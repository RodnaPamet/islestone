/**
 * Structural ratchet — business-KPI metrics coverage + cardinality.
 *
 * Locks the contract in docs/observability.md ("Business KPIs"):
 *   - the metrics module exists and defines every catalogue metric,
 *   - the cardinality rules hold (never `tenant.id` as a label; time
 *     labels are pre-rounded bucket strings),
 *   - every wiring-point usecase actually imports the metrics module.
 *
 * Adding a metric without wiring it (or wiring it without bounded
 * labels) fails CI here.
 *
 * Copied from inflect-compliance `tests/guardrails/business-metrics-coverage.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: 15 metrics, and only the
 * wiring points that exist in Islestone.
 */
import fs from 'fs';
import path from 'path';
import { BUSINESS_METRIC_NAMES } from '@/lib/observability/business-metrics';

const ROOT = path.resolve(__dirname, '../..');
const MODULE_REL = 'src/lib/observability/business-metrics.ts';
const MODULE_ABS = path.join(ROOT, MODULE_REL);

function read(rel: string): string {
    const p = path.join(ROOT, rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

const moduleSrc = read(MODULE_REL);

/**
 * Every wiring point that MUST import the metrics module. The metric(s)
 * each one emits are noted for the human reader; the assertion only
 * checks the import is present (the metric call shape is covered by the
 * unit/integration tests).
 *
 * `src/auth.ts` is intentionally NOT here: OAuth new-vs-returning user
 * detection in the NextAuth callback is best-effort (the credentials
 * register route is the guaranteed user.signup emitter), so auth.ts
 * wiring is allowed but not required.
 */
const WIRING_POINTS: Array<{ file: string; emits: string }> = [
    // Each later wiring point (tenant deletion 8.3, onboarding 8.2, automation
    // rules 5.1, billing and plan limits 8.1, the DAU/MAU aggregator 8.1) is
    // added here when its sub-phase lands.
    { file: 'src/app/api/auth/register/route.ts', emits: 'business.tenant.created + business.user.signup' },
    { file: 'src/app-layer/usecases/tenant-invites.ts', emits: 'business.invite.sent + .redeemed' },
    { file: 'src/app-layer/usecases/mfa-enrollment.ts', emits: 'business.user.mfa.enrolled' },
]

describe('business-metrics module', () => {
    it('exists', () => {
        expect(fs.existsSync(MODULE_ABS)).toBe(true);
        expect(moduleSrc.length).toBeGreaterThan(0);
    });

    it('catalogue has the 15-metric set (inflect has 21; six compliance metrics are cut)', () => {
        expect(BUSINESS_METRIC_NAMES.length).toBe(15);
        // No duplicates.
        expect(new Set(BUSINESS_METRIC_NAMES).size).toBe(BUSINESS_METRIC_NAMES.length);
    });

    it('defines a metric for every catalogue name (each name appears as a literal)', () => {
        for (const name of BUSINESS_METRIC_NAMES) {
            // Each metric name must be created/observed somewhere in the module.
            expect(moduleSrc).toContain(`'${name}'`);
        }
    });

    it('every metric name is in the business.* namespace', () => {
        for (const name of BUSINESS_METRIC_NAMES) {
            expect(name.startsWith('business.')).toBe(true);
        }
    });
});

describe('cardinality discipline', () => {
    it('never uses tenant.id / tenantId as a metric LABEL key', () => {
        // A label key looks like `'tenant.id':` or `tenant_id:` in a
        // label object. The docstring mentions tenant.id in backticks
        // (prose) which this regex deliberately does not match.
        const labelKeyRe = /['"]tenant[._]?id['"]\s*:/i;
        expect(labelKeyRe.test(moduleSrc)).toBe(false);
    });

    it('time-bucket labels are produced by bucketTimeTo (pre-rounded strings)', () => {
        // The bucket helper exists and returns only the 4 bounded values.
        expect(moduleSrc).toMatch(/export function bucketTimeTo/);
        expect(moduleSrc).toMatch(/'lt_1h'|'lt_1d'|'lt_1w'|'gt_1w'/);
        // Any `.bucket'` label must be fed bucketTimeTo(...), never a raw number.
        const bucketAssigns = moduleSrc.match(/\.bucket['"]\s*:\s*([^,\n]+)/g) ?? [];
        expect(bucketAssigns.length).toBeGreaterThan(0);
        for (const a of bucketAssigns) {
            expect(a).toContain('bucketTimeTo(');
        }
    });
});

describe('wiring-point coverage', () => {
    it.each(WIRING_POINTS)('$file imports business-metrics (emits $emits)', ({ file }) => {
        const src = read(file);
        expect(src.length).toBeGreaterThan(0);
        expect(src).toMatch(/observability\/business-metrics/);
    });
});
