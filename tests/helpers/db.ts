/**
 * Test database helpers for the `integration` Jest project.
 *
 * - getTestDatabaseUrl(): resolve the test database URL
 * - migrateTestDb(): run `prisma migrate deploy` against it
 * - prismaTestClient(): a connected PrismaClient for tests
 * - resetDatabase(): truncate the application tables for a clean state
 *
 * Usage (integration tests):
 *   import { DB_AVAILABLE } from './db-helper';
 *   import { prismaTestClient, resetDatabase } from '../helpers/db';
 *   const describeFn = DB_AVAILABLE ? describe : describe.skip;
 *   describeFn('…', () => {
 *       const prisma = prismaTestClient();
 *       beforeEach(() => resetDatabase(prisma));
 *   });
 *
 * The integration project runs in band (`npm run test:integration`): one
 * shared database, reset between suites. inflect-compliance's per-worker
 * database cloning is not ported; add it if suite time ever needs it.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Relative, not `@/`: Jest's globalSetup loads this file outside the module
// mapper, where the alias does not resolve.
import { TENANT_TX_OPTIONS } from '../../src/lib/db/concurrency-limits';

const ROOT = path.resolve(__dirname, '../..');

/**
 * The test database URL: `DATABASE_URL_TEST`, else `DATABASE_URL`.
 *
 * The app's `prisma` singleton (src/lib/prisma.ts) reads `DATABASE_URL` when
 * it is first imported, so the integration project's setup points
 * `DATABASE_URL` (and `DIRECT_DATABASE_URL`) at this URL before any suite
 * loads it (tests/setup/integration-env.ts). Otherwise `runInTenantContext`
 * and `prismaTestClient()` would talk to two different databases, and suites
 * that go through the app's client would fail with a bare
 * PrismaClientKnownRequestError while direct-client suites passed
 * (inflect-compliance #5567).
 */
export function getTestDatabaseUrl(): string {
    return process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || '';
}

/** The URL migrations run against: a direct connection when one is named. */
export function getTestDirectDatabaseUrl(): string {
    return process.env.DIRECT_DATABASE_URL_TEST || getTestDatabaseUrl();
}

/**
 * Run `prisma migrate deploy` against the test database. Called once by the
 * integration project's global setup. Throws when it fails: a suite run
 * against an unmigrated database fails anyway, later and less clearly.
 */
export function migrateTestDb(): void {
    const url = getTestDirectDatabaseUrl();
    if (!url) throw new Error('[test-db] No test database URL: set DATABASE_URL_TEST or DATABASE_URL.');
    // Ask Node where the CLI is (the package's own `bin` entry), never spell
    // the path: a worktree may resolve node_modules from a parent directory.
    const pkgFile = require.resolve('prisma/package.json', { paths: [ROOT] });
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { bin: { prisma: string } };
    const cli = require.resolve(`prisma/${pkg.bin.prisma}`, { paths: [ROOT] });
    execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
        cwd: ROOT,
        env: { ...process.env, DATABASE_URL: getTestDatabaseUrl(), DIRECT_DATABASE_URL: url },
        stdio: 'pipe',
        timeout: 120_000,
    });
}

let _client: PrismaClient | null = null;

/**
 * Create and return the PrismaClient connected to the test database.
 *
 * Prisma 7 — connections go through the adapter pattern. This client carries
 * no extensions: it connects as the login role, so it sees every row (the
 * `superuser_bypass` policies), which is what fixtures and teardown need.
 * Isolation is exercised through `runInTenantContext` or an explicit
 * `SET LOCAL ROLE app_user` transaction on it.
 */
export function prismaTestClient(): PrismaClient {
    if (!_client) {
        const adapter = new PrismaPg({ connectionString: getTestDatabaseUrl() });
        _client = new PrismaClient({ adapter, transactionOptions: TENANT_TX_OPTIONS });
    }
    return _client;
}

/**
 * The tables `resetDatabase` names. Everything reachable from one of these by
 * a foreign key is cleared too, by CASCADE, so this list is a set of ROOTS.
 * Every name must exist: `resolveResetTables` refuses the whole reset if one
 * does not.
 *
 * `TRUNCATE` fires no row-level triggers, so the last-owner guards do not
 * block a reset.
 */
export const RESET_TABLES: readonly string[] = ['TenantMembership', 'OrgMembership', 'Tenant', 'Organization', 'User'];

/**
 * Resolve `tables` against the database's real table list, refusing loudly
 * when a name does not exist. A name that names nothing is a table that
 * silently stops being reset; an absence has to be distinguishable from a
 * success.
 */
export async function resolveResetTables(
    prisma: PrismaClient,
    tables: readonly string[] = RESET_TABLES,
): Promise<string[]> {
    // No parameters and no interpolation: the whole public table list
    // comes back and the comparison happens in JS.
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = tables.filter((t) => !present.has(t));
    if (missing.length > 0) {
        throw new Error(
            `[test-db] resetDatabase cannot run: ${missing.length} of ${tables.length} ` +
                `listed table(s) do not exist in the test database — ${missing.join(', ')}. ` +
                `A name here that names nothing is a table that silently stops being reset. ` +
                `Either the migration that renamed or dropped it needs the same edit in ` +
                `RESET_TABLES (tests/helpers/db.ts), or the test database is behind ` +
                `\`prisma migrate deploy\`.`,
        );
    }
    // Returned in the caller's order, so concurrent resets request the
    // same locks in the same sequence and cannot deadlock against
    // each other.
    return tables.filter((t) => present.has(t));
}

/**
 * Truncate the application tables in the test database, in ONE statement:
 * one round trip and one lock-acquisition phase. Preserves
 * `_prisma_migrations`.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
    const tables = await resolveResetTables(prisma);
    if (tables.length === 0) return;
    // Safe to interpolate: every name survived the information_schema
    // check above, so each is a real identifier in this database.
    const list = tables.map((t) => `"${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

/** Disconnect the singleton test client. */
export async function disconnectTestClient(): Promise<void> {
    if (_client) {
        await _client.$disconnect();
        _client = null;
    }
}
