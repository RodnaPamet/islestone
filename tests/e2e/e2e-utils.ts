/**
 * Shared E2E test utilities.
 *
 * Copied from inflect-compliance `tests/e2e/e2e-utils.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.4 is its first user).
 * Kept: `safeGoto`, `waitForHydration`, `createIsolatedTenant` (it registers
 * through `/api/auth/register`, which the Playwright server opens with
 * `AUTH_PUBLIC_SIGNUP=1`) and `signInAs` over `loginAndGetTenant`. Cut:
 * `installFramework` (compliance), `reloadUntilVisible`,
 * `selectComboboxOption` and `gotoAndVerify` (no user yet), and
 * `DEFAULT_USER`, the seeded `admin@acme.com`: Islestone has no seed step
 * (sub-phase 1.8 added none: production's first workspace is registered by
 * hand, docs/deployment.md), so every spec signs in as a
 * workspace it created. The tenant tracker and its global teardown are not
 * ported either; each run's workspaces carry a unique slug, and the local
 * database is disposable.
 *
 * Islestone's sign-in lands on `/tenants`, which sends a person with one
 * workspace straight to that workspace's landing page, My Work,
 * `/t/<slug>/my-work` (`tenantLandingPath`, sub-phase 1.7), where the parent
 * landed on `/t/<slug>/dashboard`.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test';

/** Errors that indicate a transient server/network issue worth retrying. */
const TRANSIENT_ERRORS = ['net::', 'ERR_CONNECTION_REFUSED', 'ERR_EMPTY_RESPONSE'];

/** Errors that mean the page/context is dead — retrying on the same page is pointless. */
const FATAL_ERRORS = ['Target page, context or browser has been closed', 'Target closed'];

/** A workspace landing URL: My Work, `/t/<slug>/my-work`. */
export const LANDING_URL = /\/t\/[^/?#]+\/my-work(?:[?#]|$)/;

/**
 * Navigate to a URL with retry on transient network errors.
 * Uses `domcontentloaded` by default to avoid hanging on slow network requests.
 */
export async function safeGoto(page: Page, url: string, options?: Parameters<Page['goto']>[1], retries = 5) {
    const defaultOptions: Parameters<Page['goto']>[1] = {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
        ...options,
    };
    for (let i = 0; i < retries; i++) {
        try {
            return await page.goto(url, defaultOptions);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);

            // Fatal: page/context is dead — no point retrying on the same page
            if (FATAL_ERRORS.some((f) => msg.includes(f))) {
                throw e;
            }

            // Transient: wait and retry
            if (i < retries - 1 && TRANSIENT_ERRORS.some((t) => msg.includes(t))) {
                await page.waitForTimeout(5000);
                continue;
            }
            throw e;
        }
    }
}

/**
 * Wait until React has hydrated the given element so that its onClick /
 * onSubmit handlers are attached. Clicking a button whose handler is still
 * detached fires against a no-op DOM node, and a form submits natively.
 */
export async function waitForHydration(page: Page, selector = 'main', timeoutMs = 15_000) {
    await page.waitForFunction(
        (sel) => {
            const el = document.querySelector(sel as string);
            return (
                !!el &&
                Object.keys(el).some(
                    (k) => k.startsWith('__reactEvents') || k.startsWith('__reactFiber') || k.startsWith('__reactProps'),
                )
            );
        },
        selector,
        { timeout: timeoutMs },
    );
}

/** Open `/login` and wait until the credentials form is hydrated. */
export async function gotoLoginReady(page: Page, path = '/login') {
    await safeGoto(page, path, { timeout: 90_000 });
    await page.locator('#credentials-form input[type="email"][name="email"]').waitFor({ state: 'visible', timeout: 60_000 });
    await waitForHydration(page, '#credentials-form', 30_000);
}

/** Fill and submit the credentials form on an already-open, hydrated login page. */
export async function submitCredentials(page: Page, email: string, password: string) {
    // Scoped to the primary form: the resend-verification form below it has
    // its own email field and submit button.
    const credentialsForm = page.locator('#credentials-form');
    await credentialsForm.locator('input[type="email"][name="email"]').fill(email);
    await credentialsForm.locator('input[type="password"]').fill(password);
    await credentialsForm.locator('button[type="submit"]').click();
}

/**
 * Sign in through the credentials form and return the workspace slug the
 * browser landed on. A person with one workspace lands on its page; with
 * several, on the picker, which this does not choose from (it throws).
 */
export async function loginAndGetTenant(page: Page, user: { email: string; password: string }): Promise<string> {
    await gotoLoginReady(page);
    await submitCredentials(page, user.email, user.password);
    await page.waitForURL(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const match = new URL(page.url()).pathname.match(/^\/t\/([^/]+)/);
    if (!match) throw new Error('Could not extract workspace slug from ' + page.url());
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 30_000 });
    return decodeURIComponent(match[1]);
}

export interface IsolatedTenantCredentials {
    /** Workspace slug — use to build URLs like `/t/{slug}`. */
    tenantSlug: string;
    /** Workspace id (cuid). */
    tenantId: string;
    /** Workspace display name as it appears in the UI. */
    tenantName: string;
    /** Owner's email. */
    ownerEmail: string;
    /** Plaintext password — present ONLY to sign in from the same factory call. */
    ownerPassword: string;
    /** Owner user id (cuid). */
    ownerUserId: string;
    /** Owner display name. */
    ownerName: string;
}

export interface CreateIsolatedTenantOptions {
    /**
     * A live `APIRequestContext`. If omitted, an ephemeral one is created
     * against `baseURL` and disposed inside this call.
     */
    request?: APIRequestContext;
    /** Base URL for the ephemeral context; defaults to the Playwright server. */
    baseURL?: string;
    /** Friendly prefix for the generated names, sanitised to `[a-z0-9-]`. */
    namePrefix?: string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3100';

function generateOwnerPassword(): string {
    // Strong entropy + mixed character classes so the password policy AND the
    // breached-password screen at /api/auth/register accept it.
    return `Iso!${randomBytes(16).toString('hex')}`;
}

function sanitisePrefix(prefix: string): string {
    const cleaned = prefix
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return cleaned.length > 0 ? cleaned : 'iso';
}

/**
 * Provision a fresh workspace + OWNER through the production register route,
 * so a spec depends on no shared seed state. Each call yields a unique email
 * and slug.
 */
export async function createIsolatedTenant(options: CreateIsolatedTenantOptions = {}): Promise<IsolatedTenantCredentials> {
    const baseURL = options.baseURL ?? DEFAULT_BASE_URL;
    const prefix = sanitisePrefix(options.namePrefix ?? 'iso');
    const id = randomUUID().replace(/-/g, '').slice(0, 12);

    const ownerEmail = `${prefix}-${id}@e2e.test`;
    const ownerName = `${prefix} ${id}`;
    const orgName = `${prefix} ${id}`;
    const ownerPassword = generateOwnerPassword();

    const request = options.request ?? (await playwrightRequest.newContext({ baseURL }));
    const ownsRequest = !options.request;

    try {
        const res = await request.post('/api/auth/register', {
            data: { action: 'register', email: ownerEmail, password: ownerPassword, name: ownerName, orgName },
            failOnStatusCode: false,
        });
        if (!res.ok()) {
            const body = await res.text();
            throw new Error(`createIsolatedTenant: /api/auth/register failed (status ${res.status()}): ${body.slice(0, 400)}`);
        }
        const json = (await res.json()) as {
            user: { id: string; email: string; name: string };
            tenant: { id: string; name: string; slug: string };
        };
        if (!json?.tenant?.slug) {
            throw new Error('createIsolatedTenant: register response missing tenant.slug.');
        }
        return {
            tenantSlug: json.tenant.slug,
            tenantId: json.tenant.id,
            tenantName: json.tenant.name,
            ownerEmail: json.user.email,
            ownerPassword,
            ownerUserId: json.user.id,
            ownerName: json.user.name,
        };
    } finally {
        if (ownsRequest) {
            await request.dispose().catch(() => undefined);
        }
    }
}

/**
 * Sign the page in as the given credentials (typically the factory's return
 * value) and return the resolved workspace slug.
 */
export async function signInAs(
    page: Page,
    credentials: { ownerEmail: string; ownerPassword: string; tenantSlug?: string },
): Promise<string> {
    const slug = await loginAndGetTenant(page, { email: credentials.ownerEmail, password: credentials.ownerPassword });
    if (credentials.tenantSlug && slug !== credentials.tenantSlug) {
        throw new Error(`signInAs: signed in but landed on workspace '${slug}', expected '${credentials.tenantSlug}'.`);
    }
    return slug;
}
