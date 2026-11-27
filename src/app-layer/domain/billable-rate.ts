/**
 * The billable-rate cascade (sub-phase 3.4d; docs/porting/maps/3.4.md,
 * "Rates, totals and export (3.4d)"; ADR 0012 §6; owner decisions 272 and
 * 273). Pure and client-safe; every reader of a rate calls it: the approval's
 * stamp, Time totals and the export.
 *
 *   - **The cascade** (decision 272): an entry's rate is the one in force on
 *     its date at the PROJECT level for its project, else at the MEMBER level
 *     for its person, else at the WORKSPACE level. No rate anywhere is "No
 *     rate": the entry has no amount.
 *   - **In force** (decision 273): a level's row with the latest
 *     `effectiveFrom` on or before the date. A row whose rate is NULL means
 *     "no rate at this level from this date": the cascade falls through it to
 *     the next level, as if the level had none.
 *   - **Frozen** (decision 273): an entry of an approved week takes the rate
 *     stamped on it at approval, or none; later rate changes never reach it
 *     (`entryRate`).
 *
 * Dates are `YYYY-MM-DD` keys (date-only, compared as strings). Written fresh
 * for Islestone.
 */
import { amountMinor } from '@/lib/time/money';

export type RateLevel = 'WORKSPACE' | 'PROJECT' | 'MEMBER';

/** The cascade's order (decision 272). */
export const RATE_CASCADE: readonly RateLevel[] = ['PROJECT', 'MEMBER', 'WORKSPACE'];

export interface RateRow {
    level: RateLevel;
    projectId: string | null;
    userId: string | null;
    /** Minor units per hour; NULL: no rate at this level from this date. */
    hourlyRateMinor: number | null;
    /** `YYYY-MM-DD`. */
    effectiveFrom: string;
}

export interface ResolvedRate {
    hourlyRateMinor: number;
    level: RateLevel;
}

function scopeKey(level: RateLevel, projectId: string | null, userId: string | null): string {
    return level === 'WORKSPACE' ? 'W' : level === 'PROJECT' ? `P:${projectId}` : `M:${userId}`;
}

/** A workspace's rate history, indexed by level and scope, each scope's rows by date. */
export interface RateBook {
    readonly byScope: ReadonlyMap<string, readonly RateRow[]>;
}

/** Build the book from rows in any order. */
export function rateBook(rows: readonly RateRow[]): RateBook {
    const byScope = new Map<string, RateRow[]>();
    for (const r of rows) {
        const key = scopeKey(r.level, r.projectId, r.userId);
        const list = byScope.get(key);
        if (list) list.push(r);
        else byScope.set(key, [r]);
    }
    for (const list of byScope.values()) list.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
    return { byScope };
}

/** The row in force on `day` among `rows` sorted by date: the latest on or before it. */
function inForce(rows: readonly RateRow[] | undefined, day: string): RateRow | undefined {
    if (!rows || rows.length === 0) return undefined;
    // Binary search for the last row with effectiveFrom <= day.
    let lo = 0;
    let hi = rows.length - 1;
    let found = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid]!.effectiveFrom <= day) {
            found = mid;
            lo = mid + 1;
        } else hi = mid - 1;
    }
    return found >= 0 ? rows[found] : undefined;
}

/** The rate in force for an entry on `workDate` (decision 272), or null: "No rate". */
export function resolveRate(book: RateBook, entry: { projectId: string; userId: string; workDate: string }): ResolvedRate | null {
    for (const level of RATE_CASCADE) {
        const row = inForce(book.byScope.get(scopeKey(level, entry.projectId, entry.userId)), entry.workDate);
        if (row && row.hourlyRateMinor !== null) return { hourlyRateMinor: row.hourlyRateMinor, level };
    }
    return null;
}

/** What an entry's rate is read from: its week approved, the stamp (decision 273); otherwise the history. */
export interface EntryRateInput {
    projectId: string;
    userId: string;
    workDate: string;
    billable: boolean;
    /** Its week is APPROVED: the stamped rate stands, or none. */
    approved: boolean;
    frozenRateMinor: number | null;
    frozenRateLevel: RateLevel | null;
}

/** An entry's rate: none when not billable; the stamped one in an approved week; else resolved now. */
export function entryRate(book: RateBook, e: EntryRateInput): ResolvedRate | null {
    if (!e.billable) return null;
    if (e.approved) return e.frozenRateMinor !== null && e.frozenRateLevel !== null ? { hourlyRateMinor: e.frozenRateMinor, level: e.frozenRateLevel } : null;
    return resolveRate(book, e);
}

/** An entry's amount in minor units, or null with no rate (non-billable entries have none). */
export function entryAmount(book: RateBook, e: EntryRateInput & { minutes: number }): number | null {
    const rate = entryRate(book, e);
    return rate ? amountMinor(e.minutes, rate.hourlyRateMinor) : null;
}

/**
 * Amounts of a set of entries grouped by `key`, each rounded per entry
 * (decision 273). `count` entries alike in every input share one line (the
 * totals read groups them so), so a line's amount is `count × amount`.
 * Billable minutes with no rate are counted apart, so a group can say "No
 * rate" for part of its time.
 */
export function timeAmounts(
    book: RateBook,
    lines: ReadonlyArray<EntryRateInput & { key: string; minutes: number; count: number }>,
): Map<string, { amountMinor: number; noRateMinutes: number }> {
    const out = new Map<string, { amountMinor: number; noRateMinutes: number }>();
    for (const line of lines) {
        if (!line.billable) continue;
        const acc = out.get(line.key) ?? { amountMinor: 0, noRateMinutes: 0 };
        const amount = entryAmount(book, line);
        if (amount === null) acc.noRateMinutes += line.minutes * line.count;
        else acc.amountMinor += amount * line.count;
        out.set(line.key, acc);
    }
    return out;
}
