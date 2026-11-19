/**
 * `unwrapCappedList` — the client-side reader for the backfill-capped
 * `{ rows, truncated }` envelope (in Islestone, the Deleted work-item view).
 *
 * A list route that moves from a bare array to the envelope breaks every
 * consumer that typed the response as `T[]` and called `.map`: the SWR
 * generic is an unchecked assertion, so `tsc` passes and the browser throws
 * `TypeError: (d ?? []).map is not a function`, which the error boundary
 * turns into a blank page. These cases execute the helper that prevents it.
 *
 * Copied from inflect-compliance `tests/unit/list-backfill-cap.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: comments rewritten without the
 * compliance pages, and a case for `WORK_ITEM_DELETED_LIST_CAP`.
 */

import {
    applyBackfillCap,
    unwrapCappedList,
    LIST_BACKFILL_CAP,
    WORK_ITEM_DELETED_LIST_CAP,
    type CappedList,
    idsFromCappedList,
} from '@/lib/list-backfill-cap';

interface Row {
    id: string;
}

describe('unwrapCappedList', () => {
    it('reads rows out of the capped envelope', () => {
        const capped: CappedList<Row> = {
            rows: [{ id: 'a' }, { id: 'b' }],
            truncated: false,
        };
        expect(unwrapCappedList(capped)).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('passes a bare array through unchanged', () => {
        const rows: Row[] = [{ id: 'a' }];
        // Same reference — no needless copy for the legacy shape.
        expect(unwrapCappedList(rows)).toBe(rows);
    });

    it('returns [] for undefined (SWR before first response)', () => {
        // This is the pre-fetch render. It must not throw, and must not
        // produce `undefined` for a caller about to call `.map`.
        expect(unwrapCappedList(undefined)).toEqual([]);
    });

    it('returns [] for null', () => {
        expect(unwrapCappedList(null)).toEqual([]);
    });

    it('returns [] for a malformed body instead of throwing', () => {
        // An error envelope or a shape drift must degrade to an empty
        // picker, never take the page down.
        const bogus = { error: { message: 'nope' } } as unknown as CappedList<Row>;
        expect(unwrapCappedList(bogus)).toEqual([]);
    });

    it('returns [] when rows is present but not an array', () => {
        const bogus = { rows: 'not-an-array', truncated: false } as unknown as CappedList<Row>;
        expect(unwrapCappedList(bogus)).toEqual([]);
    });

    it('reproduces the regression: the capped envelope has no .map', () => {
        // The exact failure mode, pinned. `.map` on the envelope is a
        // TypeError; routed through the helper it is a usable array.
        const capped = applyBackfillCap<Row>([{ id: 'a' }]);
        expect(
            () => (capped as unknown as Row[]).map((r) => r.id),
        ).toThrow(TypeError);
        expect(unwrapCappedList(capped).map((r) => r.id)).toEqual(['a']);
    });

    it('round-trips whatever applyBackfillCap produces, truncated or not', () => {
        const under = applyBackfillCap<Row>([{ id: 'a' }]);
        expect(under.truncated).toBe(false);
        expect(unwrapCappedList(under)).toHaveLength(1);

        const over = applyBackfillCap<Row>(
            Array.from({ length: LIST_BACKFILL_CAP + 1 }, (_, i) => ({ id: String(i) })),
        );
        expect(over.truncated).toBe(true);
        // Unwrapping a truncated list yields the clamped rows, not the input.
        expect(unwrapCappedList(over)).toHaveLength(LIST_BACKFILL_CAP);
    });
});

// ─── idsFromCappedList ─────────────────────────────────────────────────
//
// The regression this exists to prevent: a page that hand-rolls
// `Array.isArray(data) ? … : []` silently produces `[]` when its route moves to
// the envelope, and the prev/next nav hides itself. Every shape below is one a
// list route may return, so this fails if any of them stops being handled.

describe('idsFromCappedList — every shape the list routes actually return', () => {
    it('reads the { rows, truncated } envelope (the Deleted work-item view)', () => {
        expect(
            idsFromCappedList({
                rows: [{ id: 'a' }, { id: 'b' }],
                truncated: false,
            }),
        ).toEqual(['a', 'b']);
    });

    it('reads the envelope spread beside extra keys', () => {
        const payload = {
            rows: [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }],
            truncated: true,
            kpiCounts: { total: 3, open: 2 },
        };
        expect(idsFromCappedList(payload)).toEqual(['r1', 'r2', 'r3']);
    });

    it('still reads a bare array (an uncapped route, or an older cached response)', () => {
        expect(idsFromCappedList([{ id: 'x' }, { id: 'y' }])).toEqual(['x', 'y']);
    });

    it('preserves list order — the nav walks the sequence the list showed', () => {
        expect(
            idsFromCappedList({ rows: [{ id: 'c' }, { id: 'a' }, { id: 'b' }], truncated: false }),
        ).toEqual(['c', 'a', 'b']);
    });

    it('drops rows with no usable id rather than emitting holes', () => {
        expect(
            idsFromCappedList({
                rows: [{ id: 'a' }, {}, { id: '' }, { id: 'b' }],
                truncated: false,
            }),
        ).toEqual(['a', 'b']);
    });

    it('degrades to [] on undefined / malformed bodies so the nav hides', () => {
        expect(idsFromCappedList(undefined)).toEqual([]);
        expect(idsFromCappedList(null)).toEqual([]);
        expect(idsFromCappedList({ rows: [], truncated: false })).toEqual([]);
    });
});

describe('WORK_ITEM_DELETED_LIST_CAP', () => {
    it('is the recovery view\'s small cap, far below the generic backfill cap', () => {
        expect(WORK_ITEM_DELETED_LIST_CAP).toBe(200);
        expect(WORK_ITEM_DELETED_LIST_CAP).toBeLessThan(LIST_BACKFILL_CAP);
    });
});
