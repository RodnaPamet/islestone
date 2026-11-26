/**
 * Fractional index keys for manual order (ADR 0002 §5, option F1).
 *
 * A key is a non-empty string of base-62 digits `0-9A-Za-z`, read as a
 * fraction in [0, 1): digit by digit, most significant first. Keys compare by
 * code unit, which for these digits is the byte order Postgres uses under
 * `COLLATE "C"`, so JavaScript `<` and the database agree. Never compare keys
 * with `localeCompare`: a language collation orders mixed case differently.
 *
 * A key never ends with the smallest digit `0`, so there is always room
 * before any key, and `keyBetween(a, b)` always finds a key strictly between
 * `a` and `b` (either may be `null`, an open end).
 *
 * The algorithm is the well-known midpoint over digit strings described in
 * public writing on fractional indexing; written in-house, no code copied
 * (ADR 0002 F1, owner decision 2026-11-19).
 *
 * Pure, with no imports, so the property tests drive it directly.
 */

export const SORT_KEY_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = SORT_KEY_DIGITS.length;

/**
 * A key longer than this asks for a rebalance (the `work-item-sortkey-rebalance`
 * job). Keys grow only when many inserts land in the same gap.
 */
export const SORT_KEY_REBALANCE_LENGTH = 64;

/** The hard ceiling a key may never pass; writes past it are refused. */
export const SORT_KEY_MAX_LENGTH = 255;

const VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;

export class InvalidSortKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidSortKeyError';
    }
}

/** True when `key` is a well-formed sort key. */
export function isValidSortKey(key: string): boolean {
    return key.length > 0 && key.length <= SORT_KEY_MAX_LENGTH && VALID_KEY.test(key);
}

/** True when the key has grown past the rebalance bound. */
export function needsRebalance(key: string): boolean {
    return key.length > SORT_KEY_REBALANCE_LENGTH;
}

function digitAt(s: string, i: number): number {
    if (i >= s.length) return 0;
    return SORT_KEY_DIGITS.indexOf(s[i]!);
}

/**
 * A digit string strictly between `a` and `b` (`b === null` means 1), with no
 * trailing `0`. Requires `a < b`, both without trailing zeros (`a` may be
 * empty, meaning 0).
 */
function midpoint(a: string, b: string | null): string {
    if (b !== null) {
        // Skip the shared prefix, treating a missing digit of `a` as 0.
        let n = 0;
        while (n < b.length && digitAt(a, n) === digitAt(b, n)) n++;
        if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
    const da = digitAt(a, 0);
    const db = b !== null ? digitAt(b, 0) : BASE;
    if (db - da > 1) {
        return SORT_KEY_DIGITS[Math.round((da + db) / 2)]!;
    }
    // Adjacent first digits.
    if (b !== null && b.length > 1) {
        // `b`'s first digit alone is below `b` and above `a`.
        return b[0]!;
    }
    // Keep `a`'s first digit and find room after the rest of `a`.
    return SORT_KEY_DIGITS[da]! + midpoint(a.slice(1), null);
}

/**
 * A key strictly between `a` and `b`. `null` is an open end: `keyBetween(null,
 * null)` is a first key, `keyBetween(last, null)` appends, `keyBetween(null,
 * first)` prepends.
 */
export function keyBetween(a: string | null, b: string | null): string {
    if (a !== null && !isValidSortKey(a)) throw new InvalidSortKeyError(`Invalid sort key "${a}".`);
    if (b !== null && !isValidSortKey(b)) throw new InvalidSortKeyError(`Invalid sort key "${b}".`);
    if (a !== null && b !== null && !(a < b)) {
        throw new InvalidSortKeyError(`Sort keys out of order: "${a}" is not before "${b}".`);
    }
    const key = midpoint(a ?? '', b);
    if (key.length > SORT_KEY_MAX_LENGTH) {
        throw new InvalidSortKeyError('The sort key gap is exhausted; rebalance the list first.');
    }
    return key;
}

/**
 * `n` keys in increasing order, strictly between `a` and `b`, spread so the
 * keys stay short (split the gap in half, recurse on each side). Used by
 * creates that place several items and by the rebalance job.
 */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
    if (!Number.isInteger(n) || n < 0) throw new InvalidSortKeyError(`Cannot generate ${n} keys.`);
    if (n === 0) return [];
    if (n === 1) return [keyBetween(a, b)];
    const mid = keyBetween(a, b);
    const left = Math.floor((n - 1) / 2);
    return [...keysBetween(a, mid, left), mid, ...keysBetween(mid, b, n - 1 - left)];
}

/** A row coming back from a soft delete: its id and the key it kept. */
export interface RestoredSortKeyRow {
    id: string;
    sortKey: string;
}

/** The live keys just before and just after a restored row's place, in `(sortKey, id)` order. */
export interface LiveSortKeyNeighbours {
    prev: string | null;
    next: string | null;
}

function byKeyThenId(a: RestoredSortKeyRow, b: RestoredSortKeyRow): number {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The restored rows whose kept key is no longer theirs alone (issue #110): a
 * live row of the project holds it (a placement made while they were
 * deleted computes its key among live rows only, so it can mint the very
 * key a deleted row kept), or an earlier restored row in `(sortKey, id)`
 * order has the same one.
 */
export function collidingRestoredRows(rows: readonly RestoredSortKeyRow[], liveKeys: ReadonlySet<string>): Set<string> {
    const out = new Set<string>();
    const seen = new Set<string>();
    for (const row of [...rows].sort(byKeyThenId)) {
        if (liveKeys.has(row.sortKey) || seen.has(row.sortKey)) out.add(row.id);
        seen.add(row.sortKey);
    }
    return out;
}

/**
 * New keys for the colliding restored rows (issue #110), each in its old
 * place: between the live rows around its `(sortKey, id)` (`neighbours`, read
 * by the caller under the project's sequence row) and after every restored
 * row before it, before every restored row after it that keeps its key. A
 * row that does not collide keeps its key, so the result names only the
 * rows that change. Every key in the project is then distinct, and the
 * order by key is the order by `(old key, id)`. Requires, for each colliding
 * row, `prev < next` (the caller steps past live rows that share a key).
 */
export function planRestoredSortKeys(
    rows: readonly RestoredSortKeyRow[],
    colliding: ReadonlySet<string>,
    neighbours: ReadonlyMap<string, LiveSortKeyNeighbours>,
): Map<string, string> {
    const sorted = [...rows].sort(byKeyThenId);
    const out = new Map<string, string>();
    let floor: string | null = null;
    sorted.forEach((row, i) => {
        if (!colliding.has(row.id)) {
            floor = row.sortKey;
            return;
        }
        const around = neighbours.get(row.id);
        if (!around) throw new InvalidSortKeyError(`No live neighbours for the restored row ${row.id}.`);
        const lower: string | null = floor !== null && (around.prev === null || floor > around.prev) ? floor : around.prev;
        let upper = around.next;
        for (const later of sorted.slice(i + 1)) {
            if (colliding.has(later.id) || (lower !== null && later.sortKey <= lower)) continue;
            if (upper === null || later.sortKey < upper) upper = later.sortKey;
            break;
        }
        const key = keyBetween(lower, upper);
        out.set(row.id, key);
        floor = key;
    });
    return out;
}
