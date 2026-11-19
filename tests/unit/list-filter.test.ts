/**
 * `parseEnumListFilter` / `parseIdListFilter` — the canonical list-filter
 * parser every list repository funnels its query-string filters through.
 *
 * Two reachable shapes would otherwise reach Prisma unchecked and throw
 * `PrismaClientValidationError` (a 500):
 *
 *   - a comma-joined multi-select (`?priority=HIGH,URGENT`), and
 *   - a value belonging to a DIFFERENT enum (`?priority=STARTED` is a state
 *     category, never a priority), which is how a URL carried from one list
 *     page to another breaks it.
 *
 * Both are handled at the boundary: valid members collapse to a scalar or
 * `{ in: [...] }`, unknown members are a 400.
 *
 * Copied from inflect-compliance `tests/unit/list-filter.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, over Islestone's enums (literal
 * sets, so the test needs no generated client).
 */

import {
    parseEnumListFilter,
    parseIdListFilter,
} from '@/app-layer/domain/list-filter';

const PRIORITIES = ['NONE', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'];
const CATEGORIES = ['BACKLOG', 'UNSTARTED', 'STARTED', 'DONE', 'CANCELLED'];
const RELATION_TYPES = ['BLOCKS', 'RELATES', 'DUPLICATES'];

describe('parseEnumListFilter', () => {
    describe('absent input', () => {
        it.each([
            ['undefined', undefined],
            ['null', null],
            ['empty string', ''],
            ['only separators', ',,,'],
            ['only whitespace', '  ,  '],
        ])('returns undefined for %s', (_label, raw) => {
            expect(
                parseEnumListFilter(raw, PRIORITIES, 'priority'),
            ).toBeUndefined();
        });
    });

    describe('valid input', () => {
        it('collapses a single member to a bare scalar', () => {
            expect(
                parseEnumListFilter('HIGH', PRIORITIES, 'priority'),
            ).toBe('HIGH');
        });

        it('expands a comma-joined multi-select to an `in` filter', () => {
            expect(
                parseEnumListFilter(
                    'HIGH,URGENT',
                    PRIORITIES,
                    'priority',
                ),
            ).toEqual({ in: ['HIGH', 'URGENT'] });
        });

        it('trims whitespace around members', () => {
            expect(
                parseEnumListFilter(
                    ' HIGH , URGENT ',
                    PRIORITIES,
                    'priority',
                ),
            ).toEqual({ in: ['HIGH', 'URGENT'] });
        });

        it('dedupes repeated members, collapsing back to a scalar', () => {
            expect(
                parseEnumListFilter('HIGH,HIGH', PRIORITIES, 'priority'),
            ).toBe('HIGH');
        });

        it('accepts a Set of valid members as well as an array', () => {
            expect(
                parseEnumListFilter(
                    'LOW',
                    new Set(PRIORITIES),
                    'priority',
                ),
            ).toBe('LOW');
        });
    });

    describe('invalid input → 400, never a Prisma 500', () => {
        it('rejects a value from another entity\'s enum (the reported bug)', () => {
            // `STARTED` is a state category; carried onto a priority filter it
            // must be refused, not passed to Prisma.
            expect(PRIORITIES).not.toContain('STARTED');
            expect(() =>
                parseEnumListFilter('STARTED', PRIORITIES, 'priority'),
            ).toThrow(/Invalid priority "STARTED"/);
        });

        it('surfaces as a 400-shaped error, not a generic throw', () => {
            let caught: unknown;
            try {
                parseEnumListFilter('STARTED', PRIORITIES, 'priority');
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeDefined();
            expect((caught as { status?: number }).status).toBe(400);
        });

        it('rejects a mixed list where only one member is unknown', () => {
            expect(() =>
                parseEnumListFilter(
                    'HIGH,NOT_A_STATUS',
                    PRIORITIES,
                    'priority',
                ),
            ).toThrow(/Invalid priority "NOT_A_STATUS"/);
        });

        it('names the allowed members so the caller can self-correct', () => {
            expect(() =>
                parseEnumListFilter('STARTED', PRIORITIES, 'priority'),
            ).toThrow(new RegExp(PRIORITIES.join(', ')));
        });

        it('is case-sensitive — enum members are exact', () => {
            expect(() =>
                parseEnumListFilter('high', PRIORITIES, 'priority'),
            ).toThrow(/Invalid priority "high"/);
        });
    });

    describe('the same contract holds for the sibling list enums', () => {
        it('accepts STARTED for state categories (where it IS a real member)', () => {
            expect(
                parseEnumListFilter(
                    'STARTED',
                    CATEGORIES,
                    'state category',
                ),
            ).toBe('STARTED');
        });

        it('expands a relation-type multi-select rather than passing the literal', () => {
            expect(
                parseEnumListFilter(
                    'BLOCKS,RELATES',
                    RELATION_TYPES,
                    'relation type',
                ),
            ).toEqual({ in: ['BLOCKS', 'RELATES'] });
        });
    });
});

describe('parseIdListFilter', () => {
    it('returns undefined for absent input', () => {
        expect(parseIdListFilter(undefined)).toBeUndefined();
        expect(parseIdListFilter('')).toBeUndefined();
        expect(parseIdListFilter(' , ')).toBeUndefined();
    });

    it('collapses a single id to a bare scalar', () => {
        expect(parseIdListFilter('user-1')).toBe('user-1');
    });

    it('expands a comma-joined id list', () => {
        expect(parseIdListFilter('user-1,user-2')).toEqual({
            in: ['user-1', 'user-2'],
        });
    });

    it('never rejects — there is no enum to validate against', () => {
        expect(parseIdListFilter('anything-at-all')).toBe('anything-at-all');
    });
});
