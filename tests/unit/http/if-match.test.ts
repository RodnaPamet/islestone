/**
 * `expectedVersionFrom`: the expected version from `If-Match` (ADR 0002 §9).
 */
import { expectedVersionFrom } from '@/lib/http/if-match';

const req = (value?: string) => new Request('http://localhost/x', { headers: value === undefined ? {} : { 'if-match': value } });

describe('expectedVersionFrom', () => {
    it.each([
        ['3', 3],
        ['"3"', 3],
        ['W/"12"', 12],
        [' "7" ', 7],
    ])('reads %s as %d', (value, expected) => {
        expect(expectedVersionFrom(req(value))).toBe(expected);
    });

    it('absent or blank is undefined (last writer wins for a single field)', () => {
        expect(expectedVersionFrom(req())).toBeUndefined();
        expect(expectedVersionFrom(req(''))).toBeUndefined();
    });

    it.each(['*', 'banana', '"0"', '-1', '"1", "2"'])('refuses %s with a 400', (value) => {
        expect(() => expectedVersionFrom(req(value))).toThrow(expect.objectContaining({ status: 400 }));
    });
});
