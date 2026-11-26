/**
 * The roadmap (sub-phase 3.2c; docs/porting/maps/3.2.md, "The roadmap";
 * owner decisions 210, 215, 216 and 217): initiatives as summary rows (or
 * goals, `groupBy=goal`), their projects as bars, stored due dates as
 * diamonds. A page, not a model (ADR 0006's Roadmap row), and read-only:
 * nothing here writes, audits or stores.
 *
 *   - **A bar is derived, never stored** (decision 215). A project's bar is
 *     the engine's span of its live, non-cancelled items' stored dates on its
 *     team's working calendar (`spanFromBounds`, decision 185's one-date
 *     rule), from ONE aggregate that never loads an item; an initiative's is
 *     the span of its projects (`spanOf`); a goal's the span of its subtree's
 *     initiatives' projects and of the items naming it, or a goal below it,
 *     directly (decision 211). The engine's pass is not run: no "today", no
 *     relation, no actual date, no forecast ("Planned dates"); a bar opens the
 *     timeline where it runs (decision 217).
 *   - **Due dates are diamonds** (decision 210): a goal's or an initiative's
 *     is not an engine deadline; a project finishing after its initiative's
 *     or that initiative's goal's due date is flagged, and nothing else.
 *   - **A project is late** when its due date has passed with open items, its
 *     latest open item is due after it, or one of its milestones is late
 *     (2.5b's rule, today in `NOTIFICATIONS_TZ`); goals, initiatives and
 *     projects read today in the workspace calendar's zone (3.1, decision 191).
 *   - **At most 500 projects** (archived ones counted): above it 422
 *     `ROADMAP_TOO_LARGE` with the count, never a cut list; so are more than
 *     2,000 dated milestones, goals or initiatives.
 *   - **Archived projects count** towards their initiative's bar and progress
 *     (decision 212's reason: finished projects are usually archived) and are
 *     shown only when `archived=true`, as archived goals and initiatives are.
 *
 * Seven statements whatever the size: the tenant binding, the goals and
 * initiatives (one statement), the projects, their dated milestones, the
 * aggregate, and the working calendars with their holidays (two). No
 * description, comment or custom-field value is read.
 *
 * Written fresh for Islestone.
 */
import type { GoalStatus, Health, InitiativeStatus, WorkflowStateCategory } from '@prisma/client';

import { NO_PROGRESS, goalProgress, isLate, progressOf, sumProgress, type DirectGoalCount, type Progress } from '../domain/progress';
import { fromEpochDay, toEpochDay, todayIn } from '../domain/schedule/calendar';
import { mergeBounds, spanFromBounds, spanOf, type DaySpan, type SpanBounds } from '../domain/schedule/span';
import { assertCanReadGoals } from '../policies/goal.policies';
import { visibleProjects } from '../policies/project-visibility';
import { assertCanReadWorkConfig } from '../policies/work-config.policies';
import { GoalRepository } from '../repositories/GoalRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { ProjectRepository, type RoadmapProjectScope } from '../repositories/ProjectRepository';
import { WorkItemRepository, type RoadmapAggregateRow } from '../repositories/WorkItemRepository';
import { todayInTz } from '../notifications/work-item-due';
import type { RequestContext } from '../types';
import { byStatusDueTitle, goalNotFound, initiativeNotFound, parseHealth, parseStatuses } from './goal-shared';
import { notificationsTz } from './work-item-shared';
import { resolveWorkingCalendars } from './working-calendar';
import { runInTenantContext } from '@/lib/db-context';
import { AppError } from '@/lib/errors/types';
import {
    ROADMAP_MILESTONE_LIMIT,
    ROADMAP_PROJECT_LIMIT,
    ROADMAP_RECORD_LIMIT,
    ROADMAP_TOO_LARGE,
    type RoadmapGoal,
    type RoadmapGroupBy,
    type RoadmapInitiative,
    type RoadmapMilestone,
    type RoadmapProject,
    type RoadmapResponse,
    type RoadmapSpan,
    type RoadmapTooLargeDetails,
} from '@/lib/goals/roadmap';
import type { RoadmapQuery } from '@/lib/schemas/goal';
import { todayClock } from '@/lib/clock';

function tooLarge(what: RoadmapTooLargeDetails['what'], count: number, limit: number): AppError {
    const details: RoadmapTooLargeDetails = { reason: ROADMAP_TOO_LARGE, count, limit, what };
    return new AppError(`This roadmap would show ${count} ${what}; it shows at most ${limit}. Narrow the filter.`, ROADMAP_TOO_LARGE, 422, true, details);
}

const day = (d: Date | null): number | null => (d ? toEpochDay(d) : null);
const dayText = (d: Date | null): string | null => (d ? fromEpochDay(toEpochDay(d)) : null);
const spanText = (s: DaySpan | null): RoadmapSpan | null => (s ? { start: fromEpochDay(s.start), end: fromEpochDay(s.end) } : null);
const boundsOfRow = (r: RoadmapAggregateRow): SpanBounds => ({ minStart: day(r.minStart), minDueOnly: day(r.minDueOnly), maxDue: day(r.maxDue), maxStartOnly: day(r.maxStartOnly) });
const progressData = (p: Progress) => ({ scope: p.scope, done: p.done, started: p.started });
const isOpen = (c: WorkflowStateCategory) => c !== 'DONE' && c !== 'CANCELLED';

function matches<T extends { status: GoalStatus | InitiativeStatus; health: Health | null; leadUserId: string | null }>(
    row: T,
    statuses: readonly string[] | undefined,
    health: ReadonlyArray<Health | null> | undefined,
    leadUserId: string | undefined,
): boolean {
    if (statuses && statuses.length > 0 && !statuses.includes(row.status)) return false;
    if (health && health.length > 0 && !health.includes(row.health)) return false;
    if (leadUserId && row.leadUserId !== leadUserId) return false;
    return true;
}

/** `id` and every live goal below it. */
function subtreeOf(id: string, children: ReadonlyMap<string, readonly string[]>): Set<string> {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
        for (const c of children.get(stack.pop()!) ?? []) {
            if (out.has(c)) continue;
            out.add(c);
            stack.push(c);
        }
    }
    return out;
}

export async function getRoadmap(ctx: RequestContext, query: RoadmapQuery = {}): Promise<RoadmapResponse> {
    assertCanReadGoals(ctx);
    // The roadmap draws projects: it asks `projects.view` too (the map's "Usecases, routes and keys").
    assertCanReadWorkConfig(ctx);
    const statuses = parseStatuses(query.status);
    const health = parseHealth(query.health);
    const showArchived = query.archived === 'true';
    const groupBy: RoadmapGroupBy = query.groupBy === 'goal' ? 'goal' : 'initiative';

    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);

        // 1. The live goals and initiatives (archived ones read; shown only when asked).
        const records = await GoalRepository.roadmapRecords(db, ctx, ROADMAP_RECORD_LIMIT + 1);
        const goalRows = records.filter((r) => r.kind === 'goal').map((r) => ({ ...r, parentId: r.parentId, title: r.label }));
        const initiativeRows = records.filter((r) => r.kind === 'initiative').map((r) => ({ ...r, goalId: r.parentId, name: r.label }));
        if (goalRows.length > ROADMAP_RECORD_LIMIT) throw tooLarge('goals', goalRows.length, ROADMAP_RECORD_LIMIT);
        if (initiativeRows.length > ROADMAP_RECORD_LIMIT) throw tooLarge('initiatives', initiativeRows.length, ROADMAP_RECORD_LIMIT);
        const goalsById = new Map(goalRows.map((g) => [g.id, g]));
        const initiativesById = new Map(initiativeRows.map((i) => [i.id, i]));
        if (query.goalId && !goalsById.has(query.goalId)) goalNotFound();
        if (query.initiativeId && !initiativesById.has(query.initiativeId)) initiativeNotFound();

        const children = new Map<string, string[]>();
        for (const g of goalRows) if (g.parentId && goalsById.has(g.parentId)) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
        const goalScope = query.goalId ? subtreeOf(query.goalId, children) : new Set(goalRows.map((g) => g.id));

        // The initiatives in scope: the filters select initiatives (decision 220's filters, here over the records).
        const inScope = initiativeRows.filter(
            (i) =>
                (showArchived || i.archivedAt === null || i.id === query.initiativeId) &&
                (!query.initiativeId || i.id === query.initiativeId) &&
                (!query.goalId || (i.goalId !== null && goalScope.has(i.goalId))) &&
                matches(i, statuses, health, query.leadUserId),
        );
        const narrowedToInitiatives = Boolean(query.goalId || query.initiativeId || (statuses && statuses.length) || (health && health.length) || query.leadUserId);

        // 2. The projects: of those initiatives, and the unlinked ones when nothing narrows to initiatives.
        const scope: RoadmapProjectScope = {
            initiativeIds: inScope.map((i) => i.id),
            unlinked: !narrowedToInitiatives,
            liveInitiativeIds: initiativeRows.map((i) => i.id),
            teamId: query.teamId,
        };
        const projects = await ProjectRepository.roadmapProjects(db, ctx, v, scope, ROADMAP_PROJECT_LIMIT + 1);
        if (projects.length > ROADMAP_PROJECT_LIMIT) throw tooLarge('projects', await ProjectRepository.countRoadmapProjects(db, ctx, v, scope), ROADMAP_PROJECT_LIMIT);
        const projectIds = projects.map((p) => p.id);

        // 3. Their dated milestones.
        const milestoneRows = await MilestoneRepository.datedForProjects(db, ctx, projectIds, ROADMAP_MILESTONE_LIMIT + 1);
        if (milestoneRows.length > ROADMAP_MILESTONE_LIMIT) throw tooLarge('milestones', milestoneRows.length, ROADMAP_MILESTONE_LIMIT);

        // 4. The aggregate: the project path, and the direct path when grouped by goal.
        const directGoalIds = groupBy === 'goal' ? [...goalScope] : [];
        const rows = await WorkItemRepository.roadmapAggregate(db, ctx, v, { projectIds, goalIds: directGoalIds, teamId: query.teamId });

        // 5. The calendars of the teams in view, and today.
        const teamIds = [...new Set([...projects.map((p) => p.teamId), ...rows.flatMap((r) => (r.teamId ? [r.teamId] : []))])];
        const calendars = await resolveWorkingCalendars(db, ctx, teamIds);
        const today = todayIn(calendars.workspace.timeZone, todayClock(calendars.workspace.timeZone));
        const milestoneToday = toEpochDay(todayInTz(todayClock(notificationsTz()), notificationsTz()));

        // ── Projects ──
        const projectRows = new Map<string, RoadmapAggregateRow[]>();
        const milestoneCounts = new Map<string, Array<{ stateCategory: WorkflowStateCategory; count: number }>>();
        const direct: Array<RoadmapAggregateRow & { goalId: string }> = [];
        for (const r of rows) {
            if (r.path === 'g') {
                if (r.goalId) direct.push(r as RoadmapAggregateRow & { goalId: string });
                continue;
            }
            projectRows.set(r.projectId, [...(projectRows.get(r.projectId) ?? []), r]);
            if (r.milestoneId) milestoneCounts.set(r.milestoneId, [...(milestoneCounts.get(r.milestoneId) ?? []), r]);
        }
        const milestones: RoadmapMilestone[] = milestoneRows.map((m) => {
            const p = progressOf(milestoneCounts.get(m.id) ?? []);
            return { id: m.id, projectId: m.projectId, name: m.name, dueDate: dayText(m.dueDate)!, late: isLate(day(m.dueDate), p, milestoneToday) };
        });
        const lateMilestones = new Map<string, number>();
        for (const m of milestones) if (m.late) lateMilestones.set(m.projectId, (lateMilestones.get(m.projectId) ?? 0) + 1);

        interface ProjectFacts {
            span: DaySpan | null;
            progress: Progress;
        }
        const facts = new Map<string, ProjectFacts>();
        const projectDtos = new Map<string, RoadmapProject>();
        for (const p of projects) {
            const own = projectRows.get(p.id) ?? [];
            const span = spanFromBounds(mergeBounds(own.map(boundsOfRow)), calendars.forTeam(p.teamId).compiled);
            const progress = progressOf(own);
            facts.set(p.id, { span, progress });
            const due = day(p.dueDate);
            const openMaxDue = own.filter((r) => isOpen(r.stateCategory)).reduce<number | null>((m, r) => {
                const d = day(r.maxDue);
                return d === null ? m : m === null ? d : Math.max(m, d);
            }, null);
            const overdue = isLate(due, progress, today);
            const itemDueAfter = due !== null && openMaxDue !== null && openMaxDue > due;
            const late = lateMilestones.get(p.id) ?? 0;
            const initiative = p.initiativeId ? initiativesById.get(p.initiativeId) : undefined;
            const goal = initiative?.goalId ? goalsById.get(initiative.goalId) : undefined;
            const initiativeDue = day(initiative?.dueDate ?? null);
            const goalDue = day(goal?.dueDate ?? null);
            projectDtos.set(p.id, {
                id: p.id,
                name: p.name,
                keyPrefix: p.keyPrefix,
                teamId: p.teamId,
                initiativeId: initiative ? initiative.id : null,
                dueDate: dayText(p.dueDate),
                archived: p.archivedAt !== null,
                span: spanText(span),
                progress: progressData(progress),
                overdue,
                itemDueAfter,
                lateMilestones: late,
                late: overdue || itemDueAfter || late > 0,
                finishesAfterInitiativeDue: span !== null && initiativeDue !== null && span.end > initiativeDue,
                finishesAfterGoalDue: span !== null && goalDue !== null && span.end > goalDue,
            });
        }
        const projectsOf = new Map<string | null, string[]>();
        for (const p of projectDtos.values()) projectsOf.set(p.initiativeId, [...(projectsOf.get(p.initiativeId) ?? []), p.id]);

        // ── Initiatives: the span of their projects (archived ones included) ──
        const shownInitiatives = inScope.filter((i) => !query.teamId || (projectsOf.get(i.id)?.length ?? 0) > 0).sort(byStatusDueTitle<(typeof inScope)[number]>((r) => r.name));
        const initiatives: RoadmapInitiative[] = shownInitiatives.map((i) => {
            const own = (projectsOf.get(i.id) ?? []).map((id) => facts.get(id)!);
            const span = spanOf(own.map((f) => f.span));
            const progress = sumProgress(own.map((f) => f.progress));
            const due = day(i.dueDate);
            return {
                id: i.id,
                goalId: i.goalId && goalsById.has(i.goalId) ? i.goalId : null,
                name: i.name,
                status: i.status,
                dueDate: dayText(i.dueDate),
                health: i.health,
                leadUserId: i.leadUserId,
                archived: i.archivedAt !== null,
                span: spanText(span),
                progress: progressData(progress),
                late: isLate(due, progress, today),
                finishesAfterDue: due !== null && own.some((f) => f.span !== null && f.span.end > due),
            };
        });

        const unlinkedIds = projectsOf.get(null) ?? [];
        const unlinkedFacts = unlinkedIds.map((id) => facts.get(id)!);
        const unlinked = {
            shown: scope.unlinked && unlinkedIds.length > 0,
            span: spanText(spanOf(unlinkedFacts.map((f) => f.span))),
            progress: progressData(sumProgress(unlinkedFacts.map((f) => f.progress))),
        };

        // ── Goals ──
        const goals: RoadmapGoal[] = groupBy === 'goal' ? goalsByGoal() : goalNames();

        function goalNames(): RoadmapGoal[] {
            const named = new Set(initiatives.flatMap((i) => (i.goalId ? [i.goalId] : [])));
            return goalRows
                .filter((g) => named.has(g.id))
                .map((g) => ({ ...goalBase(g), span: null, progress: progressData(NO_PROGRESS), late: false, finishesAfterDue: false }));
        }

        function goalBase(g: (typeof goalRows)[number]) {
            return {
                id: g.id,
                parentId: g.parentId && goalsById.has(g.parentId) ? g.parentId : null,
                title: g.title,
                status: g.status,
                dueDate: dayText(g.dueDate),
                health: g.health,
                leadUserId: g.leadUserId,
                archived: g.archivedAt !== null,
            };
        }

        function goalsByGoal(): RoadmapGoal[] {
            // The projects of each goal's own initiatives (every project read: archived ones count).
            const projectsOfGoal = new Map<string, string[]>();
            for (const i of shownInitiatives) if (i.goalId) projectsOfGoal.set(i.goalId, [...(projectsOfGoal.get(i.goalId) ?? []), ...(projectsOf.get(i.id) ?? [])]);
            const byProject = new Map([...facts].map(([id, f]) => [id, f.progress]));
            const directCounts: DirectGoalCount[] = direct.map((r) => ({ goalId: r.goalId, projectId: r.projectId, stateCategory: r.stateCategory, count: r.count }));
            // The goals shown: with nothing narrowing, every goal in scope; else the ones above what is shown.
            const byInitiative = Boolean(query.initiativeId || (statuses && statuses.length) || (health && health.length) || query.leadUserId);
            const narrowed = byInitiative || Boolean(query.teamId);
            const shown = new Set<string>();
            const withAncestors = (id: string | null) => {
                for (let g = id, i = 0; g && goalsById.has(g) && i < 8; g = goalsById.get(g)!.parentId, i++) shown.add(g);
            };
            if (narrowed) {
                for (const i of initiatives) withAncestors(i.goalId);
                // A team narrows the direct items too: the goals they name stay (unless an initiative filter is set).
                if (!byInitiative) for (const r of direct) withAncestors(r.goalId);
                for (const id of [...shown]) if (!goalScope.has(id)) shown.delete(id);
            } else {
                for (const id of goalScope) {
                    const g = goalsById.get(id)!;
                    if (showArchived || g.archivedAt === null || id === query.goalId) shown.add(id);
                }
            }
            return goalRows
                .filter((g) => shown.has(g.id))
                .sort(byStatusDueTitle<(typeof goalRows)[number]>((r) => r.title))
                .map((g) => {
                    const subtree = subtreeOf(g.id, children);
                    const pathProjects = new Set([...subtree].flatMap((id) => projectsOfGoal.get(id) ?? []));
                    const progress = goalProgress(pathProjects, subtree, byProject, directCounts);
                    const directSpans = direct
                        .filter((r) => subtree.has(r.goalId))
                        .map((r) => spanFromBounds(boundsOfRow(r), calendars.forTeam(r.teamId).compiled));
                    const span = spanOf([...[...pathProjects].map((id) => facts.get(id)?.span ?? null), ...directSpans]);
                    const due = day(g.dueDate);
                    return {
                        ...goalBase(g),
                        span: spanText(span),
                        progress: progressData(progress),
                        late: isLate(due, progress, today),
                        finishesAfterDue: due !== null && [...pathProjects].some((id) => {
                            const s = facts.get(id)?.span;
                            return s != null && s.end > due;
                        }),
                    };
                });
        }

        return {
            asOf: fromEpochDay(today),
            groupBy,
            goals,
            initiatives,
            projects: [...projectDtos.values()].filter((p) => showArchived || !p.archived),
            milestones: milestones.filter((m) => showArchived || !projectDtos.get(m.projectId)?.archived),
            unlinked,
        };
    });
}
