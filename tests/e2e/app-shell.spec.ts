/**
 * The application shell, in a browser against the built app (sub-phase 1.7).
 *
 * A signed-in member:
 *   1. lands on My Work inside the shell: the banner, the main navigation
 *      (My Work, Inbox, Projects, Views) and, for an owner, Settings;
 *   2. navigates from the sidebar, and every destination renders (no 404);
 *   3. opens the command palette with the keyboard (Ctrl+K) and goes
 *      somewhere from it, and finds a work item and a project in it (2.7b);
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

    test('the theme follows the OS before first paint, until the person chooses', async ({ authedPage, browser, isolatedTenant }) => {
        // A dark system, nothing stored: the pre-paint script sets dark before
        // the page's scripts hydrate, so the light server baseline never shows.
        const dark = await browser.newContext({ colorScheme: 'dark', storageState: await authedPage.context().storageState() });
        try {
            const page = await dark.newPage();
            await page.goto(`/t/${isolatedTenant.tenantSlug}/my-work`, { waitUntil: 'commit' });
            await page.waitForSelector('html[data-theme]', { state: 'attached' });
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

            // The person picks light in the account menu; it is stored and wins.
            await waitForHydration(page, 'aside');
            await page.getByTestId('top-chrome-user-menu').click();
            await page.getByRole('button', { name: 'Switch to light theme' }).click();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
            await page.reload();
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        } finally {
            await dark.close();
        }

        // A light system: light.
        const light = await browser.newContext({ colorScheme: 'light', storageState: await authedPage.context().storageState() });
        try {
            const page = await light.newPage();
            await page.goto(`/t/${isolatedTenant.tenantSlug}/my-work`);
            await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
        } finally {
            await light.close();
        }
    });

    test('the browser tab carries the placeholder letter icon', async ({ request }) => {
        const res = await request.get('/icon.svg');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('image/svg+xml');
        expect(await res.text()).toContain('>IS</text>');
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
        // An owner may open Settings, so the palette lists it.
        await expect(palette.getByText('Go to Settings')).toBeVisible();

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

    test('the command palette finds work items by title and key, and projects by name (2.7b)', async ({ authedPage, isolatedTenant }) => {
        const page = authedPage;
        const slug = isolatedTenant.tenantSlug;
        const base = `/api/t/${slug}`;
        const team = await page.request.post(`${base}/teams`, { data: { name: 'Palette team' } });
        expect(team.status()).toBe(201);
        const project = await page.request.post(`${base}/projects`, { data: { teamId: (await team.json()).id, name: 'Palette project', keyPrefix: 'PAL' } });
        expect(project.status()).toBe(201);
        const types = (await (await page.request.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
        const item = await page.request.post(`${base}/work-items`, { data: { projectId: (await project.json()).id, typeId: types[0]!.id, title: 'Searchable widget' } });
        expect(item.status()).toBe(201);
        await page.reload();
        await waitForHydration(page, 'aside');

        await page.keyboard.press('Control+k');
        const palette = page.getByRole('dialog', { name: 'Command palette' });
        await expect(palette).toBeVisible();
        await page.keyboard.type('searchable wid');
        const hit = palette.getByTestId('command-palette-result-workItem');
        await expect(hit).toHaveCount(1);
        await expect(hit).toContainText('Searchable widget');
        await expect(hit).toContainText('PAL-1');

        // A key finds its item; a project's name finds the project.
        await palette.getByRole('combobox').fill('pal-1');
        await expect(palette.getByTestId('command-palette-result-workItem')).toContainText('Searchable widget');
        await palette.getByRole('combobox').fill('palette proj');
        await expect(palette.getByTestId('command-palette-result-project')).toContainText('Palette project');

        await palette.getByRole('combobox').fill('searchable');
        await palette.getByTestId('command-palette-result-workItem').click();
        await page.waitForURL(`**/t/${slug}/work-items/PAL-1`, { timeout: 30_000 });
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
