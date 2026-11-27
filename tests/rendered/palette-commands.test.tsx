/**
 * Epic 57 — navigation + action commands inside the Command Palette.
 *
 * Verifies the contract for the two curated command buckets:
 *
 *   - Navigation commands (Go to My Work / Inbox / Projects / Views /
 *     Settings) render when a workspace slug is present in the URL, each
 *     carries the expected workspace-scoped `/t/<slug>/<route>` href, and
 *     selecting one calls `router.push()` + closes the palette.
 *
 *   - Action commands (Toggle theme / Sign out, and Ask the assistant
 *     once its launcher registers) invoke the appropriate handler. No
 *     action command issues a destructive operation.
 *
 *   - Both buckets are hidden outside tenant routes (the palette on
 *     /login shows only the keyboard-shortcut discoverability group).
 *
 *   - Typing into the palette filters commands by label, by the English
 *     name and by match-only keywords that never render.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7) and rewritten with Islestone's command table: the
 * compliance and agentic rows (and their vocabulary cases) are gone, and
 * the filter-trigger source checks belong with the filter (sub-phase 1.2).
 */

import React from 'react';
import {
    render,
    renderHook,
    fireEvent,
    act,
    screen,
    waitFor,
} from '@testing-library/react';

// Shared mocks — populated per-test.
const navigationMock = {
    pathname: '/t/acme-corp/my-work',
    push: jest.fn(),
};
const signOutMock = jest.fn();
const toggleThemeMock = jest.fn();

jest.mock('next/navigation', () => ({
    usePathname: () => navigationMock.pathname,
    useRouter: () => ({
        push: (href: string) => navigationMock.push(href),
        replace: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        refresh: jest.fn(),
        prefetch: jest.fn(),
    }),
}));

jest.mock('next-auth/react', () => ({
    signOut: (opts: unknown) => {
        signOutMock(opts);
        return Promise.resolve();
    },
}));

// Stub `useTheme` so we don't need the real ThemeProvider tree just
// to exercise the action handler.
jest.mock('@/components/theme/ThemeProvider', () => ({
    useTheme: () => ({
        theme: 'dark',
        setTheme: jest.fn(),
        toggle: () => toggleThemeMock(),
    }),
    ThemeProvider: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
}));


import { KeyboardShortcutProvider } from '@/lib/hooks/use-keyboard-shortcut';

import {
    CommandPalette,
    CommandPaletteProvider,
    useCommandPalette,
} from '@/components/command-palette';
import {
    filterPaletteCommands,
    usePaletteCommands,
    type PaletteCommand,
} from '@/components/command-palette/use-palette-commands';
import { RegisterPaletteWorkspaceAccess, useRegisterPaletteTimerAction } from '@/components/command-palette/workspace-access';
import { getPermissionsForRole } from '@/lib/permissions';
import { TenantProvider } from '@/lib/tenant-context-provider';
import type { Role } from '@prisma/client';

import { makeRequestContext } from '../helpers/make-context';

/** The shell's registration of the member's access, for a workspace and role. */
function MemberAccess({ role, slug = 'acme-corp' }: { role: Role; slug?: string }) {
    return (
        <TenantProvider
            value={{
                userId: 'u1',
                tenantId: 't1',
                tenantSlug: slug,
                tenantName: 'Acme',
                role,
                membershipRole: role,
                permissions: makeRequestContext(role).permissions,
                appPermissions: getPermissionsForRole(role),
            }}
        >
            <RegisterPaletteWorkspaceAccess />
        </TenantProvider>
    );
}

// Render an auto-opened palette for each test.
function Shell({ children }: { children?: React.ReactNode }) {
    // Test-only inner component: opens the palette imperatively
    // after the provider mounts. Defined inline so it can call
    // useCommandPalette() under the just-mounted provider.

    function OpenOnMount() {
        const { open } = useCommandPalette();
        React.useEffect(() => {
            open();
        }, [open]);
        return null;
    }
    return (
        <KeyboardShortcutProvider>
            <CommandPaletteProvider>
                {/* eslint-disable-next-line react-hooks/static-components */}
                <OpenOnMount />
                {children}
                <CommandPalette />
            </CommandPaletteProvider>
        </KeyboardShortcutProvider>
    );
}

beforeEach(() => {
    navigationMock.pathname = '/t/acme-corp/my-work';
    navigationMock.push.mockReset();
    signOutMock.mockReset();
    toggleThemeMock.mockReset();
    // Stub fetch so the entity-search hook doesn't error when an
    // incidental query triggers it.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ items: [] }),
    }));
});

afterEach(() => {
    delete (global as unknown as { fetch?: unknown }).fetch;
});

// ─── Navigation ───────────────────────────────────────────────────────

/** The rows every member gets; Settings follows `mayOpenSettings` (below). */
const NAV_IDS = ['nav:my-work', 'nav:inbox', 'nav:work-items', 'nav:projects', 'nav:cycles', 'nav:roadmap', 'nav:goals', 'nav:initiatives', 'nav:forms', 'nav:views'];

describe('Command Palette — navigation commands', () => {
    it('renders one row per shell destination, in sidebar order', () => {
        render(<Shell />);
        const rows = Array.from(
            document.querySelectorAll('[data-testid^="command-palette-nav-nav:"]'),
        ).map((r) => r.getAttribute('data-testid'));
        expect(rows).toEqual(NAV_IDS.map((id) => `command-palette-nav-${id}`));
    });

    it('each navigation row carries a workspace-scoped href', () => {
        render(<Shell />);
        const hrefs = Array.from(
            document.querySelectorAll('[data-testid^="command-palette-nav-nav:"]'),
        ).map((row) => row.getAttribute('data-href'));
        expect(hrefs).toEqual([
            '/t/acme-corp/my-work',
            '/t/acme-corp/inbox',
            '/t/acme-corp/work-items',
            '/t/acme-corp/projects',
            '/t/acme-corp/cycles',
            '/t/acme-corp/roadmap',
            '/t/acme-corp/roadmap/goals',
            '/t/acme-corp/roadmap/initiatives',
            '/t/acme-corp/forms',
            '/t/acme-corp/views',
        ]);
    });

    it('selecting a navigation command calls router.push and closes the palette', async () => {
        const { queryByTestId } = render(<Shell />);
        const row = document.querySelector('[data-testid="command-palette-nav-nav:projects"]')!;
        fireEvent.click(row);
        expect(navigationMock.push).toHaveBeenCalledWith('/t/acme-corp/projects');
        await waitFor(() => {
            expect(queryByTestId('command-palette-input')).toBeNull();
        });
    });

    it('no navigation rows render outside a workspace route', () => {
        navigationMock.pathname = '/login';
        render(<Shell />);
        expect(document.querySelectorAll('[data-testid^="command-palette-nav-nav:"]').length).toBe(0);
    });

    it('filters commands by label when the user types', async () => {
        render(<Shell />);
        const input = document.querySelector('[data-testid="command-palette-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'inbox' } });

        await waitFor(() => {
            expect(document.querySelector('[data-testid="command-palette-nav-nav:inbox"]')).not.toBeNull();
        });
        expect(document.querySelector('[data-testid="command-palette-nav-nav:projects"]')).toBeNull();
    });
});

// ─── Settings: only for a member who may open it (owner decision) ───────

describe('Command Palette — the Settings row', () => {
    const settingsRow = () => document.querySelector('[data-testid="command-palette-nav-nav:settings"]');

    it('lists Settings for an OWNER, from the shell-registered answer', async () => {
        render(
            <Shell>
                <MemberAccess role="OWNER" />
            </Shell>,
        );
        await waitFor(() => expect(settingsRow()).not.toBeNull());
        expect(settingsRow()!.getAttribute('data-href')).toBe('/t/acme-corp/settings');
    });

    it('lists Settings for an ADMIN', async () => {
        render(
            <Shell>
                <MemberAccess role="ADMIN" />
            </Shell>,
        );
        await waitFor(() => expect(settingsRow()).not.toBeNull());
    });

    it.each(['VIEWER', 'MEMBER', 'GUEST'] as Role[])('does not list Settings for a %s', async (role) => {
        render(
            <Shell>
                <MemberAccess role={role} />
            </Shell>,
        );
        // The other destinations are there, so the palette did render.
        await waitFor(() =>
            expect(document.querySelector('[data-testid="command-palette-nav-nav:projects"]')).not.toBeNull(),
        );
        expect(settingsRow()).toBeNull();
    });

    it('does not list Settings when no shell has registered (fail closed)', () => {
        render(<Shell />);
        expect(document.querySelector('[data-testid="command-palette-nav-nav:my-work"]')).not.toBeNull();
        expect(settingsRow()).toBeNull();
    });

    it("ignores an OWNER's answer registered for another workspace", () => {
        render(
            <Shell>
                <MemberAccess role="OWNER" slug="globex" />
            </Shell>,
        );
        expect(settingsRow()).toBeNull();
    });
});

// ─── Time (3.4b): the entry and the timer's actions ───────────────────

/** The top chrome's timer and an item's Time panel registering their actions, inside the workspace. */
function TimerActions({ stop, start }: { stop?: () => void; start?: () => void }) {
    function Register() {
        useRegisterPaletteTimerAction('stop', React.useMemo(() => (stop ? { key: 'ISL-7', run: stop } : null), []));
        useRegisterPaletteTimerAction('start', React.useMemo(() => (start ? { key: 'ISL-9', run: start } : null), []));
        return null;
    }
    return (
        <TenantProvider
            value={{
                userId: 'u1',
                tenantId: 't1',
                tenantSlug: 'acme-corp',
                tenantName: 'Acme',
                role: 'MEMBER',
                membershipRole: 'MEMBER',
                permissions: makeRequestContext('MEMBER').permissions,
                appPermissions: getPermissionsForRole('MEMBER'),
            }}
        >
            {/* eslint-disable-next-line react-hooks/static-components */}
            <Register />
        </TenantProvider>
    );
}

describe('Command Palette — time (3.4b)', () => {
    const timeRow = () => document.querySelector('[data-testid="command-palette-nav-nav:time"]');

    it('lists My time for a member who records time, and Time totals for a Viewer (3.4d)', async () => {
        const { unmount } = render(
            <Shell>
                <MemberAccess role="MEMBER" />
            </Shell>,
        );
        await waitFor(() => expect(timeRow()).not.toBeNull());
        expect(timeRow()!.getAttribute('data-href')).toBe('/t/acme-corp/time');
        unmount();
        render(
            <Shell>
                <MemberAccess role="VIEWER" />
            </Shell>,
        );
        await waitFor(() => expect(document.querySelector('[data-testid="command-palette-nav-nav:projects"]')).not.toBeNull());
        // A Viewer holds time.view alone: the Time entry opens on Time totals.
        await waitFor(() => expect(timeRow()).not.toBeNull());
        expect(timeRow()!.getAttribute('data-href')).toBe('/t/acme-corp/time/totals');
        expect(timeRow()).toHaveTextContent('Go to Time totals');
    });

    it('offers Stop timer and Start timer on the open item while they are registered, and runs them', async () => {
        const stop = jest.fn();
        const start = jest.fn();
        render(
            <Shell>
                <TimerActions stop={stop} start={start} />
            </Shell>,
        );
        expect(await screen.findByText('Stop timer')).toBeInTheDocument();
        expect(screen.getByText('Start timer on ISL-9')).toBeInTheDocument();
        fireEvent.click(document.querySelector('[data-testid="command-palette-action-action:stop-timer"]')!);
        // The palette defers the action by a microtask.
        await act(async () => {
            await Promise.resolve();
        });
        await waitFor(() => expect(stop).toHaveBeenCalled());
    });

    it('offers no timer action when none is registered', () => {
        render(<Shell />);
        expect(screen.queryByText('Stop timer')).toBeNull();
        expect(screen.queryByText(/Start timer on/)).toBeNull();
    });
});

// ─── Actions ──────────────────────────────────────────────────────────

describe('Command Palette — action commands', () => {
    it('renders exactly the two safe, universal actions while no assistant is mounted', () => {
        render(<Shell />);
        const ids = Array.from(
            document.querySelectorAll('[data-testid^="command-palette-action-action:"]'),
        ).map((a) => a.getAttribute('data-testid'));
        expect(ids.sort()).toEqual([
            'command-palette-action-action:sign-out',
            'command-palette-action-action:toggle-theme',
        ]);
    });

    it('selecting "Toggle theme" invokes the theme hook and closes the palette', async () => {
        const { queryByTestId } = render(<Shell />);
        fireEvent.click(document.querySelector('[data-testid="command-palette-action-action:toggle-theme"]')!);

        await waitFor(() => {
            expect(queryByTestId('command-palette-input')).toBeNull();
        });
        // handleAction defers invocation by a microtask — flush.
        await act(async () => {
            await Promise.resolve();
        });
        expect(toggleThemeMock).toHaveBeenCalledTimes(1);
    });

    it('selecting "Sign out" calls next-auth signOut with the login callback', async () => {
        const { queryByTestId } = render(<Shell />);
        fireEvent.click(document.querySelector('[data-testid="command-palette-action-action:sign-out"]')!);

        await waitFor(() => {
            expect(queryByTestId('command-palette-input')).toBeNull();
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(signOutMock).toHaveBeenCalledTimes(1);
        expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' });
    });

    it('actions do not render outside a workspace route', () => {
        navigationMock.pathname = '/login';
        render(<Shell />);
        expect(document.querySelectorAll('[data-testid^="command-palette-action-action:"]').length).toBe(0);
    });
});

// ─── Matching: label, English name, keywords ──────────────────────────

/**
 * `filterPaletteCommands` is the whole command-matching mechanism (cmdk's
 * own filter is off). Every assertion states the EXACT id set, never a
 * non-empty count: a predicate mutated to a pass-through satisfies every
 * "the word finds something" phrasing at once.
 */
describe('Command Palette — matching', () => {
    function paletteCommands(): PaletteCommand[] {
        const { result } = renderHook(() => usePaletteCommands('acme-corp'));
        return result.current;
    }

    function idsMatching(query: string): string[] {
        return filterPaletteCommands(paletteCommands(), query).map((c) => c.id);
    }

    it('an empty query returns every command', () => {
        expect(idsMatching('')).toEqual([...NAV_IDS, 'action:toggle-theme', 'action:sign-out']);
    });

    it('"notifications" reaches the Inbox through its keyword', () => {
        expect(idsMatching('notifications')).toEqual(['nav:inbox']);
    });

    it('"dark" reaches the theme toggle through its keyword', () => {
        expect(idsMatching('dark')).toEqual(['action:toggle-theme']);
    });

    it('a query matching nothing still returns nothing', () => {
        // Load-bearing negative control: without it, a predicate mutated
        // to `() => true` passes every assertion above.
        expect(idsMatching('zzzznotathing')).toEqual([]);
    });

    it('keywords match but never render — the row still reads by destination', async () => {
        render(<Shell />);
        const input = document.querySelector('[data-testid="command-palette-input"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'notifications' } });

        await waitFor(() => {
            expect(document.querySelector('[data-testid="command-palette-nav-nav:inbox"]')).not.toBeNull();
        });
        const text = document.querySelector('[data-testid="command-palette-nav-nav:inbox"]')!.textContent ?? '';
        expect(text).toContain('Go to Inbox');
        expect(text.toLowerCase()).not.toContain('notifications');
        expect(document.querySelector('[data-testid="command-palette-nav-nav:projects"]')).toBeNull();
    });
});
