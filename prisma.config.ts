/**
 * Prisma 7 config. It replaces the inline `url`/`directUrl` on the
 * `datasource db {}` block, which Prisma 7 rejects.
 *
 * The CLI (prisma migrate / generate / studio) resolves connection
 * URLs from this file. The runtime client (src/lib/prisma.ts) uses
 * the adapter pattern (`@prisma/adapter-pg`) and reads URLs from
 * the env module directly.
 *
 * Two URLs:
 *   • DATABASE_URL — PgBouncer pooler (transaction mode) used by
 *     the runtime app.
 *   • DIRECT_DATABASE_URL — direct Postgres connection used by
 *     `prisma migrate` (which needs DDL/lock semantics PgBouncer
 *     doesn't provide).
 *
 * With a config file the Prisma CLI loads no `.env` file itself, and
 * Islestone keeps local values in `.env.local`. `loadEnvConfig` is the
 * loader `next` uses, with the same file precedence; it never
 * overrides a variable that is already exported, so CI is unaffected.
 */
import { loadEnvConfig } from '@next/env';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

loadEnvConfig(process.cwd());

export default defineConfig({
    schema: path.join('prisma', 'schema'),
    migrations: {
        path: path.join('prisma', 'migrations'),
    },
    datasource: {
        // CLI tooling uses the direct URL when present (migrate needs
        // DDL semantics PgBouncer doesn't provide); the runtime adapter
        // in `src/lib/prisma.ts` reads `DATABASE_URL` separately.
        url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    },
});
