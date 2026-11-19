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
