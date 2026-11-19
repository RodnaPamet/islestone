/** @jest-environment jsdom */

/**
 * The role under the user's name in the sidebar is a label, as the workspace
 * switcher beside it shows it — never the stored enum (inflect-compliance
 * #5309).
 *
 * Uses the repo-wide next-intl mock, which resolves keys against the real
 * English catalogue, so `MEMBER` reading "Member" is the catalogue's word.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7): Islestone's roles; the org sidebar's half is not ported
 * (the org shell is sub-phase 8.3).
 */
import * as React from 'react';
import { render } from '@testing-library/react';

import en from '../../messages/en.json';

jest.mock('next/navigation', () => ({
    useParams: () => ({ tenantSlug: 'acme' }),
    useSearchParams: () => new URLSearchParams(),
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    usePathname: () => '/t/acme/my-work',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
}));

import type { Role } from '@prisma/client';

import { SidebarContent } from '@/components/layout/SidebarNav';
import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';
import { TenantProvider, type TenantContextValue } from '@/lib/tenant-context-provider';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../helpers/make-context';

function tenant(role: Role): TenantContextValue {
    return {
        userId: 'user-1',
        tenantId: 'tenant-1',
        tenantSlug: 'acme',
        tenantName: 'Acme',
        role,
        membershipRole: role,
        permissions: makeRequestContext(role).permissions,
        appPermissions: getPermissionsForRole(role),
    };
}

describe('the role under the user in the sidebar', () => {
    test.each(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'] as Role[])('a %s membership reads by its label', (role) => {
        const { container } = render(
            <KeyboardShortcutProvider>
                <TenantProvider value={tenant(role)}>
                    <SidebarContent user={{ name: 'Ada' }} onLogout={() => {}} />
                </TenantProvider>
            </KeyboardShortcutProvider>,
        );
        const lines = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
        expect(lines).toContain(en.roles[role]);
        expect(lines).not.toContain(role);
    });
});
