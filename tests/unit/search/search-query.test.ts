/**
 * How a search query becomes SQL parameters (sub-phase 2.7b), the per-type
 * limit clamp, and the route's query schema.
 */
import { clampPerTypeLimit } from '@/app-layer/usecases/search';
import { SearchQuerySchema } from '@/lib/schemas/search';
import { containsPattern, escapeLike, normaliseSearchQuery, prefixPattern } from '@/lib/search/query';
import { DEFAULT_PER_TYPE_LIMIT, MAX_PER_TYPE_LIMIT, MAX_QUERY_LENGTH } from '@/lib/search/types';

describe('LIKE patterns', () => {
    it('escapes the wildcards and the escape character, so they match themselves', () => {
        expect(escapeLike('50%_off\\now')).toBe('50\\%\\_off\\\\now');
        expect(containsPattern('a%b')).toBe('%a\\%b%');
        expect(prefixPattern('a_b')).toBe('a\\_b%');
    });

    it('leaves ordinary text, Cyrillic included, alone', () => {
        expect(containsPattern('вход login')).toBe('%вход login%');
    });
});

describe('normaliseSearchQuery', () => {
    it('trims and caps at MAX_QUERY_LENGTH', () => {
        expect(normaliseSearchQuery('  login  ')).toBe('login');
        expect(normaliseSearchQuery(null)).toBe('');
        expect(normaliseSearchQuery('x'.repeat(MAX_QUERY_LENGTH + 50))).toHaveLength(MAX_QUERY_LENGTH);
    });
});

describe('clampPerTypeLimit — the bounded page size', () => {
    it('defaults, floors and caps', () => {
        expect(clampPerTypeLimit(undefined)).toBe(DEFAULT_PER_TYPE_LIMIT);
        expect(clampPerTypeLimit(0)).toBe(DEFAULT_PER_TYPE_LIMIT);
        expect(clampPerTypeLimit(Number.NaN)).toBe(DEFAULT_PER_TYPE_LIMIT);
        expect(clampPerTypeLimit(7.9)).toBe(7);
        expect(clampPerTypeLimit(10_000)).toBe(MAX_PER_TYPE_LIMIT);
    });
});

describe('SearchQuerySchema', () => {
    it('takes q and a limit within the bound', () => {
        expect(SearchQuerySchema.parse({ q: 'login', limit: '10' })).toEqual({ q: 'login', limit: 10 });
        expect(SearchQuerySchema.parse({})).toEqual({});
    });

    it('refuses a limit past MAX_PER_TYPE_LIMIT, below 1 or not an integer, and an absurd q', () => {
        expect(() => SearchQuerySchema.parse({ limit: String(MAX_PER_TYPE_LIMIT + 1) })).toThrow();
        expect(() => SearchQuerySchema.parse({ limit: '0' })).toThrow();
        expect(() => SearchQuerySchema.parse({ limit: '2.5' })).toThrow();
        expect(() => SearchQuerySchema.parse({ q: 'x'.repeat(1001) })).toThrow();
    });
});
