/**
 * The timeline read (roadmap 3.1b; ADR 0010; owner decisions 184 to 198):
 * the items the list's filters select, the blocks relations that touch them,
 * the working calendars they count on and their deadlines, and the engine's
 * answer over all of it, computed here on every read (decision 197) and
 * never stored (decision 184).
 *
 *   - **At most 5,000 items** (decision 196). A larger scope is a 422
 *     `TIMELINE_TOO_LARGE` carrying the count; never a cut-off list. So is a
 *     scope whose relations pass `TIMELINE_EDGE_LIMIT`.
 *   - **The list's own `where`** (`resolveListFiltersInTx`,
 *     `WorkItemRepository._buildWhere`), so a timeline and a list with the
 *     same filters hold the same items.
 *   - **A relation's other end** outside the scope is a context row when the
 *     caller sees it (live, in a project it sees), at most 500, in id order;
 *     one it cannot see is dropped and counted (`hiddenDependencies`), never
 *     named. Past 500 context rows the rest are counted
 *     (`omittedContextRows`) and their relations left out.
 *   - **Calendars** come from `resolveWorkingCalendars`; "today" is today in
 *     the workspace calendar's zone (decision 191), and an item's actual
 *     dates are read in its own calendar's zone (decision 187).
 *
 * Reads only, never audited; no description, comment or field value is read.
 *
 * Written fresh for Islestone.
 */
import { formatKey } from '../domain/work-item-key';
import { fromEpochDay, toEpochDay, todayIn } from '../domain/schedule/calendar';
import { assertCanReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { WorkItemRelationRepository } from '../repositories/WorkItemRelationRepository';
import { WorkItemRepository, type WorkItemTimelineRow } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { resolveListFiltersInTx, type ListWorkItemsQuery } from './work-item';
import { resolveWorkingCalendars, type WorkingCalendarSet } from './working-calendar';
import { runInTenantContext } from '@/lib/db-context';
import { AppError } from '@/lib/errors/types';
import {
    TIMELINE_CONTEXT_LIMIT,
    TIMELINE_EDGE_LIMIT,
    TIMELINE_ITEM_LIMIT,
    TIMELINE_TOO_LARGE,
    computeTimelineSchedule,
    type TimelineData,
    type TimelineEdge,
    type TimelineMilestone,
    type TimelineProject,
    type TimelineResponse,
    type TimelineRow,
    type TimelineTooLargeDetails,
} from '@/lib/work-items/timeline';
import { todayClock } from '@/lib/clock';

/** The timeline's query: the list's filters (its order, cursor and page size do not apply). */
export type TimelineQuery = Omit<ListWorkItemsQuery, 'order' | 'dir' | 'cursor' | 'limit'>;

function tooLarge(count: number, limit: number, what: TimelineTooLargeDetails['what']): AppError {
    const details: TimelineTooLargeDetails = { reason: TIMELINE_TOO_LARGE, count, limit, what };
    const message =
        what === 'items'
            ? `This timeline would show ${count} items; it shows at most ${limit}. Narrow the filter.`
            : `This timeline's items have ${count} blocks relations; it reads at most ${limit}. Narrow the filter.`;
    return new AppError(message, TIMELINE_TOO_LARGE, 422, true, details);
}

const dateOnly = (d: Date | null): string | null => (d ? fromEpochDay(toEpochDay(d)) : null);

function rowOf(r: WorkItemTimelineRow, calendars: WorkingCalendarSet, context: boolean): TimelineRow {
    const cal = calendars.forTeam(r.teamId);
    return {
        id: r.id,
        key: formatKey(r.project.keyPrefix, r.number),
        title: r.title,
        projectId: r.projectId,
        teamId: r.teamId,
        typeId: r.typeId,
        stateCategory: r.stateCategory,
        assigneeId: r.assigneeId,
        parentId: r.parentId,
        sortKey: r.sortKey,
        startDate: dateOnly(r.startDate),
        dueDate: dateOnly(r.dueDate),
        actualStart: r.startedAt ? fromEpochDay(todayIn(cal.timeZone, r.startedAt)) : null,
        actualFinish: r.completedAt ? fromEpochDay(todayIn(cal.timeZone, r.completedAt)) : null,
        milestoneId: r.milestoneId,
        calendarId: cal.id,
        version: r.version,
        context,
    };
}

export async function getWorkItemTimeline(ctx: RequestContext, query: TimelineQuery = {}): Promise<TimelineResponse> {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const { listFilters, keyHit, today } = await resolveListFiltersInTx(db, ctx, v, query);

        // 1. The scope, one past the limit to know it is over it.
        const scope = await WorkItemRepository.listForTimeline(db, ctx, v, listFilters, { take: TIMELINE_ITEM_LIMIT + 1, keyHit, today });
        if (scope.length > TIMELINE_ITEM_LIMIT) {
            const count = await WorkItemRepository.countForTimeline(db, ctx, v, listFilters, { keyHit, today });
            throw tooLarge(count, TIMELINE_ITEM_LIMIT, 'items');
        }
        const scopeIds = new Set(scope.map((r) => r.id));

        // 2. Blocks relations with either end in the scope.
        const relations = await WorkItemRelationRepository.blocksTouching(db, ctx, [...scopeIds], TIMELINE_EDGE_LIMIT + 1);
        if (relations.length > TIMELINE_EDGE_LIMIT) {
            throw tooLarge(await WorkItemRelationRepository.countBlocksTouching(db, ctx, [...scopeIds]), TIMELINE_EDGE_LIMIT, 'relations');
        }

        // 3. Ends outside the scope: context rows when visible, else counted.
        const outside = [...new Set(relations.flatMap((e) => [e.fromId, e.toId]).filter((id) => !scopeIds.has(id)))];
        const visibleOutside = await WorkItemRelationRepository.visibleIds(db, ctx, v, outside);
        const contextIds = [...visibleOutside].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const context = await WorkItemRepository.timelineContextRows(db, ctx, v, contextIds, TIMELINE_CONTEXT_LIMIT);
        const shown = new Set([...scopeIds, ...context.map((r) => r.id)]);
        let hiddenDependencies = 0;
        const edges: TimelineEdge[] = [];
        for (const e of relations) {
            const hidden = [e.fromId, e.toId].some((id) => !scopeIds.has(id) && !visibleOutside.has(id));
            if (hidden) hiddenDependencies++;
            else if (shown.has(e.fromId) && shown.has(e.toId)) edges.push({ id: e.id, fromId: e.fromId, toId: e.toId });
        }

        // 4. Calendars, deadlines and today.
        const all = [...scope, ...context];
        const calendars = await resolveWorkingCalendars(db, ctx, [...new Set(all.map((r) => r.teamId))]);
        const projectIds = [...new Set(all.map((r) => r.projectId))];
        const milestoneRows = await MilestoneRepository.listForProjects(db, ctx, projectIds);
        const projects = new Map<string, TimelineProject>();
        for (const r of all) {
            if (!projects.has(r.projectId)) {
                projects.set(r.projectId, {
                    id: r.projectId,
                    name: r.project.name,
                    keyPrefix: r.project.keyPrefix,
                    dueDate: dateOnly(r.project.dueDate),
                    archived: r.project.archivedAt !== null,
                });
            }
        }
        const milestones: TimelineMilestone[] = milestoneRows.map((m) => ({ id: m.id, projectId: m.projectId, name: m.name, dueDate: dateOnly(m.dueDate) }));

        const data: TimelineData = {
            asOf: fromEpochDay(todayIn(calendars.workspace.timeZone, todayClock(calendars.workspace.timeZone))),
            rows: [...scope.map((r) => rowOf(r, calendars, false)), ...context.map((r) => rowOf(r, calendars, true))],
            edges,
            calendars: calendars.all().map((c) => ({
                id: c.id,
                teamId: c.id === calendars.workspace.id ? null : (all.find((r) => calendars.forTeam(r.teamId).id === c.id)?.teamId ?? null),
                timeZone: c.timeZone,
                workingWeekdays: [...c.spec.workingWeekdays],
                holidays: c.spec.holidays.map((h) => fromEpochDay(h)),
            })),
            milestones,
            projects: [...projects.values()],
            hiddenDependencies,
            omittedContextRows: visibleOutside.size - context.length,
        };
        return { ...data, schedule: computeTimelineSchedule(data) };
    });
}
