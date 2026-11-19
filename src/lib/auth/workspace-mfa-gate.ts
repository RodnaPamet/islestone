/**
 * The workspace MFA gate both tenant-context builders run: `getTenantCtx`
 * (`src/app-layer/context.ts`, route handlers) and `getTenantServerContext`
 * (`src/lib/server/tenant-context.server.ts`, pages and layouts). One
 * function, so the two cannot drift; CLAUDE.md, "Data layer", says they
 * change together.
 *
 * Copied from inflect-compliance `src/app-layer/context.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (`assertWorkspaceMfaSatisfied`,
 * which the parent kept private there), moved to its own module so the
 * page-side builder asks the same question.
 */
import type { NextRequest } from 'next/server';

import { isMfaAllowedPath } from '@/lib/auth/guard';
import { WORKSPACE_MFA_REQUIRED, workspaceStillAsksThisSession } from '@/lib/auth/workspace-mfa';
import { forbidden } from '@/lib/errors/types';

/** The session facts the gate reads (`JwtPayload` in `src/lib/auth/session.ts`). */
export interface WorkspaceMfaSession {
    userId: string;
    membershipTenantIds?: string[];
    mfaPendingTenantIds?: string[];
}

/**
 * Refuse a workspace that still wants this session's MFA code
 * (`workspaceStillAsksThisSession`). An API request gets the edge's own 403; a
 * page is sent to the workspace's challenge. A payload with no membership
 * claim at all (only a test double builds one) is not asked.
 */
export async function assertWorkspaceMfaSatisfied(
    session: WorkspaceMfaSession,
    tenantId: string,
    tenantSlug: string,
    req: NextRequest | undefined,
): Promise<void> {
    if (!session.membershipTenantIds) return;
    if (req && isMfaAllowedPath(new URL(req.url).pathname)) return;
    const asks = await workspaceStillAsksThisSession({
        userId: session.userId,
        tenantId,
        claimedTenantIds: session.membershipTenantIds,
        pendingTenantIds: session.mfaPendingTenantIds ?? [],
        sessionId: async () => {
            const { currentSessionIdOf, currentSessionIdFromCookies } = await import('@/lib/security/session-tracker');
            return req ? currentSessionIdOf(req) : currentSessionIdFromCookies();
        },
    });
    if (!asks) return;
    if (req) throw forbidden(WORKSPACE_MFA_REQUIRED);
    const { redirect } = await import('next/navigation');
    redirect(`/t/${tenantSlug}/auth/mfa`);
}
