/**
 * A custom role is never built on OWNER (#3734) — against a real database.
 *
 * A membership carrying a custom role resolves to the role's BASE, so a custom
 * role on OWNER would make every membership carrying it resolve as OWNER. The
 * usecases refuse that (`VALID_BASE_ROLES`); this file shows the database
 * backstop on real rows:
 *
 *   - the CHECK `TenantCustomRole_base_role_not_built_in_scope` refuses OWNER on
 *     INSERT and on UPDATE, in raw SQL no usecase stands in front of, and every
 *     other base still goes in;
 *   - the migration VALIDATED it.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Islestone has no AI_ADMIN role, and its CHECK is created VALID with the table
 * in `20261119130000_auth_and_roles`, so there are no legacy OWNER-based rows:
 * the parent's NOT VALID replay case and its `deleteCustomRole` legacy-row case
 * (whose base move Islestone's usecase does not carry) are not ported.
 */
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import type { PrismaClient } from '@prisma/client';

import { createTenantWithOwner } from '../helpers/tenant-fixture';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const CHECK = 'TenantCustomRole_base_role_not_built_in_scope';
describeFn('a custom role is never built on OWNER (real DB)', () => {
    let prisma: PrismaClient;
    const stamp = Date.now();

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    async function tenant(suffix: string) {
        const slug = `base-role-${suffix}-${stamp}`;
        const result = await createTenantWithOwner({
            name: `Base role ${suffix}`,
            slug,
            ownerEmail: `base-role-owner-${suffix}-${stamp}@example.com`,
            requestId: `req-${suffix}`,
        });
        return { tenantId: result.tenant.id };
    }

    const insertRole = (db: { $executeRawUnsafe: PrismaClient['$executeRawUnsafe'] }, id: string, tenantId: string, baseRole: string) =>
        db.$executeRawUnsafe(
            `INSERT INTO "TenantCustomRole" (id, "tenantId", name, "baseRole", "grantsJson", "updatedAt")
             VALUES ($1, $2, $1, $3::"Role", '{}'::jsonb, NOW())`,
            id,
            tenantId,
            baseRole,
        );

    const checkState = async () =>
        prisma.$queryRawUnsafe<Array<{ contype: string; convalidated: boolean }>>(
            `SELECT contype::text AS contype, convalidated FROM pg_constraint WHERE conname = $1`,
            CHECK,
        );

    /** A raw SQL statement's failure, as text — `null` when it succeeded. */
    async function sqlError(run: () => Promise<unknown>): Promise<string | null> {
        try {
            await run();
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    it('the migration added the CHECK and VALIDATED it on a clean database', async () => {
        expect(await checkState()).toEqual([{ contype: 'c', convalidated: true }]);
    });

    it('the CHECK refuses OWNER on INSERT and UPDATE — raw SQL, no usecase in front — and admits every other base', async () => {
        const a = await tenant('sql');

        for (const base of ['OWNER']) {
            const tag = base.toLowerCase();
            expect(await sqlError(() => insertRole(prisma, `cr-${tag}-ins-${stamp}`, a.tenantId, base))).toContain(CHECK);

            const clean = `cr-${tag}-upd-${stamp}`;
            await insertRole(prisma, clean, a.tenantId, 'VIEWER');
            expect(
                await sqlError(() =>
                    prisma.$executeRawUnsafe(
                        `UPDATE "TenantCustomRole" SET "baseRole" = $2::"Role" WHERE id = $1`,
                        clean,
                        base,
                    ),
                ),
            ).toContain(CHECK);
            const row = await prisma.tenantCustomRole.findUniqueOrThrow({ where: { id: clean }, select: { baseRole: true } });
            expect(row.baseRole).toBe('VIEWER');
        }

        for (const base of ['ADMIN', 'MEMBER', 'VIEWER', 'GUEST']) {
            expect(await sqlError(() => insertRole(prisma, `cr-${base.toLowerCase()}-ok-${stamp}`, a.tenantId, base))).toBeNull();
        }
    });
});
