/**
 * Playwright fixtures for declarative per-spec test isolation.
 *
 * Copied from inflect-compliance `tests/e2e/fixtures.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. Islestone has no seeded tenant,
 * so every spec that signs in uses these fixtures; `authedPage` parks on the
 * workspace landing page, My Work (`/t/<slug>/my-work`), and
 * there is no tenant tracker or global teardown.
 *
 * This module extends `test` with two fixtures so a mutating spec
 * gets a FRESH, EMPTY tenant of its own:
 *
 *   - `isolatedTenant` — a `IsolatedTenantCredentials` provisioned
 *     via `createIsolatedTenant()`. Test-scoped: every `test()` in
 *     the spec gets its own brand-new tenant, so a write in one
 *     test can never be observed by — let alone break — another.
 *
 *   - `authedPage` — the standard `page` fixture, already signed in
 *     as the `isolatedTenant`'s OWNER and parked on My Work. The common case: a mutating spec that
 *     wants "a logged-in browser on a clean tenant" with zero
 *     boilerplate.
 *
 * Usage (mutating spec):
 * ```ts
 * import { test, expect } from './fixtures';
 *
 * test('invite a member', async ({ authedPage, isolatedTenant }) => {
 *     await authedPage.goto(`/t/${isolatedTenant.tenantSlug}`);
 *     // …the workspace is empty; create what you need here.
 * });
 * ```
 *
 * Specs that sign nobody in keep importing `@playwright/test` directly.
 *
 * The underlying primitives — `createIsolatedTenant`, `signInAs` —
 * stay in `e2e-utils.ts`. This file is purely the fixture wiring on
 * top of them.
 *
 * Why test-scoped (not worker-scoped): a worker-scoped tenant would
 * be shared by every test the worker runs, re-introducing exactly
 * the cross-test pollution this work removes. Test-scoped costs one
 * extra `/api/auth/register` round-trip per test (~1-2 s) — cheap
 * insurance against order-dependence. Specs that genuinely want one
 * tenant for a whole serial scenario can still call
 * `createIsolatedTenant` once in a `beforeAll`; the fixture is the
 * per-test default, not the only option.
 */
/*
 * The Playwright fixture callback's second parameter is `use` by
 * convention. The `react-hooks` ESLint plugin mistakes it for
 * React's `use()` hook and flags `rules-of-hooks` — a false
 * positive: this file imports nothing from React and runs only in
 * the Playwright (Node) test runner. Disable the rule file-wide.
 */
/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type Page } from '@playwright/test';
import {
    createIsolatedTenant,
    signInAs,
    type IsolatedTenantCredentials,
} from './e2e-utils';

export interface IsolationFixtures {
    /**
     * A freshly-provisioned, EMPTY tenant + OWNER user dedicated to
     * the current `test()`. Use the credentials to authenticate or
     * to build URLs (`/t/${isolatedTenant.tenantSlug}/...`).
     */
    isolatedTenant: IsolatedTenantCredentials;
    /**
     * The standard `page`, already signed in as `isolatedTenant`'s
     * OWNER and on My Work. Convenience over wiring `signInAs` by
     * hand in every test.
     */
    authedPage: Page;
}

export const test = base.extend<IsolationFixtures>({
    // Test-scoped: a brand-new tenant for every `test()`.
    isolatedTenant: async ({ request }, use, testInfo) => {
        // The spec's file name (without extension) makes a tidy,
        // log-greppable `namePrefix`.
        const prefix = testInfo.titlePath[0]
            ? testInfo.titlePath[0].replace(/\.spec\.ts$/, '')
            : 'iso';
        const tenant = await createIsolatedTenant({ request, namePrefix: prefix });
        await use(tenant);
        // No teardown: the slug is unique per run, and per-test deletion
        // would race the still-open browser context.
    },

    authedPage: async ({ page, isolatedTenant }, use) => {
        await signInAs(page, isolatedTenant);
        await use(page);
    },
});

export { expect } from '@playwright/test';
