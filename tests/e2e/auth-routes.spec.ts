import { expect, test } from '@playwright/test';

/**
 * The NextAuth routes against the built server.
 *
 * Ported from inflect-compliance `tests/integration/auth-routes.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The parent ran these as a Jest
 * suite against a dev server it hoped was running, and passed silently when it
 * was not. Here they run against the server Playwright boots, so they cannot
 * skip. Google and Microsoft are registered only when their client ids are
 * set (the run sets none), so the providers case asserts the credentials
 * provider alone.
 */
const TOKEN_FIELDS = ['access_token', 'refresh_token', 'accessToken', 'refreshToken'];

test.describe('GET /api/auth/session', () => {
    test('answers 200 with JSON and no token fields for an anonymous caller', async ({ request }) => {
        const res = await request.get('/api/auth/session');
        expect(res.status()).toBe(200);
        const text = await res.text();
        const data: unknown = JSON.parse(text);
        expect(data === null || typeof data === 'object').toBe(true);
        for (const field of TOKEN_FIELDS) expect(text).not.toContain(`"${field}"`);
    });
});

test.describe('GET /api/auth/csrf', () => {
    test('returns a non-empty CSRF token', async ({ request }) => {
        const res = await request.get('/api/auth/csrf');
        expect(res.status()).toBe(200);
        const data = (await res.json()) as { csrfToken?: unknown };
        expect(typeof data.csrfToken).toBe('string');
        expect((data.csrfToken as string).length).toBeGreaterThan(0);
    });
});

test.describe('GET /api/auth/providers', () => {
    test('lists the credentials provider, and no OAuth provider without its client id', async ({ request }) => {
        const res = await request.get('/api/auth/providers');
        expect(res.status()).toBe(200);
        const data = (await res.json()) as Record<string, unknown>;
        expect(data.credentials).toBeDefined();
        expect(data.google).toBeUndefined();
        expect(data['microsoft-entra-id']).toBeUndefined();
    });
});
