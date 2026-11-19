/**
 * The address this deployment sends as — one definition, two consumers.
 *
 * WHY THIS MODULE EXISTS. In inflect-compliance the default lived in two
 * places that never agreed: the mailer used it for the SMTP transport's
 * `from`, and the notification settings used their own copy as the fallback
 * for a tenant with no `TenantNotificationSettings` row. `processOutbox`
 * overrides `from` per tenant from the second one, so only the second copy
 * mattered, and it named a domain the production relay had not verified.
 * Every message was refused for months on a correctly configured deployment.
 * Two defaults, one of them right, and the wrong one won — so the fix is to
 * leave only one thing to correct.
 *
 * Read through `@/env`. inflect-compliance read `process.env.SMTP_FROM` raw,
 * because a bundled route chunk there could carry an `@/env` copy without the
 * server variables; Islestone forbids raw reads in `src/`, and there is no
 * SMTP transport yet (src/lib/mailer.ts) to prove the route path against.
 * When the transport lands, its delivery test from a route handler in a
 * production build settles it.
 *
 * WHY A FUNCTION AND NOT A CONST. Resolved per call, so the value never
 * depends on import order, and tests can set the variable.
 *
 * Copied from inflect-compliance `src/lib/email/sender-identity.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (placeholder domain, env read and
 * docblock changed).
 */
import { env } from '@/env';

/**
 * The literal used when a deployment has configured no sender at all.
 *
 * A placeholder under the reserved `.invalid` domain (RFC 2606), which no
 * relay can verify, so a deployment that forgot `SMTP_FROM` fails loudly
 * rather than sending from a domain somebody else owns.
 */
export const UNCONFIGURED_SENDER = 'noreply@islestone.invalid';

/** The address this deployment sends as. */
export function deploymentSenderAddress(): string {
    return env.SMTP_FROM || UNCONFIGURED_SENDER;
}
