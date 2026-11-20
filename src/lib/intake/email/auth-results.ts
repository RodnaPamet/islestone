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

function parseMethods(value: string): { authservId: string; methods: Method[] } {
    const [first, ...rest] = value.split(';');
    const authservId = (first ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const methods: Method[] = [];
    for (const chunk of rest) {
        const clean = chunk.replace(/\([^)]*\)/g, ' ').trim();
        const m = /^([a-z0-9-]+)\s*=\s*([a-z0-9-]+)(.*)$/i.exec(clean);
        if (!m) continue;
        const props: Record<string, string> = {};
        for (const p of m[3]!.matchAll(/([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi)) {
            props[p[1]!.toLowerCase()] = p[2]!.replace(/^"|"$/g, '').toLowerCase();
        }
        methods.push({ method: m[1]!.toLowerCase(), result: m[2]!.toLowerCase(), props });
    }
    return { authservId, methods };
}

function domainOfIdentity(v: string | undefined): string | null {
    if (!v) return null;
    const at = v.lastIndexOf('@');
    return (at >= 0 ? v.slice(at + 1) : v).toLowerCase();
}

function aligned(signer: string | null, fromDomain: string): boolean {
    return signer !== null && (signer === fromDomain || fromDomain.endsWith(`.${signer}`));
}

export function senderCheckFrom(headerValues: readonly string[], trustedAuthservId: string | undefined, fromDomain: string | null): SenderCheck {
    if (!trustedAuthservId || !fromDomain) return 'NONE';
    const trusted = headerValues.map(parseMethods).find((h) => h.authservId === trustedAuthservId.toLowerCase());
    if (!trusted) return 'NONE';
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
