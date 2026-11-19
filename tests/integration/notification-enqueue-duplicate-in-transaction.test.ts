/**
 * inflect #5061 — a duplicate email must not abort the caller's transaction.
 *
 * `enqueueEmail` is called with the caller's interactive transaction (a
 * work-item assignment, from 2.2). Its dedupe key is unique per
 * recipient, entity and day, so a re-assignment back to the same person the
 * same day meets an existing row. A unique violation that is caught still
 * aborts the transaction in Postgres: the caller's next statement then fails
 * with 25P02 and the assignment rolls back. The insert must therefore never
 * fail on a duplicate.
 *
 * Copied from inflect-compliance
 * `tests/integration/notification-enqueue-duplicate-in-transaction.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: Islestone's `WORK_ITEM_ASSIGNED`
 * payload and `resetDatabase`.
 */
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { enqueueEmail } from '@/app-layer/notifications/enqueue';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('enqueueEmail inside a transaction (#5061)', () => {
    let prisma: PrismaClient;
    let tenantId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const slug = `outbox-dup-${randomUUID().slice(0, 8)}`;
        tenantId = (await prisma.tenant.create({ data: { name: slug, slug } })).id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('a second enqueue of the same email the same day is skipped, and the transaction still commits', async () => {
        const email = {
            tenantId,
            type: 'WORK_ITEM_ASSIGNED' as const,
            toEmail: 'dana@example.com',
            entityId: 'wi-1',
            payload: {
                workItemTitle: 'Rotate the edge certificates',
                workItemKey: 'ISL-7',
                assigneeName: 'Dana Lee',
                linkPath: '/t/acme/work-items/wi-1',
            },
        };

        const [first, second] = await prisma.$transaction(async (tx) => {
            const a = await enqueueEmail(tx, email);
            const b = await enqueueEmail(tx, email);
            // The caller's own write after the duplicate: an aborted
            // transaction fails this statement with 25P02.
            await tx.tenant.update({ where: { id: tenantId }, data: { name: 'renamed-after-duplicate' } });
            return [a, b];
        });

        expect(first).not.toBeNull();
        expect(second).toBeNull();
        expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name).toBe(
            'renamed-after-duplicate',
        );
        expect(await prisma.notificationOutbox.count({ where: { tenantId } })).toBe(1);
    });
});
