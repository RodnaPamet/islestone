import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { skipEnvValidation } from './env-skip';

/**
 * SERVER environment. Only server code may import this module.
 *
 * Why two modules: a server variable's VALUE never reaches a browser, but this
 * file's SCHEMA is ordinary module code. If a `'use client'` file can reach it
 * through any chain of imports, `next build` bundles every key name and every
 * validator below into that route's client JavaScript. So browser-reachable
 * code reads `@/env-client` (NEXT_PUBLIC_ variables only), and
 * `tests/guards/client-env-boundary.test.ts` fails, naming the import chain,
 * when a client file can reach this one.
 *
 * Add a variable here, never as a raw `process.env` read elsewhere in `src/`,
 * and add it to `.env.example` in the same change.
 */
export const env = createEnv({
    server: {
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

        /**
         * PostgreSQL, through PgBouncer in transaction mode (see
         * docker-compose.yml). The runtime Prisma client (src/lib/prisma.ts)
         * connects here.
         */
        DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

        /**
         * Direct connection to Postgres, bypassing PgBouncer. Used by the
         * Prisma CLI for migrations (prisma.config.ts), which need DDL and
         * lock semantics PgBouncer does not provide. Falls back to
         * DATABASE_URL when unset (a non-pooled environment).
         */
        DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

        /**
         * Read-replica connection string. When set, reads explicitly marked
         * replica-tolerant route to it through `prismaRead` and
         * `runInTenantReadContext`; writes and read-after-write stay on
         * DATABASE_URL. Unset means single-database mode. See
         * docs/database-routing.md.
         */
        DATABASE_READ_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

        /** Minimum log level (src/lib/observability/logger.ts). Defaults by NODE_ENV. */
        LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),

        /**
         * Redis (queues, rate limits). Optional for now; sub-phases 1.5 and
         * 1.6 decide when it becomes required and that production URLs carry
         * a password.
         */
        REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),

        // ─── Authentication (sub-phase 1.4, ADR 0004) ────────────────
        /** NextAuth's signing and encryption secret. At least 16 characters. */
        AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters long'),
        /** NextAuth's canonical URL (v4 reads it itself as well). */
        NEXTAUTH_URL: z.url().optional(),
        /** The deployment's public origin, for links in email and redirects. */
        APP_URL: z.url().optional(),
        /** Google sign-in. The provider is offered only when both are set. */
        GOOGLE_CLIENT_ID: z.string().min(1).optional(),
        GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
        /** Microsoft sign-in. The provider is offered only when both are set. */
        MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
        MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
        MICROSOFT_TENANT_ID: z.string().default('common'),
        /**
         * "1" disables the credential throttle and both rate-limit tiers, for
         * tests and the E2E server. Refused in production unless
         * NEXT_TEST_MODE is "1" (set only by the Playwright webServer).
         */
        AUTH_TEST_MODE: z
            .enum(['0', '1'])
            .optional()
            .superRefine((val, ctx) => {
                if (process.env.NODE_ENV !== 'production') return;
                // `next start` forces NODE_ENV=production even under test,
                // so the E2E server would otherwise trip this.
                if (process.env.NEXT_TEST_MODE === '1') return;
                if (val === '1') {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'AUTH_TEST_MODE must not be "1" in production. It disables the ' +
                            'login brute-force throttle and both rate-limit tiers. Remove it ' +
                            'from the production environment.',
                    });
                }
            }),
        /** Set by the Playwright webServer only; see AUTH_TEST_MODE. */
        NEXT_TEST_MODE: z.enum(['0', '1']).optional(),
        /** "1": a password sign-in needs a verified email address. */
        AUTH_REQUIRE_EMAIL_VERIFICATION: z.enum(['0', '1']).optional(),
        /** "1": the sign-in page hides the email and password form. */
        AUTH_CREDENTIALS_UI_HIDDEN: z.enum(['0', '1']).optional(),
        /**
         * Public self-sign-up at `/api/auth/register` (ADR 0006, owner
         * decision 2026-11-18): "1" opens it, "0" closes it. Unset, it is
         * closed in production and open otherwise. Read through
         * `isPublicSignupOpen` (src/lib/auth/public-signup.ts).
         */
        AUTH_PUBLIC_SIGNUP: z.enum(['0', '1']).optional(),
        /** Platform-operator key (and its predecessor during a rotation). */
        PLATFORM_ADMIN_API_KEY: z.string().min(32).optional(),
        PLATFORM_ADMIN_API_KEY_PREVIOUS: z.string().min(32).optional(),
        /** Credential throttle store: Upstash, or process memory. */
        RATE_LIMIT_MODE: z.enum(['upstash', 'memory']).default('upstash'),
        /** "0" turns every rate limit off. */
        RATE_LIMIT_ENABLED: z.enum(['0', '1']).optional(),
        UPSTASH_REDIS_REST_URL: z.url().optional(),
        UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
        /** Test-only: "1" lets the edge logger write under NODE_ENV=test. */
        EDGE_LOGGER_IN_TEST: z.enum(['0', '1']).optional(),
    },

    // Listed key by key so a variable cannot be declared without being wired.
    runtimeEnv: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
        DATABASE_READ_URL: process.env.DATABASE_READ_URL,
        LOG_LEVEL: process.env.LOG_LEVEL,
        REDIS_URL: process.env.REDIS_URL,
        AUTH_SECRET: process.env.AUTH_SECRET,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        APP_URL: process.env.APP_URL,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
        MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
        MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
        AUTH_TEST_MODE: process.env.AUTH_TEST_MODE,
        NEXT_TEST_MODE: process.env.NEXT_TEST_MODE,
        AUTH_REQUIRE_EMAIL_VERIFICATION: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
        AUTH_CREDENTIALS_UI_HIDDEN: process.env.AUTH_CREDENTIALS_UI_HIDDEN,
        AUTH_PUBLIC_SIGNUP: process.env.AUTH_PUBLIC_SIGNUP,
        PLATFORM_ADMIN_API_KEY: process.env.PLATFORM_ADMIN_API_KEY,
        PLATFORM_ADMIN_API_KEY_PREVIOUS: process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS,
        RATE_LIMIT_MODE: process.env.RATE_LIMIT_MODE,
        RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
        EDGE_LOGGER_IN_TEST: process.env.EDGE_LOGGER_IN_TEST,
    },

    skipValidation: skipEnvValidation(),

    // Compose and shell defaults produce empty strings ("${VAR:-}"); treat
    // an empty value as unset rather than as an invalid URL.
    emptyStringAsUndefined: true,
});
