/**
 * A job a member queued does not run in a workspace that has since been
 * soft-deleted (inflect #5305).
 *
 * A workspace delete stamps `Tenant.deletedAt` and leaves the memberships in
 * place, and the workspace is meant to be inaccessible everywhere from that
 * moment. A job queued from a browser session resolves the member's ACTIVE
 * membership through `resolveInitiatorContext`; without the tenant filter it
 * would go on to write into the deleted workspace.
 *
 * An integration test because the refusal is a relation filter the database
 * evaluates; a mocked client would only echo the query back.
 *
 * Copied from inflect-compliance `tests/integration/initiator-context-deleted-tenant.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: DB-gated, Islestone's MEMBER
 * role, the PII extension fills `emailHash`, and `resetDatabase` replaces the
 * hand-written teardown.
 */
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import { resolveInitiatorContext } from '@/app-layer/context-system';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

describeFn('resolveInitiatorContext and a soft-deleted tenant', () => {
    let prisma: PrismaClient;
    const SUITE = randomUUID().slice(0, 8);
    const LIVE = `initiator-live-${SUITE}`;
    const GONE = `initiator-gone-${SUITE}`;
    let userId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        const user = await prisma.user.create({ data: { email: `member@${SUITE}.test` } });
        userId = user.id;
        for (const id of [LIVE, GONE]) {
            await prisma.tenant.create({ data: { id, name: id, slug: id } });
            await prisma.tenantMembership.create({
                data: { tenantId: id, userId, role: 'MEMBER', status: 'ACTIVE' },
            });
        }
        await prisma.tenant.update({ where: { id: GONE }, data: { deletedAt: new Date() } });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('resolves the member in a live tenant — the control', async () => {
        const ctx = await resolveInitiatorContext({ tenantId: LIVE, userId, requestId: 'req-live' });
        expect(ctx).toMatchObject({ tenantId: LIVE, userId, role: 'MEMBER' });
    });

    it('refuses the same ACTIVE membership once its tenant is soft-deleted', async () => {
        await expect(resolveInitiatorContext({ tenantId: GONE, userId, requestId: 'req-gone' })).resolves.toBeNull();
    });
});
