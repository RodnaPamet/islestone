/**
 * Estimates (sub-phase 3.4a, `src/lib/work-items/estimate.ts`): the one
 * parser every form and the API's input use, the wording, and which column a
 * unit counts. Property tests hold the parser to a round trip and to its
 * bounds; examples pin the spellings a person types.
 */
import fc from 'fast-check';

import {
    ESTIMATE_LIMITS,
    countedEstimate,
    estimateColumnOf,
    estimateInputText,
    formatDuration,
    isValidEstimate,
    parseDuration,
    parseEstimate,
    parsePoints,
} from '@/lib/work-items/estimate';

describe('parseDuration', () => {
    it.each([
        ['2h 30m', 150],
        ['2h30m', 150],
        ['2.5h', 150],
        ['2,5h', 150],
        ['2h', 120],
        ['45m', 45],
        ['150m', 150],
        ['1.5', 90],
        ['3', 180],
        ['0', 0],
        ['0m', 0],
        [' 1 hour 5 minutes ', 65],
        ['2 hrs', 120],
        ['10 mins', 10],
        ['2.1h', 126],
        ['1000h', 60_000],
    ])('reads %j as %i minutes', (text, minutes) => {
        expect(parseDuration(text)).toBe(minutes);
    });

    it.each(['', '  ', 'abc', '2x', 'h', 'm', '-1h', '1.01h', '0.5m', '1000h 1m', '1001h', '2h 3', '1e3'])('refuses %j', (text) => {
        expect(parseDuration(text)).toBeNull();
    });

    it('round-trips every stored value through its wording', () => {
        fc.assert(
            fc.property(fc.integer({ min: 0, max: ESTIMATE_LIMITS.minutesMax }), (minutes) => {
                expect(parseDuration(formatDuration(minutes))).toBe(minutes);
            }),
        );
    });

    it('never answers a value the CHECK would refuse', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 12 }), (text) => {
                const out = parseDuration(text);
                if (out !== null) expect(isValidEstimate('HOURS', out)).toBe(true);
            }),
        );
    });
});

describe('parsePoints and the rest', () => {
    it('takes whole points from 0 to 100 only', () => {
        expect(parsePoints('5')).toBe(5);
        expect(parsePoints(' 100 ')).toBe(100);
        expect(parsePoints('0')).toBe(0);
        for (const bad of ['101', '1.5', '-1', '', 'five', '2h']) expect(parsePoints(bad)).toBeNull();
        fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (n) => expect(parsePoints(estimateInputText('POINTS', n))).toBe(n)));
    });

    it('parses in the unit it is given', () => {
        expect(parseEstimate('POINTS', '8')).toBe(8);
        expect(parseEstimate('HOURS', '8')).toBe(480);
        expect(estimateInputText('HOURS', 150)).toBe('2h 30m');
        expect(estimateInputText('POINTS', null)).toBe('');
    });

    it("counts only the current unit's column; a team that does not estimate counts nothing", () => {
        const both = { estimatePoints: 5, estimateMinutes: 90 };
        expect(estimateColumnOf('POINTS')).toBe('estimatePoints');
        expect(estimateColumnOf('HOURS')).toBe('estimateMinutes');
        expect(countedEstimate('POINTS', both)).toBe(5);
        expect(countedEstimate('HOURS', both)).toBe(90);
        expect(countedEstimate(null, both)).toBeNull();
        expect(countedEstimate('HOURS', { estimatePoints: 5 })).toBeNull();
    });

    it('formats durations as a person reads them', () => {
        expect(formatDuration(0)).toBe('0m');
        expect(formatDuration(45)).toBe('45m');
        expect(formatDuration(180)).toBe('3h');
        expect(formatDuration(150)).toBe('2h 30m');
    });
});
