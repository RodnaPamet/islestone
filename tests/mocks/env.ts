/**
 * Stand-in for BOTH `@/env` and `@/env-client` in Jest (mapped in
 * jest.config.mjs). The real modules use @t3-oss/env-nextjs, which ships as
 * ESM only.
 *
 * Reads are live from `process.env`, so a test sets a variable for itself
 * (and restores it). The only default is one the real schema declares:
 * `NODE_ENV` falls back to `development` in src/env.ts (Jest sets `test`
 * itself, so the fallback rarely applies). A required variable such as
 * `NEXT_PUBLIC_APP_URL` has no default here, as it has none in production:
 * a test that needs it sets it, so a missing required variable never looks
 * satisfied.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
    NODE_ENV: 'development',
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
