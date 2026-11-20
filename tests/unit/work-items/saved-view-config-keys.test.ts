/**
 * A saved view stores what the list and the board can show: every filter key
 * the list reads from the URL and every built-in swimlane grouping must pass
 * `SavedViewConfigSchema`, or saving a view that uses one is a 400. Cycle
 * (2.5a) and milestone (2.5b) filters and lanes were the cases that slipped.
 */
import { LANE_BY_VALUES, laneMovableInScope } from '@/components/work-items/board/board-model';
import { WORK_ITEM_FILTER_KEYS } from '@/components/work-items/filter-defs';
import { SavedViewConfigSchema } from '@/lib/schemas/saved-view';

describe('saved-view configuration keys', () => {
    it.each(WORK_ITEM_FILTER_KEYS)('accepts the %s filter', (key) => {
        expect(SavedViewConfigSchema.safeParse({ filters: { [key]: ['x'] } }).success).toBe(true);
    });

    it.each(LANE_BY_VALUES)('accepts the %s swimlanes', (laneBy) => {
        expect(SavedViewConfigSchema.safeParse({ laneBy }).success).toBe(true);
    });

    it('refuses an unknown filter and grouping', () => {
        expect(SavedViewConfigSchema.safeParse({ filters: { nope: ['x'] } }).success).toBe(false);
        expect(SavedViewConfigSchema.safeParse({ laneBy: 'nope' }).success).toBe(false);
    });
});

describe('milestone lanes take drops on a one-project board only (2.5b)', () => {
    it('is movable with a project in scope and not across projects', () => {
        expect(laneMovableInScope('milestone', 'p1')).toBe(true);
        expect(laneMovableInScope('milestone', undefined)).toBe(false);
        expect(laneMovableInScope('cycle', undefined)).toBe(true);
        expect(laneMovableInScope('label', 'p1')).toBe(false);
    });
});
