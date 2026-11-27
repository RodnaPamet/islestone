/**
 * The billable-rate cascade and amounts (sub-phase 3.4d; owner decisions 272
 * and 273; `domain/billable-rate.ts`, `lib/time/money.ts`), property-tested:
 *
 *   - `resolveRate` equals a day-by-day reference over random histories:
 *     project, then member, then workspace; a NULL row falls through; the
 *     latest row on or before the day;
 *   - amounts round half up per entry, are never negative, are exact for
 *     whole hours, and a total is the sum of its lines (`timeAmounts`);
 *   - an approved entry takes its stamp or none, whatever the history says;
 *   - money parses and formats in the currency's own minor digits.
 */
import fc from 'fast-check';

import { entryAmount, entryRate, rateBook, resolveRate, timeAmounts, type RateLevel, type RateRow } from '@/app-layer/domain/billable-rate';
import { amountMinor, formatMoney, isCurrencyCode, minorDigits, minorToDecimal, parseMoney } from '@/lib/time/money';

const DAYS = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
const PROJECTS = ['p1', 'p2'];
const USERS = ['u1', 'u2'];

const rowArb: fc.Arbitrary<RateRow> = fc
    .record({
        level: fc.constantFrom<RateLevel>('WORKSPACE', 'PROJECT', 'MEMBER'),
        project: fc.constantFrom(...PROJECTS),
        user: fc.constantFrom(...USERS),
        rate: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
        day: fc.constantFrom(...DAYS),
    })
    .map((r) => ({
        level: r.level,
        projectId: r.level === 'PROJECT' ? r.project : null,
        userId: r.level === 'MEMBER' ? r.user : null,
        hourlyRateMinor: r.rate,
        effectiveFrom: r.day,
    }));

/** One row per level, scope and date, as the unique index holds (the last written wins). */
function unique(rows: RateRow[]): RateRow[] {
    const byKey = new Map<string, RateRow>();
    for (const r of rows) byKey.set(`${r.level}|${r.projectId}|${r.userId}|${r.effectiveFrom}`, r);
    return [...byKey.values()];
}

/** The reference: walk the days from the first one, carrying each level's current value. */
function reference(rows: RateRow[], projectId: string, userId: string, day: string): { hourlyRateMinor: number; level: RateLevel } | null {
    const current: Record<RateLevel, number | null | undefined> = { PROJECT: undefined, MEMBER: undefined, WORKSPACE: undefined };
    for (const d of DAYS) {
        if (d > day) break;
        for (const r of rows) {
            if (r.effectiveFrom !== d) continue;
            if (r.level === 'WORKSPACE' || (r.level === 'PROJECT' && r.projectId === projectId) || (r.level === 'MEMBER' && r.userId === userId)) current[r.level] = r.hourlyRateMinor;
        }
    }
    for (const level of ['PROJECT', 'MEMBER', 'WORKSPACE'] as const) {
        const v = current[level];
        if (v !== undefined && v !== null) return { hourlyRateMinor: v, level };
    }
    return null;
}

describe('resolveRate (decision 272)', () => {
    it('equals the day-by-day reference over random histories', () => {
        fc.assert(
            fc.property(fc.array(rowArb, { maxLength: 25 }), fc.constantFrom(...PROJECTS), fc.constantFrom(...USERS), fc.constantFrom(...DAYS), (raw, projectId, userId, day) => {
                const rows = unique(raw);
                expect(resolveRate(rateBook(rows), { projectId, userId, workDate: day })).toEqual(reference(rows, projectId, userId, day));
            }),
            { numRuns: 500 },
        );
    });

    it('reads project, then member, then workspace, and falls through a NULL row', () => {
        const rows: RateRow[] = [
            { level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: 100, effectiveFrom: '2026-01-01' },
            { level: 'MEMBER', projectId: null, userId: 'u1', hourlyRateMinor: 90, effectiveFrom: '2026-01-01' },
            { level: 'PROJECT', projectId: 'p1', userId: null, hourlyRateMinor: 150, effectiveFrom: '2026-01-05' },
            { level: 'PROJECT', projectId: 'p1', userId: null, hourlyRateMinor: null, effectiveFrom: '2026-01-10' },
        ];
        const book = rateBook(rows);
        expect(resolveRate(book, { projectId: 'p1', userId: 'u1', workDate: '2026-01-04' })).toEqual({ hourlyRateMinor: 90, level: 'MEMBER' });
        expect(resolveRate(book, { projectId: 'p1', userId: 'u1', workDate: '2026-01-05' })).toEqual({ hourlyRateMinor: 150, level: 'PROJECT' });
        expect(resolveRate(book, { projectId: 'p1', userId: 'u1', workDate: '2026-01-10' })).toEqual({ hourlyRateMinor: 90, level: 'MEMBER' });
        expect(resolveRate(book, { projectId: 'p1', userId: 'u2', workDate: '2026-01-10' })).toEqual({ hourlyRateMinor: 100, level: 'WORKSPACE' });
        expect(resolveRate(book, { projectId: 'p1', userId: 'u2', workDate: '2025-12-31' })).toBeNull();
    });
});

describe('amounts (decision 273)', () => {
    it('round half up per entry, never negative, exact for whole hours', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 1_440 }), fc.integer({ min: 0, max: 2_000_000_000 }), (minutes, rate) => {
                const a = amountMinor(minutes, rate);
                expect(a).toBeGreaterThanOrEqual(0);
                expect(Number.isSafeInteger(a)).toBe(true);
                // Half up: within half a minor unit of the exact amount, a half rounding up.
                const exact = (minutes * rate) / 60;
                expect(a - exact).toBeLessThanOrEqual(0.5);
                expect(exact - a).toBeLessThan(0.5);
                if (minutes % 60 === 0) expect(a).toBe((minutes / 60) * rate);
            }),
        );
        expect(amountMinor(1, 30)).toBe(1); // 0.5 rounds up
        expect(amountMinor(1, 29)).toBe(0);
    });

    it('make a total the sum of its lines, each rounded once, and count no-rate minutes apart', () => {
        fc.assert(
            fc.property(
                fc.array(rowArb, { maxLength: 10 }),
                fc.array(fc.record({ key: fc.constantFrom('a', 'b'), projectId: fc.constantFrom(...PROJECTS), userId: fc.constantFrom(...USERS), workDate: fc.constantFrom(...DAYS), minutes: fc.integer({ min: 1, max: 600 }), count: fc.integer({ min: 1, max: 3 }) }), { maxLength: 20 }),
                (raw, lines) => {
                    const book = rateBook(unique(raw));
                    const input = lines.map((l) => ({ ...l, billable: true, approved: false, frozenRateMinor: null, frozenRateLevel: null }));
                    const out = timeAmounts(book, input);
                    for (const key of ['a', 'b']) {
                        const mine = input.filter((l) => l.key === key);
                        const amount = mine.reduce((s, l) => s + (entryAmount(book, l) ?? 0) * l.count, 0);
                        const noRate = mine.filter((l) => entryRate(book, l) === null).reduce((s, l) => s + l.minutes * l.count, 0);
                        if (mine.length === 0) expect(out.get(key)).toBeUndefined();
                        else expect(out.get(key)).toEqual({ amountMinor: amount, noRateMinutes: noRate });
                    }
                },
            ),
        );
    });

    it('take an approved entry\'s stamp or none, whatever the history; a non-billable entry has none', () => {
        const book = rateBook([{ level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: 999, effectiveFrom: '2026-01-01' }]);
        const base = { projectId: 'p1', userId: 'u1', workDate: '2026-01-05', minutes: 60 };
        expect(entryAmount(book, { ...base, billable: true, approved: true, frozenRateMinor: 100, frozenRateLevel: 'PROJECT' })).toBe(100);
        expect(entryAmount(book, { ...base, billable: true, approved: true, frozenRateMinor: null, frozenRateLevel: null })).toBeNull();
        expect(entryAmount(book, { ...base, billable: true, approved: false, frozenRateMinor: null, frozenRateLevel: null })).toBe(999);
        expect(entryAmount(book, { ...base, billable: false, approved: false, frozenRateMinor: null, frozenRateLevel: null })).toBeNull();
    });
});

describe('money (decision 273)', () => {
    it("knows a currency's minor digits from Intl, and refuses a code that is none", () => {
        expect(minorDigits('EUR')).toBe(2);
        expect(minorDigits('JPY')).toBe(0);
        expect(minorDigits('KWD')).toBe(3);
        expect(isCurrencyCode('EUR')).toBe(true);
        expect(isCurrencyCode('eur')).toBe(false);
        expect(isCurrencyCode('ZZZ')).toBe(false);
    });

    it('formats and parses in the currency\'s digits, round-tripping', () => {
        expect(formatMoney(123_450, 'EUR')).toBe('€1,234.50');
        expect(formatMoney(1_235, 'JPY')).toBe('¥1,235');
        expect(parseMoney('120.5', 'EUR')).toBe(12_050);
        expect(parseMoney('1,200.50', 'EUR')).toBe(120_050);
        expect(parseMoney('12.345', 'EUR')).toBeNull();
        expect(parseMoney('12.5', 'JPY')).toBeNull();
        expect(parseMoney('-1', 'EUR')).toBeNull();
        expect(parseMoney('30000000', 'EUR')).toBeNull();
        fc.assert(
            fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), fc.constantFrom('EUR', 'JPY', 'KWD', 'BGN'), (minor, currency) => {
                expect(parseMoney(minorToDecimal(minor, currency), currency)).toBe(minor);
            }),
        );
    });
});
