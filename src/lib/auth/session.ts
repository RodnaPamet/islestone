/**
 * The signed-in session, read through Islestone's own seam (ADR 0004 A3).
 *
 * Copied from inflect-compliance `src/lib/auth.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, at the path sub-phase 1.3 gave
 * it. It bridges the NextAuth session to the request-context builders
 * (`getSessionOrThrow` in `src/app-layer/context.ts`) and keeps the coarse
 * role helpers.
 *
 * Role hierarchy (ADR 0006): OWNER > ADMIN > MEMBER > VIEWER > GUEST. A
 * session whose role cannot be resolved reads VIEWER, never GUEST.
 *
 * TenantMembership is authoritative for role assignment.
 *
 * SSO scope and "Enforce SSO" (`ssoTenantId`, `signInMethod`) arrive with
 * sub-phase 8.3 (ADR 0004 A2); the Entra group gate with it.
 */
import type { Role, User } from '@prisma/client';

import { auth } from '@/auth';
import { forbidden, unauthorized } from '@/lib/errors/types';
import prisma from '@/lib/prisma';

export interface JwtPayload {
    userId: string;
    tenantId: string;
    email: string;
    role: Role;
    /**
     * The workspaces the session's membership claim names (capped at
     * `MAX_JWT_MEMBERSHIPS`), and those of them still waiting for this
     * session's MFA code. A workspace outside the claim was never asked at
     * sign-in; the tenant gate asks it (`workspaceStillAsksThisSession`).
     * Absent only on a payload no real session produces.
     */
    membershipTenantIds?: string[];
    mfaPendingTenantIds?: string[];
}

/**
 * The current session, from NextAuth, or `null`. NextAuth is the only session
 * mechanism: inflect-compliance's legacy `token` cookie (JWT_SECRET) is not
 * ported (ADR 0004 A2), and `tests/unit/security/no-legacy-session-cookie.test.ts`
 * keeps it out.
 *
 * tenantId and role are resolved from TenantMembership (default membership).
 */
export async function getSession(): Promise<JwtPayload | null> {
    // 1. Try Auth.js session
    const session = await auth();
    if (session?.user) {
        return {
            userId: session.user.id,
            tenantId: session.user.tenantId ?? '',
            email: session.user.email ?? '',
            role: session.user.role ?? 'VIEWER',
            membershipTenantIds: (session.user.memberships ?? []).map((m) => m.tenantId),
            mfaPendingTenantIds: session.user.mfaPendingTenantIds ?? [],
        };
    }

    return null;
}

export async function getSessionOrThrow(): Promise<JwtPayload> {
    const session = await getSession();
    if (!session) throw unauthorized();
    return session;
}

export async function getCurrentUser(): Promise<User | null> {
    const session = await getSession();
    if (!session) return null;
    return prisma.user.findUnique({ where: { id: session.userId } });
}

// ─── RBAC helpers (Chunk 1: unified roles) ───

/** The linear hierarchy, by breadth of standing (ADR 0006). */
const ROLE_HIERARCHY: Record<Role, number> = {
    OWNER: 5,
    ADMIN: 4,
    MEMBER: 3,
    VIEWER: 2,
    GUEST: 1,
};

export function hasMinRole(userRole: Role, minRole: Role): boolean {
    return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[minRole];
}

// ─── Permission-based helpers ───

/**
 * The coarse helpers, for the policies. They agree with `computePermissions`
 * in `src/lib/tenant-context.ts`. The granular `requirePermission(<key>, ...)`
 * path reads `PermissionSet` instead.
 */
/** Can read workspace data (every role). */
export function canRead(role: Role): boolean {
    return (['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'] as Role[]).includes(role);
}

/** Can write/mutate data (OWNER, ADMIN, MEMBER) */
export function canWrite(role: Role): boolean {
    return (['OWNER', 'ADMIN', 'MEMBER'] as Role[]).includes(role);
}

/** Can perform admin operations (OWNER, ADMIN) */
export function canAdmin(role: Role): boolean {
    return role === 'OWNER' || role === 'ADMIN';
}

/** Can export workspace data (OWNER, ADMIN; `workspace.export`) */
export function canExport(role: Role): boolean {
    return role === 'OWNER' || role === 'ADMIN';
}

/** Can edit data — alias for canWrite for backward compat */
export function canEdit(role: Role): boolean {
    return canWrite(role);
}

export function requireRole(session: JwtPayload, minRole: Role): void {
    if (!hasMinRole(session.role, minRole)) {
        throw forbidden('Forbidden: insufficient permissions');
    }
}

// ─── Membership-based role checks ───

/**
 * Check if a user has a specific role (or higher) on a tenant.
 * Resolves from TenantMembership table.
 */
export async function hasTenantRole(
    userId: string,
    tenantId: string,
    requiredRole: Role
): Promise<boolean> {
    const membership = await prisma.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership) return false;
    return hasMinRole(membership.role, requiredRole);
}

// ─── Password helpers ───

// One hashing module: these are src/lib/auth/passwords.ts's, re-exported.
export { hashPassword, verifyPassword } from '@/lib/auth/passwords';
