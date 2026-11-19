import type { OrgRole, Role } from '@prisma/client';

import type { ActorType } from '@/lib/audit/types';
import type { OrgPermissionSet, PermissionSet } from '@/lib/permissions';

/** What KIND of actor a context represents; owned by `@/lib/audit/types`. */
export type { ActorType };

export interface RequestContext {
    /** Unique request identifier for log correlation */
    requestId: string;

    /** The authenticated user ID */
    userId: string;

    /**
     * What KIND of actor this context represents. Absent means `'USER'`,
     * which is what every HTTP-borne context is.
     *
     * Background jobs and platform sweeps have no signed-in user. They
     * must not satisfy `userId: string` with a literal such as `'system'`
     * and then be written to the audit trail as a person: set `'JOB'` for
     * scheduled work and `'SYSTEM'` for middleware-driven writes; leave it
     * unset for anything a user asked for.
     */
    actorType?: ActorType;

    /** The resolved tenant ID */
    tenantId: string;

    /** The resolved tenant slug (if available from route) */
    tenantSlug?: string;

    /** The effective role of the user within this tenant */
    role: Role;

    /**
     * The role on the caller's OWN membership row. With a custom role, `role`
     * is the custom role's base and this stays the membership's own built-in
     * role. The edge admits the admin console by it; it is not an authority
     * for anything else.
     */
    membershipRole?: Role;

    /** Effective permissions derived from the role */
    permissions: {
        canRead: boolean;
        canWrite: boolean;
        canAdmin: boolean;
        canExport: boolean;
    };

    /** Granular permission set, from the role or its custom role */
    appPermissions: PermissionSet;

    /**
     * The API key that authenticated the request. Always undefined until
     * sub-phase 5.2 ports API keys; the policies and the MFA usecases that
     * refuse a credential-borne context already read it, so they need no
     * second edit then.
     */
    apiKeyId?: string;
}

export interface PaginatedResult<T> {
    data: T[];
    metadata: {
        total: number;
        page: number;
        limit: number;
        hasMore: boolean;
    };
}

/**
 * Organization request context.
 *
 * Resolved by `getOrgCtx({ orgSlug }, req)` for routes under
 * `/api/org/[orgSlug]/*`. Distinct from `RequestContext` (which is
 * tenant-scoped) — a single request resolves to ONE of the two,
 * never both. A workspace request re-resolves as `RequestContext`
 * through the user's own `TenantMembership`, where the per-workspace
 * permission system takes over.
 *
 * `permissions` is derived from `orgRole` via `getOrgPermissions(...)`
 * at resolution time so callers can read flags directly without an
 * extra helper call. This mirrors how `RequestContext.permissions` /
 * `appPermissions` are pre-derived.
 */
export interface OrgContext {
    /** Unique request identifier for log correlation */
    requestId: string;

    /** The authenticated user ID */
    userId: string;

    /** The resolved organization ID */
    organizationId: string;

    /** The resolved organization slug (from the route) */
    orgSlug: string;

    /** The user's role within this organization */
    orgRole: OrgRole;

    /** Pre-derived org permission flags */
    permissions: OrgPermissionSet;
}
