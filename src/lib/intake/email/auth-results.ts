/**
 * Reading the receiving MTA's `Authentication-Results` (sub-phase 2.6c,
 * owner decision 123). Resend gives no SPF, DKIM or DMARC verdict of its own
 * (re-check against resend.com before go-live), so this header is the only
 * evidence of a sender's domain authentication, and a sender can write the
 * header too. So:
 *
 * - only a header whose authserv-id equals the configured one
 *   (`INTAKE_EMAIL_AUTHSERV_ID`) is read, and of those only the topmost (the
 *   one the receiving MTA added last, closest to us);
 * - with no id configured, or no such header, the result is NONE;
 * - VERIFIED needs `dmarc=pass` (with a `header.from` equal to the From domain,
 *   when it names one), or, with no DMARC result, `dkim=pass` for the From
 *   domain or a parent of it; `dmarc=fail` is FAILED; anything else is NONE.
 *
 * Only VERIFIED is acknowledged or attributed to a member (decisions 99, 123).
 * Pure; written fresh for Islestone.
 */
export type SenderCheck = 'VERIFIED' | 'FAILED' | 'NONE';

interface Method {
    method: string;
    result: string;
    props: Record<string, string>;
}

/** ASCII letters lower-cased, nothing else: full Unicode folding turns `K` (the Kelvin sign) into `k`, so a look-alike would match. */
function asciiLower(value: string): string {
    return value.replace(/[A-Z]+/g, (c) => c.toLowerCase());
}

/**
 * The text without its comments (`(…)`, each to its first `)`, unnested, as
 * RFC 8601 readers usually take them), in one pass. The pattern this replaces
 * (`/\([^)]*\)/g`) tried every `(` of an unclosed run to the end of the text:
 * quadratic (found by Hardening H2f's fuzzing). Same answers, linear time.
 */
function withoutComments(value: string): string {
    let out = '';
    let from = 0;
    for (;;) {
        const open = value.indexOf('(', from);
        if (open < 0) break;
        const close = value.indexOf(')', open + 1);
        if (close < 0) break;
        out += `${value.slice(from, open)} `;
        from = close + 1;
    }
    return out + value.slice(from);
}

/**
 * A property (`header.d=example.com`): it starts where a word starts (the
 * look-behind), so a long run of word characters with no `.` is tried once,
 * not once per character, which made the read quadratic (H2f).
 */
const PROPERTY = /(?<![a-z0-9-])([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi;

function parseMethods(value: string): { authservId: string; methods: Method[] } {
    const [first, ...rest] = value.split(';');
    const authservId = asciiLower((first ?? '').trim().split(/\s+/)[0] ?? '');
    const methods: Method[] = [];
    for (const chunk of rest) {
        const clean = withoutComments(chunk).trim();
        const m = /^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(.*)$/i.exec(clean);
        if (!m) continue;
        const props: Record<string, string> = {};
        for (const p of m[3]!.matchAll(PROPERTY)) {
            props[asciiLower(p[1]!)] = asciiLower(p[2]!.replace(/^"|"$/g, ''));
        }
        methods.push({ method: asciiLower(m[1]!), result: asciiLower(m[2]!), props });
    }
    return { authservId, methods };
}

function domainOfIdentity(v: string | undefined): string | null {
    if (!v) return null;
    const at = v.lastIndexOf('@');
    return asciiLower(at >= 0 ? v.slice(at + 1) : v);
}

function aligned(signer: string | null, fromDomain: string): boolean {
    return signer !== null && (signer === fromDomain || fromDomain.endsWith(`.${signer}`));
}

/**
 * How much of one header is read (8 KB): a receiving server's results are a
 * few hundred bytes, and a sender's 10 MB one made the method pattern
 * overflow the stack while it backtracked (Hardening H2f).
 */
export const MAX_RESULTS_HEADER = 8 * 1024;

/** A header's authserv-id, read without parsing the rest. */
function authservIdOf(value: string): string {
    const semicolon = value.indexOf(';');
    return asciiLower((semicolon < 0 ? value : value.slice(0, semicolon)).trim().split(/\s+/)[0] ?? '');
}

export function senderCheckFrom(headerValues: readonly string[], trustedAuthservId: string | undefined, fromDomainRaw: string | null): SenderCheck {
    if (!trustedAuthservId || !fromDomainRaw) return 'NONE';
    const fromDomain = asciiLower(fromDomainRaw);
    // Only the topmost header from the trusted server is parsed.
    const id = asciiLower(trustedAuthservId);
    const value = headerValues.map((v) => v.slice(0, MAX_RESULTS_HEADER)).find((v) => authservIdOf(v) === id);
    if (value === undefined) return 'NONE';
    const trusted = parseMethods(value);
    const dmarc = trusted.methods.find((m) => m.method === 'dmarc');
    if (dmarc) {
        if (dmarc.result === 'fail') return 'FAILED';
        if (dmarc.result !== 'pass') return 'NONE';
        const hf = dmarc.props['header.from'];
        return !hf || hf === fromDomain ? 'VERIFIED' : 'NONE';
    }
    const dkim = trusted.methods.find((m) => m.method === 'dkim' && m.result === 'pass' && aligned(domainOfIdentity(m.props['header.d'] ?? m.props['header.i']), fromDomain));
    return dkim ? 'VERIFIED' : 'NONE';
}
