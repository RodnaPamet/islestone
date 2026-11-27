/**
 * Plan checks on the seeded database (Hardening H2a; docs/porting/maps/H2.md
 * part 1.2; owner decision 168: deterministic, blocking on every pull request
 * at 10k).
 *
 * Every query in PLAN_CHECKED_QUERIES runs its real repository methods with
 * realistic arguments, as the heavy member, inside `runInTenantContext`
 * (`app_user`, row-level security on), with auto_explain capturing each
 * statement's plan as it executes. Each query must:
 *   - read no guarded table (`WorkItem`, `Comment`, `SearchVector`,
 *     `WorkItemTransition`, `AuditLog`) with a sequential scan;
 *   - use the indexes it names;
 *   - stay under its shared-buffer budget.
 * Needs the seeded database (`scripts/seed-scale/`), `DIRECT_DATABASE_URL`,
 * and runs only in the `perf` project (`npm run test:perf`).
 */
import { capturePlans } from './plan-env';

import * as fs from 'node:fs';

import type { PrismaClient } from '@prisma/client';

import { SORT_KEY_REBALANCE_LENGTH } from '@/app-layer/domain/fractional-index';
import { visibleProjects, type ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { ProjectRepository } from '@/app-layer/repositories/ProjectRepository';
import { ReviewRepository } from '@/app-layer/repositories/ReviewRepository';
import { SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import { TeamRepository } from '@/app-layer/repositories/TeamRepository';
import { TimeEntryRepository } from '@/app-layer/repositories/TimeEntryRepository';
import { WorkloadRepository } from '@/app-layer/repositories/WorkloadRepository';
import { WorkItemTransitionRepository, type RecordScope } from '@/app-layer/repositories/WorkItemTransitionRepository';
import { CommentRepository, listSortSpec, WorkItemRepository, type WorkItemFilters } from '@/app-layer/repositories/WorkItemRepository';
import type { RequestContext } from '@/app-layer/types';
import { resolveWorkingCalendars } from '@/app-layer/usecases/working-calendar';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { prisma } from '@/lib/prisma';
import { sortValuesOf, type SortCursor } from '@/lib/pagination';
import type { ListSort } from '@/lib/work-items/list-sorts';

import { conditionMisses, GUARDED_TABLES, judgePlans, type CapturedPlan, type PlanVerdict } from './plan-capture';
import { bufferBudgetAt, PLAN_CHECKED_QUERIES, type PlanCheckedQuery } from './plan-checked-queries';
import { directClient, loadPerfWorld, type PerfWorld } from './perf-world';

type Runner = (w: PerfWorld, db: PrismaTx, ctx: RequestContext, v: ProjectVisibility) => Promise<unknown>;

const DAY = 86_400_000;

/** The 91 days that end with the Sunday of the week starting `monday`: Time totals' quarter (3.4d). */
function quarterTo(monday: string): { from: Date; to: Date } {
    const to = new Date(`${monday}T00:00:00Z`).getTime() + 6 * DAY;
    return { from: new Date(to - 90 * DAY), to: new Date(to) };
}
const today = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const page = (sort: ListSort, extra: { cursor?: SortCursor } = {}) => ({ limit: 50, sort: listSortSpec(sort), today: today(), ...extra });
const list = (filters: WorkItemFilters, sort: ListSort = 'manual'): Runner => (w, db, ctx, v) => WorkItemRepository.list(db, ctx, v, filters, page(sort));

/** The phrase every content search uses: two common Bulgarian words, stemmed. */
const CONTENT_QUERY = 'задачата проекта';

/** An analytics read's scope (3.6a): recorded filters as given, no filter on current values. */
const recordScope = (v: ProjectVisibility, over: Partial<RecordScope> = {}): RecordScope => ({ visibility: v, projectIds: null, teamIds: null, cycle: null, milestone: null, itemIds: null, ...over });
/** The Analytics page's default window: the twelve weeks ending today (UTC days), read now. */
const analyticsWindow = () => {
    const end = new Date(today().getTime() + DAY);
    return { from: new Date(end.getTime() - 84 * DAY), to: end, asOf: new Date(Math.min(Date.now(), end.getTime())), tz: 'UTC' };
};

const RUNNERS: Record<string, Runner> = {
    'list: project, manual order': (w, db, ctx, v) => list({ projectId: w.projectId })(w, db, ctx, v),
    'list: project, by updated': (w, db, ctx, v) => list({ projectId: w.projectId }, 'updated')(w, db, ctx, v),
    'list: project, by created': (w, db, ctx, v) => list({ projectId: w.projectId }, 'created')(w, db, ctx, v),
    'list: project, by due date': (w, db, ctx, v) => list({ projectId: w.projectId }, 'due')(w, db, ctx, v),
    'list: project, by priority': (w, db, ctx, v) => list({ projectId: w.projectId }, 'priority')(w, db, ctx, v),
    'list: project, by key': (w, db, ctx, v) => list({ projectId: w.projectId }, 'key')(w, db, ctx, v),
    'list: project, second page (keyset)': async (w, db, ctx, v) => {
        const spec = listSortSpec('manual');
        const first = await WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, page('manual'));
        const last = first[49]!;
        return WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, page('manual', { cursor: { v: sortValuesOf(spec, last), id: last.id } }));
    },
    'list: workspace, manual order': (w, db, ctx, v) => list({})(w, db, ctx, v),
    'list: workspace, two filters, by due date': (w, db, ctx, v) => list({ stateCategory: 'BACKLOG,UNSTARTED,STARTED', priority: 'HIGH,URGENT' }, 'due')(w, db, ctx, v),
    'list: project, label filter': (w, db, ctx, v) => list({ projectId: w.projectId, labelId: w.labelId })(w, db, ctx, v),
    'list: project, custom-field filter': (w, db, ctx, v) =>
        list({ projectId: w.projectId, customFields: [{ field: { id: w.selectFieldId, type: 'SELECT' }, condition: { op: 'any', ids: [w.optionId], orEmpty: false } }] })(w, db, ctx, v),
    'list: project, sorted by a custom field': (w, db, ctx, v) =>
        WorkItemRepository.listByCustomField(db, ctx, v, { projectId: w.projectId }, { limit: 50, field: { id: w.selectFieldId, type: 'SELECT' }, direction: 'asc', today: today() }),
    'list: q (titles, stemmed titles, contents)': async (w, db, ctx, v) => {
        // As `listWorkItems` builds it: stemmed titles and contents first, then the list with `q`.
        const titles = await WorkItemRepository.titleFullTextIds(db, ctx, v, CONTENT_QUERY, 1000);
        const contents = (await SearchVectorRepository.matchItems(db, ctx, v, CONTENT_QUERY, 1000)).matches;
        const substring = await WorkItemRepository.titleSubstringIds(db, ctx, v, CONTENT_QUERY, 1000);
        const ids = [...new Set([...titles, ...contents.map((m) => m.workItemId)])];
        const titleSubstringMatchIds = substring.length < 1000 ? substring : undefined;
        return WorkItemRepository.list(db, ctx, v, { q: CONTENT_QUERY, fullTextMatchIds: ids, titleSubstringMatchIds }, page('manual'));
    },
    'list: the Deleted view': (w, db, ctx, v) => WorkItemRepository.listDeleted(db, ctx, v),
    'board: one column (by state)': (w, db, ctx, v) => list({ projectId: w.bigProjectId, stateId: w.stateId })(w, db, ctx, v),
    'my work: to review': (w, db, ctx, v) => list({ reviewerId: 'me' })(w, db, ctx, v),
    'my work: assigned': (w, db, ctx, v) => list({ assigneeId: w.heavyUserId, stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: waiting on me': (w, db, ctx, v) => list({ waitingOnId: 'me', stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: created': (w, db, ctx, v) => list({ createdById: w.heavyUserId, stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: watching': (w, db, ctx, v) => list({ watching: 'me', stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: due soon': (w, db, ctx, v) => list({ assigneeId: w.heavyUserId, due: 'soon' })(w, db, ctx, v),
    'detail: the item': (w, db, ctx, v) => WorkItemRepository.getById(db, ctx, v, w.itemId),
    'detail: comments': (w, db, ctx) => CommentRepository.list(db, ctx, w.itemId, { limit: 50 }),
    'detail: sub-items and their progress': async (w, db, ctx, v) => {
        const subs = await WorkItemRepository.listSubItems(db, ctx, v, w.itemId, { limit: 50 });
        return WorkItemRepository.subItemProgress(db, ctx, subs.map((s) => s.id));
    },
    'detail: the subtree and ancestors': async (w, db, ctx) => {
        await WorkItemRepository.liveSubtree(db, ctx, [w.itemId]);
        await WorkItemRepository.subtreeHeight(db, ctx, w.itemId);
        return WorkItemRepository.ancestors(db, ctx, w.leafId);
    },
    'counts: list metrics (one project)': (w, db, ctx, v) => WorkItemRepository.metrics(db, ctx, v, { projectId: w.projectId }, today()),
    'counts: cycles': async (w, db, ctx, v) => {
        await WorkItemRepository.countsByCycle(db, ctx, v, [w.currentCycleId]);
        return WorkItemRepository.cycleIdsInUse(db, ctx, [w.currentCycleId]);
    },
    'counts: milestones': (w, db, ctx, v) => WorkItemRepository.countsByMilestone(db, ctx, v, [w.milestoneId]),
    // The seed holds no goals: the resolved scopes name its project and a goal id no item names.
    'list: goal filter (project path or own goal)': (w, db, ctx, v) => list({ goalId: 'g', goalScope: { projectIds: [w.projectId], goalIds: ['no-such-goal'] } })(w, db, ctx, v),
    'list: initiative filter': (w, db, ctx, v) => list({ initiativeId: 'i', initiativeProjectIds: [w.projectId] })(w, db, ctx, v),
    'detail: the ancestry (one statement)': (w, db, ctx, v) => WorkItemRepository.ancestry(db, ctx, v, w.leafId),
    "job: the goal purge's unlinked items": (w, db, ctx) => WorkItemRepository.lockItemsNamingGoals(db, ctx, ['no-such-goal']),
    // The project and the big project (initiatives' projects); the seed holds no goals, so the direct path names one no item names.
    'counts: progress, the project path': (w, db, ctx, v) => WorkItemRepository.countsByProjects(db, ctx, v, [w.projectId, w.bigProjectId]),
    'counts: progress, the direct goal path': (w, db, ctx, v) => WorkItemRepository.countsByGoals(db, ctx, v, ['no-such-goal']),
    // The whole roadmap of the seeded workspace: every visible project as `getRoadmap` reads them, and the
    // direct path for a goal no item names (the seed holds no goals).
    'roadmap: the aggregate (every project, both paths)': async (w, db, ctx, v) => {
        const projects = await ProjectRepository.roadmapProjects(db, ctx, v, { initiativeIds: [], unlinked: true, liveInitiativeIds: [] }, 501);
        return WorkItemRepository.roadmapAggregate(db, ctx, v, { projectIds: projects.map((p) => p.id), goalIds: ['no-such-goal'] });
    },
    'counts: items in a state': async (w, db, ctx) => {
        await TeamRepository.countItemsInState(db, ctx, w.stateId);
        await ReviewRepository.itemsInStateRequiringReview(db, ctx, w.stateId);
        return WorkItemRepository.lockInState(db, ctx, w.stateId);
    },
    'search: titles (trigram and full text)': async (w, db, ctx, v) => {
        // As `searchWorkspace` reads them: the candidates, then their rows by id.
        const hits = await WorkItemRepository.searchTitleIds(db, ctx, v, 'проект', { limit: 20 });
        return WorkItemRepository.findSearchRows(db, ctx, v, hits.map((h) => h.id));
    },
    'search: contents and snippets': async (w, db, ctx, v) => {
        const hits = (await SearchVectorRepository.matchItems(db, ctx, v, CONTENT_QUERY, 20)).matches;
        await WorkItemRepository.findSearchRows(db, ctx, v, hits.map((h) => h.workItemId));
        return WorkItemRepository.searchSnippetSources(db, ctx, v, {
            descriptionItemIds: hits.filter((h) => h.commentId === null).slice(0, 5).map((h) => h.workItemId),
            commentIds: hits.flatMap((h) => (h.commentId ? [h.commentId] : [])).slice(0, 5),
        });
    },
    'timeline: scope, count and relations': async (w, db, ctx, v) => {
        const rows = await WorkItemRepository.listForTimeline(db, ctx, v, { projectId: w.projectId }, { take: 5001, today: today() });
        await WorkItemRepository.countForTimeline(db, ctx, v, { projectId: w.projectId }, { today: today() });
        return WorkItemRepository.timelineContextRows(db, ctx, v, rows.slice(0, 500).map((r) => r.id), 500);
    },
    // A month grid around today (42 days), as the calendar view first reads it.
    'calendar: workspace, a month grid': async (w, db, ctx, v) => {
        const window = { from: new Date(today().getTime() - 14 * DAY), to: new Date(today().getTime() + 27 * DAY) };
        await WorkItemRepository.listForCalendar(db, ctx, v, {}, { ...window, take: 2001, today: today() });
        await WorkItemRepository.countForCalendar(db, ctx, v, {}, { ...window, today: today() });
        return WorkItemRepository.countWithoutDueDate(db, ctx, v, {}, { today: today() });
    },
    'calendar: project, a month grid': async (w, db, ctx, v) => {
        const window = { from: new Date(today().getTime() - 14 * DAY), to: new Date(today().getTime() + 27 * DAY) };
        await WorkItemRepository.listForCalendar(db, ctx, v, { projectId: w.projectId }, { ...window, take: 2001, today: today() });
        return WorkItemRepository.countWithoutDueDate(db, ctx, v, { projectId: w.projectId }, { today: today() });
    },
    // The push window as the calendar sync job reads it (decision 226): 30 days back, a year ahead.
    "calendar sync: a member's items and projects": async (w, db, ctx, v) => {
        const window = { from: new Date(today().getTime() - 30 * DAY), to: new Date(today().getTime() + 365 * DAY) };
        await WorkItemRepository.listAssignedForCalendarSync(db, ctx, v, w.heavyUserId, { ...window, take: 1001 });
        await WorkItemRepository.countAssignedForCalendarSync(db, ctx, v, w.heavyUserId, window);
        return WorkItemRepository.projectsWithOpenAssigned(db, ctx, v, w.heavyUserId, 1000);
    },
    // Time entries (3.4b): the heavy member's full week, as My time reads it; a day of it and their timer, as
    // every entry write asks; the item with the most time, as its Time panel reads it.
    "time: a person's week": (w, db, ctx) => {
        const from = new Date(`${w.timeWeek}T00:00:00Z`);
        return TimeEntryRepository.listForPerson(db, ctx, w.heavyUserId, from, new Date(from.getTime() + 6 * DAY));
    },
    "time: a day's total and the running timer": async (w, db, ctx) => {
        await TimeEntryRepository.dayTotal(db, ctx, w.heavyUserId, new Date(`${w.timeWeek}T00:00:00Z`));
        return TimeEntryRepository.running(db, ctx, w.heavyUserId);
    },
    "time: an item's total and first page": async (w, db, ctx) => {
        await TimeEntryRepository.itemTotals(db, ctx, w.timeItemId, w.heavyUserId);
        return TimeEntryRepository.itemPage(db, ctx, w.timeItemId, { limit: 50 });
    },
    "timesheets: a week's sums": (w, db, ctx) => {
        const from = new Date(`${w.timeWeek}T00:00:00Z`);
        return TimeEntryRepository.weekSums(db, ctx, w.heavyUserId, from, new Date(from.getTime() + 6 * DAY));
    },
    "timesheets: a page of weeks' sums": (w, db, ctx) => {
        // The heavy member's last 50 weeks: as many weeks as a page shows, each with entries.
        const from = new Date(`${w.timeWeek}T00:00:00Z`).getTime();
        return TimeEntryRepository.sumsForWeeks(db, ctx, Array.from({ length: 50 }, (_, i) => ({ userId: w.heavyUserId, weekStart: new Date(from - i * 7 * DAY) })));
    },
    // Sub-phase 3.4d: a quarter ending with the heavy member's full week, as Time totals asks for it.
    'time totals: a quarter by person and by project': async (w, db, ctx) => {
        const window = quarterTo(w.timeWeek);
        await TimeEntryRepository.totals(db, ctx, window, 'person', 2_001);
        await TimeEntryRepository.countTotalsGroups(db, ctx, window, 'project');
        return TimeEntryRepository.totals(db, ctx, window, 'project', 2_001);
    },
    "time totals: a quarter's priced lines": (w, db, ctx) => TimeEntryRepository.amountLines(db, ctx, quarterTo(w.timeWeek), 'project'),
    "time export: a month's entries": (w, db, ctx) => {
        const to = new Date(`${w.timeWeek}T00:00:00Z`).getTime() + 6 * DAY;
        return TimeEntryRepository.forExport(db, ctx, { from: new Date(to - 29 * DAY), to: new Date(to) }, 50_001);
    },
    // Workload (3.5b): the Workload page's counted work and the counts beside it, for every member over twelve
    // weeks from this week (overdue work included) and for the heavy member alone (My Work's line); the time on the
    // counted items; the members' time-off dates in the window.
    'workload: open assigned items of every member over 12 weeks': async (w, db, ctx, v) => {
        await WorkItemRepository.workloadUnplacedCounts(db, ctx, v, { take: 50_000 });
        return WorkItemRepository.listForWorkload(db, ctx, v, { take: 20_001 });
    },
    'workload: one person, two weeks': async (w, db, ctx, v) => {
        await WorkItemRepository.workloadUnplacedCounts(db, ctx, v, { assigneeIds: [w.heavyUserId], take: 50_000 });
        return WorkItemRepository.listForWorkload(db, ctx, v, { assigneeIds: [w.heavyUserId], take: 20_001 });
    },
    'time: totals for a set of items': async (w, db, ctx, v) => {
        const items = await WorkItemRepository.listForWorkload(db, ctx, v, { take: 20_001 });
        return TimeEntryRepository.totalsForItems(db, ctx, items.map((i) => i.id));
    },
    'workload: time-off dates in a window': async (w, db, ctx) => {
        // The workload read's one statement for capacity (the default, the capacity rows, the time-off window).
        const people = await WorkloadRepository.activePeople(db, ctx, 501);
        const from = today();
        return WorkloadRepository.capacityInputs(db, ctx, {
            userIds: people.map((p) => p.userId),
            from: from.toISOString().slice(0, 10),
            to: new Date(from.getTime() + 83 * DAY).toISOString().slice(0, 10),
            rowsTake: 20_000,
            timeOffTake: 100_000,
        });
    },
    'timeline: working calendars': async (w, db, ctx) => {
        await resolveWorkingCalendars(db, ctx, [w.teamId]);
        return resolveWorkingCalendars(db, ctx);
    },
    'placement: sort keys around a position': async (w, db, ctx, v) => {
        const last = await WorkItemRepository.lastSortKey(db, ctx, w.projectId);
        const [row] = await WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, { ...page('manual'), limit: 1 });
        await WorkItemRepository.nextSortKeyAfter(db, ctx, w.projectId, { sortKey: row!.sortKey, id: row!.id });
        // A restore's check for a key a live row holds (issue #110).
        await WorkItemRepository.liveSortKeysAmong(db, ctx, w.projectId, [row!.sortKey, last ?? row!.sortKey]);
        return WorkItemRepository.prevSortKeyBefore(db, ctx, w.projectId, { sortKey: last ?? row!.sortKey, id: row!.id });
    },
    "removal: a member's items": (w, db, ctx) => WorkItemRepository.lockItemsOfPerson(db, ctx, w.heavyUserId, []),
    'deletion: a deletion group': (w, db, ctx) => WorkItemRepository.idsOfDeletion(db, ctx, w.deletionId),
    'cycle and milestone deletes: their items': async (w, db, ctx) => {
        await WorkItemRepository.idsInCycleIncludingDeleted(db, ctx, w.currentCycleId, 500);
        await WorkItemRepository.idsInMilestoneIncludingDeleted(db, ctx, w.milestoneId, 500);
        return WorkItemRepository.rolloverCandidates(db, ctx, w.currentCycleId, 500);
    },
    'templates: open items of a project': (w, db, ctx, v) => WorkItemRepository.openItemsForTemplate(db, ctx, v, w.projectId, null, 500),
    'job: due reminders': (w, db) => {
        const t = today().getTime();
        return WorkItemRepository.dueCandidates(db, w.tenantId, [new Date(t), new Date(t + DAY), new Date(t + 7 * DAY)], null, 500);
    },
    'job: the daily digest': (w, db) => WorkItemRepository.digestDueItems(db, w.tenantId, [w.heavyUserId], new Date(today().getTime() + 3 * DAY), 200),
    'job: the purge sweep': (w, db, ctx) => WorkItemRepository.purgeableIds(db, ctx, new Date(today().getTime() - 30 * DAY), 500),
    'job: a purged project': async (w, db, ctx) => {
        await WorkItemRepository.countLiveInProject(db, ctx, w.projectId);
        return WorkItemRepository.projectItemIds(db, ctx, w.projectId, 500);
    },
    'job: the sort-key rebalance': async (w, db, ctx) => {
        await WorkItemRepository.projectsNeedingRebalance(db, ctx, SORT_KEY_REBALANCE_LENGTH);
        return WorkItemRepository.orderedPageIncludingDeleted(db, ctx, w.projectId, undefined, 500);
    },
    'job: the timesheet reminder': (w, db, ctx) => {
        const from = new Date(`${w.timeWeek}T00:00:00Z`);
        return TimeEntryRepository.activeMembersWithTimeIn(db, ctx, from, new Date(from.getTime() + 6 * DAY), 5_000);
    },
    // Analytics (3.6a): the workspace's and a project's twelve weeks, as the page first reads them.
    'analytics: completions in a window, workspace': async (w, db, ctx, v) => {
        await WorkItemTransitionRepository.completionsPerDay(db, ctx, recordScope(v), analyticsWindow());
        return WorkItemTransitionRepository.windowCounts(db, ctx, recordScope(v), analyticsWindow());
    },
    'analytics: completions in a window, one project': (w, db, ctx, v) => WorkItemTransitionRepository.completionsPerDay(db, ctx, recordScope(v, { projectIds: [w.bigProjectId] }), analyticsWindow()),
    'analytics: the first start of completed items': (w, db, ctx, v) => WorkItemTransitionRepository.completionDurations(db, ctx, recordScope(v, { projectIds: [w.bigProjectId] }), analyticsWindow(), 50_001),
    'analytics: flow over a project': async (w, db, ctx, v) => {
        const window = analyticsWindow();
        const scope = recordScope(v, { projectIds: [w.bigProjectId] });
        const ids = await WorkItemTransitionRepository.flowItemIds(db, ctx, scope, window.asOf, 20_001);
        const fromDay = Math.floor(window.from.getTime() / DAY);
        return WorkItemTransitionRepository.flowDeltas(db, ctx, scope, ids, { fromDay, end: window.to, asOf: window.asOf, tz: 'UTC', doneSince: window.from, measure: 'items' });
    },
    'analytics: the age of started items': (w, db, ctx, v) =>
        WorkItemTransitionRepository.startedItemsByFirstStart(db, ctx, { ...recordScope(v, { projectIds: [w.bigProjectId] }), includeArchived: false, initiativeProjectIds: null }, 2_000),
    'analytics: counts now and a filter on current values': async (w, db, ctx, v) => {
        await WorkItemRepository.countsByCategory(db, ctx, v, { projectId: w.bigProjectId }, null, today());
        return WorkItemRepository.idsMatchingCurrentValues(db, ctx, v, { labelId: w.labelId }, { take: 50_001, today: today() });
    },
    // Time waiting (3.6b): the largest project's twelve weeks, as the page first reads it.
    'analytics: waits over a project': async (w, db, ctx, v) => {
        const window = analyticsWindow();
        const spans = await ReviewRepository.reviewSpans(db, ctx, { start: window.from, asOf: window.asOf, itemIds: null, take: 50_001 });
        const reviewItemIds = [...new Set(spans.map((sp) => sp.workItemId))];
        const openReviewItemIds = [...new Set(spans.filter((sp) => sp.end === null).map((sp) => sp.workItemId))];
        return WorkItemTransitionRepository.waitSpans(db, ctx, recordScope(v, { projectIds: [w.bigProjectId] }), { start: window.from, asOf: window.asOf, itemLimit: 20_000, reviewItemIds, openReviewItemIds });
    },
    "cycles: the burn-up's items and rows": async (w, db, ctx) => {
        const ids = await WorkItemTransitionRepository.itemIdsEverInCycle(db, ctx, w.currentCycleId);
        return WorkItemTransitionRepository.transitionsOf(db, ctx, ids.slice(0, 5_000), new Date());
    },
    // Forecasting (3.6c): the workspace's first recorded rows, a project's open items and its record.
    "forecast: the history's first recorded row, the workspace": (w, db, ctx, v) => WorkItemTransitionRepository.firstRecordedAt(db, ctx, { visibility: v, projectIds: null, teamId: null }),
    'forecast: the open items per project': (w, db, ctx, v) => WorkItemRepository.openCountsByProject(db, ctx, v, { projectId: w.bigProjectId }, null, today()),
    "forecast: the record's completions of a project": (w, db, ctx, v) =>
        WorkItemTransitionRepository.completionSpanRows(db, ctx, recordScope(v, { projectIds: [w.bigProjectId] }), { from: new Date(Date.now() - 64 * 7 * DAY), asOf: new Date() }, 20_001),
    'job: the search-index rebuild': async (w, db, ctx) => {
        // One page of each kind, through the keyset (after 'c', which sorts before every cuid): a page
        // reads its own rows only, so its cost does not grow with the workspace (issue #79).
        await SearchVectorRepository.staleDescriptionPage(db, ctx, 'c', { force: false });
        return SearchVectorRepository.staleCommentPage(db, ctx, 'c', { force: true });
    },
};

describe(`plan checks on the seeded database (PERF_SHAPE=${process.env.PERF_SHAPE || '10k'})`, () => {
    let direct: PrismaClient;
    let world: PerfWorld;
    const verdicts: Array<{ name: string; verdict: PlanVerdict; budget: number | null }> = [];
    const trees: Record<string, CapturedPlan[]> = {};

    beforeAll(async () => {
        direct = directClient();
        world = await loadPerfWorld(direct);
        // Deterministic statistics, so a plan does not flip between runs: the
        // visibility map set (index-only scans fetch no heap pages at random),
        // and ANALYZE sampling every row at 10k (300 x 1,000 rows), where the
        // default target samples 30,000 at random and the same query could
        // take another plan on the next run.
        await direct.$executeRawUnsafe('VACUUM');
        await direct.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL default_statistics_target = 1000');
            await tx.$executeRawUnsafe('ANALYZE');
        }, { timeout: 600_000 });
    }, 900_000);

    afterAll(async () => {
        await direct?.$disconnect();
        await prisma.$disconnect();
        const lines = [
            `### Plan checks (${world?.shape ?? '?'})`,
            '',
            '| Query | Statements | Buffers / budget | Indexes | Seq scans |',
            '|---|---:|---:|---|---|',
            ...verdicts.map(
                ({ name, verdict, budget }) =>
                    `| ${name} | ${verdict.statements} | ${verdict.buffers} / ${budget} | ${verdict.indexes.join(', ')} | ${verdict.seqScans.join(', ') || 'none'} |`,
            ),
            '',
        ];
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
        if (process.env.PERF_REPORT_DIR) {
            fs.mkdirSync(process.env.PERF_REPORT_DIR, { recursive: true });
            fs.writeFileSync(`${process.env.PERF_REPORT_DIR}/plans.json`, JSON.stringify(verdicts, null, 2));
            // Every statement's full plan, for reading a failure.
            fs.writeFileSync(`${process.env.PERF_REPORT_DIR}/plan-trees.json`, JSON.stringify(trees, null, 2));
        }
    });

    it('every registered query has a runner and every runner a registration', () => {
        expect(Object.keys(RUNNERS).sort()).toEqual(PLAN_CHECKED_QUERIES.map((q) => q.name).sort());
    });

    it('auto_explain captures the plans of the statements a call runs', async () => {
        const plans = await capturePlans(() => runInTenantContext(world.ctx, (db) => WorkItemRepository.getById(db, world.ctx, { kind: 'ALL' }, world.itemId)));
        expect(plans.length).toBeGreaterThan(0);
        expect(plans.some((p) => /"WorkItem"/.test(p.query))).toBe(true);
    });

    it("row-level security holds on the measured connection: the sibling workspace's item reads as nothing", async () => {
        const row = await runInTenantContext(world.ctx, (db) => db.workItem.findFirst({ where: { id: world.siblingItemId }, select: { id: true } }));
        expect(row).toBeNull();
    });

    const captured = new Map<string, Promise<CapturedPlan[]>>();
    /** Each query runs once; its checks read the same captured plans. */
    const plansOf = (q: PlanCheckedQuery): Promise<CapturedPlan[]> => {
        let hit = captured.get(q.name);
        if (!hit) {
            const run = RUNNERS[q.name];
            if (!run) throw new Error(`no runner for ${q.name}`);
            hit = capturePlans(() =>
                runInTenantContext(world.ctx, async (db) => {
                    const v = await visibleProjects(world.ctx, db);
                    return run(world, db, world.ctx, v);
                }),
            ).then((plans) => {
                trees[q.name] = plans;
                verdicts.push({ name: q.name, verdict: judgePlans(plans, q.indexes), budget: bufferBudgetAt(q, world.shape) });
                return plans;
            });
            captured.set(q.name, hit);
        }
        return hit;
    };

    for (const q of PLAN_CHECKED_QUERIES) {
        it(`${q.name}: statements captured, its indexes used, within its buffer budget (${q.maxBuffers} at 10k, ${q.maxBuffers100k} at 100k)`, async () => {
            const verdict = judgePlans(await plansOf(q), q.indexes);
            expect({ name: q.name, statements: verdict.statements > 0 }).toEqual({ name: q.name, statements: true });
            expect({ name: q.name, missingIndexes: verdict.missingIndexes, used: verdict.indexes }).toEqual({ name: q.name, missingIndexes: [], used: verdict.indexes });
            // The 10k budgets block every pull request, the 100k ones the nightly (H2b); another shape is reported only.
            const budget = bufferBudgetAt(q, world.shape);
            if (budget !== null) expect({ name: q.name, buffers: verdict.buffers <= budget, measured: verdict.buffers, budget }).toEqual({ name: q.name, buffers: true, measured: verdict.buffers, budget });
        });

        const seqScans = async () => {
            const verdict = judgePlans(await plansOf(q), q.indexes);
            expect({ name: q.name, seqScans: verdict.seqScans }).toEqual({ name: q.name, seqScans: [] });
        };
        const seqTitle = `${q.name}: no sequential scan on ${GUARDED_TABLES.join(', ')}`;
        if (q.knownFinding?.fails === 'seqScans') it.failing(`${seqTitle} (known finding ${q.knownFinding.id}, docs/performance.md)`, seqScans);
        else it(seqTitle, seqScans);

        if (q.conditions && q.conditions.length > 0) {
            const conditions = async () => {
                expect({ name: q.name, misses: conditionMisses(await plansOf(q), q.conditions!) }).toEqual({ name: q.name, misses: [] });
            };
            const condTitle = `${q.name}: ${q.conditions.map((c) => `${c.index} searched with ${c.operator}`).join('; ')}`;
            if (q.knownFinding?.fails === 'conditions') it.failing(`${condTitle} (known finding ${q.knownFinding.id}, docs/performance.md)`, conditions);
            else it(condTitle, conditions);
        }
    }
});
