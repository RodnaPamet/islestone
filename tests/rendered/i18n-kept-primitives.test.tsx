/** @jest-environment jsdom */

/**
 * The app shell's primitives render their built-in copy from the catalogue.
 *
 * Every label below was once an English literal inside the component — a JSX
 * text node, an `aria-label="…"`, or a parameter default. They are catalogue
 * keys now (`messages/en.json`, built key by key); this suite is what proves
 * the keys are real. The repo-wide next-intl mock renders a missing key as the
 * key itself, so each exact English sentence below fails on a missing or
 * misplaced key.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (sub-phase 1.7), cut to the shell's primitives (ThemeToggle, NavBar,
 * UserMenu): English only, as Islestone ships one catalogue; the chart, table
 * and form primitives' cases are 1.2's or not ported.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { useTranslations } from 'next-intl';

import { TooltipProvider } from '@inflect/ui/components/ui/tooltip';
import { NavBarBrand, NavBarMobileMenu } from '@/components/layout/nav-bar';
import { UserMenu } from '@/components/layout/user-menu';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

const mockTheme: { current: 'dark' | 'light' } = { current: 'light' };

// ThemeToggle reads `useTheme()`; pinning it keeps both labels reachable
// without the provider's cookie + localStorage side effects.
jest.mock('@/components/theme/ThemeProvider', () => ({
    useTheme: () => ({ theme: mockTheme.current, setTheme: () => {}, toggle: () => {} }),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/t/acme/my-work',
    useParams: () => ({ tenantSlug: 'acme' }),
}));

/**
 * The rows `TopChrome` supplies through `UserMenu`'s `items` slot, with the
 * SAME translation keys. A component because it calls `useTranslations`.
 */
function HostSuppliedRows({ close }: { close: () => void }) {
    const tSecurity = useTranslations('account.security');
    const tNav = useTranslations('nav');
    return (
        <>
            <button type="button" role="menuitem" data-testid="user-menu-account-security" onClick={close}>
                {tSecurity('securityTitle')}
            </button>
            <button type="button" role="menuitem" data-testid="user-menu-sign-out" onClick={close}>
                {tNav('signOut')}
            </button>
        </>
    );
}

describe('the shell primitives render their own copy', () => {
    it.each([
        ['dark', 'Switch to light theme'],
        ['light', 'Switch to dark theme'],
    ] as const)('ThemeToggle (%s): the button name', (theme, english) => {
        mockTheme.current = theme;
        render(
            <TooltipProvider>
                <ThemeToggle />
            </TooltipProvider>,
        );
        expect(screen.getByRole('button', { name: english })).toBeInTheDocument();
    });

    it('NavBar: the brand link and the menu button names', () => {
        render(
            <>
                <NavBarBrand href="/t/acme/my-work" initials="IS" />
                <NavBarMobileMenu onClick={() => {}} />
            </>,
        );
        // The initials are part of the name, not just decoration behind
        // `aria-hidden` — WCAG 2.5.3 compares the accessible name against
        // what a sighted reader SEES, and the glyph is on screen either way.
        expect(screen.getByRole('link').getAttribute('aria-label')).toBe('IS: Islestone — go to My Work');
        expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Open navigation menu');
    });

    it('UserMenu: the trigger, the menu, the name fallback, the theme row and both host rows', async () => {
        render(
            <TooltipProvider>
                <UserMenu
                    displayName={null}
                    displayEmail={null}
                    displayImage={null}
                    showLanguage={false}
                    items={({ close }) => <HostSuppliedRows close={close} />}
                />
            </TooltipProvider>,
        );
        const trigger = screen.getByTestId('top-chrome-user-menu');
        expect(trigger.getAttribute('aria-label')).toBe('Account menu for Account');
        fireEvent.click(trigger);
        const menu = await screen.findByRole('menu');
        expect(menu.getAttribute('aria-label')).toBe('Account menu');
        expect(screen.getByTestId('user-menu-display-name').textContent).toBe('Account');
        expect(screen.getByTestId('user-menu-theme-row').textContent).toContain('Theme');
        expect(screen.queryByTestId('user-menu-language-row')).toBeNull();
        expect(screen.getByTestId('user-menu-account-security').textContent).toBe('Account security');
        expect(screen.getByTestId('user-menu-sign-out').textContent).toBe('Sign out');
    });
});
