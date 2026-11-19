/**
 * Epic B end-to-end — the crypto layers cooperating against a live Postgres.
 *
 * One test file walks the chain:
 *   1. `createTenantWithDek` mints a tenant with a wrapped DEK from day one.
 *   2. A write via `runInTenantContext` lands ciphertext — the extension
 *      resolves the tenant's DEK and emits `v2:`.
 *   3. A raw SQL read confirms the on-disk value starts with `v2:` and is NOT
 *      the plaintext ("what does an attacker with a DB dump see?").
 *   4. A read via `runInTenantContext` returns plaintext.
 *   5. The OTHER tenant's DEK cannot decrypt the first tenant's ciphertext —
 *      the per-tenant isolation guarantee.
 *   6. `runKeyRotation` re-wraps the DEK under the current primary KEK: the
 *      wrapped-DEK ciphertext changes, the DEK bytes do not.
 *   7. A read after the rotation still produces plaintext.
 *
 * Copied from inflect-compliance `tests/integration/epic-b-encryption.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e, against Islestone's one
 * manifest field, `TenantSecuritySettings.auditStreamSecretEncrypted`. The
 * key-rotation cases (`runKeyRotation`) returned with sub-phase 1.5b. The
 * encryption extension is composed onto the app client in `src/lib/prisma.ts`,
 * so nothing is registered here.
 */
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { deleteAuditRowsForTenants, deleteAuditRowsForUsers } from '../helpers/audit-cleanup';
import type { PrismaClient } from '@prisma/client';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek, getTenantDek, clearTenantDekCache } from '@/lib/security/tenant-key-manager';
import { isWrappedDek, unwrapDek } from '@/lib/security/tenant-keys';
import { runKeyRotation } from '@/app-layer/jobs/key-rotation';
import { getCiphertextVersion, decryptWithKey } from '@/lib/security/encryption';
import type { RequestContext } from '@/app-layer/types';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

function ctxFor(tenantId: string, userId = 'epic-b-user'): RequestContext {
    return makeRequestContext('ADMIN', { tenantId, userId, requestId: 'epic-b-req' });
}

const SECRET = 'whsec-epic-b-stream-secret-2026-04-01'; // pragma: allowlist secret — test fixture

describeFn('Epic B — encryption and tenant DEKs end-to-end', () => {
    let testPrisma: PrismaClient;
    let tenantA: string;
    let tenantB: string;
    let adminUserId: string;
    const slugs: string[] = [];
    const emails: string[] = [];

    beforeAll(async () => {
        testPrisma = prismaTestClient();
        await testPrisma.$connect();

        const suffix = `epic-b-${Date.now()}`;
        const aSlug = `${suffix}-a`;
        const bSlug = `${suffix}-b`;
        slugs.push(aSlug, bSlug);

        const a = await createTenantWithDek({ name: 'A', slug: aSlug });
        const b = await createTenantWithDek({ name: 'B', slug: bSlug });
        tenantA = a.id;
        tenantB = b.id;

        // A real user, so the audit rows the writes produce have an actor.
        const adminEmail = `epic-b-admin-${Date.now()}@example.com`;
        emails.push(adminEmail);
        const admin = await testPrisma.user.create({
            data: { email: adminEmail, name: 'Epic B Admin' },
        });
        adminUserId = admin.id;
    });

    afterAll(async () => {
        try {
            await testPrisma.tenantSecuritySettings.deleteMany({
                where: { tenantId: { in: [tenantA, tenantB] } },
            });
            // Audit rows block the tenant delete (RESTRICT); clear them first.
            await deleteAuditRowsForTenants(testPrisma, [tenantA, tenantB]);
            await deleteAuditRowsForUsers(testPrisma, [adminUserId]);
            await testPrisma.tenant.deleteMany({
                where: { slug: { in: slugs } },
            });
            await testPrisma.user.deleteMany({
                where: { email: { in: emails } },
            });
        } catch {
            /* best effort */
        }
        clearTenantDekCache();
        await testPrisma.$disconnect();
    });

    test('tenant creation populates a wrapped DEK', async () => {
        const row = await testPrisma.tenant.findUnique({
            where: { id: tenantA },
            select: { encryptedDek: true },
        });
        expect(row?.encryptedDek).toBeTruthy();
        expect(isWrappedDek(row!.encryptedDek)).toBe(true);
    });

    test('write via runInTenantContext emits v2 ciphertext on disk', async () => {
        const created = await runInTenantContext(ctxFor(tenantA, adminUserId), (db) =>
            db.tenantSecuritySettings.create({
                data: { tenantId: tenantA, auditStreamUrl: 'https://siem.example.com/ingest', auditStreamSecretEncrypted: SECRET },
            }),
        );

        // Caller sees plaintext (the extension decrypted the create result).
        expect(created.auditStreamSecretEncrypted).toBe(SECRET);

        // Raw SQL bypasses the extension — confirms on-disk ciphertext.
        const raw = await testPrisma.$queryRawUnsafe<Array<{ secret: string; url: string }>>(
            `SELECT "auditStreamSecretEncrypted" AS secret, "auditStreamUrl" AS url FROM "TenantSecuritySettings" WHERE id = $1`,
            created.id,
        );
        expect(raw).toHaveLength(1);
        expect(getCiphertextVersion(raw[0]!.secret)).toBe('v2');
        expect(raw[0]!.secret).not.toContain('whsec');
        // The URL is not in the manifest and stays plaintext.
        expect(raw[0]!.url).toBe('https://siem.example.com/ingest');
    });

    test('read via runInTenantContext returns plaintext', async () => {
        const found = await runInTenantContext(ctxFor(tenantA, adminUserId), (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId: tenantA } }),
        );
        expect(found).not.toBeNull();
        expect(found!.auditStreamSecretEncrypted).toBe(SECRET);
    });

    test("tenant B's DEK cannot decrypt tenant A's v2 ciphertext", async () => {
        const raw = await testPrisma.$queryRawUnsafe<Array<{ secret: string }>>(
            `SELECT "auditStreamSecretEncrypted" AS secret FROM "TenantSecuritySettings" WHERE "tenantId" = $1 LIMIT 1`,
            tenantA,
        );
        const cipher = raw[0]!.secret;
        expect(getCiphertextVersion(cipher)).toBe('v2');

        // Tenant B's DEK: AES-GCM refuses.
        const dekB = await getTenantDek(tenantB);
        expect(() => decryptWithKey(dekB, cipher)).toThrow();

        // Sanity: tenant A's OWN DEK decrypts it.
        const dekA = await getTenantDek(tenantA);
        expect(decryptWithKey(dekA, cipher)).toBe(SECRET);
    });

    test('key rotation re-wraps the DEK (ciphertext changes, DEK bytes preserved)', async () => {
        // Capture the pre-rotation DEK + its wrapped form.
        const before = await testPrisma.tenant.findUnique({
            where: { id: tenantA },
            select: { encryptedDek: true },
        });
        const wrappedBefore = before!.encryptedDek!;
        const dekBefore = unwrapDek(wrappedBefore);

        const result = await runKeyRotation({
            tenantId: tenantA,
            initiatedByUserId: adminUserId,
            requestId: 'epic-b-rotation',
        });
        expect(result.dekRewrapped).toBe(true);
        expect(result.totalErrors).toBe(0);

        const after = await testPrisma.tenant.findUnique({
            where: { id: tenantA },
            select: { encryptedDek: true },
        });
        const wrappedAfter = after!.encryptedDek!;

        // Envelope changed — new IV + fresh wrap.
        expect(wrappedAfter).not.toBe(wrappedBefore);

        // Underlying DEK bytes unchanged — existing ciphertexts stay readable.
        const dekAfter = unwrapDek(wrappedAfter);
        expect(dekAfter.equals(dekBefore)).toBe(true);
    });

    test('reads still decrypt cleanly after rotation', async () => {
        // The key-manager cache was invalidated by the rotation job —
        // the next request re-resolves from the freshly-wrapped DEK row.
        const found = await runInTenantContext(ctxFor(tenantA, adminUserId), (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId: tenantA } }),
        );
        expect(found!.auditStreamSecretEncrypted).toBe(SECRET);
    });
});
