/**
 * Property fuzzing of the sender check (Hardening H2f; docs/porting/maps/H2.md
 * part 6; `src/lib/intake/email/auth-results.ts`; owner decision 123).
 *
 * For any set of `Authentication-Results` headers, in any order, letter case,
 * spacing and comments, with duplicates:
 *   - the verdict is decided by the topmost header whose authserv-id is the
 *     trusted one, and equals the decision's rule read off it: VERIFIED only
 *     for a DMARC pass (its `header.from` the From domain, when it names one)
 *     or, with no DMARC result, a DKIM pass aligned with the From domain;
 *     FAILED for a DMARC fail; NONE otherwise;
 *   - a header from any other server never verifies, wherever it sits and
 *     whatever it claims, a look-alike of the trusted id included;
 *   - with no trusted id configured, or no From domain, the verdict is NONE;
 *   - reading takes time linear in the headers' length.
 */
import fc from 'fast-check';

import { senderCheckFrom, type SenderCheck } from '@/lib/intake/email/auth-results';

import { assertFuzz, bestTimeMs, fuzzTimeout } from '../../../helpers/fuzz';

const TRUSTED = 'mx.kinbound.test';
const FROM = 'kexample.com';

interface Method {
    method: string;
    result: string;
    props: Array<[string, string]>;
}

const domainArb = fc.constantFrom(FROM, FROM.toUpperCase(), `mail.${FROM}`, 'example.com', 'other.org', 'com', `${FROM}.evil.test`, `Kexample.com`, `x${FROM}`);
const resultArb = fc.constantFrom('pass', 'fail', 'none', 'neutral', 'softfail', 'temperror', 'permerror', 'policy');
const methodArb: fc.Arbitrary<Method> = fc.oneof(
    fc.record({
        method: fc.constant('dmarc'),
        result: resultArb,
        props: fc.option(domainArb, { nil: undefined }).map((d): Array<[string, string]> => (d ? [['header.from', d]] : [])),
    }),
    fc.record({
        method: fc.constant('dkim'),
        result: resultArb,
        props: fc
            .tuple(fc.option(domainArb, { nil: undefined }), fc.option(domainArb, { nil: undefined }))
            .map(([d, i]): Array<[string, string]> => [...(d ? ([['header.d', d]] as Array<[string, string]>) : []), ...(i ? ([['header.i', `@${i}`]] as Array<[string, string]>) : [])]),
    }),
    fc.record({
        method: fc.constantFrom('spf', 'arc', 'iprev', 'auth'),
        result: resultArb,
        props: domainArb.map((d): Array<[string, string]> => [['smtp.mailfrom', `x@${d}`]]),
    }),
);

const commentArb = fc.string({ maxLength: 12 }).map((s) => `(${s.replace(/[;()\\]/g, '')})`);
const caseArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 16 });
const recase = (s: string, flips: boolean[]) => [...s].map((c, i) => (flips[i % flips.length] ? c.toUpperCase() : c)).join('');

/** One header's text: the id, then each method, with any case, spacing, quoting and comments. */
const headerText = (id: string, methods: Method[], flips: boolean[], comments: string[], spaces: string[]) => {
    const space = (i: number) => spaces[i % Math.max(1, spaces.length)] ?? ' ';
    const comment = (i: number) => (comments.length > 0 && i % 2 === 0 ? ` ${comments[i % comments.length]} ` : '');
    const parts = methods.map((m, i) => {
        const props = m.props.map(([k, v], j) => `${recase(k, flips)}${space(j)}=${space(j + 1)}${j % 2 === 1 ? `"${v}"` : v}`).join(' ');
        return `${space(i)}${recase(m.method, flips)}=${recase(m.result, flips)}${comment(i)}${props ? ` ${props}` : ''}${comment(i + 1)}`;
    });
    return [`${recase(id, flips)}${comment(0)}`, ...parts].join(';');
};

const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** The rule of decision 123, read off a structured header (never parsed). */
function referenceVerdict(methods: Method[], fromDomain: string): SenderCheck {
    const prop = (m: Method, k: string) => {
        const found = m.props.filter(([key]) => key === k);
        return found.length > 0 ? asciiLower(found[found.length - 1]![1]) : undefined;
    };
    const dmarc = methods.find((m) => m.method === 'dmarc');
    if (dmarc) {
        if (dmarc.result === 'fail') return 'FAILED';
        if (dmarc.result !== 'pass') return 'NONE';
        const hf = prop(dmarc, 'header.from');
        return !hf || hf === fromDomain ? 'VERIFIED' : 'NONE';
    }
    const aligned = methods.some((m) => {
        if (m.method !== 'dkim' || m.result !== 'pass') return false;
        const raw = prop(m, 'header.d') ?? prop(m, 'header.i');
        if (!raw) return false;
        const signer = raw.slice(raw.lastIndexOf('@') + 1);
        return signer === fromDomain || fromDomain.endsWith(`.${signer}`);
    });
    return aligned ? 'VERIFIED' : 'NONE';
}

/** Ids of other servers: random ones, near misses, and look-alikes that lower-case onto the trusted id. */
const otherIdArb = fc.oneof(
    fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[\s;()]/g, 'x')),
    fc.constantFrom(`${TRUSTED}.evil`, `x${TRUSTED}`, TRUSTED.replace('k', 'K'), TRUSTED.replace('i', 'İ'), 'mx.kinbound.tes', ''),
).filter((id) => asciiLower(id) !== TRUSTED);

const headerArb = (id: fc.Arbitrary<string>) =>
    fc.record({
        id,
        methods: fc.array(methodArb, { maxLength: 5 }),
        flips: caseArb,
        comments: fc.array(commentArb, { maxLength: 3 }),
        spaces: fc.array(fc.constantFrom(' ', '  ', '\t', ''), { maxLength: 3 }),
    });

type H = { id: string; methods: Method[]; flips: boolean[]; comments: string[]; spaces: string[] };
const text = (h: H) => headerText(h.id, h.methods, h.flips, h.comments, h.spaces);

describe('the sender check (fuzzed)', () => {
    it(
        'decides by the topmost trusted header, by the rule read off it, whatever else is around it',
        () => {
            assertFuzz(
                fc.property(
                    fc.array(headerArb(otherIdArb), { maxLength: 3 }),
                    headerArb(fc.constant(TRUSTED)),
                    fc.array(headerArb(fc.constant(TRUSTED)), { maxLength: 2 }),
                    fc.array(headerArb(otherIdArb), { maxLength: 3 }),
                    (above, trusted, forgedBelow, below) => {
                        const headers = [...above, trusted, ...forgedBelow, ...below].map(text);
                        expect(senderCheckFrom(headers, TRUSTED, FROM)).toBe(referenceVerdict(trusted.methods, FROM));
                        // The configured id is matched in any case.
                        expect(senderCheckFrom(headers, TRUSTED.toUpperCase(), FROM)).toBe(referenceVerdict(trusted.methods, FROM));
                    },
                ),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'never verifies a header from any other server, look-alikes of the trusted id included',
        () => {
            assertFuzz(
                fc.property(fc.array(headerArb(otherIdArb), { minLength: 1, maxLength: 5 }), (headers) => {
                    expect(senderCheckFrom(headers.map(text), TRUSTED, FROM)).toBe('NONE');
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'is NONE with no trusted id configured or no From domain',
        () => {
            assertFuzz(
                fc.property(fc.array(headerArb(fc.constant(TRUSTED)), { maxLength: 3 }), fc.constantFrom(undefined, ''), (headers, id) => {
                    expect(senderCheckFrom(headers.map(text), id, FROM)).toBe('NONE');
                    expect(senderCheckFrom(headers.map(text), TRUSTED, null)).toBe('NONE');
                }),
            );
        },
        fuzzTimeout(1),
    );

    it(
        'reads headers in time linear in their length (no backtracking blow-up)',
        () => {
            const piece = fc.constantFrom('a', '-', '.', '=', '(', ')', '"', ';', ' ', 'header.d', 'dkim=pass ', '@');
            const hostile = fc
                .tuple(fc.array(piece, { maxLength: 3 }), fc.array(piece, { minLength: 1, maxLength: 2 }), fc.integer({ min: 5_000, max: 20_000 }))
                .map(([pre, unit, n]) => `${TRUSTED}; ${pre.join('')}${unit.join('').repeat(Math.ceil(n / unit.join('').length))}`);
            assertFuzz(
                fc.property(hostile, (value) => {
                    expect(bestTimeMs(() => senderCheckFrom([value], TRUSTED, FROM), 25)).toBeLessThanOrEqual(25);
                }),
                { scale: 0.5 },
            );
        },
        fuzzTimeout(60, 0.5),
    );
});

describe('the sender check: the linear reader answers as the patterns it replaced, on ASCII', () => {
    /** The check before H2f, kept as the reference on inputs too short to blow up. */
    function legacy(headerValues: readonly string[], trustedId: string, fromDomain: string): SenderCheck {
        const parse = (value: string) => {
            const [first, ...rest] = value.split(';');
            const authservId = (first ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
            const methods: Array<{ method: string; result: string; props: Record<string, string> }> = [];
            for (const chunk of rest) {
                const clean = chunk.replace(/\([^)]*\)/g, ' ').trim();
                const m = /^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(.*)$/i.exec(clean);
                if (!m) continue;
                const props: Record<string, string> = {};
                for (const p of m[3]!.matchAll(/([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi)) props[p[1]!.toLowerCase()] = p[2]!.replace(/^"|"$/g, '').toLowerCase();
                methods.push({ method: m[1]!.toLowerCase(), result: m[2]!.toLowerCase(), props });
            }
            return { authservId, methods };
        };
        const trusted = headerValues.map(parse).find((h) => h.authservId === trustedId.toLowerCase());
        if (!trusted) return 'NONE';
        const dmarc = trusted.methods.find((m) => m.method === 'dmarc');
        if (dmarc) {
            if (dmarc.result === 'fail') return 'FAILED';
            if (dmarc.result !== 'pass') return 'NONE';
            const hf = dmarc.props['header.from'];
            return !hf || hf === fromDomain ? 'VERIFIED' : 'NONE';
        }
        const dom = (v: string | undefined) => (v ? v.slice(v.lastIndexOf('@') + 1).toLowerCase() : null);
        const ok = trusted.methods.some((m) => {
            const d = dom(m.props['header.d'] ?? m.props['header.i']);
            return m.method === 'dkim' && m.result === 'pass' && d !== null && (d === fromDomain || fromDomain.endsWith(`.${d}`));
        });
        return ok ? 'VERIFIED' : 'NONE';
    }

    it(
        'gives the same verdict on any short ASCII header',
        () => {
            const piece = fc.constantFrom('a', 'b.c', '-', '.', '=', '(', ')', '"', ';', ' ', 'header.d', 'header.from', 'dkim', 'dmarc', 'pass', 'fail', '@', 'kexample.com', TRUSTED);
            assertFuzz(
                fc.property(fc.array(fc.array(piece, { maxLength: 24 }).map((p) => p.join('')), { minLength: 1, maxLength: 3 }), (headers) => {
                    expect(senderCheckFrom(headers, TRUSTED, FROM)).toBe(legacy(headers, TRUSTED, FROM));
                }),
            );
        },
        fuzzTimeout(1),
    );
});

describe('the sender check: examples the fuzzing found (H2f)', () => {
    it('does not trust an authserv-id spelt with the Kelvin sign for k (seed 1134639010)', () => {
        expect(senderCheckFrom(['mx.Kinbound.test; dmarc=pass'], TRUSTED, FROM)).toBe('NONE');
        expect(senderCheckFrom([`${TRUSTED}; dmarc=pass`], TRUSTED, FROM)).toBe('VERIFIED');
    });

    it('does not take a header.from spelt with the Kelvin sign for the From domain (seed 10416746)', () => {
        expect(senderCheckFrom([`${TRUSTED}; dmarc=pass header.from=Kexample.com`], TRUSTED, FROM)).toBe('NONE');
        expect(senderCheckFrom([`${TRUSTED}; dkim=pass header.d=Kexample.com`], TRUSTED, FROM)).toBe('NONE');
    });

    it('reads an unclosed comment run and a long word run in linear time (seeds -1548931954, 1201339995)', () => {
        expect(bestTimeMs(() => senderCheckFrom([`${TRUSTED}; ${'('.repeat(20_000)}`], TRUSTED, FROM), 25)).toBeLessThanOrEqual(25);
        expect(bestTimeMs(() => senderCheckFrom([`${TRUSTED}; dkim=pass ${'a'.repeat(20_000)}`], TRUSTED, FROM), 25)).toBeLessThanOrEqual(25);
    });
});

describe('the sender check: a header far larger than any server writes (H2f)', () => {
    it('reads a 10 MB header without overflowing the stack, deciding by its first 8 KB', () => {
        // The method pattern backtracked over the whole word and threw a RangeError
        // in the 10 MB check of the email parsers' suite.
        expect(() => senderCheckFrom([`${TRUSTED}; dkim=pass ${'a'.repeat(10_000_000)}`], TRUSTED, FROM)).not.toThrow();
        expect(senderCheckFrom([`${TRUSTED}; dmarc=pass header.from=${FROM}; ${'x'.repeat(10_000_000)}`], TRUSTED, FROM)).toBe('VERIFIED');
    });
});
