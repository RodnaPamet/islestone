/**
 * Whether public self-sign-up is open: may anyone create an account and,
 * with it, a new workspace at `/api/auth/register`?
 *
 * Owner decision, 2026-11-18 (ADR 0006): the route sits behind a switch,
 * off by default in production, on in development, and an operator opens it
 * without a code change. inflect-compliance left it open everywhere, throttled
 * only by `TENANT_CREATE_LIMIT`, as an open product question.
 *
 *   AUTH_PUBLIC_SIGNUP=1   open
 *   AUTH_PUBLIC_SIGNUP=0   closed
 *   unset                  closed when NODE_ENV is production, open otherwise
 *
 * The switch governs the workspace-creating path only. Registering an account
 * for a pending invitation (no `orgName`, and an invite cookie sent to the
 * same email) is not public sign-up: it needs an invitation, so it stays open
 * whatever the switch says.
 */
import { env } from '@/env';

export function isPublicSignupOpen(): boolean {
    if (env.AUTH_PUBLIC_SIGNUP === '1') return true;
    if (env.AUTH_PUBLIC_SIGNUP === '0') return false;
    return env.NODE_ENV !== 'production';
}
