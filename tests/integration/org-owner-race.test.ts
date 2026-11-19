/**
 * Two organization owners changing each other at once never leave an
 * organization with no owner (inflect-compliance #5373).
 *
 *   - THE TRIGGER, raw SQL with explicit ordering: transaction 1 demotes owner
 *     B and holds; transaction 2 demotes owner A. Without serialisation both
 *     counts see the other row still ORG_OWNER and both commit — zero owners.
 *     With it, transaction 2 waits on the per-organization lock and, once 1
 *     commits, its count sees the demotion and is refused (P0001).
 *   - THE SHARED KEY: a transaction holding `lockOrgOwners`' key makes the
 *     trigger wait too, so the org member usecases (sub-phase 1.4) and the
 *     trigger queue on one lock.
 *
 * The role-change and removal halves of the source suite exercise org member
 * usecases that arrive in sub-phases 1.4 and 8.3.
 */
import { randomUUID } from 'node:crypto';

import type { OrgRole, PrismaClient } from '@prisma/client';

import { lockOrgOwners, orgOwnerLockKey } from '@/app-layer/usecases/org-owner-lock';

import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
jest.setTimeout(120_000);

const SUITE = randomUUID().slice(0, 8);
const TX = { timeout: 30_000, maxWait: 30_000 };

/** Resolves `true` once `p` settles, or `false` after `ms`; clears its timer either way. */
function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((r) => (timer = setTimeout(() => r(false), ms)));
    return Promise.race([p.then(() => true, () => true), timeout]).finally(() => clearTimeout(timer));
}

describeFn('the org last-owner trigger serialises owner changes per organization (#5373)', () => {
    let prisma: PrismaClient;
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
    });

    // TRUNCATE fires no row-level triggers: no trigger bypass is needed.
    afterAll(async () => {
        await resetDatabase(prisma);
    });

    async function user(label: string): Promise<string> {
        const u = await prisma.user.create({
            data: { email: `${label}-${seq++}-${SUITE}@example.com`, name: label },
        });
        return u.id;
    }
    async function org(label: string): Promise<string> {
        const o = await prisma.organization.create({ data: { name: label, slug: `${label}-${seq++}-${SUITE}` } });
        return o.id;
    }
    async function member(organizationId: string, userId: string, role: OrgRole) {
        await prisma.orgMembership.create({ data: { organizationId, userId, role } });
    }
    const owners = (organizationId: string) =>
        prisma.orgMembership.count({ where: { organizationId, role: 'ORG_OWNER' } });
    const roleIn = async (organizationId: string, userId: string) =>
        (
            await prisma.orgMembership.findUnique({
                where: { organizationId_userId: { organizationId, userId } },
                select: { role: true },
            })
        )?.role ?? null;

    async function twoOwners(label: string) {
        const o = await org(label);
        const a = await user(`${label}-a`);
        const b = await user(`${label}-b`);
        await member(o, a, 'ORG_OWNER');
        await member(o, b, 'ORG_OWNER');
        return { o, a, b };
    }

    it('the TypeScript key and the trigger key are the same string', () => {
        expect(orgOwnerLockKey('o1')).toBe('org-owner:o1');
    });

    it('refuses the second of two concurrent cross-demotions, whatever the writer', async () => {
        const { o, a, b } = await twoOwners('trg');

        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        let demotedB!: () => void;
        const bDemoted = new Promise<void>((r) => (demotedB = r));

        // Transaction 1 demotes B (A is still an owner, so its count passes)
        // and stays open.
        const t1 = prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                `UPDATE "OrgMembership" SET "role" = 'ORG_ADMIN' WHERE "organizationId" = $1 AND "userId" = $2`,
                o,
                b,
            );
            demotedB();
            await held;
        }, TX);
        await bDemoted;

        // Transaction 2 demotes A while 1 is uncommitted.
        const t2 = prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
                `UPDATE "OrgMembership" SET "role" = 'ORG_ADMIN' WHERE "organizationId" = $1 AND "userId" = $2`,
                o,
                a,
            );
        }, TX);
        const t2Result = t2.then(
            () => 'committed' as const,
            (e: unknown) => e,
        );

        // It must WAIT for transaction 1 — it touches a different row, so
        // nothing but the per-organization lock can hold it.
        expect(await settlesWithin(t2Result, 500)).toBe(false);

        release();
        await t1;
        const outcome = await t2Result;
        expect(outcome).not.toBe('committed');
        expect(String((outcome as Error).message)).toMatch(/LAST_ORG_OWNER_GUARD/);

        expect(await owners(o)).toBe(1);
        expect(await roleIn(o, a)).toBe('ORG_OWNER');
        expect(await roleIn(o, b)).toBe('ORG_ADMIN');
    });

    it('waits behind a transaction holding lockOrgOwners, then proceeds', async () => {
        const { o, b } = await twoOwners('key');

        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        let locked!: () => void;
        const isLocked = new Promise<void>((r) => (locked = r));
        const holder = prisma.$transaction(async (tx) => {
            await lockOrgOwners(tx, o);
            locked();
            await held;
        }, TX);
        await isLocked;

        const demote = prisma.$executeRawUnsafe(
            `UPDATE "OrgMembership" SET "role" = 'ORG_READER' WHERE "organizationId" = $1 AND "userId" = $2`,
            o,
            b,
        );
        expect(await settlesWithin(demote, 500)).toBe(false);

        release();
        await holder;
        await expect(demote).resolves.toBe(1);
        expect(await owners(o)).toBe(1);
    });
});
