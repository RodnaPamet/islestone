/**
 * The application shell, in a browser against the built app (sub-phase 1.7).
 *
 * A signed-in member:
 *   1. lands on My Work inside the shell: the banner, the main navigation
 *      (My Work, Inbox, Projects, Views) and, for an owner, Settings;
 *   2. navigates from the sidebar, and every destination renders (no 404);
 *   3. opens the command palette with the keyboard (Ctrl+K) and goes
 *      somewhere from it;
 *   4. switches workspace from the top chrome's switcher, after joining a
 *      second workspace by invitation;
 *   5. cannot open another workspace's shell by its slug.
 *
 * The shell also hydrates under the CSP nonce policy (sub-phase 1.5) with
 * its inline theme script.
 *
 * Every case runs on a workspace the spec registers (`isolatedTenant`).
 */
import type { Page } from '@playwright/test';

import { createIsolatedTenant, signInAs, waitForHydration } from './e2e-utils';
import { expect, test } from './fixtures';

/** The sidebar's navigation landmark. */
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

test.describe('Application shell', () => {
    test('a signed-in owner lands on My Work inside the shell', async ({ authedPage, isolatedTenant }) => {
        const page = authedPage;
        expect(new URL(page.url()).pathname).toBe(`/t/${isolatedTenant.tenantSlug}/my-work`);

        await expect(page.locator('header[role="banner"]')).toBeVisible();
        const nav = mainNav(page);
        await expect(nav).toBeVisible();
        for (const [label, route] of [
            ['My Work', 'my-work'],
            ['Inbox', 'inbox'],
            ['Projects', 'projects'],
            ['Views', 'views'],
        ] as const) {
            await expect(nav.getByRole('link', { name: label })).toHaveAttribute(
                'href',
                `/t/${isolatedTenant.tenantSlug}/${route}`,
            );
        }
        await expect(nav.getByRole('link', { name: 'My Work' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('My Work');
    });

    test('the shell hydrates under the nonce policy, with no CSP violation', async ({ authedPage }) => {
        const violations: string[] = [];
        authedPage.on('console', (msg) => {
            if (/Content Security Policy|Refused to (execute|load|apply)/i.test(msg.text())) violations.push(msg.text());
        });
        await authedPage.reload();
        await waitForHydration(authedPage, 'aside');
        // The theme's pre-paint script ran: the page carries a theme.
        await expect(authedPage.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);
        expect(violations).toEqual([]);
    });

    test('every sidebar destination renders', async ({ authedPage, isolatedTenant }) => {
        const page = authedPage;
        await waitForHydration(page, 'aside');
        for (const [label, route] of [
            ['Inbox', 'inbox'],
            ['Projects', 'projects'],
            ['Views', 'views'],
            ['My Work', 'my-work'],
        ] as const) {
            await mainNav(page).getByRole('link', { name: label }).click();
            await page.waitForURL(`**/t/${isolatedTenant.tenantSlug}/${route}`, { timeout: 30_000 });
            await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(label);
            await expect(mainNav(page).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
        }

        await page.getByRole('link', { name: 'Settings' }).click();
        await page.waitForURL(`**/t/${isolatedTenant.tenantSlug}/settings`, { timeout: 30_000 });
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Settings');
    });

    test('the command palette opens with Ctrl+K and navigates', async ({ authedPage, isolatedTenant }) => {
        const page = authedPage;
        await waitForHydration(page, 'aside');

        await page.keyboard.press('Control+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await expect(palette.getByText('Go to Projects')).toBeVisible();

        await page.keyboard.type('inbox');
        await expect(palette.getByText('Go to Inbox')).toBeVisible();
        await expect(palette.getByText('Go to Projects')).toHaveCount(0);
        await page.keyboard.press('Enter');

        await page.waitForURL(`**/t/${isolatedTenant.tenantSlug}/inbox`, { timeout: 30_000 });
        await expect(palette).toBeHidden();
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Inbox');

        // Escape closes it without going anywhere.
        await page.keyboard.press('Control+k');
        await expect(palette).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
    });

    test('a member of two workspaces switches between them from the top chrome', async ({
        authedPage,
        isolatedTenant,
        browser,
        request,
    }) => {
        const page = authedPage;
        const other = await createIsolatedTenant({ request, namePrefix: 'app-shell-other' });

        // The other workspace's owner invites this spec's owner.
        const inviterContext = await browser.newContext();
        let invitePath = '';
        try {
            const inviter = await inviterContext.newPage();
            await signInAs(inviter, other);
            const result = await inviter.evaluate(
                async ({ slug, email }) => {
                    const res = await fetch(`/api/t/${slug}/admin/invites`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, role: 'MEMBER' }),
                    });
                    return { status: res.status, url: (await res.json())?.url as string | undefined };
                },
                { slug: other.tenantSlug, email: isolatedTenant.ownerEmail },
            );
            expect(result.status).toBe(201);
            invitePath = new URL(result.url ?? '', 'http://127.0.0.1').pathname;
        } finally {
            await inviterContext.close();
        }

        // Accepting re-mints the session with the new membership and opens
        // the other workspace.
        await page.goto(invitePath);
        await waitForHydration(page, 'main');
        await page.getByRole('button', { name: /Accept invitation/i }).click();
        await page.waitForURL(`**/t/${other.tenantSlug}/my-work`, { timeout: 60_000 });
        await expect(page.getByTestId('top-chrome-tenant-switcher')).toContainText(other.tenantName);

        // Back to the first workspace through the switcher.
        await waitForHydration(page, '[data-testid="top-chrome-tenant-switcher"]');
        await page.getByTestId('top-chrome-tenant-switcher').click();
        await page.getByTestId(`tenant-switcher-row-${isolatedTenant.tenantSlug}`).click();
        await page.waitForURL(`**/t/${isolatedTenant.tenantSlug}/my-work`, { timeout: 30_000 });
        await expect(page.getByTestId('top-chrome-tenant-switcher')).toContainText(isolatedTenant.tenantName);
    });

    test("another workspace's slug is a 404, not its shell", async ({ authedPage, request }) => {
        const other = await createIsolatedTenant({ request, namePrefix: 'app-shell-stranger' });
        const response = await authedPage.goto(`/t/${other.tenantSlug}/my-work`);
        // The edge refuses a slug the session's memberships do not name.
        expect(new URL(authedPage.url()).pathname).not.toBe(`/t/${other.tenantSlug}/my-work`);
        expect(response?.status() === 404 || new URL(authedPage.url()).pathname === '/no-tenant').toBe(true);
        await expect(authedPage.getByText(other.tenantName)).toHaveCount(0);
    });
});
