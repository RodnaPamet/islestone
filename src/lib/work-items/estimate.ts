/**
 * Estimates (sub-phase 3.4a; docs/porting/maps/3.4.md, "Estimates (3.4a)";
 * ADR 0012 §1; owner decisions 257 to 259): the one home of the estimate's
 * units, limits, parser and wording, used by every form, the API's input
 * schemas and the usecases.
 *
 *   - A team estimates in POINTS, HOURS or not at all (`null`).
 *   - An item holds two typed columns: `estimatePoints` (whole points, 0 to
 *     100) and `estimateMinutes` (hours stored as minutes, 0 to 60,000). Only
 *     the column of the item's team's current unit is shown, written and
 *     counted; the other is kept, so switching back restores it.
 *   - Hours are entered as "2h 30m", "2.5h", "2h", "45m" or "150m"; a bare
 *     number is hours ("1.5" is 90 minutes). Minutes are whole: a fraction
 *     of a minute is refused, never rounded.
 *
 * Client-safe: no Prisma runtime, no server import. Written fresh for
 * Islestone.
 */

export const ESTIMATE_UNITS = ['POINTS', 'HOURS'] as const;
export type EstimateUnitValue = (typeof ESTIMATE_UNITS)[number];

export const ESTIMATE_LIMITS = {
    /** Whole points, inclusive (CHECK `WorkItem_estimate_points_range`). */
    pointsMax: 100,
    /** 1,000 hours, inclusive (CHECK `WorkItem_estimate_minutes_range`). */
    minutesMax: 60_000,
} as const;

/** The two stored columns of an item or an item template. */
export interface EstimateColumns {
    estimatePoints: number | null;
    estimateMinutes: number | null;
}

/** The column a unit writes and counts. */
export function estimateColumnOf(unit: EstimateUnitValue): keyof EstimateColumns {
    return unit === 'POINTS' ? 'estimatePoints' : 'estimateMinutes';
}

/** The value counted for an item under its team's current unit (`null`: none, or the team does not estimate). */
export function countedEstimate(unit: EstimateUnitValue | null | undefined, columns: Partial<EstimateColumns>): number | null {
    if (!unit) return null;
    return columns[estimateColumnOf(unit)] ?? null;
}

/** Is `value` a valid stored value of `unit` (whole, in range)? */
export function isValidEstimate(unit: EstimateUnitValue, value: number): boolean {
    if (!Number.isInteger(value) || value < 0) return false;
    return value <= (unit === 'POINTS' ? ESTIMATE_LIMITS.pointsMax : ESTIMATE_LIMITS.minutesMax);
}

const DURATION = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/i;

/**
 * Parse a duration the person typed into whole minutes: "2h 30m", "2.5h",
 * "2h", "45m", "150m", "1.5" (hours). `null` for anything else, for a
 * fraction of a minute, and for more than the limit.
 */
export function parseDuration(text: string): number | null {
    const raw = text.trim().replace(',', '.');
    if (raw === '') return null;
    let minutes: number;
    if (/^\d+(?:\.\d+)?$/.test(raw)) {
        minutes = Number(raw) * 60;
    } else {
        const m = DURATION.exec(raw);
        if (!m || (m[1] === undefined && m[2] === undefined)) return null;
        minutes = (m[1] !== undefined ? Number(m[1]) * 60 : 0) + (m[2] !== undefined ? Number(m[2]) : 0);
    }
    // Floating point: 2.1h is 126 minutes, but 2.1 * 60 is 126.00000000000001.
    const rounded = Math.round(minutes * 1e6) / 1e6;
    if (!Number.isInteger(rounded)) return null;
    return isValidEstimate('HOURS', rounded) ? rounded : null;
}

/** Minutes as "2h 30m", "45m", "3h", "0m". */
export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Parse points the person typed: a whole number from 0 to 100, else `null`. */
export function parsePoints(text: string): number | null {
    const raw = text.trim();
    if (!/^\d+$/.test(raw)) return null;
    const value = Number(raw);
    return isValidEstimate('POINTS', value) ? value : null;
}

/** Parse an estimate typed in `unit`'s form. */
export function parseEstimate(unit: EstimateUnitValue, text: string): number | null {
    return unit === 'POINTS' ? parsePoints(text) : parseDuration(text);
}

/** The value as it is entered again in a form ("5", "2h 30m"). */
export function estimateInputText(unit: EstimateUnitValue, value: number | null): string {
    if (value === null) return '';
    return unit === 'POINTS' ? String(value) : formatDuration(value);
}
