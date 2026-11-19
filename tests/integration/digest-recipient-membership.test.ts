/**
 * Due digests go only to CURRENT members of the workspace.
 *
 * In inflect-compliance `resolveRecipients` used to be a bare
 * `prisma.user.findMany({ where: { id: { in: userIds } } })` — no tenant, no
 * membership, no status — on the unscoped client. Assignee ids reach the
 * digest from entity columns (a work item's assignee, from 2.1) and none of
 * them is cleared when a membership is deactivated: deactivation writes only
 * `status` + `deactivatedAt`. So a departed employee kept receiving that
 * workspace's deadlines — item names, due dates and links — every night.
 *
 * RLS could not have caught it and cannot be the fix: `User` is a global model
 * with no tenant column and no row-level policies, and this path runs outside
 * `runInTenantContext`. The membership predicate IS the control.
 *
 * These assert the OUTBOX, not the return counters — an item counted as
 * `unroutable` but still written would be a mail that goes out.
 *
 * Copied from inflect-compliance `tests/integration/digest-recipient-membership.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: Islestone's `DUE_DIGEST`
 * category, `WORK_ITEM` items and MEMBER role, the PII-extended test client
 * (the outbox address is ciphertext at rest and read back decrypted) and
 * `resetDatabase` in place of the trigger-bypassing teardown.
 */
import { MembershipStatus, Role } from '@prisma/client';
import { randomUUID } from 'crypto';

import type { DueItem } from '@/app-layer/jobs/types';
import { dispatchDigest } from '@/app-layer/notifications/digest-dispatcher';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

const globalPrisma = prismaTestClient();

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const SUITE = `dgm-${randomUUID().slice(0, 8)}`;
const TENANT_A = `t-${SUITE}-a`;
const TENANT_B = `t-${SUITE}-b`;

interface UserFixture {
    userId: string;
    email: string;
}

let activeOwner: UserFixture;
let departedOwner: UserFixture;
let owner: UserFixture; // OWNER role — the admin-fallback case
let crossTenant: UserFixture; // ACTIVE in B, DEACTIVATED in A

async function makeUser(label: string): Promise<UserFixture> {
    const email = `${SUITE}-${label}@example.test`;
    const u = await globalPrisma.user.create({ data: { email } });
    return { userId: u.id, email };
}

async function join(
    user: UserFixture,
    tenantId: string,
    role: Role,
    status: MembershipStatus,
) {
    await globalPrisma.tenantMembership.create({
        data: { tenantId, userId: user.userId, role, status },
    });
}

async function seed() {
    for (const [id, slug] of [
        [TENANT_A, `${SUITE}-a`],
        [TENANT_B, `${SUITE}-b`],
    ]) {
        await globalPrisma.tenant.upsert({
            where: { id },
            update: {},
            create: { id, name: `t ${slug}`, slug },
        });
    }

    activeOwner = await makeUser('active');
    departedOwner = await makeUser('departed');
    owner = await makeUser('owner');
    crossTenant = await makeUser('cross');

    await join(activeOwner, TENANT_A, Role.MEMBER, MembershipStatus.ACTIVE);
    // The offboarded employee: the membership is gone, the entity columns
    // pointing at them are not.
    await join(departedOwner, TENANT_A, Role.MEMBER, MembershipStatus.DEACTIVATED);
    await join(owner, TENANT_A, Role.OWNER, MembershipStatus.ACTIVE);
    // Active somewhere else, deactivated here — the case a userId-only
    // recipient map collapses into one entry.
    await join(crossTenant, TENANT_A, Role.MEMBER, MembershipStatus.DEACTIVATED);
    await join(crossTenant, TENANT_B, Role.MEMBER, MembershipStatus.ACTIVE);
}

function dueItem(tenantId: string, ownerUserId: string | undefined, name: string): DueItem {
    return {
        entityType: 'WORK_ITEM',
        entityId: `e-${randomUUID().slice(0, 8)}`,
        tenantId,
        name,
        reason: 'Due in 3 day(s)',
        urgency: 'URGENT',
        dueDate: new Date('2026-06-15T00:00:00Z').toISOString(),
        daysRemaining: 3,
        ownerUserId,
    };
}

/** Every email address the digest actually queued for a tenant. */
async function queuedRecipients(tenantId: string): Promise<string[]> {
    const rows = await globalPrisma.notificationOutbox.findMany({
        where: { tenantId },
        select: { toEmail: true },
    });
    return rows.map((r) => r.toEmail).sort();
}

describeFn('digest recipients — membership scoping', () => {
    beforeAll(async () => {
        await resetDatabase(globalPrisma);
        await seed();
    });
    afterAll(async () => {
        await resetDatabase(globalPrisma);
    });
    beforeEach(async () => {
        await globalPrisma.notificationOutbox.deleteMany({
            where: { tenantId: { in: [TENANT_A, TENANT_B] } },
        });
    });

    it('mails an active owner and NOT a deactivated one', async () => {
        const result = await dispatchDigest({
            category: 'DUE_DIGEST',
            items: [
                dueItem(TENANT_A, activeOwner.userId, 'Still here'),
                dueItem(TENANT_A, departedOwner.userId, 'Left the company'),
            ],
            now: new Date('2026-06-12T09:00:00Z'),
        });

        const mailed = await queuedRecipients(TENANT_A);
        expect(mailed).toContain(activeOwner.email);
        // The whole point: an offboarded employee's deadlines stop.
        expect(mailed).not.toContain(departedOwner.email);
        // And the drop is reported rather than silent.
        expect(result.unroutable).toBe(1);
    });

    it('does not leak tenant A deadlines to someone only active in tenant B', async () => {
        await dispatchDigest({
            category: 'DUE_DIGEST',
            items: [dueItem(TENANT_A, crossTenant.userId, 'Tenant A item')],
            now: new Date('2026-06-12T09:00:00Z'),
        });

        // A userId-keyed recipient map would resolve this user via their
        // tenant-B membership and mail them tenant A's deadline.
        expect(await queuedRecipients(TENANT_A)).not.toContain(crossTenant.email);
    });

    it('still mails the same user for the tenant they ARE active in', async () => {
        await dispatchDigest({
            category: 'DUE_DIGEST',
            items: [dueItem(TENANT_B, crossTenant.userId, 'Tenant B item')],
            now: new Date('2026-06-12T09:00:00Z'),
        });

        // The guard must scope, not blanket-deny — the same person is a
        // legitimate recipient one tenant over.
        expect(await queuedRecipients(TENANT_B)).toContain(crossTenant.email);
    });

    it('routes unowned items to an OWNER, not just to ADMINs', async () => {
        // The fallback filtered `role: 'ADMIN'`, which excludes OWNER — the
        // most privileged member, and the only one a freshly created tenant
        // has. Such a tenant received no digest at all.
        await dispatchDigest({
            category: 'DUE_DIGEST',
            items: [dueItem(TENANT_A, undefined, 'Nobody owns this')],
            now: new Date('2026-06-12T09:00:00Z'),
        });

        expect(await queuedRecipients(TENANT_A)).toContain(owner.email);
    });
});
