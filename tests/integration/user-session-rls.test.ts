/**
 * Epic D.1 — `UserSession` RLS behavioural tests.
 *
 * The static guards (`tests/guards/rls-migration-policies.test.ts`,
 * `tests/integration/rls-coverage.test.ts`)
 * confirms the policies + FORCE flag exist on the table. These tests
 * exercise the actual semantics against a live Postgres so a future
 * migration that quietly weakens the rules (e.g. adds a permissive
 * sibling policy) breaks here even if the static surface still looks
 * correct.
 *
 * Coverage
 * --------
 *   1. INSERT under `app_user` with own tenantId   → succeeds.
 *   2. INSERT under `app_user` with a different tenantId → blocked.
 *   3. INSERT under `app_user` with NULL tenantId  → blocked
 *      (only the superuser-bypassed sign-in path may mint NULL).
 *   4. SELECT under `app_user` returns own-tenant + NULL-tenant rows
 *      and EXCLUDES other tenants' rows.
 *   5. UPDATE under `app_user` cannot reassign a NULL row to a
 *      different tenant (the asymmetric-USING + strict-WITH-CHECK
 *      contract).
 *   6. UPDATE under `app_user` cannot reassign an own-tenant row to
 *      a different tenant.
 *   7. Superuser (default `postgres` role, no SET LOCAL ROLE) can
 *      read every row regardless of tenant — covers migrations,
 *      sign-in INSERT, admin reads from the global Prisma client.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Islestone runs every tenant-bound step through `runInTenantContext` (the
 * parent used `withTenantDb`) and creates its own tenants and user rather
 * than borrowing a seeded one.
 */

import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import type { RequestContext } from '@/app-layer/types';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

// The login role: superuser_bypass applies, as on the sign-in path.
let globalPrisma: PrismaClient;

const describeFn = DB_AVAILABLE ? describe : describe.skip;

// ─── Fixtures ──────────────────────────────────────────────────────

const SUFFIX = randomUUID().slice(0, 8);
let TENANT_A = '';
let TENANT_B = '';
let USER_ID = '';
let ctxA: RequestContext;

/** Tenant A's context: `runInTenantContext` runs as app_user with app.tenant_id = A. */
const asTenantA = <T>(fn: (tx: Parameters<Parameters<typeof runInTenantContext>[1]>[0]) => Promise<T>) =>
    runInTenantContext(ctxA, fn);

function makeSessionRow(overrides: {
    sessionId?: string;
    tenantId?: string | null;
    userId?: string;
} = {}) {
    return {
        sessionId: overrides.sessionId ?? `sid-${randomUUID()}`,
        userId: overrides.userId ?? USER_ID,
        tenantId: overrides.tenantId === undefined ? TENANT_A : overrides.tenantId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
}

async function seedSuperuser(rows: Array<ReturnType<typeof makeSessionRow>>) {
    for (const r of rows) {
        await globalPrisma.userSession.create({ data: r });
    }
}

async function cleanup() {
    await globalPrisma.userSession.deleteMany({
        where: { userId: USER_ID },
    });
}

// ─── Suite ─────────────────────────────────────────────────────────

describeFn('Epic D.1 — UserSession RLS', () => {
    beforeAll(async () => {
        globalPrisma = prismaTestClient();
        TENANT_A = (await globalPrisma.tenant.create({ data: { name: 'RLS A', slug: `rls-a-${SUFFIX}` } })).id;
        TENANT_B = (await globalPrisma.tenant.create({ data: { name: 'RLS B', slug: `rls-b-${SUFFIX}` } })).id;
        USER_ID = (await globalPrisma.user.create({ data: { email: `rls-${SUFFIX}@example.test` } })).id;
        ctxA = makeRequestContext('OWNER', { tenantId: TENANT_A, userId: USER_ID, requestId: 'req-user-session-rls' });
    });

    afterEach(async () => {
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await globalPrisma.user.delete({ where: { id: USER_ID } });
        await globalPrisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
    });

    it('app_user INSERT with own tenantId succeeds', async () => {
        const row = makeSessionRow({ tenantId: TENANT_A });
        await asTenantA(async (tx) => {
            await tx.$executeRawUnsafe(
                `INSERT INTO "UserSession"("id","sessionId","userId","tenantId","expiresAt")
                 VALUES ($1, $2, $3, $4, $5)`,
                `id-${randomUUID()}`,
                row.sessionId,
                row.userId,
                row.tenantId,
                row.expiresAt,
            );
        });
        const persisted = await globalPrisma.userSession.findUnique({
            where: { sessionId: row.sessionId },
        });
        expect(persisted?.tenantId).toBe(TENANT_A);
    });

    it('app_user INSERT with a different tenantId is blocked', async () => {
        const row = makeSessionRow({ tenantId: TENANT_B });
        await expect(
            asTenantA(async (tx) => {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "UserSession"("id","sessionId","userId","tenantId","expiresAt")
                     VALUES ($1, $2, $3, $4, $5)`,
                    `id-${randomUUID()}`,
                    row.sessionId,
                    row.userId,
                    row.tenantId,
                    row.expiresAt,
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });

    it('app_user INSERT with NULL tenantId is blocked (only sign-in path may mint NULL)', async () => {
        const row = makeSessionRow({ tenantId: null });
        await expect(
            asTenantA(async (tx) => {
                await tx.$executeRawUnsafe(
                    `INSERT INTO "UserSession"("id","sessionId","userId","tenantId","expiresAt")
                     VALUES ($1, $2, $3, NULL, $4)`,
                    `id-${randomUUID()}`,
                    row.sessionId,
                    row.userId,
                    row.expiresAt,
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });

    it('app_user SELECT returns own-tenant + NULL-tenant rows, NOT other tenants', async () => {
        const ownSid = `sid-own-${randomUUID()}`;
        const nullSid = `sid-null-${randomUUID()}`;
        const otherSid = `sid-other-${randomUUID()}`;
        await seedSuperuser([
            makeSessionRow({ sessionId: ownSid, tenantId: TENANT_A }),
            makeSessionRow({ sessionId: nullSid, tenantId: null }),
            makeSessionRow({ sessionId: otherSid, tenantId: TENANT_B }),
        ]);

        const visible = await asTenantA(async (tx) => {
            return tx.userSession.findMany({
                where: { sessionId: { in: [ownSid, nullSid, otherSid] } },
                select: { sessionId: true, tenantId: true },
            });
        });
        const sids = new Set(visible.map((r) => r.sessionId));
        expect(sids.has(ownSid)).toBe(true);
        expect(sids.has(nullSid)).toBe(true);
        // The strict isolation property — TENANT_B's session is invisible.
        expect(sids.has(otherSid)).toBe(false);
    });

    it('app_user UPDATE cannot reassign a NULL row to another tenant (WITH CHECK strict)', async () => {
        const sid = `sid-null-claim-${randomUUID()}`;
        await seedSuperuser([
            makeSessionRow({ sessionId: sid, tenantId: null }),
        ]);

        // Try to claim the NULL row for TENANT_B while the session is
        // bound to TENANT_A. The USING (NULL OR own) admits the row;
        // the WITH CHECK (own) rejects the new tenantId.
        await expect(
            asTenantA(async (tx) => {
                await tx.$executeRawUnsafe(
                    `UPDATE "UserSession" SET "tenantId" = $1 WHERE "sessionId" = $2`,
                    TENANT_B,
                    sid,
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });

    it('app_user UPDATE cannot reassign an own-tenant row to another tenant', async () => {
        const sid = `sid-own-reassign-${randomUUID()}`;
        await seedSuperuser([
            makeSessionRow({ sessionId: sid, tenantId: TENANT_A }),
        ]);

        await expect(
            asTenantA(async (tx) => {
                await tx.$executeRawUnsafe(
                    `UPDATE "UserSession" SET "tenantId" = $1 WHERE "sessionId" = $2`,
                    TENANT_B,
                    sid,
                );
            }),
        ).rejects.toThrow(/row-level security|new row violates/i);
    });

    it('superuser (no SET LOCAL ROLE) sees every row regardless of tenant', async () => {
        const ownSid = `sid-su-own-${randomUUID()}`;
        const otherSid = `sid-su-other-${randomUUID()}`;
        const nullSid = `sid-su-null-${randomUUID()}`;
        await seedSuperuser([
            makeSessionRow({ sessionId: ownSid, tenantId: TENANT_A }),
            makeSessionRow({ sessionId: otherSid, tenantId: TENANT_B }),
            makeSessionRow({ sessionId: nullSid, tenantId: null }),
        ]);

        const all = await globalPrisma.userSession.findMany({
            where: { sessionId: { in: [ownSid, otherSid, nullSid] } },
            select: { sessionId: true },
        });
        expect(all).toHaveLength(3);
    });
});
