/**
 * The calendar view's read (roadmap 3.3a; docs/porting/maps/3.3.md, "The
 * calendar view (3.3a)"; owner decisions 241 and 242): the items the list's
 * filters select with a due date in the window, the cycles, milestones and
 * project due dates around them, and the scope's working calendar.
 *
 *   - **The window** is at most 62 days (400 `CALENDAR_RANGE` otherwise);
 *     dates are date-only, never passed through a zone.
 *   - **The list's own `where`** (`resolveListFiltersInTx`,
 *     `WorkItemRepository._buildWhere`), so a calendar and a list with the
 *     same filters hold the same items. Closed items are included (shown
 *     done); undated ones are counted, not drawn.
 *   - **At most 2,000 items**, read one past the limit; above it a 422
 *     `CALENDAR_TOO_LARGE` with the count, never a cut-off grid.
 *   - **Cycles** (`cycles.view`) and **milestones and project due dates**
 *     (`projects.view`): a caller without the key gets the source named in
 *     `omitted`, never a silent gap; each bounded, a reached bound named in
 *     `truncated`. Which: the filters' cycles, else the cycles of the teams
 *     in view (the `teamId` filter's, the items' and the projects'); the
 *     milestones the `milestoneId` filter names, else those of the projects
 *     in view (the `projectId` filter's and the items'); and those projects'
 *     due dates.
 *   - **The working calendar** of the scope: one team's when the scope is one
 *     team, project, cycle or milestone, else the workspace's; "today" in its
 *     zone (decision 191).
 *
 * Reads only, never audited; no description, comment or field value is read.
 *
 * Written fresh for Islestone; inflect-compliance's compliance-calendar
 * aggregation (`src/app-layer/usecases/compliance-calendar/`, 5528464)
 * supplied the pattern "a capped result says so, an omitted source is named"
 * (pattern only, no code copied).
 */
import { formatKey } from '../domain/work-item-key';
import { fromEpochDay, toEpochDay, todayIn } from '../domain/schedule/calendar';
import { mayReadCycles } from '../policies/cycle.policies';
import { mayReadMilestones } from '../policies/milestone.policies';
import { visibleProjects } from '../policies/project-visibility';
import { assertCanReadWorkItems } from '../policies/work-item.policies';
import { CycleRepository } from '../repositories/CycleRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { resolveListFiltersInTx, type ListWorkItemsQuery } from './work-item';
import { resolveWorkingCalendars } from './working-calendar';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, ValidationError } from '@/lib/errors/types';
import {
    CALENDAR_CYCLE_LIMIT,
    CALENDAR_ITEM_LIMIT,
    CALENDAR_MAX_DAYS,
    CALENDAR_MILESTONE_LIMIT,
    CALENDAR_RANGE,
    CALENDAR_TOO_LARGE,
    daysBetween,
    type CalendarOmission,
    type CalendarProject,
    type CalendarResponse,
    type CalendarTooLargeDetails,
} from '@/lib/work-items/calendar';
import { todayClock } from '@/lib/clock';

/** The calendar's query: the list's filters (its order, cursor and page size do not apply) and the window. */
export type CalendarQuery = Omit<ListWorkItemsQuery, 'order' | 'dir' | 'cursor' | 'limit'> & { from: string; to: string };

const dateOnly = (d: Date | null): string | null => (d ? fromEpochDay(toEpochDay(d)) : null);
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** One id when a filter names exactly one (`a`, not `a,b` or `none`). */
function single(value: string | undefined | null): string | null {
    if (!value || value.includes(',') || value === 'none' || value === 'current') return null;
    return value;
}

function assertWindow(from: string, to: string): void {
    const span = daysBetween(from, to);
    if (span < 0 || span + 1 > CALENDAR_MAX_DAYS) {
        throw new ValidationError(`A calendar reads from a date to a date at most ${CALENDAR_MAX_DAYS} days later.`, { reason: CALENDAR_RANGE, maxDays: CALENDAR_MAX_DAYS });
    }
}

export async function getWorkItemCalendar(ctx: RequestContext, query: CalendarQuery): Promise<CalendarResponse> {
    assertCanReadWorkItems(ctx);
    const { from, to, ...filters } = query;
    assertWindow(from, to);
    const window = { from: asDate(from), to: asDate(to) };
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const { listFilters, keyHit, today } = await resolveListFiltersInTx(db, ctx, v, filters);

        // 1. The items due in the window, one past the limit to know it is over it.
        const rows = await WorkItemRepository.listForCalendar(db, ctx, v, listFilters, { ...window, take: CALENDAR_ITEM_LIMIT + 1, keyHit, today });
        if (rows.length > CALENDAR_ITEM_LIMIT) {
            const count = await WorkItemRepository.countForCalendar(db, ctx, v, listFilters, { ...window, keyHit, today });
            const details: CalendarTooLargeDetails = { reason: CALENDAR_TOO_LARGE, count, limit: CALENDAR_ITEM_LIMIT };
            throw new AppError(`This calendar would show ${count} items; it shows at most ${CALENDAR_ITEM_LIMIT}. Narrow the filter.`, CALENDAR_TOO_LARGE, 422, true, details);
        }
        const noDueDate = await WorkItemRepository.countWithoutDueDate(db, ctx, v, listFilters, { keyHit, today });

        // 2. The projects in view: the items', and the one the filters name (with the scope's team).
        const projects = new Map<string, CalendarProject & { teamId: string }>();
        for (const r of rows) {
            if (!projects.has(r.projectId)) {
                projects.set(r.projectId, {
                    id: r.projectId,
                    teamId: r.teamId,
                    name: r.project.name,
                    keyPrefix: r.project.keyPrefix,
                    dueDate: dateOnly(r.project.dueDate),
                    archived: r.project.archivedAt !== null,
                });
            }
        }
        const milestoneFilter = (listFilters.milestoneId ?? '').split(',').filter((id) => id && id !== 'none');
        const filterMilestones = await MilestoneRepository.byIds(db, ctx, milestoneFilter);
        const wanted = [single(listFilters.projectId), ...filterMilestones.map((m) => m.projectId)].filter((id): id is string => id !== null && !projects.has(id));
        for (const p of await ProjectRepository.visibleByIds(db, ctx, v, [...new Set(wanted)])) {
            projects.set(p.id, { id: p.id, teamId: p.teamId, name: p.name, keyPrefix: p.keyPrefix, dueDate: dateOnly(p.dueDate), archived: p.archivedAt !== null });
        }

        // 3. The cycles: the filters' cycles, else the cycles of the teams in view.
        const omitted: CalendarOmission[] = [];
        const truncated: CalendarOmission[] = [];
        const cycleFilter = (listFilters.cycleId ?? '').split(',').filter((id) => id && id !== 'none');
        let cycles: CalendarResponse['cycles'] = [];
        let scopeCycleTeam: string | null = null;
        if (!mayReadCycles(ctx)) {
            omitted.push('cycles');
        } else {
            const teamIds = [...new Set([...(single(listFilters.teamId) ? [listFilters.teamId!] : []), ...rows.map((r) => r.teamId), ...[...projects.values()].map((p) => p.teamId)])];
            const read = await CycleRepository.inWindow(db, ctx, cycleFilter.length > 0 ? { ids: cycleFilter } : { teamIds }, window.from, window.to, CALENDAR_CYCLE_LIMIT + 1);
            if (read.length > CALENDAR_CYCLE_LIMIT) truncated.push('cycles');
            cycles = read.slice(0, CALENDAR_CYCLE_LIMIT).map((c) => ({ id: c.id, teamId: c.teamId, number: c.number, name: c.name, startsOn: dateOnly(c.startsOn)!, endsOn: dateOnly(c.endsOn)! }));
            if (cycleFilter.length === 1) scopeCycleTeam = read.find((c) => c.id === cycleFilter[0])?.teamId ?? null;
        }

        // 4. Milestones and project due dates: the filter's milestones, else those of the projects in view.
        let milestones: CalendarResponse['milestones'] = [];
        if (!mayReadMilestones(ctx)) {
            omitted.push('milestones');
        } else {
            const inView = [...projects.keys()];
            const read =
                milestoneFilter.length > 0
                    ? filterMilestones.filter((m) => projects.has(m.projectId) && m.dueDate !== null && m.dueDate >= window.from && m.dueDate <= window.to)
                    : await MilestoneRepository.datedInWindow(db, ctx, inView, window.from, window.to, CALENDAR_MILESTONE_LIMIT + 1);
            if (read.length > CALENDAR_MILESTONE_LIMIT) truncated.push('milestones');
            milestones = read.slice(0, CALENDAR_MILESTONE_LIMIT).map((m) => ({ id: m.id, projectId: m.projectId, name: m.name, dueDate: dateOnly(m.dueDate)! }));
        }

        // 5. The scope's working calendar and today in its zone.
        const scopeTeam =
            single(listFilters.teamId) ??
            (single(listFilters.projectId) ? (projects.get(listFilters.projectId!)?.teamId ?? null) : null) ??
            scopeCycleTeam ??
            (milestoneFilter.length === 1 ? (projects.get(filterMilestones[0]?.projectId ?? '')?.teamId ?? null) : null);
        const calendars = await resolveWorkingCalendars(db, ctx, scopeTeam ? [scopeTeam] : []);
        const cal = scopeTeam ? calendars.forTeam(scopeTeam) : calendars.workspace;
        const fromDay = toEpochDay(from);
        const toDay = toEpochDay(to);

        return {
            from,
            to,
            asOf: fromEpochDay(todayIn(cal.timeZone, todayClock(cal.timeZone))),
            items: rows.map((r) => ({
                id: r.id,
                key: formatKey(r.project.keyPrefix, r.number),
                title: r.title,
                projectId: r.projectId,
                teamId: r.teamId,
                typeId: r.typeId,
                stateCategory: r.stateCategory,
                assigneeId: r.assigneeId,
                parentId: r.parentId,
                cycleId: r.cycleId,
                milestoneId: r.milestoneId,
                startDate: dateOnly(r.startDate),
                dueDate: dateOnly(r.dueDate),
                version: r.version,
            })),
            noDueDate,
            cycles,
            milestones,
            projects: [...projects.values()].map(({ teamId: _teamId, ...p }) => {
                void _teamId;
                return omitted.includes('milestones') ? { ...p, dueDate: null } : p;
            }),
            calendar: {
                id: cal.id,
                teamId: scopeTeam && cal.id !== calendars.workspace.id ? scopeTeam : null,
                timeZone: cal.timeZone,
                workingWeekdays: [...cal.spec.workingWeekdays],
                holidays: cal.spec.holidays.filter((h) => h >= fromDay && h <= toDay).map((h) => fromEpochDay(h)),
            },
            omitted,
            truncated,
        };
    });
}
