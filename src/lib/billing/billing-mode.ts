/**
 * SAAS vs SELFHOSTED, in one place.
 *
 * A deployment with `STRIPE_SECRET_KEY` set is hosted (SAAS); without it, it
 * is self-hosted. The egress allowlist (`@/lib/security/egress-allowlist`)
 * needs this answer today; sub-phase 8.1's entitlements will re-export it
 * rather than re-derive it, so the two can never disagree. Kept free of
 * Prisma so the SSRF guard that imports it stays small.
 */
import { env } from '@/env';

export type BillingMode = 'SAAS' | 'SELFHOSTED';

/**
 * Read once at module load — billing mode does not change at runtime
 * (you'd have to restart the process to flip it).
 */
const BILLING_MODE: BillingMode = env.STRIPE_SECRET_KEY ? 'SAAS' : 'SELFHOSTED';

export function getBillingMode(): BillingMode {
    return BILLING_MODE;
}
