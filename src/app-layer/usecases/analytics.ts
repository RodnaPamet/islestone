/**
 * The analytics reads (sub-phase 3.6a; docs/porting/maps/3.6.md, "The
 * measures", "Reads, routes and keys"; ADR 0014; owner decisions 310 to 316,
 * 329 to 331): counts, throughput, cycle time and lead time with age, and
 * cumulative flow with the burn-up for any scope.
 *
 *   - **The record is the source** (decision 310): every measure reads
 *     `WorkItemTransition` through `WorkItemTransitionRepository`, live, with
 *     stated bounds (decision 331); nothing computed is stored, cached or
 *     audited.
 *   - **The list's filters** through `resolveListFiltersInTx`, never a second
 *     filter path (decision 315). The status filters (state, category, due)
 *     are set aside and named in the answer. Recorded fields (project, team,
 *     initiative through each project's current link, cycle, milestone) are
 *     judged on each row as recorded; every other filter judges the item's
 *     current values, through the set of items it selects (at most
 *     `ANALYTICS_FILTER_ITEM_LIMIT`, 422 above).
 *   - **Days** are cut in the scope's working calendar's zone (decision 316):
 *     one team's when the scope is one team, project, cycle or milestone,
 *     else the workspace's; "today" in it through `todayClock`. Durations are
 *     elapsed working time on each item's own team's calendar (decision 313).
 *   - **Visibility**: a row counts only while its recorded project is visible
 *     to the caller; archived projects' history counts, deleted projects'
 *     does not (decision 315). The figures about now (open, started, age)
 *     follow the list: archived projects only with `includeArchived`.
 *   - **Bounds**: a window of at most 366 days (400 `ANALYTICS_RANGE`), at
 *     most 50,000 completions and 20,000 items in a flow (422
 *     `ANALYTICS_TOO_LARGE` with the count), never a cut answer.
 *
 * No description, comment or field value is read; the points' keys and
 * titles are read by id under row-level security. Written fresh for
 * Islestone.
 */
import { burnUpOf, cumulativeFlowOf, flowFromDeltas, type FlowDay } from '../domain/analytics/flow';
import { WorkingTimeMeter } from '../domain/analytics/elapsed';
import { summarise } from '../domain/analytics/percentiles';
import { binThroughput } from '../domain/analytics/throughput';
import { epochDayOf, startOfEpochDay } from '../domain/analytics/zone';
import { fromEpochDay, isoWeekday, toEpochDay, todayIn, type EpochDay } from '../domain/schedule/calendar';
import { formatKey } from '../domain/work-item-key';
import { assertCanViewAnalytics } from '../policies/analytics.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { CycleRepository } from '../repositories/CycleRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository, type KeyHit, type WorkItemFilters } from '../repositories/WorkItemRepository';
import { WorkItemTransitionRepository, type RecordScope, type RecordedIdFilter } from '../repositories/WorkItemTransitionRepository';
import type { RequestContext } from '../types';
import { burnUpMeasuresFor } from './cycle';
import { resolveListFiltersInTx, type ListWorkItemsQuery } from './work-item';
import { resolveWorkingCalendars, type ResolvedCalendar, type WorkingCalendarSet } from './working-calendar';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { AppError, ValidationError, badRequest } from '@/lib/errors/types';
import { todayClock } from '@/lib/clock';
import {
    ANALYTICS_AGE_LIMIT,
    ANALYTICS_COMPLETION_LIMIT,
    ANALYTICS_DAILY_FLOW_DAYS,
    ANALYTICS_FILTER_ITEM_LIMIT,
    ANALYTICS_FLOW_ITEM_LIMIT,
    ANALYTICS_MAX_DAYS,
    ANALYTICS_POINT_LIMIT,
    ANALYTICS_RANGE,
    ANALYTICS_SET_ASIDE_FILTERS,
    ANALYTICS_TOO_LARGE,
    type AnalyticsFrame,
    type AnalyticsMeasure,
    type AnalyticsTooLargeDetails,
    type CountsResponse,
    type DurationMeasure,
    type DurationsResponse,
    type FlowResponse,
    type ThroughputBin,
    type ThroughputResponse,
} from '@/lib/analytics/types';

/** An analytics read's query: the list's filters (its order, cursor and page size do not apply) and the window. */
export type AnalyticsQuery = Omit<ListWorkItemsQuery, 'order' | 'dir' | 'cursor' | 'limit'> & { from: string; to: string };

/**
 * The list's filters on current values (decision 315). The others are on
 * recorded fields (project, team, initiative through its projects, cycle,
 * milestone; judged on each row as recorded) or on status (set aside).
 */
const CURRENT_VALUE_FILTERS = ['typeId', 'priority', 'labelId', 'parentId', 'assigneeId', 'createdById', 'waitingOnId', 'goalScope', 'reviewerId', 'watching', 'q'] as const;

function tooLarge(what: AnalyticsTooLargeDetails['what'], count: number, limit: number): AppError {
    const noun = what === 'completions' ? 'completed items' : what === 'filter' ? 'items matching this filter' : 'items';
    const details: AnalyticsTooLargeDetails = { reason: ANALYTICS_TOO_LARGE, what, count, limit };
    return new AppError(`This chart would read ${count >= limit ? `more than ${limit}` : count} ${noun}; it reads at most ${limit}. Narrow the filter or the window.`, ANALYTICS_TOO_LARGE, 422, true, details);
}

function parseDay(value: string, name: string): EpochDay {
    try {
        return toEpochDay(value);
    } catch {
        throw new ValidationError(`${name} must be a date (YYYY-MM-DD).`, { reason: ANALYTICS_RANGE });
    }
}

function idList(value: string | undefined): string[] | null {
    if (value === undefined) return null;
    return [...new Set(value.split(',').map((x) => x.trim()).filter(Boolean))];
}

function recordedIdFilter(value: string | undefined): RecordedIdFilter | null {
    const members = idList(value);
    if (!members) return null;
    const ids = members.filter((m) => m !== 'none');
    return { ids, none: ids.length !== members.length };
}

/** One id when a list names exactly one, never `none`. */
function single(list: readonly string[] | null | undefined): string | null {
    return list && list.length === 1 && list[0] !== 'none' ? list[0]! : null;
}

interface Scope {
    v: ProjectVisibility;
    listFilters: WorkItemFilters;
    keyHit: KeyHit | null;
    today: Date;
    record: RecordScope;
    initiativeProjectIds: readonly string[] | null;
    includeArchived: boolean;
    /** The single team the scope is, or null. */
    scopeTeamId: string | null;
    calendars: WorkingCalendarSet;
    calendar: ResolvedCalendar;
    frame: AnalyticsFrame;
    /** The window's days, `toDay` no later than today; empty when `fromDay > toDay`. */
    fromDay: EpochDay;
    toDay: EpochDay;
    /** The instant the window begins, the instant after its last day, and the moment of reading (no later than either). */
    start: Date;
    end: Date;
    asOf: Date;
}

/**
 * The scope of a read: the window, the list's filters split into recorded and
 * current ones, the scope's calendar and today in its zone.
 */
async function resolveScope(db: PrismaTx, ctx: RequestContext, query: AnalyticsQuery, now: Date, opts: { allCalendars: boolean }): Promise<Scope> {
    const { from, to, ...filters } = query;
    const fromDay = parseDay(from, 'from');
    const lastDay = parseDay(to, 'to');
    if (lastDay < fromDay || lastDay - fromDay + 1 > ANALYTICS_MAX_DAYS) {
        throw new ValidationError(`An analytics read covers from a date to a date at most ${ANALYTICS_MAX_DAYS} days later.`, { reason: ANALYTICS_RANGE, maxDays: ANALYTICS_MAX_DAYS });
    }
    const v = await visibleProjects(ctx, db);
    const { listFilters, keyHit, today } = await resolveListFiltersInTx(db, ctx, v, filters);
    const setAside = ANALYTICS_SET_ASIDE_FILTERS.filter((k) => listFilters[k] !== undefined && listFilters[k] !== '');

    // Recorded fields, judged on each row (decision 315). An initiative is its
    // projects' CURRENT link, judged against each row's recorded project.
    let projectIds = idList(listFilters.projectId);
    const initiativeProjectIds = listFilters.initiativeProjectIds ?? null;
    if (initiativeProjectIds) projectIds = projectIds ? projectIds.filter((p) => initiativeProjectIds.includes(p)) : [...initiativeProjectIds];
    const teamIds = idList(listFilters.teamId);
    const cycle = recordedIdFilter(listFilters.cycleId);
    const milestone = recordedIdFilter(listFilters.milestoneId);

    // Current values: the items the rest of the filters select now.
    const current: WorkItemFilters = {};
    let anyCurrent = false;
    for (const k of CURRENT_VALUE_FILTERS) {
        if (listFilters[k] !== undefined && listFilters[k] !== '') {
            (current as Record<string, unknown>)[k] = listFilters[k];
            anyCurrent = true;
        }
    }
    if (listFilters.customFields && listFilters.customFields.length > 0) {
        current.customFields = listFilters.customFields;
        anyCurrent = true;
    }
    if (current.q) {
        current.fullTextMatchIds = listFilters.fullTextMatchIds;
        current.titleSubstringMatchIds = listFilters.titleSubstringMatchIds;
    }
    let itemIds: string[] | null = null;
    if (anyCurrent) {
        itemIds = await WorkItemRepository.idsMatchingCurrentValues(db, ctx, v, current, { take: ANALYTICS_FILTER_ITEM_LIMIT + 1, keyHit, today });
        if (itemIds.length > ANALYTICS_FILTER_ITEM_LIMIT) throw tooLarge('filter', itemIds.length, ANALYTICS_FILTER_ITEM_LIMIT);
    }

    // The scope's calendar (decision 316): one team, project, cycle or milestone.
    let scopeTeamId = single(teamIds);
    if (!scopeTeamId && single(projectIds)) scopeTeamId = (await ProjectRepository.visibleByIds(db, ctx, v, [projectIds![0]!]))[0]?.teamId ?? null;
    if (!scopeTeamId && cycle && !cycle.none && single(cycle.ids)) scopeTeamId = (await CycleRepository.getById(db, ctx, cycle.ids[0]!))?.teamId ?? null;
    if (!scopeTeamId && milestone && !milestone.none && single(milestone.ids)) {
        const [m] = await MilestoneRepository.byIds(db, ctx, [milestone.ids[0]!]);
        if (m) scopeTeamId = (await ProjectRepository.visibleByIds(db, ctx, v, [m.projectId]))[0]?.teamId ?? null;
    }
    const calendars = await resolveWorkingCalendars(db, ctx, opts.allCalendars ? undefined : scopeTeamId ? [scopeTeamId] : []);
    const calendar = scopeTeamId ? calendars.forTeam(scopeTeamId) : calendars.workspace;
    const tz = calendar.timeZone;
    const asOfDay = todayIn(tz, todayClock(tz, now));
    const toDay = Math.min(lastDay, asOfDay);
    const start = startOfEpochDay(fromDay, tz);
    const end = startOfEpochDay(toDay + 1, tz);
    const asOf = new Date(Math.min(now.getTime(), end.getTime()));
    return {
        v,
        listFilters,
        keyHit,
        today,
        record: { visibility: v, projectIds, teamIds, cycle, milestone, itemIds },
        initiativeProjectIds,
        includeArchived: listFilters.includeArchived === true,
        scopeTeamId,
        calendars,
        calendar,
        fromDay,
        toDay,
        start,
        end,
        asOf,
        frame: {
            from,
            to,
            asOf: fromEpochDay(asOfDay),
            timeZone: tz,
            calendarTeamId: scopeTeamId && calendar.id !== calendars.workspace.id ? scopeTeamId : null,
            setAside,
        },
    };
}

const emptyWindow = (s: Scope) => s.toDay < s.fromDay;

// ─── Counts ───────────────────────────────────────────────────────────────

/** Open and started items now, and the items completed and created in the window. */
export async function getAnalyticsCounts(ctx: RequestContext, query: AnalyticsQuery, now: Date = new Date()): Promise<CountsResponse> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, async (db) => {
        const s = await resolveScope(db, ctx, query, now, { allCalendars: false });
        const nowFilters: WorkItemFilters = { ...s.listFilters };
        for (const k of ANALYTICS_SET_ASIDE_FILTERS) delete nowFilters[k];
        const byCategory = await WorkItemRepository.countsByCategory(db, ctx, s.v, nowFilters, s.keyHit, s.today);
        const window = emptyWindow(s) ? { done: 0, created: 0 } : await WorkItemTransitionRepository.windowCounts(db, ctx, s.record, { from: s.start, to: s.end, asOf: s.asOf });
        return {
            ...s.frame,
            open: byCategory.BACKLOG + byCategory.UNSTARTED + byCategory.STARTED,
            started: byCategory.STARTED,
            doneInWindow: window.done,
            createdInWindow: window.created,
        };
    });
}

// ─── Throughput ───────────────────────────────────────────────────────────

/** Items completed per day or ISO week of the window (decision 311), with the median whole bin. */
export async function getThroughput(ctx: RequestContext, query: AnalyticsQuery & { bin?: ThroughputBin }, now: Date = new Date()): Promise<ThroughputResponse> {
    assertCanViewAnalytics(ctx);
    const { bin = 'week', ...rest } = query;
    return runInTenantContext(ctx, async (db) => {
        const s = await resolveScope(db, ctx, rest, now, { allCalendars: false });
        const perDay = new Map<EpochDay, number>();
        if (!emptyWindow(s)) {
            const rows = await WorkItemTransitionRepository.completionsPerDay(db, ctx, s.record, { from: s.start, to: s.end, asOf: s.asOf, tz: s.calendar.timeZone });
            let total = 0;
            for (const r of rows) {
                perDay.set(r.day, r.count);
                total += r.count;
            }
            if (total > ANALYTICS_COMPLETION_LIMIT) throw tooLarge('completions', total, ANALYTICS_COMPLETION_LIMIT);
        }
        const out = binThroughput(perDay, s.fromDay, s.toDay, bin);
        return { ...s.frame, bin, bins: out.bins, total: out.total, median: out.median };
    });
}

// ─── Cycle time, lead time and age ────────────────────────────────────────

/**
 * Cycle time and lead time over every completion in the window (nearest-rank
 * percentiles), the newest completions as points, and (for cycle time) the
 * age of open, started items, the oldest first.
 */
export async function getDurations(ctx: RequestContext, query: AnalyticsQuery & { measure?: DurationMeasure }, now: Date = new Date()): Promise<DurationsResponse> {
    assertCanViewAnalytics(ctx);
    const { measure = 'cycle', ...rest } = query;
    return runInTenantContext(ctx, async (db) => {
        const s = await resolveScope(db, ctx, rest, now, { allCalendars: true });
        const meters = new Map<string, WorkingTimeMeter>();
        const meterFor = (teamId: string) => {
            const cal = s.calendars.forTeam(teamId);
            let m = meters.get(cal.id);
            if (!m) {
                m = new WorkingTimeMeter({ compiled: cal.compiled, timeZone: cal.timeZone });
                meters.set(cal.id, m);
            }
            return m;
        };
        const rows = emptyWindow(s)
            ? []
            : await WorkItemTransitionRepository.completionDurations(db, ctx, s.record, { from: s.start, to: s.end, asOf: s.asOf }, ANALYTICS_COMPLETION_LIMIT + 1);
        if (rows.length > ANALYTICS_COMPLETION_LIMIT) throw tooLarge('completions', rows.length, ANALYTICS_COMPLETION_LIMIT);

        const cycleTimes: number[] = [];
        const leadTimes: number[] = [];
        let doneWithoutStarting = 0;
        const measured = rows.map((r) => {
            const meter = meterFor(r.teamId);
            const cycleTime = r.startedAt ? meter.elapsedDays(r.startedAt, r.completedAt) : null;
            const leadTime = meter.elapsedDays(r.createdAt, r.completedAt);
            if (cycleTime === null) doneWithoutStarting += 1;
            else cycleTimes.push(cycleTime);
            leadTimes.push(leadTime);
            return { ...r, cycleTime, leadTime };
        });

        const newest = measured.slice(0, ANALYTICS_POINT_LIMIT);
        const ageRows =
            measure === 'cycle'
                ? await WorkItemTransitionRepository.startedItemsByFirstStart(db, ctx, { ...s.record, includeArchived: s.includeArchived, initiativeProjectIds: s.initiativeProjectIds }, ANALYTICS_AGE_LIMIT)
                : [];
        const labels = new Map((await WorkItemRepository.keyTitlesByIds(db, ctx, s.v, newest.map((p) => p.workItemId))).map((w) => [w.id, w]));
        const tz = s.calendar.timeZone;
        return {
            ...s.frame,
            measure,
            cycleTime: summarise(cycleTimes),
            leadTime: summarise(leadTimes),
            doneWithoutStarting,
            points: newest.flatMap((p) => {
                const w = labels.get(p.workItemId);
                if (!w) return [];
                return [{ workItemId: p.workItemId, key: formatKey(w.project.keyPrefix, w.number), title: w.title, completedOn: fromEpochDay(epochDayOf(p.completedAt, tz)), cycleTime: p.cycleTime, leadTime: p.leadTime }];
            }),
            pointsNewestOnly: measured.length > ANALYTICS_POINT_LIMIT,
            age: ageRows.map((a) => ({
                workItemId: a.id,
                key: formatKey(a.keyPrefix, a.number),
                title: a.title,
                startedOn: fromEpochDay(epochDayOf(a.startedAt, tz)),
                age: meterFor(a.teamId).elapsedDays(a.startedAt, now),
            })),
            ageTotal: ageRows[0]?.total ?? 0,
        };
    });
}

// ─── Cumulative flow and the burn-up ──────────────────────────────────────

async function measuresOfScope(db: PrismaTx, ctx: RequestContext, s: Scope): Promise<AnalyticsMeasure[]> {
    const teams = await TeamRepository.list(db, ctx);
    let inScope: string[];
    if (s.record.teamIds) inScope = [...s.record.teamIds];
    else if (s.scopeTeamId) inScope = [s.scopeTeamId];
    else if (s.record.projectIds) inScope = [...new Set((await ProjectRepository.visibleByIds(db, ctx, s.v, s.record.projectIds)).map((p) => p.teamId))];
    else inScope = teams.map((t) => t.id);
    const units = teams.filter((t) => inScope.includes(t.id));
    if (units.length === 0) return ['items'];
    // Points or hours only when EVERY team in scope estimates in that unit (decision 259; ADR 0012: never mixed).
    return (['items', 'points', 'hours'] as const).filter((m) => units.every((t) => burnUpMeasuresFor(t.estimateUnit).includes(m)));
}

/**
 * Cumulative flow over the window (the open categories at each day's end,
 * Done since the window's first day) and, with `burnUp`, the burn-up (scope,
 * started, completed; items, or points or hours where every team in scope
 * estimates in them).
 */
export async function getFlow(
    ctx: RequestContext,
    query: AnalyticsQuery & { burnUp?: boolean; measure?: AnalyticsMeasure },
    now: Date = new Date(),
): Promise<FlowResponse> {
    assertCanViewAnalytics(ctx);
    const { burnUp = false, measure = 'items', ...rest } = query;
    return runInTenantContext(ctx, async (db) => {
        const s = await resolveScope(db, ctx, rest, now, { allCalendars: false });
        const measures = burnUp ? await measuresOfScope(db, ctx, s) : (['items'] as AnalyticsMeasure[]);
        if (burnUp && !measures.includes(measure)) {
            throw badRequest(`The teams in this scope do not all estimate in ${measure}; its burn-up counts ${measures.join(' or ')}.`, { reason: 'MEASURE_UNAVAILABLE', measures });
        }
        if (emptyWindow(s)) return { ...s.frame, resolution: 'day', days: [], burnUp: burnUp ? { measure, measures, points: [] } : null, items: 0 };
        const tz = s.calendar.timeZone;
        const ids = await WorkItemTransitionRepository.flowItemIds(db, ctx, s.record, s.asOf, ANALYTICS_FLOW_ITEM_LIMIT + 1);
        if (ids.length > ANALYTICS_FLOW_ITEM_LIMIT) throw tooLarge('items', ids.length, ANALYTICS_FLOW_ITEM_LIMIT);
        const window = { fromDay: s.fromDay, end: s.end, asOf: s.asOf, tz, doneSince: s.start };
        const flow = flowFromDeltas(s.fromDay, s.toDay, await WorkItemTransitionRepository.flowDeltas(db, ctx, s.record, ids, { ...window, measure: 'items' }));
        const weighted: FlowDay[] =
            burnUp && measure !== 'items' ? flowFromDeltas(s.fromDay, s.toDay, await WorkItemTransitionRepository.flowDeltas(db, ctx, s.record, ids, { ...window, measure })) : flow;
        const resolution = s.toDay - s.fromDay + 1 > ANALYTICS_DAILY_FLOW_DAYS ? 'week' : 'day';
        // By week beyond 92 days: each ISO week's last day in the window (its Sunday, or the window's last day).
        const keep = (d: FlowDay) => resolution === 'day' || isoWeekday(d.day) === 7 || d.day === s.toDay;
        return {
            ...s.frame,
            resolution,
            days: flow.filter(keep).map((d) => ({ date: fromEpochDay(d.day), ...cumulativeFlowOf(d) })),
            burnUp: burnUp
                ? {
                      measure,
                      measures,
                      points: weighted.filter(keep).map((d) => {
                          const b = burnUpOf(d);
                          return measure === 'items' ? { date: fromEpochDay(d.day), ...b } : { date: fromEpochDay(d.day), ...b, unestimated: d.unestimated };
                      }),
                  }
                : null,
            items: ids.length,
        };
    });
}


/** Today in the workspace calendar's zone (the page's default window ends on it). */
export async function getAnalyticsToday(ctx: RequestContext, now: Date = new Date()): Promise<string> {
    assertCanViewAnalytics(ctx);
    return runInTenantContext(ctx, async (db) => {
        const tz = (await resolveWorkingCalendars(db, ctx, [])).workspace.timeZone;
        return fromEpochDay(todayIn(tz, todayClock(tz, now)));
    });
}
