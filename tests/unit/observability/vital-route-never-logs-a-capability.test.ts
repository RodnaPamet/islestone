/* eslint-disable @typescript-eslint/no-require-imports -- copied from inflect-compliance (PROVENANCE.md), whose lint config allows it */
/**
 * A route label must never contain a bearer capability (#5130).
 *
 * `src/middleware.ts` writes one `document_load` line per page load and one
 * `soft_navigation` line per client-side navigation, each carrying the route
 * label from `normalizeVitalRoute`. The middleware also runs on PUBLIC paths:
 * `src/lib/auth/guard.ts` lists `/invite/` as pass-through, so `isPassThrough`
 * is true and both lines are written for it.
 *
 * Those paths carry the raw capability in the PATH:
 *
 *   /invite/<43 base64url>   randomBytes(32).toString('base64url') — tenant-invites.ts
 *   /invite/org/<43 base64url>                                     — org-invites.ts
 *
 * and the database deliberately stores only a SHA-256 hash of each. `ID_SEGMENT`
 * does not collapse them: a base64url token almost always contains `-` or `_`
 * so never matches. In inflect-compliance nearly every invite token (and its
 * audit-pack share tokens) was written to the container's stdout in plaintext.
 *
 * `/reset-password` is NOT affected and a test below says why: it passes its
 * token in the QUERY (`?token=`), which `normalizeVitalRoute` strips before it
 * splits segments. That stripping is therefore load-bearing and is asserted
 * here too — remove it and that path starts leaking.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e,
 * without the `/audit/shared` cases (compliance share links are not ported;
 * 8.4's share links add their own) and with a planted list of long literal
 * segments in place of inflect's route-census floors.
 */
import * as path from 'path';
import { repoRelativeFiles } from '../../helpers/repo-files';
import {
    normalizeVitalRoute,
    documentLoadRoute,
    softNavigationRoute,
} from '@/lib/observability/vital-route';

/** A 64-char hex share token that does NOT begin with `c`. */
const HEX = '9f3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8';
/** The 1-in-16 hex token that DID match the old id rule — see the order test. */
const HEX_C = 'cf3a2b1c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8';
/** A base64url invite token, carrying both `-` and `_`. */
const B64 = 'Ab3-x9_Qz1LmNoPqRsTuVwXyZ0123456789abcdEFG';

describe('a route label never contains a bearer capability', () => {
    it.each([
        [`/invite/${B64}`, '/invite/[token]'],
        [`/invite/org/${B64}`, '/invite/org/[token]'],
    ])('collapses %s', (pathname, expected) => {
        const label = normalizeVitalRoute(pathname);
        expect(label).toBe(expected);
        // Said twice on purpose: the equality above would also pass if the
        // expectation itself were wrong, and this is the property that matters.
        expect(label).not.toContain(HEX);
        expect(label).not.toContain(HEX_C);
        expect(label).not.toContain(B64);
    });

    it('reaches the log line through both counters, not just the normalizer', () => {
        // The leak needed the middleware to CALL this for a public path. Both
        // counters pass a pass-through page through, so both are asserted.
        expect(documentLoadRoute({
            fetchDest: 'document', pathname: `/invite/${B64}`, passedThrough: true,
        })).toBe('/invite/[token]');
        expect(softNavigationRoute({
            rsc: '1', routerPrefetch: null, pathname: `/invite/org/${B64}`, passedThrough: true,
        })).toBe('/invite/org/[token]');
    });

    it('strips the QUERY, which is the whole reason two other token paths are safe', () => {
        // `/reset-password?token=` carries a capability. It is safe ONLY
        // because of this strip.
        expect(normalizeVitalRoute(`/reset-password?token=${B64}`)).toBe('/reset-password');
        expect(normalizeVitalRoute(`/t/acme/work-items/ckxyz01234567890123456789?t=${B64}`))
            .not.toContain(B64);
        expect(normalizeVitalRoute(`/invite/${B64}#frag`)).toBe('/invite/[token]');
    });

    it('catches a token-bearing path nobody registered — the general backstop', () => {
        // The explicit prefix list cannot cover a public path added later. A
        // long segment carrying a digit is a credential, not a word.
        expect(normalizeVitalRoute(`/some-future-public-page/${HEX}`))
            .toBe('/some-future-public-page/[token]');
        expect(normalizeVitalRoute(`/another/${B64}`)).toBe('/another/[token]');
    });
});

/**
 * THE SECOND SINK, which #5130 does not mention: the web-vitals BEACON.
 *
 * `recordWebVital` puts the same label into `http.route` — a METRIC ATTRIBUTE
 * on the histogram, not a log field. So a browser sitting on `/invite/<token>`
 * firing any web-vital sent the raw capability to the metrics backend, where
 * label values are indexed and retained. It is also the cardinality explosion
 * this normalizer exists to prevent: one new time series per share link.
 *
 * Both sinks share the one normalizer, so the fix covers both — asserted here
 * rather than assumed, because "it goes through the same function" is exactly
 * the kind of claim that stops being true after a refactor.
 */
describe('the web-vitals beacon label carries no capability either', () => {
    const loadWithCapturedMetrics = () => {
        const recorded: Array<Record<string, unknown>> = [];
        jest.resetModules();
        jest.doMock('@opentelemetry/api', () => ({
            metrics: {
                getMeter: () => ({
                    createHistogram: () => ({
                        record: (_v: number, attrs: Record<string, unknown>) => {
                            recorded.push(attrs);
                        },
                    }),
                }),
            },
        }));
        const mod = require('@/lib/observability/web-vitals');
        return { mod, recorded };
    };

    afterEach(() => { jest.resetModules(); jest.dontMock('@opentelemetry/api'); });

    it.each([
        [`/invite/org/${B64}`, '/invite/org/[token]', B64],
        [`/invite/${B64}`, '/invite/[token]', B64],
    ])('records %s as a bounded label', (route, expected, secret) => {
        const { mod, recorded } = loadWithCapturedMetrics();
        mod.recordWebVital({ name: 'LCP', value: 741.7, rating: 'good', route });
        expect(recorded).toHaveLength(1);
        expect(recorded[0]['http.route']).toBe(expected);
        // The property, said independently of the expectation above.
        expect(JSON.stringify(recorded[0])).not.toContain(secret);
    });
});

describe('and it still labels the real routes', () => {
    /**
     * DERIVED, not listed: every literal path segment of every route on disk.
     * A bare "collapse any segment of 20+ characters" rule — the obvious
     * spelling — would eat the long ones, silently destroying their metric
     * series. Islestone has only a few dozen segments, so the planted list
     * below carries the long literal shapes the rule must also leave alone.
     */
    const ROUTE_SEGMENTS: readonly string[] = (() => {
        const segs = new Set<string>();
        for (const f of repoRelativeFiles()) {
            if (!f.startsWith('src/app/')) continue;
            const dir = path.posix.dirname(f).slice('src/app/'.length);
            if (dir === '' || dir === '.') continue;
            for (const seg of dir.split('/')) {
                // Dynamic `[x]`, route groups `(x)`, and private `_x` folders
                // are not path segments a URL carries.
                if (!seg || seg.startsWith('[') || seg.startsWith('(') || seg.startsWith('_')) continue;
                segs.add(seg);
            }
        }
        return [...segs].sort();
    })();

    /**
     * Long literal segments of the shape real routes take (two of them from
     * inflect-compliance's census, one Islestone's own): words joined by
     * hyphens, 20 or more characters, no digit.
     */
    const PLANTED_LONG_SEGMENTS = [
        'vendor-assessment-templates',
        'http-message-signatures-directory',
        'notification-settings',
    ];

    it('reads a real population', () => {
        // Every assertion below passes over an empty set.
        expect(ROUTE_SEGMENTS.length).toBeGreaterThan(5);
        expect(ROUTE_SEGMENTS).toContain('notification-settings');
        expect(PLANTED_LONG_SEGMENTS.every((s) => s.length >= 20)).toBe(true);
    });

    it('leaves every literal route segment on disk, and every planted one, untouched', () => {
        const mangled = [...ROUTE_SEGMENTS, ...PLANTED_LONG_SEGMENTS]
            .filter((seg) => normalizeVitalRoute(`/x/${seg}`) !== `/x/${seg}`)
            .map((seg) => `${seg} (${seg.length} chars) -> ${normalizeVitalRoute(`/x/${seg}`)}`);
        expect(mangled).toEqual([]);
    });

    it('keeps the literal pages that sit beside a token route', () => {
        // `/invite/[token]` has real siblings. A blanket "segment after /invite
        // is a token" would relabel both of these.
        expect(normalizeVitalRoute('/invite/result')).toBe('/invite/result');
        expect(normalizeVitalRoute('/invite/org')).toBe('/invite/org');
    });

    it('still collapses ids and tenant slugs as it always did', () => {
        expect(normalizeVitalRoute('/t/acme/work-items/ckxyz01234567890123456789'))
            .toBe('/t/[tenant]/work-items/[id]');
        expect(normalizeVitalRoute('/t/acme/dashboard')).toBe('/t/[tenant]/dashboard');
        expect(normalizeVitalRoute('/t/acme/projects/42')).toBe('/t/[tenant]/projects/[id]');
        expect(normalizeVitalRoute('/t/acme/x/3f2504e0-4f89-11d3-9a0c-0305e82c3301'))
            .toBe('/t/[tenant]/x/[id]');
    });
});
