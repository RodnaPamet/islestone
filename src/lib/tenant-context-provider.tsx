'use client';

/**
 * The workspace's client context: who the signed-in person is in this
 * workspace, what they may do, and the URL builders every workspace page uses.
 *
 * Copied from inflect-compliance `src/lib/tenant-context-provider.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7). It replaces the
 * 1.4 stub at this path and keeps its two hooks, `useTenantHref` and
 * `useTenantApiUrl`, with the same signatures. Cut: the risk currency
 * (`currencySymbol`, `useCurrencySymbol`, `useMoneyFormatter`) and the
 * optional-module bag (`modules`, `useModules`); the coarse `permissions` are
 * Islestone's (`Permissions` in `@/lib/tenant-context`).
 *
 * The workspace app layout (`src/app/t/[tenantSlug]/(app)/layout.tsx`)
 * resolves the value on the server and mounts the provider, so no client
 * component fetches it.
 *
 * The two URL builders also work OUTSIDE the provider, from the route's
 * `tenantSlug` param, as the 1.4 stub did: the MFA challenge and enrolment
 * pages (`src/app/t/[tenantSlug]/(mfa)/`) must render for a session that
 * still owes the workspace its MFA code, which the provider's layout
 * refuses, so they sit outside it.
 */
import { useParams } from 'next/navigation';
import { createContext, useCallback, useContext } from 'react';
import type { ReactNode } from 'react';
import type { Role } from '@prisma/client';

import type { PermissionSet } from '@/lib/permissions';
import type { Permissions } from '@/lib/tenant-context';

// ─── Tenant context ───

export interface TenantContextValue {
    /**
     * The authenticated user's id. Resolved server-side in the tenant layout
     * and threaded through here so client components can read it WITHOUT
     * `useSession()` — the app deliberately mounts no `<SessionProvider>`, so
     * `useSession()` returns undefined and throws on destructure.
     */
    userId: string;
    tenantId: string;
    tenantSlug: string;
    tenantName: string;
    role: Role;
    /**
     * The role on the user's own membership row, before any custom role. `role`
     * is a custom role's base when the membership carries one; this is what the
     * edge's admin gate reads, so the sidebar's settings link reads it too. The
     * tenant layout always sets it; absent reads as "may not open the admin
     * console".
     */
    membershipRole?: Role;
    /** The workspace's plan; sub-phase 8.1 fills it. */
    plan?: string;
    /** The coarse tiers (`computePermissions`). */
    permissions: Permissions;
    appPermissions: PermissionSet;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ value, children }: { value: TenantContextValue; children: ReactNode }) {
    return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantContext(): TenantContextValue {
    const ctx = useContext(TenantContext);
    if (!ctx) {
        throw new Error('useTenantContext must be used within a TenantProvider');
    }
    return ctx;
}

/**
 * The workspace context, or null outside a `TenantProvider`: for chrome that
 * renders in both shells (the top chrome's timer, 3.4b) and must render
 * nothing outside a workspace rather than throw.
 */
export function useOptionalTenantContext(): TenantContextValue | null {
    return useContext(TenantContext);
}

/**
 * Hook to retrieve granular app permissions for UI rendering logic.
 */
export function usePermissions(): PermissionSet {
    return useTenantContext().appPermissions;
}

/**
 * The authenticated user's id — the no-SessionProvider replacement for
 * `useSession().user.id` in client components.
 */
export function useCurrentUserId(): string {
    return useTenantContext().userId;
}

/**
 * The workspace slug: the provider's, else the route's `tenantSlug` param
 * (see the file header), else empty.
 */
function useTenantSlug(): string {
    const ctx = useContext(TenantContext);
    const params = useParams<{ tenantSlug?: string }>();
    return ctx?.tenantSlug ?? params?.tenantSlug ?? '';
}

/**
 * Build a tenant-scoped href: `/t/<slug>/<path>`
 */
export function useTenantHref() {
    const tenantSlug = useTenantSlug();
    return useCallback(
        (path: string) => `/t/${tenantSlug}${path.startsWith('/') ? path : `/${path}`}`,
        [tenantSlug],
    );
}

/**
 * Build a tenant-scoped API URL: `/api/t/<slug>/<path>`
 */
export function useTenantApiUrl() {
    const tenantSlug = useTenantSlug();
    return useCallback(
        (path: string) => `/api/t/${tenantSlug}${path.startsWith('/') ? path : `/${path}`}`,
        [tenantSlug],
    );
}
