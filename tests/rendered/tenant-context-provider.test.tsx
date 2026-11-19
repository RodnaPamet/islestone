/** @jest-environment jsdom */

/**
 * `@/lib/tenant-context-provider` (sub-phase 1.7) replaced the 1.4 stub and
 * kept its two hooks. Inside the provider they build from the resolved
 * workspace; outside it (the MFA challenge and enrolment pages, which sit
 * outside the provider's layout) they fall back to the route's slug, as the
 * stub did. The context hook refuses to run without a provider.
 */
import { renderHook } from '@testing-library/react';
import * as React from 'react';

let mockParams: Record<string, string> | null = { tenantSlug: 'from-route' };
jest.mock('next/navigation', () => ({ useParams: () => mockParams }));

import { getPermissionsForRole } from '@/lib/permissions';
import {
    TenantProvider,
    useCurrentUserId,
    usePermissions,
    useTenantApiUrl,
    useTenantContext,
    useTenantHref,
} from '@/lib/tenant-context-provider';

import { makeRequestContext } from '../helpers/make-context';

function wrapper({ children }: { children: React.ReactNode }) {
    return (
        <TenantProvider
            value={{
                userId: 'u-ada',
                tenantId: 'tenant-1',
                tenantSlug: 'acme',
                tenantName: 'Acme',
                role: 'MEMBER',
                membershipRole: 'MEMBER',
                permissions: makeRequestContext('MEMBER').permissions,
                appPermissions: getPermissionsForRole('MEMBER'),
            }}
        >
            {children}
        </TenantProvider>
    );
}

beforeEach(() => {
    mockParams = { tenantSlug: 'from-route' };
});

describe('inside the provider', () => {
    it("builds page and API URLs from the resolved workspace, not the route's param", () => {
        const href = renderHook(() => useTenantHref(), { wrapper }).result.current;
        const api = renderHook(() => useTenantApiUrl(), { wrapper }).result.current;
        expect(href('/my-work')).toBe('/t/acme/my-work');
        expect(href('inbox')).toBe('/t/acme/inbox');
        expect(api('/notifications')).toBe('/api/t/acme/notifications');
    });

    it('exposes the member, their permissions and the workspace', () => {
        expect(renderHook(() => useCurrentUserId(), { wrapper }).result.current).toBe('u-ada');
        expect(renderHook(() => usePermissions(), { wrapper }).result.current.projects.create).toBe(true);
        expect(renderHook(() => useTenantContext(), { wrapper }).result.current.tenantName).toBe('Acme');
    });
});

describe('outside the provider', () => {
    it("falls back to the route's tenantSlug for the URL builders", () => {
        expect(renderHook(() => useTenantHref()).result.current('/security/mfa')).toBe('/t/from-route/security/mfa');
        expect(renderHook(() => useTenantApiUrl()).result.current('/security/mfa/enroll')).toBe(
            '/api/t/from-route/security/mfa/enroll',
        );
    });

    it('refuses the workspace context itself', () => {
        expect(() => renderHook(() => useTenantContext())).toThrow('useTenantContext must be used within a TenantProvider');
    });
});
