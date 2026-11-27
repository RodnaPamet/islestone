/** @jest-environment jsdom */

/**
 * The application shell as a member meets it (sub-phase 1.7): the real
 * `<Providers>` (palette, shortcuts, theme, tooltips), the workspace's
 * `TenantProvider` and `AppShell` (sidebar, top chrome), around a placeholder
 * page.
 *
 *   - the landmarks: one banner, the main navigation, one main;
 *   - the sidebar lists the shell's destinations (ADR 0006: My Work, Inbox,
 *     Projects, Cycles, Views) as workspace links, marks the current page, and shows
 *     Settings only to a member who may open it;
 *   - the command palette opens from the keyboard (Ctrl+K) and from the
 *     sidebar's search row, and lists the same destinations, Settings only
 *     for a member who may open it;
 *   - sign-out goes through the auth seam to /login;
 *   - jest-axe finds no violation in the shell, or in the open palette.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import * as React from 'react';

import type { Role } from '@prisma/client';

const mockSignOut = jest.fn();
jest.mock('next-auth/react', () => ({
    signOut: (opts: unknown) => {
        mockSignOut(opts);
        return Promise.resolve();
    },
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
    usePathname: () => '/t/acme/my-work',
    useParams: () => ({ tenantSlug: 'acme' }),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
}));

// The toast host animates; it is not what this suite is about.
jest.mock('sonner', () => ({ Toaster: () => null, toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

import { Providers } from '@/app/providers';
import { AppShell } from '@/components/layout/AppShell';
import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { getPermissionsForRole } from '@/lib/permissions';
import { TenantProvider } from '@/lib/tenant-context-provider';

import { makeRequestContext } from '../helpers/make-context';

const fetchMock = jest.fn();

beforeEach(() => {
    mockSignOut.mockReset();
    mockPush.mockReset();
    fetchMock.mockReset();
    // The bell's list: empty.
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => [] }));
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

function renderShell(role: Role = 'OWNER') {
    return render(
        <Providers>
            <TenantProvider
                value={{
                    userId: 'u-ada',
                    tenantId: 'tenant-1',
                    tenantSlug: 'acme',
                    tenantName: 'Acme',
                    role,
                    membershipRole: role,
                    permissions: makeRequestContext(role).permissions,
                    appPermissions: getPermissionsForRole(role),
                }}
            >
                <AppShell
                    user={{
                        name: 'Ada Lovelace',
                        email: 'ada@example.com',
                        image: null,
                        memberships: [
                            { slug: 'acme', role, tenantId: 'tenant-1' },
                            { slug: 'globex', role: 'MEMBER', tenantId: 'tenant-2' },
                        ],
                        orgMemberships: [],
                    }}
                    appName="Islestone"
                >
                    <PlaceholderPage
                        title="My Work"
                        emptyTitle="Not here yet"
                        body="Your work items will gather here."
                        testId="placeholder-my-work"
                    />
                </AppShell>
            </TenantProvider>
        </Providers>,
    );
}

/** Let the bell's mount-time fetch settle. */
async function settle() {
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {});
}

describe('the application shell', () => {
    it('renders one banner, the main navigation and one main landmark around the page', async () => {
        const { container } = renderShell();
        await settle();
        // The top chrome's explicit banner. (jsdom's role computation also
        // counts the page header's <header>, which sits inside <main> and
        // so is not a banner to a browser or to axe.)
        expect(container.querySelectorAll('[role="banner"]')).toHaveLength(1);
        expect(screen.getByRole('main').querySelector('[role="banner"]')).toBeNull();
        expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
        const main = screen.getByRole('main');
        expect(within(main).getByTestId('placeholder-my-work')).toBeInTheDocument();
        expect(within(main).getByRole('heading', { level: 1, name: 'My Work' })).toBeInTheDocument();
    });

    it('lists the shell destinations as workspace links and marks the current page', async () => {
        renderShell();
        await settle();
        const nav = screen.getByRole('navigation', { name: 'Main navigation' });
        const links = within(nav).getAllByRole('link');
        expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
            ['My Work', '/t/acme/my-work'],
            ['Inbox', '/t/acme/inbox'],
            ['Time', '/t/acme/time'],
            ['Work items', '/t/acme/work-items'],
            ['Projects', '/t/acme/projects'],
            ['Cycles', '/t/acme/cycles'],
            // Decision 222: one Roadmap entry, opening the Roadmap page (3.2c).
            ['Roadmap', '/t/acme/roadmap'],
            ['Workload', '/t/acme/workload'],
            ['Analytics', '/t/acme/analytics'],
            // Sub-phase 2.6a: Intake (an OWNER reads intake) and Forms.
            ['Intake', '/t/acme/intake'],
            ['Forms', '/t/acme/forms'],
            ['Views', '/t/acme/views'],
        ]);
        expect(within(nav).getByRole('link', { name: 'My Work', current: 'page' })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current');
        // The section eyebrow names the workspace group.
        expect(within(nav).getByText('Workspace')).toBeInTheDocument();
    });

    it('shows Settings to an owner and hides it from a member', async () => {
        const { unmount } = renderShell('OWNER');
        await settle();
        expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/t/acme/settings');
        unmount();

        renderShell('MEMBER');
        await settle();
        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    });

    it('names the open workspace in the switcher and the role under the member', async () => {
        renderShell();
        await settle();
        expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
        expect(screen.getByText('Owner')).toBeInTheDocument();
    });

    it('opens the command palette with Ctrl+K, listing the same destinations', async () => {
        renderShell();
        await settle();
        expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
        const ids = Array.from(dialog.querySelectorAll('[data-testid^="command-palette-nav-nav:"]')).map((r) =>
            r.getAttribute('data-href'),
        );
        expect(ids).toEqual([
            '/t/acme/my-work',
            '/t/acme/inbox',
            '/t/acme/time',
            '/t/acme/work-items',
            '/t/acme/projects',
            '/t/acme/cycles',
            '/t/acme/roadmap',
            '/t/acme/roadmap/goals',
            '/t/acme/roadmap/initiatives',
            '/t/acme/forms',
            '/t/acme/views',
            '/t/acme/settings',
        ]);

        fireEvent.click(within(dialog).getByText('Go to Projects'));
        expect(mockPush).toHaveBeenCalledWith('/t/acme/projects');
    });

    it("lists Settings in the palette only for a member who may open it", async () => {
        renderShell('VIEWER');
        await settle();
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
        expect(within(dialog).getByText('Go to Projects')).toBeInTheDocument();
        expect(within(dialog).queryByText('Go to Settings')).toBeNull();
        expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    });

    it("opens the palette from the sidebar's search row", async () => {
        renderShell();
        await settle();
        fireEvent.click(screen.getByTestId('sidebar-search-anchor'));
        expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    });

    it('signs out through the auth seam, to /login', async () => {
        renderShell();
        await settle();
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' }));
    });

    it('has no axe violations', async () => {
        const { container } = renderShell();
        await settle();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations with the palette open', async () => {
        renderShell();
        await settle();
        fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
        await screen.findByRole('dialog', { name: 'Command palette' });
        expect(await axe(document.body)).toHaveNoViolations();
    });
});
