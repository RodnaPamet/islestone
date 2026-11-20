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

// ─── Multi-column sorts (sub-phase 2.4) ───────────────────────────────────
//
// The list sorts of 2.4 (due date, priority, created, key, a custom field)
// order by one or more columns, some nullable, before the `id` tie-break.
// Nulls sort LAST in both directions (docs/pagination.md). The cursor is
// `{ v: [value per column], id }`; a `null` value continues among the nulls.
// Written fresh for Islestone.

/** One column of a sort: a Prisma path (`['dueDate']`, `['project', 'keyPrefix']`). */
export interface SortColumn {
    path: readonly string[];
    direction: 'asc' | 'desc';
    kind: 'string' | 'date' | 'number';
    nullable?: boolean;
}

/** An ordered list of columns; `id` breaks ties in the last column's direction. */
export interface SortSpec {
    columns: readonly SortColumn[];
}

export type SortValue = string | number | null;

export interface SortCursor {
    v: SortValue[];
    id: string;
}

export function encodeSortCursor(cursor: SortCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode a sort cursor for `spec`; anything else is refused, never read as the first page. */
export function decodeSortCursor(raw: string, spec: SortSpec): SortCursor {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
        throw new InvalidCursorError();
    }
    if (!parsed || typeof parsed !== 'object') throw new InvalidCursorError();
    const { v, id } = parsed as { v?: unknown; id?: unknown };
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw new InvalidCursorError();
    if (!Array.isArray(v) || v.length !== spec.columns.length) throw new InvalidCursorError();
    spec.columns.forEach((col, i) => {
        const value = v[i] as unknown;
        if (value === null) {
            if (!col.nullable) throw new InvalidCursorError();
            return;
        }
        if (col.kind === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new InvalidCursorError();
        } else {
            if (typeof value !== 'string' || value.length > 512) throw new InvalidCursorError();
            if (col.kind === 'date' && Number.isNaN(Date.parse(value))) throw new InvalidCursorError();
        }
    });
    return { v: v as SortValue[], id };
}

function atPath(path: readonly string[], leaf: unknown): Record<string, unknown> {
    let out: unknown = leaf;
    for (let i = path.length - 1; i >= 0; i -= 1) out = { [path[i]!]: out };
    return out as Record<string, unknown>;
}

function sortValue(col: SortColumn, value: SortValue): string | number | Date {
    return col.kind === 'date' ? new Date(value as string) : (value as string | number);
}

/**
 * The `where` for "rows after the cursor" under `spec`: a lexicographic OR
 * over the columns (equal on every earlier column, after on this one), then
 * equal on all and `id` after. "After" a non-null value includes every null
 * of a nullable column (nulls last); after a null, only a later `id` among
 * the nulls.
 */
export function buildSortWhere(spec: SortSpec, cursor: SortCursor): Record<string, unknown> {
    const or: Array<Record<string, unknown>> = [];
    const equal: Array<Record<string, unknown>> = [];
    spec.columns.forEach((col, i) => {
        const value = cursor.v[i] ?? null;
        if (value !== null) {
            const op = col.direction === 'asc' ? 'gt' : 'lt';
            const after: Array<Record<string, unknown>> = [atPath(col.path, { [op]: sortValue(col, value) })];
            if (col.nullable) after.push(atPath(col.path, null));
            or.push({ AND: [...equal, after.length === 1 ? after[0]! : { OR: after }] });
            equal.push(atPath(col.path, sortValue(col, value)));
        } else {
            equal.push(atPath(col.path, null));
        }
    });
    const last = spec.columns[spec.columns.length - 1];
    const idOp = (last?.direction ?? 'asc') === 'asc' ? 'gt' : 'lt';
    or.push({ AND: [...equal, { id: { [idOp]: cursor.id } }] });
    return { OR: or };
}

/** The `orderBy` for `spec`: each column (nulls last), then `id`. */
export function sortOrderBy(spec: SortSpec): Array<Record<string, unknown>> {
    const order = spec.columns.map((col) =>
        atPath(col.path, col.nullable ? { sort: col.direction, nulls: 'last' } : col.direction),
    );
    const last = spec.columns[spec.columns.length - 1];
    order.push({ id: last?.direction ?? 'asc' });
    return order;
}

function readPath(row: unknown, path: readonly string[]): unknown {
    let at: unknown = row;
    for (const key of path) at = at == null ? undefined : (at as Record<string, unknown>)[key];
    return at;
}

/** The cursor values of `row` under `spec`. */
export function sortValuesOf(spec: SortSpec, row: unknown): SortValue[] {
    return spec.columns.map((col) => {
        const raw = readPath(row, col.path);
        if (raw === null || raw === undefined) return null;
        if (raw instanceof Date) return raw.toISOString();
        if (col.kind === 'number') return Number(raw);
        return String(raw);
    });
}

/** Trim a `limit + 1` read under `spec` and compute the next cursor. */
export function computeSortPage<T extends { id: string }>(
    rows: T[],
    limit: number,
    spec: SortSpec,
): { items: T[]; pageInfo: { nextCursor?: string; hasNextPage: boolean } } {
    const hasNextPage = rows.length > limit;
    const items = hasNextPage ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    if (!hasNextPage || !last) return { items, pageInfo: { hasNextPage: false } };
    return { items, pageInfo: { hasNextPage: true, nextCursor: encodeSortCursor({ v: sortValuesOf(spec, last), id: last.id }) } };
}
