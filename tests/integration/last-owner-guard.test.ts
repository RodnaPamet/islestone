/**
 * Integration tests for the `tenant_membership_last_owner_guard` DB trigger.
 *
 * Exercises the Postgres-level backstop that prevents a live workspace from
 * being left with zero ACTIVE OWNERs via UPDATE or DELETE on
 * TenantMembership, and its one exemption: a soft-deleted workspace may lose
 * its last OWNER, so a purge can remove its memberships.
 *
 * Requires a real PostgreSQL instance with the migrations applied
 * (`20261119120000_tenancy_core` installs `check_not_last_owner`).
 */
import type { PrismaClient } from '@prisma/client';

import { prismaTestClient, resetDatabase } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('last-OWNER DB trigger', () => {
    let prisma: PrismaClient;
    let seq = 0;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
    });

    // resetDatabase truncates, and TRUNCATE fires no row-level triggers, so
    // the guard does not block the teardown the way removing the last OWNER
    // row by row would.
    afterAll(async () => {
        await resetDatabase(prisma);
    });

    /** Create a test tenant + OWNER membership, return IDs. */
    async function createTenantWithOwner(suffix: string): Promise<{
        tenantId: string;
        ownerMembershipId: string;
        ownerUserId: string;
    }> {
        const n = seq++;
        const tenant = await prisma.tenant.create({
            data: { name: `Last Owner Guard ${suffix}`, slug: `last-owner-guard-${suffix}-${n}` },
            select: { id: true },
        });

        const user = await prisma.user.create({
            data: { email: `owner-guard-${suffix}-${n}@example.com` },
            select: { id: true },
        });

        const membership = await prisma.tenantMembership.create({
            data: {
                tenantId: tenant.id,
                userId: user.id,
                role: 'OWNER',
                status: 'ACTIVE',
            },
            select: { id: true },
        });

        return {
            tenantId: tenant.id,
            ownerMembershipId: membership.id,
            ownerUserId: user.id,
        };
    }

    it('rejects UPDATE that demotes the only ACTIVE OWNER', async () => {
        const { ownerMembershipId } = await createTenantWithOwner('demote');

        await expect(
            prisma.tenantMembership.update({
                where: { id: ownerMembershipId },
                data: { role: 'ADMIN' },
            }),
        ).rejects.toThrow(/LAST_OWNER_GUARD/);
    });

    it('rejects UPDATE that deactivates the only ACTIVE OWNER', async () => {
        const { ownerMembershipId } = await createTenantWithOwner('deactivate');

        await expect(
            prisma.tenantMembership.update({
                where: { id: ownerMembershipId },
                data: { status: 'DEACTIVATED' },
            }),
        ).rejects.toThrow(/LAST_OWNER_GUARD/);
    });

    it('rejects DELETE of the only ACTIVE OWNER', async () => {
        const { ownerMembershipId } = await createTenantWithOwner('delete');

        await expect(
            prisma.tenantMembership.delete({
                where: { id: ownerMembershipId },
            }),
        ).rejects.toThrow(/LAST_OWNER_GUARD/);
    });

    it('rejects deleteMany that would remove the only ACTIVE OWNER', async () => {
        const { tenantId } = await createTenantWithOwner('deletemany');

        await expect(
            prisma.tenantMembership.deleteMany({
                where: { tenantId, role: 'OWNER' },
            }),
        ).rejects.toThrow(/LAST_OWNER_GUARD/);
    });

    it('allows demoting the first OWNER when a second OWNER already exists', async () => {
        const { tenantId, ownerMembershipId } = await createTenantWithOwner('two-owners');

        const user2 = await prisma.user.create({
            data: { email: `owner2-${seq++}@example.com` },
            select: { id: true },
        });
        await prisma.tenantMembership.create({
            data: { tenantId, userId: user2.id, role: 'OWNER', status: 'ACTIVE' },
        });

        // Demote the first OWNER — should succeed because the second still exists.
        await expect(
            prisma.tenantMembership.update({
                where: { id: ownerMembershipId },
                data: { role: 'ADMIN' },
            }),
        ).resolves.toMatchObject({ role: 'ADMIN' });
    });

    it('allows removing the only ACTIVE OWNER of a soft-deleted workspace (the purge exemption)', async () => {
        const { tenantId, ownerMembershipId } = await createTenantWithOwner('purge');
        await prisma.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } });

        await expect(prisma.tenantMembership.delete({ where: { id: ownerMembershipId } })).resolves.toMatchObject({
            id: ownerMembershipId,
        });
        expect(await prisma.tenantMembership.count({ where: { tenantId } })).toBe(0);
    });
});
