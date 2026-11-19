/**
 * The per-workspace SYSTEM user (inflect #4400), against a real database.
 *
 * A background job that must write a row with a NOT NULL foreign key to
 * `User` writes it as `sys_<tenantId>` instead of borrowing a member. That
 * row is a foreign-key target and nothing else, and these tests hold the
 * three things that make it safe to have:
 *
 *   1. its shape: a `system:` hash no lookup by email can compute, and no
 *      password, ever;
 *   2. it can hold no sign-in, membership, credential or session, refused by
 *      the database in every table that would grant one;
 *   3. a job context built for it writes the audit trail as that user with
 *      `actorType: 'JOB'`, keeps the chain valid, and touches no other
 *      workspace.
 *
 * Copied from inflect-compliance `tests/integration/tenant-system-user.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the guarded tables are
 * Islestone's six (UserIdentityLink, Session, TenantApiKey and
 * TenantDeviceToken do not exist yet; each brings its CHECK), the setup client
 * is the PII-extended test client, and part 3 audits through `logEvent` in
 * place of the policy review reminder, which is compliance and not ported.
 */
import { MembershipStatus, Role, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import { buildTenantSystemJobContext, ensureTenantSystemUser } from '@/app-layer/context-system';
import { logEvent } from '@/app-layer/events/audit';
import { verifyAuditChain } from '@/lib/audit';
import appPrisma from '@/lib/prisma';
import { hashForLookup } from '@/lib/security/encryption';
import {
    isTenantSystemUserId,
    tenantSystemUserEmail,
    tenantSystemUserEmailHash,
    tenantSystemUserId,
} from '@/lib/tenant-system-user';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

let db: PrismaClient;
const describeFn = DB_AVAILABLE ? describe : describe.skip;

const TAG = randomUUID().slice(0, 8);
const TENANT_A = `t-sysuser-a-${TAG}`;
const TENANT_B = `t-sysuser-b-${TAG}`;
const SYS_A = tenantSystemUserId(TENANT_A);

/** Postgres's check_violation, however the driver wraps it. */
async function expectCheckViolation(op: Promise<unknown>, constraint: string): Promise<void> {
    const err = await op.then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(String((err as Error).message)).toContain(constraint);
}

let ownerA: string;

describeFn('the tenant SYSTEM user (#4400)', () => {
    beforeAll(async () => {
        db = prismaTestClient();
        await resetDatabase(db);
        for (const id of [TENANT_A, TENANT_B]) {
            await db.tenant.create({ data: { id, name: id, slug: id } });
        }
        const mkUser = async (label: string, tenantId: string) => {
            const u = await db.user.create({ data: { email: `${label}-${TAG}@example.test` } });
            await db.tenantMembership.create({
                data: { tenantId, userId: u.id, role: Role.OWNER, status: MembershipStatus.ACTIVE },
            });
            return u.id;
        };
        ownerA = await mkUser('owner-a', TENANT_A);
        await mkUser('owner-b', TENANT_B);
    });

    afterAll(async () => {
        await resetDatabase(db);
    });

    describe('its shape', () => {
        it('is created once, with the reserved id and hash and no password', async () => {
            expect(await ensureTenantSystemUser(TENANT_A)).toBe(SYS_A);
            expect(await ensureTenantSystemUser(TENANT_A)).toBe(SYS_A);

            const rows = await db.$queryRaw<Array<{ emailHash: string; passwordHash: string | null; emailVerified: Date | null }>>`
                SELECT "emailHash", "passwordHash", "emailVerified" FROM "User" WHERE id = ${SYS_A}`;
            expect(rows).toHaveLength(1);
            expect(rows[0]!.emailHash).toBe(tenantSystemUserEmailHash(TENANT_A));
            expect(rows[0]!.passwordHash).toBeNull();
            // Set, so no verify-email path ever offers to mail it.
            expect(rows[0]!.emailVerified).not.toBeNull();
        });

        it('no lookup by email reaches it', async () => {
            await ensureTenantSystemUser(TENANT_A);
            const byEmail = await appPrisma.user.findUnique({
                where: { emailHash: hashForLookup(tenantSystemUserEmail(TENANT_A)) },
            });
            expect(byEmail).toBeNull();
        });

        it('cannot be given a password', async () => {
            await ensureTenantSystemUser(TENANT_A);
            await expectCheckViolation(
                db.$executeRawUnsafe(`UPDATE "User" SET "passwordHash" = 'x' WHERE id = $1`, SYS_A),
                'User_system_row_shape',
            );
        });

        it('cannot be repointed at a real address: the rewrite re-hashes it', async () => {
            await ensureTenantSystemUser(TENANT_A);
            await expectCheckViolation(
                appPrisma.user.update({ where: { id: SYS_A }, data: { email: `taken-${TAG}@example.test` } }),
                'User_system_row_shape',
            );
        });

        it('no person can take the reserved namespace', async () => {
            const email = `squatter-${TAG}@example.test`;
            // Through the extension: it derives the real hash for the address.
            await expectCheckViolation(
                db.user.create({ data: { id: `sys_${TAG}`, email } }),
                'User_system_row_shape',
            );
            // Raw, so the forged hash reaches the column as written.
            await expectCheckViolation(
                db.$executeRawUnsafe(
                    `INSERT INTO "User" ("id", "email", "emailHash", "updatedAt") VALUES ($1, $2, $3, now())`,
                    `squat-${TAG}`,
                    email,
                    `system:${TAG}`,
                ),
                'User_system_row_shape',
            );
        });
    });

    describe('it can hold no sign-in, membership, credential or session', () => {
        // Every table a session or a context needs a row in. One CHECK each.
        const GUARDED: ReadonlyArray<readonly [table: string, constraint: string]> = [
            ['Account', 'Account_not_system_user'],
            ['TenantMembership', 'TenantMembership_not_system_user'],
            ['OrgMembership', 'OrgMembership_not_system_user'],
            ['PasswordResetToken', 'PasswordResetToken_not_system_user'],
            ['UserMfaEnrollment', 'UserMfaEnrollment_not_system_user'],
            ['UserSession', 'UserSession_not_system_user'],
        ];

        it('each guarded table carries its constraint, validated', async () => {
            const rows = await db.$queryRawUnsafe<Array<{ table: string; conname: string; convalidated: boolean }>>(
                `SELECT c.relname AS "table", k.conname, k.convalidated
                   FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
                  WHERE k.contype = 'c' AND k.conname LIKE '%\\_not\\_system\\_user'`,
            );
            const found = new Map(rows.map((r) => [r.conname, r]));
            for (const [table, constraint] of GUARDED) {
                expect(found.get(constraint)).toEqual({ table, conname: constraint, convalidated: true });
            }
            expect(rows).toHaveLength(GUARDED.length);
        });

        it('a membership for the system user is refused', async () => {
            await ensureTenantSystemUser(TENANT_A);
            await expectCheckViolation(
                db.tenantMembership.create({
                    data: { tenantId: TENANT_A, userId: SYS_A, role: Role.OWNER, status: MembershipStatus.ACTIVE },
                }),
                'TenantMembership_not_system_user',
            );
        });

        it('an OAuth account linked to the system user is refused', async () => {
            await ensureTenantSystemUser(TENANT_A);
            await expectCheckViolation(
                db.account.create({
                    data: { userId: SYS_A, type: 'oauth', provider: 'google', providerAccountId: `acct-${TAG}` },
                }),
                'Account_not_system_user',
            );
        });
    });

    describe('a job context for the system user', () => {
        it('audits as that user with actorType JOB, keeps the chain valid, and leaves the other workspace alone', async () => {
            const ctx = await buildTenantSystemJobContext({ tenantId: TENANT_A, job: 'system-user-test' });
            expect(ctx.userId).toBe(SYS_A);
            expect(isTenantSystemUserId(ctx.userId)).toBe(true);
            expect(ctx.actorType).toBe('JOB');

            await logEvent(appPrisma, ctx, {
                action: 'SYSTEM_USER_TEST',
                entityType: 'Tenant',
                entityId: TENANT_A,
                detailsJson: { category: 'custom', job: 'system-user-test' },
            });

            const row = await db.auditLog.findFirstOrThrow({
                where: { tenantId: TENANT_A, action: 'SYSTEM_USER_TEST' },
            });
            expect(row.userId).toBe(SYS_A);
            expect(row.actorType).toBe('JOB');
            expect((await verifyAuditChain(TENANT_A)).valid).toBe(true);

            // Nothing in workspace A was written under the owner's name, and
            // workspace B has no system user and no audit row of its own.
            expect(await db.auditLog.count({ where: { tenantId: TENANT_A, userId: ownerA } })).toBe(0);
            expect(await db.auditLog.count({ where: { tenantId: TENANT_B } })).toBe(0);
            expect(await db.user.count({ where: { id: tenantSystemUserId(TENANT_B) } })).toBe(0);
        });
    });
});
