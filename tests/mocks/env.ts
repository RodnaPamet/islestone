/**
 * Stand-in for BOTH `@/env` and `@/env-client` in Jest (mapped in
 * jest.config.mjs). The real modules use @t3-oss/env-nextjs, which ships as
 * ESM only.
 *
 * Reads are live from `process.env`, so a test sets a variable for itself
 * (and restores it). The defaults mirror the real schemas' defaults; a mock
 * that answered differently from production would let suites pass against a
 * configuration that never ships.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
    NODE_ENV: 'test',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
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
