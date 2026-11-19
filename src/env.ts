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
    },

    // Listed key by key so a variable cannot be declared without being wired.
    runtimeEnv: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
        DATABASE_READ_URL: process.env.DATABASE_READ_URL,
        LOG_LEVEL: process.env.LOG_LEVEL,
        REDIS_URL: process.env.REDIS_URL,
    },

    skipValidation: skipEnvValidation(),

    // Compose and shell defaults produce empty strings ("${VAR:-}"); treat
    // an empty value as unset rather than as an invalid URL.
    emptyStringAsUndefined: true,
});
