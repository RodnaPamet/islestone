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
 * Sub-phase 1.6 adds the first entries, the credential-less beacons: the CSP
 * report sink and its legacy alias, and the web-vitals beacon. SCIM (8.3),
 * the webhook receivers, MCP, A2A and the platform-operator `/api/admin`
 * routes have not arrived, so the parent's contracts and directory sweeps for
 * them are not ported. Each entry's contract names, per exported METHOD, the
 * gate the handler carries; a method a contract does not list fails, so a GET
 * added to a beacon cannot ride its POST's public path ungated.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MACHINE_CALLER_PREFIXES, isPublicPath } from '@/lib/auth/guard';
import { codeOf, functionBodyOf } from '../helpers/source-blocks';

const APP = path.resolve(__dirname, '../../src/app');

/**
 * prefix → the handler file, and for EVERY method it exports the gate that
 * method's body must contain (a regex over the body, comments stripped, so a
 * docblock promising a check cannot satisfy it). A credential-less sink's
 * gate is its abuse bound (rate limit, size cap); an operator method's gate
 * is its credential check.
 */
const CONTRACTS: ReadonlyArray<{
    prefix: string;
    handler: string;
    methods: Readonly<Record<string, RegExp>>;
    why: string;
}> = [
    {
        prefix: '/api/security/csp-report',
        handler: 'api/security/csp-report/route.ts',
        methods: {
            POST: /checkReportRateLimit\s*\(/,
            GET: /verifyPlatformApiKey\s*\(/,
        },
        why: 'POST is the credential-less browser report sink (per-IP limit, 16 KB cap); GET returns the process-wide violation buffer and needs PLATFORM_ADMIN_API_KEY.',
    },
    {
        prefix: '/api/csp-report',
        handler: 'api/csp-report/route.ts',
        methods: { POST: /cspReportSink\s*\(\s*request\s*\)/ },
        why: 'The legacy alias: its only method hands the request to the canonical sink, limits included.',
    },
    {
        prefix: '/api/telemetry/vitals',
        handler: 'api/telemetry/vitals/route.ts',
        methods: { POST: /acceptVitalBeacon\s*\(/ },
        why: 'The web-vitals beacon: per-IP limited, size-capped, always 204.',
    },
];

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** The HTTP methods a route file exports (function or const). */
function exportedMethods(src: string): string[] {
    return HTTP_METHODS.filter((m) =>
        new RegExp(`export\\s+(async\\s+function\\s+${m}\\b|const\\s+${m}\\b)`).test(src),
    );
}

describe('machine-caller paths authenticate themselves', () => {
    it('each contract names exactly the methods its handler exports, and each method carries its gate', () => {
        for (const { prefix, handler, methods } of CONTRACTS) {
            const src = codeOf(fs.readFileSync(path.join(APP, handler), 'utf8'));
            expect({ prefix, exports: exportedMethods(src).sort() }).toEqual({
                prefix,
                exports: Object.keys(methods).sort(),
            });
            for (const [method, gate] of Object.entries(methods)) {
                const body = functionBodyOf(src, method);
                expect(body.length).toBeGreaterThan(0);
                expect({ prefix, method, gated: gate.test(body) }).toEqual({ prefix, method, gated: true });
            }
        }
    });

    it('the method check catches a planted ungated GET (the detector is not vacuous)', () => {
        const planted = codeOf(
            'export async function POST(request: Request) { return cspReportSink(request); }\n' +
                'export async function GET() { return new Response(JSON.stringify(getViolationSummary(50))); }\n',
        );
        expect(exportedMethods(planted).sort()).toEqual(['GET', 'POST']);
        expect(/verifyPlatformApiKey\s*\(/.test(functionBodyOf(planted, 'GET'))).toBe(false);
    });

    it('every prefix has a contract here, and every contract names a listed prefix', () => {
        const contracted = new Set(CONTRACTS.map((c) => c.prefix));
        expect(MACHINE_CALLER_PREFIXES.filter((p) => !contracted.has(p))).toEqual([]);
        expect(CONTRACTS.filter((c) => !MACHINE_CALLER_PREFIXES.includes(c.prefix))).toEqual([]);
    });

    it('the list holds exactly the sub-phase 1.6 beacons — a new entry is a reviewed edit here', () => {
        expect([...MACHINE_CALLER_PREFIXES].sort()).toEqual([
            '/api/csp-report',
            '/api/security/csp-report',
            '/api/telemetry/vitals',
        ]);
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
            '/api/security/csp-report-admin',
            '/api/telemetry/vitals-dump',
            '/api/stripe/webhook',
        ]) {
            expect({ p, public: isPublicPath(p) }).toEqual({ p, public: false });
        }
    });
});
