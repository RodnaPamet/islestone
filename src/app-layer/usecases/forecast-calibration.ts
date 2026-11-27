/**
 * The forecast's calibration (sub-phase 3.6c; Hardening H3; ADR 0014 §5;
 * owner decision 325; docs/porting/maps/3.6.md, "Calibration"): H3's
 * back-test over every visible project of a workspace, each forecast from its
 * own completions as the record stood at each weekly origin, for the next 10,
 * 25 and 50 completions, scored against the record as it stands now.
 *
 * Not a route: `scripts/forecast-calibration.ts` (`npm run
 * forecast:calibration`) publishes it in `docs/analytics.md`, "Calibration",
 * and `tests/perf/forecast-calibration.test.ts` holds the 85 % hit rate on
 * the 10k seed. The same back-test, over 52 weeks, is each forecast's own
 * record (`analytics-forecast.ts`). Reads only, never stored or audited; no
 * description, comment or field value is read.
 *
 * Written fresh for Islestone.
 */
import { completionSpans, daySpansOf, type SpanRow } from '../domain/analytics/completion';
import { epochDayOf, startOfEpochDay } from '../domain/analytics/zone';
import { backtest, BACKTEST_SIZES, wilsonBand, type BacktestSizeResult, type DaySpan } from '../domain/forecast/backtest';
import { DEFAULT_FORECAST_HISTORY_WEEKS } from '../domain/forecast/sample';
import { FORECAST_PERCENTILES, FORECAST_TRIALS } from '../domain/forecast/simulate';
import { todayIn } from '../domain/schedule/calendar';
import { assertCanViewAnalytics } from '../policies/analytics.policies';
import { visibleProjects } from '../policies/project-visibility';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemTransitionRepository } from '../repositories/WorkItemTransitionRepository';
import type { RequestContext } from '../types';
import { resolveWorkingCalendars } from './working-calendar';
import { runInTenantContext } from '@/lib/db-context';

/** The most completions a project's back-test reads: its whole recorded history, bounded. */
const CALIBRATION_COMPLETION_LIMIT = 50_000;

export interface CalibrationScore {
    scorable: number;
    held: number;
    band: [number, number] | null;
}

export interface CalibrationResult {
    weeks: number;
    trials: number;
    /** Projects back-tested, and those left out (too large to read whole). */
    projects: number;
    skipped: number;
    bySize: Array<{ size: number; origins: number; refused: number; scores: Record<`p${(typeof FORECAST_PERCENTILES)[number]}`, CalibrationScore> }>;
}

/** Back-test every visible project's forecasts (see the module's header). */
export async function backtestWorkspaceForecasts(
    ctx: RequestContext,
    opts: { weeks?: number; sizes?: readonly number[]; trials?: number; now?: Date } = {},
): Promise<CalibrationResult> {
    assertCanViewAnalytics(ctx);
    const weeks = opts.weeks ?? DEFAULT_FORECAST_HISTORY_WEEKS;
    const sizes = opts.sizes ?? BACKTEST_SIZES;
    const trials = opts.trials ?? FORECAST_TRIALS;
    const now = opts.now ?? new Date();
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projects = await ProjectRepository.list(db, ctx, v, { includeArchived: true });
        const calendars = await resolveWorkingCalendars(db, ctx);
        const totals = sizes.map((size) => ({ size, origins: 0, refused: 0, scores: Object.fromEntries(FORECAST_PERCENTILES.map((p) => [`p${p}`, { scorable: 0, held: 0, band: null }])) as Record<`p${(typeof FORECAST_PERCENTILES)[number]}`, CalibrationScore> }));
        let skipped = 0;
        for (const project of projects) {
            const calendar = calendars.forTeam(project.teamId);
            const tz = calendar.timeZone;
            const scope = { visibility: v, projectIds: [project.id], teamIds: null, cycle: null, milestone: null, itemIds: null };
            // guardrail-allow: n+1 — the calibration's one read per project (the workspace's projects, at most PROJECT_LIST_TAKE), a script's, never a request's.
            const firstAt = await WorkItemTransitionRepository.firstRecordedAt(db, ctx, { visibility: v, projectIds: [project.id], teamId: null });
            if (!firstAt) continue;
            const firstDay = epochDayOf(firstAt, tz);
            // guardrail-allow: n+1 — as above: each project's recorded completions, bounded.
            const rows = await WorkItemTransitionRepository.completionSpanRows(db, ctx, scope, { from: startOfEpochDay(firstDay, tz), asOf: now }, CALIBRATION_COMPLETION_LIMIT + 1);
            if (new Set(rows.map((r) => r.workItemId)).size > CALIBRATION_COMPLETION_LIMIT) {
                skipped += 1;
                continue;
            }
            const spans: DaySpan[] = [];
            let start = 0;
            for (let i = 1; i <= rows.length; i += 1) {
                if (i === rows.length || rows[i]!.workItemId !== rows[start]!.workItemId) {
                    spans.push(...daySpansOf(completionSpans(rows.slice(start, i) as SpanRow[]), (at) => epochDayOf(at, tz)));
                    start = i;
                }
            }
            const results: BacktestSizeResult[] = backtest({
                calendar: calendar.compiled,
                spans,
                firstRecordedDay: firstDay,
                today: todayIn(tz, now),
                weeks,
                sizes,
                trials,
                scopeKey: { calibration: project.id },
            });
            results.forEach((r, i) => {
                const t = totals[i]!;
                t.origins += r.origins;
                t.refused += r.refused;
                for (const p of FORECAST_PERCENTILES) {
                    t.scores[`p${p}`].scorable += r.scores[`p${p}`].scorable;
                    t.scores[`p${p}`].held += r.scores[`p${p}`].held;
                }
            });
        }
        for (const t of totals) for (const p of FORECAST_PERCENTILES) t.scores[`p${p}`].band = wilsonBand(t.scores[`p${p}`].held, t.scores[`p${p}`].scorable);
        return { weeks, trials, projects: projects.length - skipped, skipped, bySize: totals };
    });
}
