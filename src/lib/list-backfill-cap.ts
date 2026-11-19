/**
 * List-page backfill cap.
 *
 * A flat (uncursored) list read must never return a whole workspace. This
 * module is the canonical entry point for that cap: the route asks the
 * repository for `cap + 1` rows; if the result exceeds the cap, the helper
 * slices to the cap and sets `truncated: true`, so the client can say "refine
 * the filters to see the rest" instead of silently lying about completeness.
 *
 * In Islestone the live work-item list is cursor-only (H2 seeds 100,000 items
 * per workspace), so `LIST_BACKFILL_CAP` is not used for it. The one flat read
 * is the Deleted work-item view, capped at `WORK_ITEM_DELETED_LIST_CAP`.
 *
 * Copied from inflect-compliance `src/lib/list-backfill-cap.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the constant renamed for work
 * items and the comments rewritten.
 */

export const LIST_BACKFILL_CAP = 5000;

/**
 * Cap on the Deleted work-item view's flat (uncursored) read. The view is a
 * recovery tool, not a browsable archive, so the most recently deleted rows
 * are what matter. Here rather than in the repository so the page's
 * truncation banner can name it.
 */
export const WORK_ITEM_DELETED_LIST_CAP = 200;

export interface CappedList<T> {
    rows: T[];
    truncated: boolean;
}

/**
 * Clamp a list of rows to the backfill cap and report whether the
 * cap fired. Callers in API route handlers should pass `take: cap+1`
 * to the underlying `findMany` and then this helper to the result —
 * the cap+1 sentinel is what makes "exactly cap rows" distinguishable
 * from "more than cap rows".
 */
export function applyBackfillCap<T>(rows: T[]): CappedList<T> {
    return rows.length > LIST_BACKFILL_CAP
        ? { rows: rows.slice(0, LIST_BACKFILL_CAP), truncated: true }
        : { rows, truncated: false };
}

/**
 * Read the rows out of a capped-list response on the CLIENT side.
 *
 * The `useTenantSWR<T>` / `apiGet<T>` generic is an unchecked
 * assertion — nothing validates the response against it at runtime.
 * So when a route moved from a bare array to `{ rows, truncated }`,
 * consumers still typed as `T[]` compiled cleanly and then threw
 * `.map is not a function` in the browser, which the error boundary
 * escalates into a blank page.
 *
 * Every client read of a capped endpoint should funnel through here
 * rather than hand-rolling the `Array.isArray` dance:
 *
 *     const { data } = useTenantSWR<CappedList<WorkItemRow> | WorkItemRow[]>('/work-items?deleted=1');
 *     const items = unwrapCappedList(data);
 *
 * Tolerates BOTH shapes on purpose — a bare array is still returned by
 * some endpoints (and by older cached responses), and a modal that
 * hard-codes one shape is precisely the fragility this replaces.
 * Anything else (undefined, an error envelope, a malformed body)
 * yields `[]` so a bad response degrades to an empty picker instead
 * of taking the page down.
 */
export function unwrapCappedList<T>(
    data: CappedList<T> | T[] | null | undefined,
): T[] {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as CappedList<T>).rows)) {
        return (data as CappedList<T>).rows;
    }
    return [];
}

/**
 * Ordered entity ids out of a list response, for the detail-page prev/next
 * nav (`<EntityPrevNextNav>`).
 *
 * Exists as a named helper rather than an inline memo on each page, so one
 * guard reads every response shape and a page cannot hand-roll a narrower
 * one that silently yields `[]` when a route's envelope changes.
 *
 * Tolerates every shape the list routes actually return: a bare array
 * (an uncapped route, or an older cached response), the plain envelope
 * (the Deleted work-item view), and the envelope spread alongside extra
 * keys. Anything else yields `[]`, which
 * makes the nav hide rather than render arrows that point nowhere.
 */
export function idsFromCappedList(
    data: CappedList<{ id?: string }> | Array<{ id?: string }> | null | undefined,
): string[] {
    return unwrapCappedList(data)
        .map((row) => row?.id)
        .filter((id): id is string => Boolean(id));
}
