'use client';

/**
 * Tenant-scoped URL builders — SUB-PHASE 1.4 STUB at the final module path.
 *
 * Sub-phase 1.7 ports inflect-compliance's `TenantProvider` (the workspace's
 * name, role, permissions and these hooks, fed by the tenant layout) and
 * replaces this file. Until then the two hooks the 1.4 MFA pages call derive
 * the slug from the route params, which is what the provider's value carries
 * for them. Tests that `jest.mock('@/lib/tenant-context-provider')` keep
 * working when 1.7 lands.
 */
import { useParams } from 'next/navigation';
import { useCallback } from 'react';

function useTenantSlug(): string {
    const params = useParams<{ tenantSlug?: string }>();
    return params?.tenantSlug ?? '';
}

/** Build a tenant-scoped page URL: `/t/<slug>/<path>` */
export function useTenantHref() {
    const tenantSlug = useTenantSlug();
    return useCallback(
        (path: string) => `/t/${tenantSlug}${path.startsWith('/') ? path : `/${path}`}`,
        [tenantSlug],
    );
}

/** Build a tenant-scoped API URL: `/api/t/<slug>/<path>` */
export function useTenantApiUrl() {
    const tenantSlug = useTenantSlug();
    return useCallback(
        (path: string) => `/api/t/${tenantSlug}${path.startsWith('/') ? path : `/${path}`}`,
        [tenantSlug],
    );
}
