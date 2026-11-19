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
         * docker-compose.yml). Optional for now: nothing reads the database in
         * the skeleton. Sub-phase 1.3 (tenancy and data core) makes it
         * required and adds the direct connection string migrations need.
         */
        DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

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
        REDIS_URL: process.env.REDIS_URL,
    },

    skipValidation: skipEnvValidation(),

    // Compose and shell defaults produce empty strings ("${VAR:-}"); treat
    // an empty value as unset rather than as an invalid URL.
    emptyStringAsUndefined: true,
});
