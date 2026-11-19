/**
 * The permissions only a custom role based on ADMIN may hold.
 *
 * Copied from inflect-compliance `src/lib/custom-role-admin-base-rule.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (its owner decisions of
 * 2026-10-30), with the lists re-derived for Islestone's admin keys.
 *
 * A custom role's base role is what every coarse-tier check reads
 * (`canAdmin` / `assertCanAdmin`). A route gated on one of these keys passes a
 * role that grants it, and the server code behind the route then asks the
 * Admin tier, which a Member or Viewer base does not have — so the role would
 * be let in and refused, with no `AUTHZ_DENIED` row. The combination itself is
 * refused instead: `createCustomRole` / `updateCustomRole` refuse these keys
 * on other bases, and the Roles page (sub-phase 1.7 or 8.3) stops offering
 * them.
 *
 * Every `admin` key is classified in exactly one of the two lists below, so a
 * new one fails `tests/unit/custom-role-admin-base-rule.test.ts` until somebody
 * decides which.
 *
 * Client-safe: no server imports, so the Roles page applies the same rule.
 */

/** The refusal reason, in `error.details.reason`; the keys are in `error.details.permissions`. */
export const PERMISSION_NEEDS_ADMIN_BASE = 'PERMISSION_NEEDS_ADMIN_BASE' as const;

/**
 * Held only on an ADMIN base, each because server code behind a route gated on
 * it asks the Admin tier.
 */
export const ADMIN_BASE_ONLY_PERMISSIONS = [
    // Its routes (security settings, custom roles, the MFA policy) reach
    // `assertCanAdmin` or the settings check behind it.
    'admin.manage',
    // Member, invite, custom-role assignment and session usecases call
    // `assertCanManageMembers`.
    'admin.members',
    // Read inside the member and invite usecases, behind the same check.
    'admin.owner_management',
    // OWNER-only; the workspace lifecycle surfaces (8.3) are Admin-tier.
    'admin.tenant_lifecycle',
] as const;

export type AdminBaseOnlyPermission = (typeof ADMIN_BASE_ONLY_PERMISSIONS)[number];

/**
 * The `admin` keys a custom role may hold on any base, and why. Not read by
 * the rule; it exists so every admin key is a decision.
 */
export const ADMIN_KEYS_ON_ANY_BASE: Readonly<Record<string, string>> = {
    view: 'Read-only; the admin pages need an Admin membership anyway (the edge admits by the built-in role).',
    sso: 'No code reads it until sub-phase 8.3; then its routes check the key. Carried only by an ADMIN membership (roles.ts).',
    scim: 'Its routes (8.3) check the key and nothing else. Carried only by an ADMIN membership (roles.ts).',
};

const ADMIN_BASE_ONLY = new Set<string>(ADMIN_BASE_ONLY_PERMISSIONS);

/** Whether `domain.action` is held only on an ADMIN base. */
export function needsAdminBase(domain: string, action: string): boolean {
    return ADMIN_BASE_ONLY.has(`${domain}.${action}`);
}

/** Whether a custom role on `baseRole` may hold `domain.action`. */
export function mayHoldOnBase(baseRole: string, domain: string, action: string): boolean {
    return baseRole === 'ADMIN' || !needsAdminBase(domain, action);
}

/**
 * The Admin-base-only keys a stored or submitted permission blob grants
 * (`true`), in list order. Empty for a blob that grants none of them.
 */
export function adminBaseOnlyGrants(grantsJson: unknown): AdminBaseOnlyPermission[] {
    const blob = (grantsJson ?? {}) as Record<string, Record<string, unknown> | undefined>;
    return ADMIN_BASE_ONLY_PERMISSIONS.filter((key) => {
        const [domain, action] = key.split('.');
        return blob[domain]?.[action] === true;
    });
}

/** The keys `grantsJson` grants that `baseRole` may not hold. Empty on an ADMIN base. */
export function grantsNeedingAdminBase(grantsJson: unknown, baseRole: string): AdminBaseOnlyPermission[] {
    return baseRole === 'ADMIN' ? [] : adminBaseOnlyGrants(grantsJson);
}

/** The refused keys when a parsed API error body is this refusal, else `null`. */
export function adminBaseRefusalPermissions(body: unknown): string[] | null {
    const details = (body as { error?: { details?: { reason?: unknown; permissions?: unknown } } } | null)?.error?.details;
    if (details?.reason !== PERMISSION_NEEDS_ADMIN_BASE) return null;
    return Array.isArray(details.permissions) ? details.permissions.filter((k): k is string => typeof k === 'string') : [];
}
