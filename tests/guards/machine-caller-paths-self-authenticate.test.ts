/**
 * Every machine-caller path authenticates inside its own handler.
 *
 * `MACHINE_CALLER_PREFIXES` exists because the edge gate refuses any API
 * request without a NextAuth cookie, and the callers of these endpoints —
 * Stripe, Microsoft Graph, the AV scanner, a SCIM IdP, an MCP client, a
 * browser sending a credential-less CSP report — never have one. They were
 * all returning 401 before reaching code that would have authenticated them
 * correctly.
 *
 * That makes this list the one place where a typo opens the tenant API. An
 * entry whose handler does NOT authenticate is not a fix, it is a hole, and
 * the failure is silent in the direction that matters: the endpoint starts
 * working, which looks like success.
 *
 * So each entry is paired with the gate it is claimed to have, and the gate
 * is asserted to be present in the source. This is deliberately a
 * hard-coded expectation per path rather than a generic "contains the word
 * auth" scan — the point is that a human decided what gates each one, and
 * changing that decision has to be a visible edit here.
 *
 * And an entry is a PATH, while a route file exports METHODS. `isPublicPath`
 * cannot say "the POST only", so an entry added for a credential-less method
 * opens every other method on the same path. `/api/security/csp-report` is
 * where that bit: its POST is the browser report sink and must stay open,
 * while its GET returns the process-wide CSP violation buffer and was public
 * for as long as the entry existed (#2103).
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * In sub-phase 1.4 `MACHINE_CALLER_PREFIXES` is EMPTY: SCIM (8.3), the
 * webhook receivers, the CSP report (1.5), MCP, A2A and the platform-operator
 * `/api/admin` routes have not arrived. The parent's per-prefix contracts and
 * its `/api/admin` and `/api/a2a` directory sweeps are therefore not ported;
 * what is kept is the rule that binds the day the first entry is added — it
 * must come with a contract here naming its in-handler gate — and the checks
 * that the list opens nothing it does not mean to.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MACHINE_CALLER_PREFIXES, isPublicPath } from '@/lib/auth/guard';
import { codeOf } from '../helpers/source-blocks';

const APP = path.resolve(__dirname, '../../src/app');

/**
 * prefix → the handler that must authenticate it and the gate it must contain
 * (a regex over the handler source, comments stripped, so a docblock
 * promising a check cannot satisfy it). Empty while the list is.
 */
const CONTRACTS: ReadonlyArray<{
    prefix: string;
    handler: string;
    gate: RegExp;
    why: string;
}> = [];

describe('machine-caller paths authenticate themselves', () => {
    it('each contract\'s handler carries its gate', () => {
        // A loop rather than `it.each`, which refuses an empty table.
        for (const { prefix, handler, gate } of CONTRACTS) {
            const src = codeOf(fs.readFileSync(path.join(APP, handler), 'utf8'));
            expect({ prefix, gated: gate.test(src) }).toEqual({ prefix, gated: true });
        }
    });

    it('every prefix has a contract here, and every contract names a listed prefix', () => {
        const contracted = new Set(CONTRACTS.map((c) => c.prefix));
        expect(MACHINE_CALLER_PREFIXES.filter((p) => !contracted.has(p))).toEqual([]);
        expect(CONTRACTS.filter((c) => !MACHINE_CALLER_PREFIXES.includes(c.prefix))).toEqual([]);
    });

    it('the list is empty in sub-phase 1.4 — a new entry is a reviewed edit here', () => {
        expect(MACHINE_CALLER_PREFIXES).toEqual([]);
    });
});

describe('the allowlist opens what it means to open, and nothing else', () => {
    it('does NOT open the tenant API, or the parent\'s machine-caller paths', () => {
        for (const p of [
            '/api/t/acme/work-items',
            '/api/t/acme/admin/members',
            '/api/t/acme/admin/invites',
            '/api/scim/v2/Users',
            '/api/admin/diagnostics',
            '/api/mcp',
            '/api/security/csp-report',
            '/api/stripe/webhook',
        ]) {
            expect({ p, public: isPublicPath(p) }).toEqual({ p, public: false });
        }
    });
});
