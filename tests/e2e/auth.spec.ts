/**
 * E2E tests for the authentication flow and the middleware auth guard.
 *
 * Copied from inflect-compliance `tests/e2e/auth.spec.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The parent signed in as the
 * seeded `admin@acme.com`; Islestone has no seed, so each signed-in case uses
 * the `isolatedTenant` fixture (a workspace registered for that test). It
 * lands on the workspace page `/t/<slug>` rather than a dashboard, and the
 * protected paths it probes are Islestone's (`/t/<slug>`, the admin members
 * API) rather than the compliance pages. The OAuth buttons render only for a
 * provider whose client id is configured; the Playwright server sets none.
 */
import type { Cookie } from '@playwright/test';

import { gotoLoginReady, LANDING_URL, safeGoto, submitCredentials } from './e2e-utils';
import { expect, test } from './fixtures';

test.describe('Authentication flow', () => {
    test('login page shows the credentials form, and no OAuth button without a configured provider', async ({ page }) => {
        await gotoLoginReady(page);

        await expect(page.locator('#credentials-form input[type="email"][name="email"]')).toBeVisible();
        await expect(page.locator('#credentials-form input[type="password"]')).toBeVisible();
        await expect(page.getByText('Continue with Google')).toHaveCount(0);
        await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
    });

    test('credentials sign-in lands on the workspace page, which names the workspace and the role', async ({
        page,
        isolatedTenant,
    }) => {
        await gotoLoginReady(page);
        await submitCredentials(page, isolatedTenant.ownerEmail, isolatedTenant.ownerPassword);
        await page.waitForURL(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

        expect(new URL(page.url()).pathname).toBe(`/t/${isolatedTenant.tenantSlug}`);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1 })).toHaveText(isolatedTenant.tenantName);
        await expect(main.getByText('You are signed in as Owner.')).toBeVisible();
    });

    test('a wrong password stays on the login page and signs nobody in', async ({ page, isolatedTenant }) => {
        await gotoLoginReady(page);
        await submitCredentials(page, isolatedTenant.ownerEmail, `${isolatedTenant.ownerPassword}-wrong`);
        await expect(page.getByText('Invalid credentials')).toBeVisible({ timeout: 30_000 });
        expect(new URL(page.url()).pathname).toBe('/login');

        const session = await page.evaluate(async () => (await fetch('/api/auth/session')).json());
        expect(session?.user).toBeUndefined();
    });

    test('the session cookie is httpOnly and SameSite=Lax', async ({ authedPage, context }) => {
        expect(authedPage.url()).toMatch(LANDING_URL);
        const cookies = await context.cookies();
        const sessionCookie = cookies.find(
            (c: Cookie) => c.name === 'next-auth.session-token' || c.name === '__Secure-next-auth.session-token',
        );

        expect(sessionCookie).toBeDefined();
        expect(sessionCookie!.httpOnly).toBe(true);
        expect(sessionCookie!.sameSite).toBe('Lax');
    });

    test('without the session cookie the workspace page sends the browser to login', async ({
        authedPage,
        context,
        isolatedTenant,
    }) => {
        await context.clearCookies();

        await authedPage.goto(`/t/${isolatedTenant.tenantSlug}`);
        await authedPage.waitForURL('**/login**', { timeout: 15_000 });
        expect(new URL(authedPage.url()).pathname).toBe('/login');
    });

    test('unauthenticated access to a workspace redirects to /login with the next param', async ({ page }) => {
        await page.goto('/t/some-workspace');
        await page.waitForURL('**/login**', { timeout: 15_000 });
        const url = new URL(page.url());
        expect(url.pathname).toBe('/login');
        expect(url.searchParams.get('next')).toBe('/t/some-workspace');
    });

    test('the session API exposes no tokens', async ({ authedPage, isolatedTenant }) => {
        const sessionResponse = await authedPage.evaluate(async () => (await fetch('/api/auth/session')).json());

        const sessionStr = JSON.stringify(sessionResponse);
        for (const field of ['access_token', 'refresh_token', 'accessToken', 'refreshToken']) {
            expect(sessionStr).not.toContain(`"${field}"`);
        }
        expect(sessionResponse.user.email).toBe(isolatedTenant.ownerEmail);
    });
});

test.describe('Middleware auth guard', () => {
    test('an unauthenticated API request gets 401 JSON, not a redirect', async ({ request }) => {
        const response = await request.get('/api/t/some-workspace/admin/members', { maxRedirects: 0 });
        expect(response.status()).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized' });
    });

    test('the OWNER reads the members API of their own workspace, and not of another', async ({
        authedPage,
        isolatedTenant,
    }) => {
        const statusOf = (slug: string) =>
            authedPage.evaluate(async (s) => (await fetch(`/api/t/${s}/admin/members`)).status, slug);

        expect(await statusOf(isolatedTenant.tenantSlug)).toBe(200);
        // Not a member: the edge gate refuses before any handler runs.
        expect(await statusOf('a-workspace-this-person-is-not-in')).toBe(403);
    });

    test('/api/auth/session and /api/auth/providers are public', async ({ request }) => {
        expect((await request.get('/api/auth/session')).status()).toBe(200);
        expect((await request.get('/api/auth/providers')).status()).toBe(200);
    });

    test('static assets are not blocked by the middleware', async ({ request }) => {
        const response = await request.get('/favicon.ico', { maxRedirects: 0 });
        // 200 or 404 depending on the asset, but never 401 or a login redirect.
        expect(response.status()).not.toBe(401);
        expect(response.headers()['location']).toBeUndefined();
    });

    test('the workspace picker is behind the gate', async ({ page }) => {
        await safeGoto(page, '/tenants');
        await page.waitForURL('**/login**', { timeout: 15_000 });
        expect(new URL(page.url()).searchParams.get('next')).toBe('/tenants');
    });
});
