/**
 * Inbound email intake's deployment switch and address domain (sub-phase
 * 2.6c, owner decisions 120 to 123).
 *
 *   INTAKE_EMAIL=1   open
 *   INTAKE_EMAIL=0   closed
 *   unset            closed when NODE_ENV is production, open otherwise
 *
 * The same shape as public forms (`isPublicIntakeOpen`). It is also the kill
 * switch: every received email counts toward the provider's quota, so closing
 * it stops the processing (the webhook answers 200 and stores nothing) and
 * the Settings controls that turn an address on. Server-only.
 */
import { env } from '@/env';

export const DEFAULT_INTAKE_EMAIL_DOMAIN = 'in.islestone.cloud';

export function isInboundEmailOpen(): boolean {
    if (env.INTAKE_EMAIL === '1') return true;
    if (env.INTAKE_EMAIL === '0') return false;
    return env.NODE_ENV !== 'production';
}

/** The domain of every project's intake address. */
export function intakeEmailDomain(): string {
    return (env.INTAKE_EMAIL_DOMAIN || DEFAULT_INTAKE_EMAIL_DOMAIN).toLowerCase();
}
