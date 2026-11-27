/**
 * The analytics reads' shapes and bounds (sub-phase 3.6a;
 * docs/porting/maps/3.6.md, "Reads, routes and keys"; ADR 0014). Client-safe:
 * the page, the charts and the usecases import them; no server module.
 *
 * Dates are `YYYY-MM-DD` (epoch days on the server, never passed through a
 * zone); durations are working days to one decimal (decision 313).
 */

/** The widest window a read takes, inclusive (400 `ANALYTICS_RANGE` above). */
export const ANALYTICS_MAX_DAYS = 366;
/** The most completions a throughput or durations read counts (422 `ANALYTICS_TOO_LARGE` above, never cut). */
export const ANALYTICS_COMPLETION_LIMIT = 50_000;
/** The most items a flow or burn-up read follows (422 above). */
export const ANALYTICS_FLOW_ITEM_LIMIT = 20_000;
/** The most items a filter on current values (labels, type, assignee …) may select (422 above). */
export const ANALYTICS_FILTER_ITEM_LIMIT = 50_000;
/** The most reviewers' spans asked on open steps a time-waiting read takes in its window (422 above). */
export const ANALYTICS_REVIEW_SPAN_LIMIT = 50_000;
/** The newest completions drawn as points on the cycle-time and lead-time charts. */
export const ANALYTICS_POINT_LIMIT = 2_000;
/** The oldest open, started items drawn as "Age". */
export const ANALYTICS_AGE_LIMIT = 2_000;
/** A flow window up to this many days is drawn by day, beyond by week. */
export const ANALYTICS_DAILY_FLOW_DAYS = 92;

export const ANALYTICS_RANGE = 'ANALYTICS_RANGE';
export const ANALYTICS_TOO_LARGE = 'ANALYTICS_TOO_LARGE';

/** The windows the page offers, in weeks back from today. */
export const ANALYTICS_WINDOW_WEEKS = [4, 8, 12, 26, 52] as const;
export type AnalyticsWindowWeeks = (typeof ANALYTICS_WINDOW_WEEKS)[number];
export const DEFAULT_ANALYTICS_WINDOW_WEEKS: AnalyticsWindowWeeks = 12;

/**
 * The list's filters each measure owns (status) and so sets aside; the answer
 * names those that were set (decision 315).
 */
export const ANALYTICS_SET_ASIDE_FILTERS = ['stateId', 'stateCategory', 'due'] as const;
export type AnalyticsSetAsideFilter = (typeof ANALYTICS_SET_ASIDE_FILTERS)[number];

export type ThroughputBin = 'day' | 'week';
export type DurationMeasure = 'cycle' | 'lead';
export type AnalyticsMeasure = 'items' | 'points' | 'hours';

/** What every analytics answer says about its window and its scope. */
export interface AnalyticsFrame {
    /** The window asked for, inclusive. */
    from: string;
    to: string;
    /** Today in the scope's zone: the window ends no later. */
    asOf: string;
    /** The scope's working calendar's zone (decision 316): one team's for a one-team scope, else the workspace's. */
    timeZone: string;
    /** The team whose calendar draws the days, or null for the workspace's. */
    calendarTeamId: string | null;
    /** The status filters the read set aside (decision 315). */
    setAside: AnalyticsSetAsideFilter[];
}

export interface AnalyticsTooLargeDetails {
    reason: typeof ANALYTICS_TOO_LARGE;
    /** What was over its bound: completions, items in the flow (or in time waiting), items a filter selects, or reviewers' spans (time waiting). */
    what: 'completions' | 'items' | 'filter' | 'reviews';
    count: number;
    limit: number;
}

export interface CountsResponse extends AnalyticsFrame {
    /** Open items now (Backlog, Unstarted, Started). */
    open: number;
    /** Started items now. */
    started: number;
    /** Items completed in the window (decision 311). */
    doneInWindow: number;
    /** Items created in the window, live now. */
    createdInWindow: number;
}

export interface ThroughputBinRow {
    /** The bin's first day (a Monday for a week, the window's first day for a partial first week). */
    start: string;
    /** The bin's last day, inclusive. */
    end: string;
    count: number;
    /** False for a first or last week the window cuts (left out of the median). */
    whole: boolean;
}

export interface ThroughputResponse extends AnalyticsFrame {
    bin: ThroughputBin;
    bins: ThroughputBinRow[];
    total: number;
    /** The median bin (nearest rank), whole bins only; null with none. */
    median: number | null;
}

export interface PercentileSummary {
    count: number;
    p50: number | null;
    p85: number | null;
    p95: number | null;
}

export interface DurationPoint {
    workItemId: string;
    key: string;
    title: string;
    completedOn: string;
    /** Null: done without starting (decision 312). */
    cycleTime: number | null;
    leadTime: number;
}

export interface AgePoint {
    workItemId: string;
    key: string;
    title: string;
    startedOn: string;
    age: number;
}

export interface DurationsResponse extends AnalyticsFrame {
    measure: DurationMeasure;
    /** Over every completion in the window. */
    cycleTime: PercentileSummary;
    leadTime: PercentileSummary;
    /** Completions with no Started row before them (no cycle time). */
    doneWithoutStarting: number;
    /** The newest completions, at most `ANALYTICS_POINT_LIMIT`. */
    points: DurationPoint[];
    /** More completions than points: the points are the newest ones. */
    pointsNewestOnly: boolean;
    /** Open, started items now, the oldest first (cycle time only; empty for lead time). */
    age: AgePoint[];
    /** Open, started items in scope now (with a recorded start). */
    ageTotal: number;
}

export interface FlowDayRow {
    date: string;
    backlog: number;
    unstarted: number;
    started: number;
    /** Done since the window's first day. */
    done: number;
}

export interface BurnUpRow {
    date: string;
    scope: number;
    started: number;
    completed: number;
    /** In-scope items with no estimate in the measure's unit (points and hours only). */
    unestimated?: number;
}

export interface FlowResponse extends AnalyticsFrame {
    /** `day` up to `ANALYTICS_DAILY_FLOW_DAYS` days, `week` beyond (each week's last day drawn). */
    resolution: 'day' | 'week';
    days: FlowDayRow[];
    burnUp: { measure: AnalyticsMeasure; measures: AnalyticsMeasure[]; points: BurnUpRow[] } | null;
    /** Items followed (ever in scope up to the window's end). */
    items: number;
}

// ─── Time waiting (3.6b; decisions 76, 317, 329 and 332) ─────────────────

/** The most waits at the moment of reading listed per party (the rest counted in `waitingNow`). */
export const WAITING_NOW_LISTED = 10;
/** The most waiting-now items listed across the parties shown (their keys and titles are read by id). */
export const WAITING_NOW_LISTED_TOTAL = 2_000;

/** Whom a row is about: a member (active or deactivated) by name, or every removed member as one anonymous row. */
export type WaitingParty = { kind: 'member'; userId: string; name: string | null; active: boolean } | { kind: 'former' };

/** Ended waits' lengths in working days to one decimal: their count, median and 85th percentile (nearest rank). */
export interface EndedWaitsSummary {
    count: number;
    p50: number | null;
    p85: number | null;
}

export interface WaitingNowItem {
    workItemId: string;
    key: string;
    title: string;
    /** A reviewer's wait (decision 317), not waiting on. */
    asReviewer: boolean;
    /** The wait so far, in working days. */
    age: number;
}

export interface WaitingPartyRow {
    party: WaitingParty;
    /** Time waited in the window, in working days (decision 313). */
    waited: number;
    /** Of which as a reviewer (decision 317). */
    asReviewer: number;
    /** Items waited on in the window. */
    items: number;
    /** Waits that ended in the window (whole waits). */
    ended: EndedWaitsSummary;
    /** Items waiting on the party at the moment of reading. */
    waitingNow: number;
    /** Those waits, the oldest first, at most `WAITING_NOW_LISTED`. */
    waitingNowItems: WaitingNowItem[];
}

export interface WaitingTotals {
    /** Time waited in the window, summed over everyone waited on. */
    waited: number;
    asReviewer: number;
    /** The time open items spent waiting on someone (each instant of an item once). */
    itemTimeWaiting: number;
    /** Open item time in the window: Unstarted and Started time, never Backlog (decision 336). */
    openItemTime: number;
    /** `itemTimeWaiting / openItemTime`; null with no open item time. */
    share: number | null;
    items: number;
    ended: EndedWaitsSummary;
    /** Items waiting on someone at the moment of reading. */
    waitingNow: number;
}

export interface WaitingResponse extends AnalyticsFrame {
    /**
     * The totals across everyone: only for a holder of `analytics.people` who
     * is a person (decision 335). Absent otherwise, in any scope.
     */
    totals?: WaitingTotals;
    /**
     * The caller's own row (decision 329), zeros when nobody waited on them.
     * Absent for a caller who is not a person (an API key or an agent;
     * decisions 332 and 335).
     */
    self?: WaitingPartyRow;
    /**
     * Every party's row, the caller's included, the most time waited first:
     * only for a holder of `analytics.people` who is a person (decisions 329
     * and 332). Absent otherwise, never null or empty for want of the key.
     */
    people?: WaitingPartyRow[];
    /** The waiting-now lists were cut at `WAITING_NOW_LISTED_TOTAL` across the rows shown. */
    waitingNowCut: boolean;
    /** Items followed (ever in scope up to the moment of reading); absent for a caller who is not a person (nothing is read). */
    items?: number;
}

/** What the Analytics page offers (asked on the server). */
export interface AnalyticsAffordances {
    view: boolean;
    share: boolean;
    people: boolean;
}

// ─── Forecasting (3.6c; ADR 0014 §3 to §5; owner decisions 318 to 325) ────

/** Whose completions feed a forecast (decision 321): the scope's projects (a cycle: its team), the team or the workspace. */
export const FORECAST_BASED_ON = ['projects', 'team', 'workspace'] as const;
export type ForecastBasedOn = (typeof FORECAST_BASED_ON)[number];
export const FORECAST_HISTORY = 'FORECAST_HISTORY';

/** What a forecast is over, which decides its due date: a cycle's end, a milestone's, goal's, initiative's or project's due date, or none. */
export type ForecastScopeKind = 'cycle' | 'milestone' | 'goal' | 'initiative' | 'project' | 'filter';

/** A likely date: the day, or later than it (`beyond`: past the two-year cap, the cap's day). */
export interface ForecastLikelyDate {
    date: string;
    beyond: boolean;
}

/** Why a forecast gives no date (decision 319); the counts are the sentence's. */
export type ForecastRefusalBody =
    | { reason: 'NOTHING_REMAINING' }
    | { reason: 'NO_SHARE' }
    | { reason: 'TOO_FEW_COMPLETIONS'; completions: number; needed: number; weeks: number }
    | { reason: 'TOO_FEW_WORKING_DAYS'; workingDays: number; needed: number }
    | { reason: 'BEYOND_TWO_YEARS'; completions: number; weeks: number; capDate: string };

export type ForecastCautionCode = 'FEW_COMPLETIONS';

export interface ForecastProjectRef {
    id: string;
    name: string;
    keyPrefix: string;
}

/**
 * The scope's own record (decision 325): earlier forecasts of the same
 * question here, replayed from weekly origins over the last 52 weeks with the
 * history as it stood then. Shown with at least 10 scorable origins.
 */
export type ForecastRecord =
    | {
          status: 'SHOWN';
          /** The completions each earlier forecast was for: these items at this share, in the history's own completions. */
          size: number;
          p50: { scorable: number; held: number };
          p85: { scorable: number; held: number };
          p95: { scorable: number; held: number };
      }
    | { status: 'NOT_ENOUGH'; scorable: number; needed: number }
    | { status: 'TOO_LARGE'; count: number; limit: number }
    | { status: 'NONE' };

export interface ForecastResponse {
    /** Today in the scope's zone: the forecast's first day is the next working day. */
    asOf: string;
    timeZone: string;
    calendarTeamId: string | null;
    setAside: AnalyticsSetAsideFilter[];
    scope: { kind: ForecastScopeKind; dueDate: string | null };
    /** Open items now (live, in visible, unarchived projects). */
    remaining: number;
    /** What the history is: the projects, the team, or the workspace (decision 321). */
    basedOn: { kind: ForecastBasedOn; projects: ForecastProjectRef[]; team: { id: string; name: string } | null };
    /** What the person may base it on instead: a subset of these projects, this team, or the workspace. */
    offered: { projects: ForecastProjectRef[]; team: { id: string; name: string } | null };
    history: { weeks: number; from: string | null; to: string | null; completions: number; workingDays: number };
    /** The share of that throughput assumed, in percent (decision 322). No new items are assumed. */
    share: number;
    trials: number;
    /** Derived from the inputs (decision 323): the same data on the same day gives the same seed. */
    seed: number;
    refused: ForecastRefusalBody | null;
    cautions: ForecastCautionCode[];
    likely: { p50: ForecastLikelyDate; p85: ForecastLikelyDate; p95: ForecastLikelyDate } | null;
    /** The chance by the scope's due date: trials finished by it of `trials`; `passed` when it is today or earlier. */
    due: { date: string; finished: number | null; passed: boolean } | null;
    histogram: { resolution: 'day' | 'week'; buckets: Array<{ start: string; end: string; trials: number }>; beyond: number } | null;
    /** "Chance finished by": trials finished on or before each working day. */
    curve: Array<{ date: string; finished: number }> | null;
    record: ForecastRecord;
}
