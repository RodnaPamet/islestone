/**
 * Property fuzzing of the requester's name as it is stored (Hardening H2f;
 * docs/porting/maps/H2.md part 6, "Injection"; `src/lib/intake/requester-name.ts`),
 * the one cleaning both a public form's name and an emailed `From` display
 * name go through.
 *
 * For any input, of any length:
 *   - the stored name is null or 1 to 100 characters;
 *   - it holds no control character (CR and LF included) and no bidirectional
 *     embedding, override or isolate;
 *   - read as HTML it holds no element;
 *   - cleaning takes bounded time, a multi-megabyte name included.
 */
import fc from 'fast-check';
import sanitizeHtml from 'sanitize-html';

import { INTAKE_LIMITS } from '@/lib/intake/form-definition';
import { cleanRequesterName } from '@/lib/intake/requester-name';

import { assertFuzz, bestTimeMs, fuzzTimeout } from '../../../helpers/fuzz';

const HOSTILE = ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<scr<script>ipt>', '&lt;svg onload=alert(1)&gt;', 'javascript:alert(1)', "'; DROP TABLE x; --", '\r\n', '\u0000', '‮', '⁦', '​', '\u0085', '<i>', '"><', 'Ada'];

function elementsIn(text: string): number {
    let n = 0;
    sanitizeHtml(text, {
        allowedTags: false,
        allowedAttributes: false,
        allowVulnerableTags: true,
        transformTags: {
            '*': (tagName, attribs) => {
                n++;
                return { tagName, attribs };
            },
        },
    });
    return n;
}

describe('the stored requester name (fuzzed)', () => {
    it(
        'is null or at most 100 characters, with no control or bidirectional character and no element',
        () => {
            const nameArb = fc.oneof(fc.string({ maxLength: 300 }), fc.string({ unit: 'binary', maxLength: 300 }), fc.array(fc.constantFrom(...HOSTILE), { maxLength: 30 }).map((p) => p.join('')));
            assertFuzz(
                fc.property(nameArb, (raw) => {
                    const name = cleanRequesterName(raw);
                    if (name === null) return;
                    expect(name.length).toBeGreaterThanOrEqual(1);
                    expect(name.length).toBeLessThanOrEqual(INTAKE_LIMITS.requesterName);
                    expect(name).not.toMatch(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
                    expect(name).toBe(name.trim());
                    expect(elementsIn(name)).toBe(0);
                }),
            );
        },
        fuzzTimeout(2),
    );

    it(
        'cleans any name in bounded time, however long',
        () => {
            const unitArb = fc.constantFrom('<i>', '<b>x', '<', 'a', '&lt;', '‮');
            assertFuzz(
                fc.property(unitArb, fc.integer({ min: 1_000, max: 10 * 1024 * 1024 }), (unit, n) => {
                    const raw = unit.repeat(Math.ceil(n / unit.length));
                    expect(bestTimeMs(() => cleanRequesterName(raw), 50)).toBeLessThanOrEqual(50);
                }),
                { scale: 0.1 },
            );
        },
        fuzzTimeout(100, 0.1),
    );
});

describe('the stored requester name: examples the fuzzing found (H2f)', () => {
    it('drops a right-to-left override and NUL that the name kept before', () => {
        expect(cleanRequesterName('Mallory ‮evil‬\u0000')).toBe('Mallory evil');
        expect(cleanRequesterName('Ada\r\nBcc: victim@example.com')).toBe('Ada Bcc: victim@example.com');
        expect(cleanRequesterName('   ')).toBeNull();
        expect(cleanRequesterName('<script>alert(1)</script>')).toBeNull();
    });

    it('cleans a 10 MB name of nested tags in milliseconds, where the whole name was sanitised before', () => {
        expect(bestTimeMs(() => cleanRequesterName('<i>'.repeat(3_500_000)), 50)).toBeLessThanOrEqual(50);
    });
});
