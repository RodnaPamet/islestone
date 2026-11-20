/** @jest-environment jsdom */

/**
 * Every destination the shell links to exists (sub-phase 1.7), so no nav
 * link 404s: Inbox and Views are placeholders saying the feature arrives
 * later, in the catalogue's words (My Work and Projects became real pages in
 * 2.3, covered by tests/rendered/work-item-pages.test.tsx); Settings is one too, and
 * asserts on the server the same rule the sidebar's gear reads; the workspace
 * root goes to My Work.
 */
import { render, screen } from '@testing-library/react';

import en from '../../messages/en.json';

jest.mock('next/navigation', () => ({
    usePathname: () => '/t/acme/my-work',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    useParams: () => ({ tenantSlug: 'acme' }),
    redirect: (url: string) => {
        throw new Error(`NEXT_REDIRECT ${url}`);
    },
    notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
    },
}));

// Server-side translations against the real catalogue.
jest.mock('next-intl/server', () => {
    const catalog = jest.requireActual('../../messages/en.json');
    return {
        getTranslations: async (ns: string) => (key: string) =>
            `${ns}.${key}`.split('.').reduce((o: Record<string, unknown>, k) => o?.[k] as Record<string, unknown>, catalog) ??
            key,
    };
});

const mockSession = { userId: 'u-ada', tenantId: 't1', email: 'ada@example.com', role: 'OWNER', membershipTenantIds: ['t1'], mfaPendingTenantIds: [] };
jest.mock('@/lib/auth/session', () => ({ getSessionOrThrow: async () => mockSession }));

const mockContext = jest.fn();
jest.mock('@/lib/server/tenant-context.server', () => ({ getTenantServerContext: (...args: unknown[]) => mockContext(...args) }));

import type { Role } from '@prisma/client';

import InboxPage from '@/app/t/[tenantSlug]/(app)/inbox/page';
import WorkspaceRootPage from '@/app/t/[tenantSlug]/(app)/page';
import SettingsPage from '@/app/t/[tenantSlug]/(app)/settings/page';
import ViewsPage from '@/app/t/[tenantSlug]/(app)/views/page';
import { getPermissionsForRole } from '@/lib/permissions';

const params = Promise.resolve({ tenantSlug: 'acme' });

function contextFor(role: Role) {
    return {
        tenant: { id: 't1', slug: 'acme', name: 'Acme' },
        role,
        membershipRole: role,
        permissions: { canRead: true, canWrite: true, canAdmin: role === 'OWNER' || role === 'ADMIN', canExport: false },
        appPermissions: getPermissionsForRole(role),
    };
}

describe('the placeholder destinations', () => {
    it.each([
        ['Inbox', InboxPage, en.placeholders.inbox],
        ['Views', ViewsPage, en.placeholders.views],
    ] as const)('%s renders its title and says the feature arrives later', async (title, Page, body) => {
        render(await Page());
        expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
        expect(screen.getByText(en.placeholders.title)).toBeInTheDocument();
        expect(screen.getByText(body)).toBeInTheDocument();
    });

    it('the workspace root goes to My Work', async () => {
        await expect(WorkspaceRootPage({ params })).rejects.toThrow('NEXT_REDIRECT /t/acme/my-work');
    });
});

describe('Settings', () => {
    beforeEach(() => mockContext.mockReset());

    it.each(['OWNER', 'ADMIN'] as Role[])('renders for an %s', async (role) => {
        mockContext.mockResolvedValue(contextFor(role));
        render(await SettingsPage({ params }));
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        expect(mockContext).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 'acme', userId: 'u-ada' }));
    });

    it.each(['MEMBER', 'VIEWER', 'GUEST'] as Role[])('is a 404 for a %s', async (role) => {
        mockContext.mockResolvedValue(contextFor(role));
        await expect(SettingsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('is a 404 for a Member whose custom role grants admin.view', async () => {
        const member = contextFor('MEMBER');
        mockContext.mockResolvedValue({
            ...member,
            appPermissions: { ...member.appPermissions, admin: { ...member.appPermissions.admin, view: true } },
        });
        await expect(SettingsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    });
});
