/**
 * Stand-in for BOTH `@/env` and `@/env-client` in Jest (mapped in
 * jest.config.mjs). The real modules use @t3-oss/env-nextjs, which ships as
 * ESM only.
 *
 * Reads are live from `process.env`, so a test sets a variable for itself
 * (and restores it). The only defaults are those the real schema declares:
 * `NODE_ENV` falls back to `development` in src/env.ts (Jest sets `test`
 * itself, so the fallback rarely applies), and the auth variables'
 * `MICROSOFT_TENANT_ID` and `RATE_LIMIT_MODE`. A required variable such as
 * `NEXT_PUBLIC_APP_URL` or `DATABASE_URL` has no default here, as it has
 * none in production: a test that needs it sets it, so a missing required
 * variable never looks satisfied. The integration project's global setup
 * (tests/setup/integration-global-setup.ts) points `DATABASE_URL` and
 * `DIRECT_DATABASE_URL` at the test database before any suite loads
 * `@/lib/prisma`.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
    NODE_ENV: 'development',
    // Schema defaults of the auth variables (sub-phase 1.4).
    MICROSOFT_TENANT_ID: 'common',
    RATE_LIMIT_MODE: 'upstash',
};

export const env: Readonly<Record<string, string | undefined>> = new Proxy(
    {},
    {
        get(_target, key) {
            if (typeof key !== 'string') return undefined;
            return process.env[key] ?? DEFAULTS[key];
        },
    },
);
