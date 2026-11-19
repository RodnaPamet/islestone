/**
 * `local/no-request-derived-public-url` — RuleTester.
 *
 * Written fresh: inflect-compliance has the rule (copied verbatim into
 * eslint-rules/rules/) and no RuleTester suite for it. The valid cases are
 * the load-bearing half: an invalid-only suite passes against a rule that
 * flags everything.
 */
import { RuleTester } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';

// CommonJS on purpose — see eslint-rules/index.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require('../rules/no-request-derived-public-url');

const ruleTester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

const ROUTE = '/repo/src/app/api/t/[tenantSlug]/admin/invites/route.ts';

describe('local/no-request-derived-public-url', () => {
    ruleTester.run('no-request-derived-public-url', rule, {
        valid: [
            { name: 'publicBaseUrl in a route', filename: ROUTE, code: 'const base = publicBaseUrl(req);' },
            { name: 'the pathname is not an origin', filename: ROUTE, code: 'const p = req.nextUrl.pathname;' },
            {
                name: 'middleware may read the host for routing',
                filename: '/repo/src/middleware.ts',
                code: 'const h = req.nextUrl.host;',
            },
            {
                name: 'the helper implements the fallback',
                filename: '/repo/src/app/api/lib/http/public-base-url.ts',
                code: 'const o = req.nextUrl.origin;',
            },
            { name: 'a non-nextUrl host is someone else’s', filename: ROUTE, code: 'const h = config.host;' },
            {
                name: 'destructuring other props of nextUrl',
                filename: ROUTE,
                code: 'const { pathname, searchParams } = req.nextUrl;',
            },
        ],
        invalid: [
            {
                name: 'the template literal the rule exists for',
                filename: ROUTE,
                code: 'const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;',
                errors: [{ messageId: 'requestDerived', data: { prop: 'host' } }],
            },
            {
                name: 'origin',
                filename: ROUTE,
                code: 'const o = request.nextUrl.origin;',
                errors: [{ messageId: 'requestDerived', data: { prop: 'origin' } }],
            },
            {
                name: 'hostname',
                filename: ROUTE,
                code: 'const h = req.nextUrl.hostname;',
                errors: [{ messageId: 'requestDerived', data: { prop: 'hostname' } }],
            },
            {
                name: 'a destructured host',
                filename: ROUTE,
                code: 'const { host } = req.nextUrl;',
                errors: [{ messageId: 'requestDerived', data: { prop: 'host' } }],
            },
        ],
    });
});
