/** @jest-environment jsdom */

/**
 * Owner decision 204: until roadmap 8.4 a GUEST holds no key, so the sidebar
 * offers it only what it may open, My Work (which tells it it has no access
 * yet) and the Inbox (its own notifications). Every workspace-wide role keeps
 * the workspace rows. The pages refuse on the server whatever the sidebar
 * shows; this is the filter that keeps a refused row off it.
 */
import * as React from 'react';
import { render } from '@testing-library/react';

let mockPathname = '/t/acme/my-work';
jest.mock('next/navigation', () => ({
    useParams: () => ({ tenantSlug: 'acme' }),
    useSearchParams: () => new URLSearchParams(),
    useSelectedLayoutSegment: () => null,
    useSelectedLayoutSegments: () => [],
    usePathname: () => mockPathname,
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

function navKeys(role: Role): string[] {
    const { container } = render(
        <KeyboardShortcutProvider>
            <TenantProvider value={tenant(role)}>
                <SidebarContent user={{ name: 'Ada' }} onLogout={() => {}} />
            </TenantProvider>
        </KeyboardShortcutProvider>,
    );
    return Array.from(container.querySelectorAll('[data-testid^="nav-"]')).map((el) => el.getAttribute('data-testid') ?? '');
}

// The Roadmap entry opens the Roadmap page (3.2c), and a row's test id is its href's last segment.
const WORKSPACE_ROWS = ['nav-work-items', 'nav-projects', 'nav-cycles', 'nav-roadmap', 'nav-forms', 'nav-views'];

describe('the sidebar a GUEST sees before 8.4 (decision 204)', () => {
    it('lists My Work and the Inbox and nothing of the workspace', () => {
        expect(navKeys('GUEST')).toEqual(['nav-my-work', 'nav-inbox', 'nav-logout']);
    });

    it.each(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[])('a %s keeps the workspace rows', (role) => {
        expect(navKeys(role)).toEqual(expect.arrayContaining(['nav-my-work', 'nav-inbox', ...WORKSPACE_ROWS]));
    });
});

describe('the Roadmap entry (decision 222)', () => {
    afterEach(() => {
        mockPathname = '/t/acme/my-work';
    });

    it.each(['/t/acme/roadmap', '/t/acme/roadmap/goals', '/t/acme/roadmap/initiatives', '/t/acme/roadmap/initiatives/i-1'])('is the current page on %s', (path) => {
        mockPathname = path;
        const { container } = render(
            <KeyboardShortcutProvider>
                <TenantProvider value={tenant('MEMBER')}>
                    <SidebarContent user={{ name: 'Ada' }} onLogout={() => {}} />
                </TenantProvider>
            </KeyboardShortcutProvider>,
        );
        const entry = container.querySelector('[data-testid="nav-roadmap"]');
        expect(entry).toHaveAttribute('href', '/t/acme/roadmap');
        expect(entry).toHaveAttribute('aria-current', 'page');
    });
});

describe('the Time entry (3.4b, decision 265)', () => {
    afterEach(() => {
        mockPathname = '/t/acme/my-work';
    });

    it('shows to a holder of time.track and not to a Viewer, who records no time', () => {
        expect(navKeys('MEMBER')).toContain('nav-time');
        expect(navKeys('OWNER')).toContain('nav-time');
        expect(navKeys('VIEWER')).not.toContain('nav-time');
    });

    it('is the current page under /time', () => {
        mockPathname = '/t/acme/time';
        const { container } = render(
            <KeyboardShortcutProvider>
                <TenantProvider value={tenant('MEMBER')}>
                    <SidebarContent user={{ name: 'Ada' }} onLogout={() => {}} />
                </TenantProvider>
            </KeyboardShortcutProvider>,
        );
        const entry = container.querySelector('[data-testid="nav-time"]');
        expect(entry).toHaveAttribute('href', '/t/acme/time');
        expect(entry).toHaveAttribute('aria-current', 'page');
    });
});

describe('the Workload entry (3.5a, decisions 297 and 298)', () => {
    it('shows to every holder of workload.view, a Viewer too, and never to a guest', () => {
        expect(navKeys('MEMBER')).toContain('nav-workload');
        expect(navKeys('VIEWER')).toContain('nav-workload');
        expect(navKeys('OWNER')).toContain('nav-workload');
        expect(navKeys('GUEST')).not.toContain('nav-workload');
    });
});

describe('the Analytics entry (3.6a, decisions 324 and 329)', () => {
    it('shows to every holder of analytics.view, a Viewer too, and never to a guest', () => {
        expect(navKeys('MEMBER')).toContain('nav-analytics');
        expect(navKeys('VIEWER')).toContain('nav-analytics');
        expect(navKeys('OWNER')).toContain('nav-analytics');
        expect(navKeys('GUEST')).not.toContain('nav-analytics');
    });
});
