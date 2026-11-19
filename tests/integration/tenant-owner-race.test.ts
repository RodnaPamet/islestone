/**
 * Two workspace OWNERs changing each other at once never leave a workspace
 * with no ACTIVE OWNER (inflect-compliance #5388).
 *
 *   - THE TRIGGER, raw SQL with explicit ordering: transaction 1 demotes (or
 *     deactivates) OWNER B and holds; transaction 2 demotes (or deletes) OWNER
 *     A. Without serialisation both counts see the other row still an ACTIVE
 *     OWNER and both commit — zero owners. With it, transaction 2 waits on the
 *     per-tenant lock and, once 1 commits, its count sees the change and is
 *     refused (P0001).
 *   - THE SHARED KEY: a transaction holding `lockTenantOwners`' key (the one
 *     the member usecases take first, from sub-phase 1.4) makes the trigger
 *     wait too, so the two layers queue on one lock.
 *
 * The usecase and ownership-transfer halves of the source suite arrive with
 * member management (sub-phase 1.4) and enterprise administration (8.3).
 */
import type { PrismaClient, Role } from '@prisma/client';

import { lockTenantOwners, tenantOwnerLockKey } from '@/app-layer/usecases/tenant-owner-lock';

import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
jest.setTimeout(120_000);

const SUITE = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext($1))`;
const TX = { timeout: 30_000, maxWait: 30_000 };
/** Resolves `true` once `p` settles, or `false` after `ms`; clears its timer either way. */
function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)));
    return Promise.race([p.then(() => true, () => true), timeout]).finally(() => clearTimeout(timer));
}

describeFn('the tenant last-OWNER guard serialises per tenant (#5388)', () => {
    let prisma: PrismaClient;
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    type Member = { userId: string; membershipId: string };

    async function addMember(tenantId: string, label: string, role: Role): Promise<Member> {
        const email = `${label}-${seq++}-${SUITE}@example.com`;
        const user = await prisma.user.create({ data: { email, name: label }, select: { id: true } });
        const m = await prisma.tenantMembership.create({
            data: { tenantId, userId: user.id, role, status: 'ACTIVE' },
            select: { id: true },
        });
        return { userId: user.id, membershipId: m.id };
    }

    /** A tenant with two ACTIVE OWNERs, A and B. */
    async function twoOwners(label: string) {
        const slug = `race-${label}-${seq++}-${SUITE}`;
        const tenant = await prisma.tenant.create({ data: { name: `Race ${label}`, slug }, select: { id: true } });
        const a = await addMember(tenant.id, `${label}-a`, 'OWNER');
        const b = await addMember(tenant.id, `${label}-b`, 'OWNER');
        return { tenantId: tenant.id, slug, a, b };
    }

    const activeOwners = (tenantId: string) =>
        prisma.tenantMembership.count({ where: { tenantId, role: 'OWNER', status: 'ACTIVE' } });

    /** Hold `lock(tx)` in a transaction of its own until `release()`. */
    async function hold(lock: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>) {
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        let locked!: () => void;
        const isLocked = new Promise<void>((r) => (locked = r));
        const done = prisma.$transaction(async (tx) => {
            await lock(tx);
            locked();
            await held;
        }, TX);
        await isLocked;
        return {
            release: async () => {
                release();
                await done;
            },
        };
    }

    it('the TypeScript key and the trigger key are the same string', () => {
        expect(tenantOwnerLockKey('t1')).toBe('tenant-owner:t1');
    });

    describe('the trigger', () => {
        const cases: Array<{ name: string; first: string; second: string }> = [
            {
                name: 'demote B, then demote A',
                first: `UPDATE "TenantMembership" SET "role" = 'ADMIN' WHERE "id" = $1`,
                second: `UPDATE "TenantMembership" SET "role" = 'ADMIN' WHERE "id" = $1`,
            },
            {
                name: 'deactivate B, then delete A',
                first: `UPDATE "TenantMembership" SET "status" = 'DEACTIVATED' WHERE "id" = $1`,
                second: `DELETE FROM "TenantMembership" WHERE "id" = $1`,
            },
        ];

        it.each(cases)('$name, concurrently: the second waits and is refused', async ({ first, second }) => {
            const { tenantId, a, b } = await twoOwners('trg');

            let release!: () => void;
            const held = new Promise<void>((r) => (release = r));
            let changedB!: () => void;
            const bChanged = new Promise<void>((r) => (changedB = r));

            // Transaction 1 changes B (A is still an owner, so its count
            // passes) and stays open.
            const t1 = prisma.$transaction(async (tx) => {
                await tx.$executeRawUnsafe(first, b.membershipId);
                changedB();
                await held;
            }, TX);
            await bChanged;

            // Transaction 2 changes A while 1 is uncommitted.
            const t2 = prisma
                .$transaction(async (tx) => {
                    await tx.$executeRawUnsafe(second, a.membershipId);
                }, TX)
                .then(
                    () => 'committed' as const,
                    (e: unknown) => e,
                );

            // It must WAIT for transaction 1 — it touches a different row, so
            // nothing but the per-tenant lock can hold it.
            expect(await settlesWithin(t2, 500)).toBe(false);

            release();
            await t1;
            const outcome = await t2;
            expect(outcome).not.toBe('committed');
            expect(String((outcome as Error).message)).toMatch(/LAST_OWNER_GUARD/);

            expect(await activeOwners(tenantId)).toBe(1);
            const aNow = await prisma.tenantMembership.findUnique({ where: { id: a.membershipId } });
            expect(aNow).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
        });

        it('waits behind a transaction holding lockTenantOwners, then proceeds', async () => {
            const { tenantId, b } = await twoOwners('key');
            const barrier = await hold((tx) => lockTenantOwners(tx, tenantId));

            const demote = prisma.$executeRawUnsafe(
                `UPDATE "TenantMembership" SET "role" = 'MEMBER' WHERE "id" = $1`,
                b.membershipId,
            );
            // The trigger takes the same key, so it queues behind the holder.
            expect(await settlesWithin(demote, 500)).toBe(false);

            await barrier.release();
            await expect(demote).resolves.toBe(1);
            expect(await activeOwners(tenantId)).toBe(1);
        });

        it('a write that demotes no ACTIVE OWNER takes no lock and does not wait', async () => {
            const { tenantId } = await twoOwners('nolock');
            const member = await addMember(tenantId, 'nolock-m', 'MEMBER');
            const barrier = await hold((tx) => lockTenantOwners(tx, tenantId));
            try {
                const change = prisma.$executeRawUnsafe(
                    `UPDATE "TenantMembership" SET "role" = 'VIEWER' WHERE "id" = $1`,
                    member.membershipId,
                );
                expect(await settlesWithin(change, 5_000)).toBe(true);
                await expect(change).resolves.toBe(1);
            } finally {
                await barrier.release();
            }
        });

        it('is keyed on the namespaced string, not the bare tenant id the audit chain will take', async () => {
            const { b, tenantId } = await twoOwners('ns');
            const barrier = await hold((tx) => tx.$executeRawUnsafe(LOCK_SQL, tenantId));
            try {
                const demote = prisma.$executeRawUnsafe(
                    `UPDATE "TenantMembership" SET "role" = 'ADMIN' WHERE "id" = $1`,
                    b.membershipId,
                );
                expect(await settlesWithin(demote, 5_000)).toBe(true);
                await expect(demote).resolves.toBe(1);
            } finally {
                await barrier.release();
            }
        });
    });
});
