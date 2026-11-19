/**
 * Keyset (cursor) pagination for list endpoints.
 *
 * Every paginated list returns `{ items, pageInfo: { nextCursor?, hasNextPage } }`
 * (`src/lib/dto/pagination.ts`). The cursor is opaque to the client: a
 * base64url JSON payload `{ k, id }`, where `k` is the last row's value in the
 * list's ordering column and `id` breaks ties, so a page boundary that falls
 * inside a run of equal keys neither skips nor repeats a row.
 *
 * Rewritten from inflect-compliance `src/lib/pagination.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. That cursor was hard-wired to
 * `(createdAt, id)` descending; work-item lists order by `(sortKey, id)`
 * ascending and "recently changed" by `(updatedAt, id)`, and reusing a
 * `createdAt` cursor under a `sortKey` order silently skips or repeats rows.
 * The helper is parameterised by `{ column, direction }`. `clampLimit`,
 * `DEFAULT_LIMIT` and `MAX_LIMIT` are kept as they were.
 */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Clamp a limit value to [1, MAX_LIMIT], defaulting to DEFAULT_LIMIT. */
export function clampLimit(limit?: number | null): number {
    if (limit == null || isNaN(limit)) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

/** The ordering a keyset page follows. `kind` says how `k` is encoded. */
export interface KeysetOrder<C extends string = string> {
    column: C;
    direction: 'asc' | 'desc';
    kind: 'string' | 'date';
}

export interface CursorPayload {
    k: string;
    id: string;
}

export class InvalidCursorError extends Error {
    constructor() {
        super('Invalid cursor');
        this.name = 'InvalidCursorError';
    }
}

export function encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor. A cursor that is not base64url JSON of the right shape is
 * refused (`InvalidCursorError`), never treated as "the first page": a forged
 * cursor must not silently restart the list.
 */
export function decodeCursor(cursor: string, order: KeysetOrder): CursorPayload {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        throw new InvalidCursorError();
    }
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof (parsed as CursorPayload).k !== 'string' ||
        typeof (parsed as CursorPayload).id !== 'string' ||
        (parsed as CursorPayload).id.length === 0 ||
        (parsed as CursorPayload).id.length > 64
    ) {
        throw new InvalidCursorError();
    }
    const { k, id } = parsed as CursorPayload;
    if (order.kind === 'date' && Number.isNaN(Date.parse(k))) throw new InvalidCursorError();
    if (k.length > 512) throw new InvalidCursorError();
    return { k, id };
}

function keyValue(order: KeysetOrder, k: string): string | Date {
    return order.kind === 'date' ? new Date(k) : k;
}

/**
 * The `where` fragment for "rows after the cursor" under `order`:
 * `(col > k) OR (col = k AND id > id0)` for ascending, `<` for descending.
 */
export function buildKeysetWhere(order: KeysetOrder, cursor: CursorPayload): Record<string, unknown> {
    const op = order.direction === 'asc' ? 'gt' : 'lt';
    const value = keyValue(order, cursor.k);
    return {
        OR: [
            { [order.column]: { [op]: value } },
            { [order.column]: value, id: { [op]: cursor.id } },
        ],
    };
}

/** The `orderBy` for `order`, with `id` as the tie-breaker. */
export function keysetOrderBy(order: KeysetOrder): Array<Record<string, 'asc' | 'desc'>> {
    return [{ [order.column]: order.direction }, { id: order.direction }];
}

/**
 * Trim a `limit + 1` read to `limit` rows and compute the next cursor from the
 * last row kept.
 */
export function computeKeysetPage<T extends { id: string }>(
    rows: T[],
    limit: number,
    order: KeysetOrder,
): { items: T[]; pageInfo: { nextCursor?: string; hasNextPage: boolean } } {
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    if (!hasNextPage || !last) return { items, pageInfo: { hasNextPage: false } };
    const raw = (last as Record<string, unknown>)[order.column];
    const k = raw instanceof Date ? raw.toISOString() : String(raw);
    return { items, pageInfo: { hasNextPage: true, nextCursor: encodeCursor({ k, id: last.id }) } };
}
