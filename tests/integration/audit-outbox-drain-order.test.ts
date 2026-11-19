/**
 * The audit-outbox drain appends queued entries IN ORDER, and the chain it
 * appends to still verifies (sub-phase 1.5b).
 *
 * `audit-outbox-no-silent-drop.test.ts` proves a queued entry is never lost
 * and that the drain puts ONE of them on the chain. This suite proves what a
 * backlog needs on top of that:
 *
 *   - the drain reads the oldest EVENT first, not the first-inserted row: three
 *     entries queued in one order but stamped with another reach the chain in
 *     the order their events happened;
 *   - they land after whatever the chain already holds, entries written
 *     straight to the chain while the backlog waited included, each linked to
 *     the one before it (`previousHash` = the previous row's `entryHash`);
 *   - `verifyAuditChain` reads the whole workspace's chain as valid
 *     afterwards: a replayed entry is an ordinary chain entry, not a splice;
 *   - the scheduled job (`executorRegistry.execute('audit-outbox-flush')`,
 *     what the worker runs every five minutes) is the path that does it.
 *
 * Written for Islestone, on real `AuditLog` rows.
 */
import type { PrismaClient } from '@prisma/client';

import { executorRegistry } from '@/app-layer/jobs/executor-registry';
import { appendAuditEntryOrQueue } from '@/lib/audit/audit-outbox';
import { appendAuditEntry, verifyAuditChain } from '@/lib/audit/audit-writer';

import { DB_AVAILABLE } from './db-helper';
import { deleteAuditRowsForTenants } from '../helpers/audit-cleanup';
import { prismaTestClient } from '../helpers/db';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

/** A client whose transaction always fails — the chain is unreachable. */
function brokenClient(): PrismaClient {
    return {
        $transaction: () => Promise.reject(new Error('advisory lock wait exceeded')),
    } as unknown as PrismaClient;
}

const RUN = `outbox-order-${Date.now()}`;

describeFn('the audit-outbox drain appends a backlog in event order onto a valid chain', () => {
    let prisma: PrismaClient;
    let tenantId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
        const tenant = await prisma.tenant.create({ data: { name: RUN, slug: RUN } });
        tenantId = tenant.id;
    });

    afterAll(async () => {
        if (tenantId) {
            await deleteAuditRowsForTenants(prisma, [tenantId]);
            await prisma.auditOutbox.deleteMany({ where: { tenantId } });
            await prisma.tenant.deleteMany({ where: { id: tenantId } });
        }
        await prisma.$disconnect();
    });

    function entry(action: string) {
        return {
            tenantId,
            userId: null,
            actorType: 'SYSTEM',
            entity: 'Workspace',
            entityId: tenantId,
            action,
            detailsJson: { category: 'custom', event: action.toLowerCase() },
        };
    }

    test('queued in one order, replayed in event order, linked, and the chain verifies', async () => {
        // The chain already has a head.
        await appendAuditEntry(entry('OUTBOX_ORDER_HEAD'));

        // Three entries the chain could not take, queued X, Y, Z ...
        const queued: Record<string, string> = {};
        for (const action of ['OUTBOX_ORDER_X', 'OUTBOX_ORDER_Y', 'OUTBOX_ORDER_Z']) {
            const outcome = await appendAuditEntryOrQueue(entry(action), brokenClient());
            expect(outcome.recorded).toBe('queued');
            if (outcome.recorded === 'queued') queued[action] = outcome.outboxId;
        }
        // ... but whose events happened Y, Z, X.
        const t0 = Date.now() - 60_000;
        const occurred: Record<string, Date> = {
            OUTBOX_ORDER_Y: new Date(t0),
            OUTBOX_ORDER_Z: new Date(t0 + 1_000),
            OUTBOX_ORDER_X: new Date(t0 + 2_000),
        };
        for (const [action, id] of Object.entries(queued)) {
            await prisma.auditOutbox.update({ where: { id }, data: { occurredAt: occurred[action] } });
        }

        // An entry written straight to the chain while the backlog waited.
        await appendAuditEntry(entry('OUTBOX_ORDER_LIVE'));

        // The scheduled job drains this workspace.
        const result = await executorRegistry.execute('audit-outbox-flush', { tenantId });
        expect(result.success).toBe(true);
        expect(result.itemsActioned).toBe(3);
        expect(result.details).toEqual({ applied: 3, failed: 0, skipped: 0 });

        const rows = await prisma.auditOutbox.findMany({ where: { tenantId }, select: { status: true } });
        expect(rows.map((r) => r.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);

        // The chain: head, live, then the backlog in event order.
        const chain = await prisma.auditLog.findMany({
            where: { tenantId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { action: true, entryHash: true, previousHash: true, detailsJson: true },
        });
        expect(chain.map((r) => r.action)).toEqual([
            'OUTBOX_ORDER_HEAD',
            'OUTBOX_ORDER_LIVE',
            'OUTBOX_ORDER_Y',
            'OUTBOX_ORDER_Z',
            'OUTBOX_ORDER_X',
        ]);
        // Each entry links to the one before it.
        expect(chain[0]!.previousHash).toBeNull();
        for (let i = 1; i < chain.length; i++) {
            expect({ i, linked: chain[i]!.previousHash === chain[i - 1]!.entryHash }).toEqual({ i, linked: true });
        }
        // A replayed entry says when its event happened, beside the chain's
        // own (later) timestamp.
        for (const row of chain.slice(2)) {
            const details = row.detailsJson as Record<string, unknown>;
            expect(details.replayedFromOutbox).toBe(true);
            expect(details.occurredAt).toBe(occurred[row.action]!.toISOString());
        }

        // And the whole chain verifies.
        const verification = await verifyAuditChain(tenantId);
        expect(verification).toMatchObject({ valid: true, totalEntries: 5, hashedEntries: 5 });
        expect(verification.firstBreakAt).toBeUndefined();
    }, 30_000);

    test('a second drain finds nothing and leaves the chain as it was', async () => {
        const before = await prisma.auditLog.count({ where: { tenantId } });

        const result = await executorRegistry.execute('audit-outbox-flush', { tenantId });

        expect(result.success).toBe(true);
        expect(result.details).toEqual({ applied: 0, failed: 0, skipped: 0 });
        expect(await prisma.auditLog.count({ where: { tenantId } })).toBe(before);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
