/**
 * The signed-in session — SUB-PHASE 1.3 STUB.
 *
 * No session provider exists yet, so every call is a 401. Sub-phase 1.4
 * replaces this file with NextAuth, widens `SessionIdentity` to the real
 * session shape (SSO scope, membership claims, pending MFA, sign-in method)
 * and restores the gates `getTenantCtx` / `getOrgCtx` and their page-side
 * twins dropped in 1.3. Do not add a development bypass here: the stub fails
 * closed on purpose.
 */
import { unauthorized } from '@/lib/errors/types';

export interface SessionIdentity {
    userId: string;
}

/** 1.3 stub: no session provider exists yet, so every call is 401. */
export async function getSessionOrThrow(): Promise<SessionIdentity> {
    throw unauthorized();
}
