import type { APIResponse, Response } from '@playwright/test';
import { expect, test } from '@playwright/test';

function expectSecurityHeaders(headers: Record<string, string>) {
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    // `next start` serves a production build.
    expect(headers['strict-transport-security']).toMatch(/^max-age=\d+; includeSubDomains$/);
    expect(headers).not.toHaveProperty('x-powered-by');
}

const headersOf = (response: Response | APIResponse | null) => response?.headers() ?? {};

test('the home page loads and names the product', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Islestone');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Islestone');
    expectSecurityHeaders(headersOf(response));
});

test('/api/livez answers 200', async ({ request }) => {
    const response = await request.get('/api/livez');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expectSecurityHeaders(headersOf(response));
});

// Sub-phase 1.5: the policy carries a per-request script nonce, and the page
// still hydrates under it. A policy Next.js could not stamp its scripts for
// (no Content-Security-Policy on the request) would block every chunk under
// 'strict-dynamic', and the browser would report each one.
test('the sign-in page hydrates under a nonce policy, with no CSP violation', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) violations.push(msg.text());
    });

    const response = await page.goto('/login');
    const csp = headersOf(response)['content-security-policy'] ?? '';
    const nonce = csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");

    // The scripts Next.js rendered carry that nonce.
    const scriptNonces = await page.locator('script[src]').evaluateAll((els) =>
        els.map((el) => (el as HTMLScriptElement).nonce),
    );
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(scriptNonces.every((n) => n === nonce)).toBe(true);

    // Every chunk has loaded and run; a refused one would be a violation.
    // (auth.spec.ts signs in through this form, which needs it hydrated.)
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    expect(violations).toEqual([]);

    // A second request gets a different nonce.
    const again = await page.goto('/login');
    expect(headersOf(again)['content-security-policy']).not.toContain(`'nonce-${nonce}'`);
});
