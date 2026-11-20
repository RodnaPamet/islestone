/**
 * Whether public intake forms are open on this deployment (sub-phase 2.6b,
 * owner decision 86): a form an admin published for "anyone with the link"
 * takes requests only while this says yes.
 *
 *   INTAKE_PUBLIC_FORMS=1   open
 *   INTAKE_PUBLIC_FORMS=0   closed
 *   unset                   closed when NODE_ENV is production, open otherwise
 *
 * The same shape as public sign-up (`isPublicSignupOpen`, decision 7):
 * an operator opens it without a code change once H2's abuse tests pass.
 * Closed, every public form page, its submit and the confirmation link answer
 * the one 404 an unknown form answers, and no form can be set to public.
 *
 * Server-only (it reads `@/env`).
 */
import { env } from '@/env';

export function isPublicIntakeOpen(): boolean {
    if (env.INTAKE_PUBLIC_FORMS === '1') return true;
    if (env.INTAKE_PUBLIC_FORMS === '0') return false;
    return env.NODE_ENV !== 'production';
}
