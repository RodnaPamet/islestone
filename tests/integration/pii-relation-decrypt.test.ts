/**
 * A person's email, read THROUGH A RELATION from a row the PII extension
 * wrote, comes back as plaintext.
 *
 * The unit suites hand the extension fabricated rows; this one writes a real
 * user (so the stored `User.email` is ciphertext, asserted with a raw read as
 * the precondition), then reads it back through the two relations into
 * `User` that sub-phase 1.5 has: a membership's `user` and an audit row's
 * `user`, through the app's client and `runInTenantContext`, as the product
 * reads them. Sub-phase 2.2 adds a work item's assignee.
 *
 * Written for Islestone (docs/porting/maps/1.5.md): inflect-compliance's
 * `pii-relation-decrypt.test.ts` holds the same property through its access
 * reviews, which Islestone does not have. No code copied.
 */
import type { PrismaClient } from '@prisma/client';

import { appendAuditEntry } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { isEncryptedValue } from '@/lib/security/encryption';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = `piirel_${Date.now()}`;
const EMAIL = `related-${SUFFIX}@example.com`;
const NAME = 'Related Person';

describeFn('PII — a relation into User decrypts', () => {
    let prisma: PrismaClient;
    let tenantId: string;
    let userId: string;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await prisma.tenant.create({ data: { name: 'PII relation', slug: `pii-${SUFFIX}` } })).id;
        userId = (await prisma.user.create({ data: { email: EMAIL, name: NAME } })).id;
        await prisma.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER' } });
        await appendAuditEntry({
            tenantId,
            userId,
            entity: 'TenantMembership',
            entityId: userId,
            action: 'PII_RELATION_PROBE',
            detailsJson: { category: 'custom', event: 'pii_relation_probe' },
        });
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    it('stores ciphertext (the precondition: a plaintext column would make every case below vacuous)', async () => {
        const [raw] = await prisma.$queryRawUnsafe<Array<{ email: string; name: string; emailHash: string }>>(
            'SELECT "email", "name", "emailHash" FROM "User" WHERE "id" = $1',
            userId,
        );
        expect(isEncryptedValue(raw!.email)).toBe(true);
        expect(raw!.email).not.toContain(SUFFIX);
        expect(isEncryptedValue(raw!.name)).toBe(true);
        expect(raw!.emailHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('TenantMembership include: { user } returns the plaintext address', async () => {
        const ctx = makeRequestContext('OWNER', { tenantId, userId });
        const membership = await runInTenantContext(ctx, (db) =>
            db.tenantMembership.findFirst({ where: { tenantId, userId }, include: { user: true } }),
        );
        expect(membership?.user.email).toBe(EMAIL);
        expect(membership?.user.name).toBe(NAME);
    });

    it('AuditLog include: { user } returns the plaintext address', async () => {
        const ctx = makeRequestContext('OWNER', { tenantId, userId });
        const row = await runInTenantContext(ctx, (db) =>
            db.auditLog.findFirst({ where: { tenantId, action: 'PII_RELATION_PROBE' }, include: { user: true } }),
        );
        expect(row?.user?.email).toBe(EMAIL);
        expect(row?.user?.name).toBe(NAME);
    });
});
