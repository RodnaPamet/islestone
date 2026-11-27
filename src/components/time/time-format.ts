/**
 * Small client-side helpers of the Time pages (sub-phase 3.4b). Written fresh
 * for Islestone.
 */

/** Today's date (`YYYY-MM-DD`) in the browser's zone: the default date of a new entry. */
export function todayKey(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "0:42" or "11:05": a running timer's hours and minutes. */
export function clockText(totalMinutes: number): string {
    const m = Math.max(0, Math.floor(totalMinutes));
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

const DAY_FORMATS = {
    /** "Tue 24" — a column header. */
    short: { weekday: 'short', day: 'numeric' },
    /** "Tuesday 24 November" — a cell's label. */
    long: { weekday: 'long', day: 'numeric', month: 'long' },
    /** "24 Nov" — an entry's date. */
    date: { day: 'numeric', month: 'short' },
    /** "29 Nov 2026" — the end of a range. */
    dateYear: { day: 'numeric', month: 'short', year: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

/** A date-only `YYYY-MM-DD` in words, never passed through a zone (its UTC parts). One locale ships: English. */
export function formatDay(ymd: string, style: keyof typeof DAY_FORMATS): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...DAY_FORMATS[style] }).format(new Date(`${ymd}T00:00:00Z`));
}
