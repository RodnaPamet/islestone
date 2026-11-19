/**
 * The production runtime role (sub-phase 1.8): deploy/postgres/init-runtime-role.sh,
 * run for real against the test database, then used the way the app uses it.
 *
 * docs/rls-tenant-isolation.md requires production to connect as a role that
 * is neither a superuser nor BYPASSRLS and is a member of `app_user`. The
 * script creates that role; this suite proves the role it creates:
 *   - logs in, is not a superuser, cannot bypass row-level security;
 *   - can `SET ROLE app_user`, after which tenant isolation holds;
 *   - without it, the `superuser_bypass` policy admits it (the pre-tenant
 *     paths: sign-in, invites, sweeps), as it admits the login role today;
 *   - holds no privilege app_user lacks: it cannot delete what app_user may
 *     not delete (the notification outbox and settings), truncate a table or
 *     create one;
 *   - and the script is idempotent (it converges an existing role).
 *
 * The whole integration suite was also run with the app's DATABASE_URL as
 * such a role (docs/HANDOFF.md, the 1.8 step); this file keeps the property.
 * Needs `psql` on PATH (the CI runner and the Postgres image carry it).
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

import { getTestDirectDatabaseUrl, prismaTestClient, resetDatabase } from '../helpers/db';
import { createTenantWithOwner } from '../helpers/tenant-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SCRIPT = path.resolve(__dirname, '../../deploy/postgres/init-runtime-role.sh');
const ROLE = `islestone_runtime_it_${process.pid}`;
const PASSWORD = randomBytes(24).toString('hex');

function runScript(): void {
    const admin = new URL(getTestDirectDatabaseUrl());
    execFileSync('bash', [SCRIPT], {
        stdio: 'pipe',
        env: {
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            PGHOST: admin.hostname,
            PGPORT: admin.port || '5432',
            PGPASSWORD: decodeURIComponent(admin.password),
            POSTGRES_USER: decodeURIComponent(admin.username),
            POSTGRES_DB: admin.pathname.slice(1),
            APP_DB_USER: ROLE,
            APP_DB_PASSWORD: PASSWORD,
        },
    });
}

function runtimeUrl(): string {
    const url = new URL(getTestDirectDatabaseUrl());
    url.username = ROLE;
    url.password = PASSWORD;
    return url.toString();
}

describeFn('the production runtime role', () => {
    let prisma: PrismaClient;
    let client: Client;
    let tenantA: string;
    let tenantB: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        runScript();
        // A second run converges instead of failing.
        runScript();
        const a = await createTenantWithOwner({ name: 'A', slug: `rt-a-${process.pid}`, ownerEmail: `rt-a-${process.pid}@example.com`, requestId: 'rt' });
        const b = await createTenantWithOwner({ name: 'B', slug: `rt-b-${process.pid}`, ownerEmail: `rt-b-${process.pid}@example.com`, requestId: 'rt' });
        tenantA = a.tenant.id;
        tenantB = b.tenant.id;
        client = new Client({ connectionString: runtimeUrl() });
        await client.connect();
    });

    afterAll(async () => {
        await client?.end();
        await prisma.$executeRawUnsafe(`DROP OWNED BY "${ROLE}"`);
        await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${ROLE}"`);
        await resetDatabase(prisma);
    });

    it('logs in as a role that is not a superuser and cannot bypass RLS', async () => {
        const { rows } = await client.query(
            'SELECT current_user AS who, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, pg_has_role(current_user, $1, $2) AS member FROM pg_roles r WHERE r.rolname = current_user',
            ['app_user', 'MEMBER'],
        );
        expect(rows[0]).toEqual({ who: ROLE, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, member: true });
    });

    it('under SET ROLE app_user sees only the bound tenant', async () => {
        await client.query('BEGIN');
        try {
            await client.query('SET LOCAL ROLE app_user');
            await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
            const { rows } = await client.query('SELECT DISTINCT "tenantId" FROM "TenantMembership"');
            expect(rows).toEqual([{ tenantId: tenantB }]);
            const update = await client.query('UPDATE "TenantMembership" SET "updatedAt" = now() WHERE "tenantId" = $1', [tenantA]);
            expect(update.rowCount).toBe(0);
        } finally {
            await client.query('ROLLBACK');
        }
    });

    it('without SET ROLE is admitted by the bypass policy, like the login role', async () => {
        const { rows } = await client.query('SELECT count(DISTINCT "tenantId")::int AS n FROM "TenantMembership" WHERE "tenantId" = ANY($1)', [[tenantA, tenantB]]);
        expect(rows[0]).toEqual({ n: 2 });
    });

    it('holds no privilege beyond app_user: no outbox delete, no truncate, no DDL', async () => {
        for (const sql of [
            'DELETE FROM "NotificationOutbox"',
            'DELETE FROM "TenantNotificationSettings"',
            'TRUNCATE "TenantMembership"',
            'CREATE TABLE runtime_role_probe (id int)',
        ]) {
            await expect(client.query(sql)).rejects.toThrow(/permission denied|must be owner/);
        }
    });
});
