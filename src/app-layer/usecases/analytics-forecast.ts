/**
 * The forecast read (sub-phase 3.6c; docs/porting/maps/3.6.md, "Forecasting";
 * ADR 0014 §3 to §5; owner decisions 318 to 325, 329 and 331): when are a
 * scope's open items likely to be done.
 *
 *   - **The scope** is the list's filters (`resolveListFiltersInTx`, never a
 *     second filter path; the status filters set aside and named, as every
 *     analytics read does). Its **remaining** items are its live, open items
 *     in visible, unarchived projects, counted now.
 *   - **The history** (decision 321) is the completions of the projects those
 *     items belong to (a cycle: its team's), named in the answer and
 *     changeable to a subset of them, the team or the workspace; over the last
 *     4, 8, 12 or 26 weeks ending yesterday, never before its first recorded
 *     row (decision 318), counted by the 3.6a completions read in the scope's
 *     calendar zone (decision 316).
 *   - **The share** (decision 322): all of that throughput unless the person
 *     picks 75, 50 or 25 %; no new items assumed. Both are printed.
 *   - **The seed** is derived from the inputs and shown (decision 323).
 *   - **The forecast** is `forecastCompletion` (pure): the 50/85/95 % dates,
 *     the chance by the scope's due date, the histogram and the curve, or a
 *     refusal with its counts (decision 319), returned as a 200, never a date.
 *   - **The scope's own record** (decision 325): the same question replayed
 *     from weekly origins over the last 52 weeks, the history as it stood
 *     then, shown with at least 10 scorable origins.
 *
 * Nothing is stored, cached, audited or logged per scope; no description,
 * comment, field value or estimate is read (principle 4). Written fresh for
 * Islestone.
 */
import { completionSpans, daySpansOf, type SpanRow } from '../domain/analytics/completion';
import { startOfEpochDay, epochDayOf } from '../domain/analytics/zone';
import { backtest, recordSize, RECORD_COMPLETION_LIMIT, RECORD_MIN_SCORABLE, RECORD_TRIALS, RECORD_WEEKS, type DaySpan } from '../domain/forecast/backtest';
import { dailySample, DEFAULT_FORECAST_HISTORY_WEEKS, historyWindow, type ForecastHistoryWeeks } from '../domain/forecast/sample';
import { canonicalJson, forecastSeed } from '../domain/forecast/seed';
import { chanceCurveOf, forecastCompletion, histogramOf, FORECAST_TRIALS, type ForecastOutcome } from '../domain/forecast/simulate';
import { fromEpochDay, toEpochDay, todayIn, type EpochDay } from '../domain/schedule/calendar';
import { assertCanViewAnalytics } from '../policies/analytics.policies';
import { visibleProjects } from '../policies/project-visibility';
import { CycleRepository } from '../repositories/CycleRepository';
import { GoalRepository } from '../repositories/GoalRepository';
import { InitiativeRepository } from '../repositories/InitiativeRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository, type WorkItemFilters } from '../repositories/WorkItemRepository';
import { WorkItemTransitionRepository, type RecordScope } from '../repositories/WorkItemTransitionRepository';
import type { RequestContext } from '../types';
import { resolveListFiltersInTx, type ListWorkItemsQuery } from './work-item';
import { resolveWorkingCalendars } from './working-calendar';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, badRequest } from '@/lib/errors/types';
import { todayClock } from '@/lib/clock';
import {
    ANALYTICS_COMPLETION_LIMIT,
    ANALYTICS_SET_ASIDE_FILTERS,
    ANALYTICS_TOO_LARGE,
    FORECAST_HISTORY,
    type AnalyticsTooLargeDetails,
    type ForecastBasedOn,
    type ForecastProjectRef,
    type ForecastRecord,
    type ForecastRefusalBody,
    type ForecastResponse,
    type ForecastScopeKind,
} from '@/lib/analytics/types';

/** A forecast's query: the list's filters (no order, cursor, page or window) and its own choices. */
export type ForecastQuery = Omit<ListWorkItemsQuery, 'order' | 'dir' | 'cursor' | 'limit'> & {
    historyWeeks?: ForecastHistoryWeeks;
    share?: number;
    basedOn?: ForecastBasedOn;
    /** With `basedOn=projects`: a subset of the scope's projects. */
    historyProjectIds?: readonly string[];
};

/** The list filters a forecast's scope key holds (the seed's `scope`), sorted by the canonical JSON. */
const SCOPE_KEY_OMIT = new Set(['historyWeeks', 'share', 'basedOn', 'historyProjectIds']);

function single(value: string | undefined): string | null {
    if (!value) return null;
    const ids = [...new Set(value.split(',').map((x) => x.trim()).filter(Boolean))];
    return ids.length === 1 && ids[0] !== 'none' ? ids[0]! : null;
}

function tooLarge(count: number, limit: number): AppError {
    const details: AnalyticsTooLargeDetails = { reason: ANALYTICS_TOO_LARGE, what: 'completions', count, limit };
    return new AppError(`This forecast's history holds more than ${limit} completed items; narrow what it is based on or the window.`, ANALYTICS_TOO_LARGE, 422, true, details);
}

function refusalBody(outcome: Extract<ForecastOutcome, { refused: object }>, weeks: number): ForecastRefusalBody {
    const r = outcome.refused;
    switch (r.reason) {
        case 'TOO_FEW_COMPLETIONS':
            return { reason: r.reason, completions: r.completions, needed: r.needed, weeks };
        case 'TOO_FEW_WORKING_DAYS':
            return { reason: r.reason, workingDays: r.workingDays, needed: r.needed };
        case 'BEYOND_TWO_YEARS':
            return { reason: r.reason, completions: r.completions, weeks, capDate: fromEpochDay(r.capDay) };
        default:
            return { reason: r.reason };
    }
}

/** Where the forecast is (see the module's header). */
export async function getForecast(ctx: RequestContext, query: ForecastQuery, now: Date = new Date()): Promise<ForecastResponse> {
    assertCanViewAnalytics(ctx);
    const { historyWeeks = DEFAULT_FORECAST_HISTORY_WEEKS, share = 100, basedOn: askedBasedOn, historyProjectIds, ...filters } = query;
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const { listFilters, keyHit, today: listToday } = await resolveListFiltersInTx(db, ctx, v, filters);
        const setAside = ANALYTICS_SET_ASIDE_FILTERS.filter((k) => listFilters[k] !== undefined && listFilters[k] !== '');
        const nowFilters: WorkItemFilters = { ...listFilters };
        for (const k of ANALYTICS_SET_ASIDE_FILTERS) delete nowFilters[k];

        // The remaining items, per project (decision 320: items only).
        const open = await WorkItemRepository.openCountsByProject(db, ctx, v, nowFilters, keyHit, listToday);
        const remaining = open.reduce((sum, r) => sum + r.count, 0);

        // The scope's kind and due date: a cycle's end, a milestone's, goal's, initiative's or project's due date.
        const cycleId = single(listFilters.cycleId);
        const milestoneId = single(listFilters.milestoneId);
        const goalId = single(filters.goalId);
        const initiativeId = single(filters.initiativeId);
        const projectId = single(listFilters.projectId);
        let kind: ForecastScopeKind = 'filter';
        let dueDate: Date | null = null;
        let scopeTeamId: string | null = single(listFilters.teamId);
        let scopeProjectId: string | null = projectId;
        if (cycleId) {
            const cycle = await CycleRepository.getById(db, ctx, cycleId);
            if (cycle) {
                kind = 'cycle';
                dueDate = cycle.endsOn;
                scopeTeamId = cycle.teamId;
            }
        } else if (milestoneId) {
            const [m] = await MilestoneRepository.byIds(db, ctx, [milestoneId]);
            if (m) {
                kind = 'milestone';
                dueDate = m.dueDate;
                scopeProjectId = m.projectId;
            }
        } else if (goalId) {
            const g = await GoalRepository.liveDueDate(db, ctx, goalId);
            if (g) {
                kind = 'goal';
                dueDate = g.dueDate;
            }
        } else if (initiativeId) {
            const i = await InitiativeRepository.liveDueDate(db, ctx, initiativeId);
            if (i) {
                kind = 'initiative';
                dueDate = i.dueDate;
            }
        } else if (projectId) kind = 'project';

        // The scope's projects (the remaining items', and the one project it names) with their names and teams.
        const scopeProjectIds = [...new Set([...open.map((r) => r.projectId), ...(scopeProjectId ? [scopeProjectId] : [])])];
        const projects = await ProjectRepository.visibleByIds(db, ctx, v, scopeProjectIds);
        const byId = new Map(projects.map((p) => [p.id, p]));
        if (kind === 'project' && scopeProjectId) dueDate = byId.get(scopeProjectId)?.dueDate ?? null;
        if (!scopeTeamId && scopeProjectId) scopeTeamId = byId.get(scopeProjectId)?.teamId ?? null;
        const ref = (id: string): ForecastProjectRef | null => {
            const p = byId.get(id);
            return p ? { id: p.id, name: p.name, keyPrefix: p.keyPrefix } : null;
        };
        const offeredProjects = open.map((r) => ref(r.projectId)).filter((p): p is ForecastProjectRef => p !== null);
        if (offeredProjects.length === 0 && scopeProjectId && ref(scopeProjectId)) offeredProjects.push(ref(scopeProjectId)!);
        offeredProjects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        // The team a history may be: a cycle's team, else the one team every scope project belongs to.
        const teamIds = [...new Set(offeredProjects.map((p) => byId.get(p.id)!.teamId))];
        const offeredTeamId = kind === 'cycle' ? scopeTeamId : teamIds.length === 1 ? teamIds[0]! : null;
        const teamName = offeredTeamId ? ((await TeamRepository.list(db, ctx)).find((t) => t.id === offeredTeamId)?.name ?? null) : null;
        const offeredTeam = offeredTeamId && teamName !== null ? { id: offeredTeamId, name: teamName } : null;

        const basedOn: ForecastBasedOn = askedBasedOn ?? (kind === 'cycle' && offeredTeam ? 'team' : 'projects');
        if (basedOn === 'team' && !offeredTeam) {
            throw badRequest('This scope spans more than one team; base its forecast on its projects or the workspace.', { reason: FORECAST_HISTORY });
        }
        let historyProjects: ForecastProjectRef[] = offeredProjects;
        if (historyProjectIds && historyProjectIds.length > 0) {
            if (basedOn !== 'projects') throw badRequest('Only a forecast based on projects names them.', { reason: FORECAST_HISTORY });
            const offeredIds = new Set(offeredProjects.map((p) => p.id));
            const unknown = historyProjectIds.filter((id) => !offeredIds.has(id));
            if (unknown.length > 0) throw badRequest("A forecast's history is a subset of its scope's projects.", { reason: FORECAST_HISTORY });
            const chosen = new Set(historyProjectIds);
            historyProjects = offeredProjects.filter((p) => chosen.has(p.id));
        }

        // The scope's calendar (decision 316) and today in its zone.
        const calendars = await resolveWorkingCalendars(db, ctx, scopeTeamId ? [scopeTeamId] : []);
        const calendar = scopeTeamId ? calendars.forTeam(scopeTeamId) : calendars.workspace;
        const tz = calendar.timeZone;
        const today = todayIn(tz, todayClock(tz, now));

        const recordScope: RecordScope = {
            visibility: v,
            projectIds: basedOn === 'projects' ? historyProjects.map((p) => p.id) : null,
            teamIds: basedOn === 'team' ? [offeredTeam!.id] : null,
            cycle: null,
            milestone: null,
            itemIds: null,
        };
        // A forecast based on projects with none (nothing open, no project named) has no history.
        const noHistoryProjects = basedOn === 'projects' && historyProjects.length === 0;
        const firstAt = noHistoryProjects
            ? null
            : await WorkItemTransitionRepository.firstRecordedAt(db, ctx, { visibility: v, projectIds: recordScope.projectIds, teamId: basedOn === 'team' ? offeredTeam!.id : null });
        const firstDay = firstAt ? epochDayOf(firstAt, tz) : null;
        const window = historyWindow(today, historyWeeks, firstDay);

        const perDay = new Map<EpochDay, number>();
        if (window && remaining > 0) {
            const rows = await WorkItemTransitionRepository.completionsPerDay(db, ctx, recordScope, { from: startOfEpochDay(window.from, tz), to: startOfEpochDay(window.to + 1, tz), asOf: now, tz });
            let total = 0;
            for (const r of rows) {
                perDay.set(r.day, r.count);
                total += r.count;
            }
            if (total > ANALYTICS_COMPLETION_LIMIT) throw tooLarge(total, ANALYTICS_COMPLETION_LIMIT);
        }
        const sample = window ? dailySample(perDay, calendar.compiled, window.from, window.to) : { days: [], counts: [], completions: 0 };

        const scopeKey = canonicalJson({
            filters: Object.fromEntries(Object.entries(filters).filter(([k, val]) => !SCOPE_KEY_OMIT.has(k) && val !== undefined && val !== '' && val !== false)),
            basedOn,
            history: recordScope.projectIds ?? recordScope.teamIds ?? 'workspace',
            weeks: historyWeeks,
        });
        const seed = forecastSeed({ scope: scopeKey, day: today, sample: sample.counts, remaining, share, trials: FORECAST_TRIALS });
        const due = dueDate ? toEpochDay(dueDate) : null;
        const outcome = forecastCompletion({ calendar: calendar.compiled, today, sample: sample.counts, remaining, sharePercent: share, seed, dueDate: due });

        // The scope's own record (decision 325), only beside a forecast that gave dates.
        let record: ForecastRecord = { status: 'NONE' };
        if (!outcome.refused && firstDay !== null) {
            const from = startOfEpochDay(today - 7 * RECORD_WEEKS - 7 * historyWeeks, tz);
            const rows = await WorkItemTransitionRepository.completionSpanRows(db, ctx, recordScope, { from, asOf: now }, RECORD_COMPLETION_LIMIT + 1);
            const items = new Set(rows.map((r) => r.workItemId));
            if (items.size > RECORD_COMPLETION_LIMIT) record = { status: 'TOO_LARGE', count: items.size, limit: RECORD_COMPLETION_LIMIT };
            else {
                const spans: DaySpan[] = [];
                const dayOf = (at: Date) => epochDayOf(at, tz);
                let start = 0;
                for (let i = 1; i <= rows.length; i += 1) {
                    if (i === rows.length || rows[i]!.workItemId !== rows[start]!.workItemId) {
                        spans.push(...daySpansOf(completionSpans(rows.slice(start, i) as SpanRow[]), dayOf));
                        start = i;
                    }
                }
                const size = recordSize(remaining, share);
                const [result] = backtest({
                    calendar: calendar.compiled,
                    spans,
                    firstRecordedDay: firstDay,
                    today,
                    weeks: historyWeeks,
                    sizes: [size],
                    trials: RECORD_TRIALS,
                    scopeKey,
                    originsFrom: today - 7 * RECORD_WEEKS,
                });
                const s = result!.scores;
                record =
                    s.p85.scorable >= RECORD_MIN_SCORABLE
                        ? {
                              status: 'SHOWN',
                              size,
                              p50: { scorable: s.p50.scorable, held: s.p50.held },
                              p85: { scorable: s.p85.scorable, held: s.p85.held },
                              p95: { scorable: s.p95.scorable, held: s.p95.held },
                          }
                        : { status: 'NOT_ENOUGH', scorable: s.p85.scorable, needed: RECORD_MIN_SCORABLE };
            }
        }

        const histogram = outcome.refused ? null : histogramOf(outcome.distribution);
        return {
            asOf: fromEpochDay(today),
            timeZone: tz,
            calendarTeamId: scopeTeamId && calendar.id !== calendars.workspace.id ? scopeTeamId : null,
            setAside,
            scope: { kind, dueDate: due !== null ? fromEpochDay(due) : null },
            remaining,
            basedOn: { kind: basedOn, projects: basedOn === 'projects' ? historyProjects : [], team: basedOn === 'team' ? offeredTeam : null },
            offered: { projects: offeredProjects, team: offeredTeam },
            history: { weeks: historyWeeks, from: window ? fromEpochDay(window.from) : null, to: window ? fromEpochDay(window.to) : null, completions: sample.completions, workingDays: sample.days.length },
            share,
            trials: outcome.trials,
            seed: outcome.seed,
            refused: outcome.refused ? refusalBody(outcome, historyWeeks) : null,
            cautions: outcome.refused ? [] : outcome.cautions,
            likely: outcome.refused
                ? null
                : {
                      p50: { date: fromEpochDay(outcome.likely.p50.day), beyond: outcome.likely.p50.beyond },
                      p85: { date: fromEpochDay(outcome.likely.p85.day), beyond: outcome.likely.p85.beyond },
                      p95: { date: fromEpochDay(outcome.likely.p95.day), beyond: outcome.likely.p95.beyond },
                  },
            due: outcome.refused || !outcome.due ? null : { date: fromEpochDay(outcome.due.day), finished: outcome.due.finished, passed: outcome.due.passed },
            histogram: histogram
                ? { resolution: histogram.resolution, buckets: histogram.buckets.map((b) => ({ start: fromEpochDay(b.start), end: fromEpochDay(b.end), trials: b.trials })), beyond: outcome.refused ? 0 : outcome.distribution.beyond }
                : null,
            curve: outcome.refused ? null : chanceCurveOf(outcome.distribution).map((c) => ({ date: fromEpochDay(c.day), finished: c.finished })),
            record,
        };
    });
}
