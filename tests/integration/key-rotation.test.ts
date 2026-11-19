/**
 * Integration test: a master-key (KEK) rotation, end-to-end against a real DB
 * (sub-phase 1.5b).
 *
 * The operator's runbook, played out in one process:
 *
 *   1. Before: a workspace whose DEK is wrapped under the OLD key, a `v1:`
 *      manifest ciphertext (`TenantSecuritySettings.auditStreamSecretEncrypted`
 *      written under the global key), a tenant-scoped PII column (the outbox
 *      recipient) and the global PII columns (`User.email`, `User.name`), all
 *      under OLD.
 *   2. Stage: `DATA_ENCRYPTION_KEY` = NEW, `DATA_ENCRYPTION_KEY_PREVIOUS` = OLD
 *      (and `LOOKUP_HASH_KEY` pinned to OLD, as the runbook requires).
 *      MID-FLIGHT every value still reads — the primary key fails AES-GCM and
 *      the previous key decrypts — through `decryptField`, the app's own
 *      client and the PII extension.
 *   3. Rotate: `runKeyRotation` for the workspace and `rotateGlobalPiiColumns`
 *      once. Both report zero errors and the workspace's audit chain records
 *      the run.
 *   4. Retire: `DATA_ENCRYPTION_KEY_PREVIOUS` unset. EVERY ciphertext the
 *      rotation owns was rewritten (none is byte-equal to its pre-rotation
 *      value) and reads under NEW alone; the DEK unwraps; the app reads the
 *      workspace's data.
 *
 * The global sweep rewrites every `User` row in the test database, not just
 * this suite's, so the teardown rotates them back under the original key
 * before restoring the environment: a later suite reads its own rows.
 *
 * Written for Islestone. inflect-compliance proved the re-wrap in
 * `epic-b-encryption.test.ts` (restored there too) and the rest with mocks.
 */
import type { PrismaClient } from '@prisma/client';

import { runKeyRotation, rotateGlobalPiiColumns } from '@/app-layer/jobs/key-rotation';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { DEV_FALLBACK_DATA_ENCRYPTION_KEY } from '@/lib/security/encryption-constants';
import { _resetKeyCache, decryptField, encryptField, getCiphertextVersion } from '@/lib/security/encryption';
import { _resetTenantDekCache, createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { unwrapDek } from '@/lib/security/tenant-keys';

import { DB_AVAILABLE } from './db-helper';
import { deleteAuditRowsForTenants, deleteAuditRowsForUsers } from '../helpers/audit-cleanup';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const KEY_VARS = ['DATA_ENCRYPTION_KEY', 'DATA_ENCRYPTION_KEY_PREVIOUS', 'LOOKUP_HASH_KEY', 'DERIVED_SUBKEY_KEY'] as const;
const SAVED: Record<string, string | undefined> = {};

/** The key every other suite writes under: the configured one, else the dev fallback. */
const OLD_KEY =
    process.env.DATA_ENCRYPTION_KEY && process.env.DATA_ENCRYPTION_KEY.length >= 32
        ? process.env.DATA_ENCRYPTION_KEY
        : DEV_FALLBACK_DATA_ENCRYPTION_KEY;
const NEW_KEY = 'islestone-integration-rotated-master-key-0123456789'; // pragma: allowlist secret — test fixture

function setKeys(primary: string, previous: string | undefined): void {
    process.env.DATA_ENCRYPTION_KEY = primary;
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
    else process.env.DATA_ENCRYPTION_KEY_PREVIOUS = previous;
    // Pinned to the outgoing key for the whole rotation, as the runbook
    // requires: a lookup hash is an index and must not move.
    process.env.LOOKUP_HASH_KEY = OLD_KEY;
    process.env.DERIVED_SUBKEY_KEY = OLD_KEY;
    _resetKeyCache();
    _resetTenantDekCache();
}

const RUN = `kekrot-${Date.now()}`;
const SECRET = 'kek-rotation-stream-secret-0001'; // pragma: allowlist secret — test fixture
const EMAIL = `${RUN}@example.test`;
const RECIPIENT = `${RUN}-recipient@example.test`;

describeFn('master-key rotation (integration — real DB)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let userId = '';

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
        for (const k of KEY_VARS) SAVED[k] = process.env[k];
        setKeys(OLD_KEY, undefined);
    });

    afterAll(async () => {
        try {
            // Put every User row the global sweep touched back under the
            // original key, so later suites read their own fixtures.
            setKeys(OLD_KEY, NEW_KEY);
            await rotateGlobalPiiColumns();
            if (tenantId) {
                await deleteAuditRowsForTenants(prisma, [tenantId]);
                await prisma.tenantSecuritySettings.deleteMany({ where: { tenantId } });
                await prisma.notificationOutbox.deleteMany({ where: { tenantId } });
                await prisma.tenant.deleteMany({ where: { id: tenantId } });
            }
            if (userId) {
                await deleteAuditRowsForUsers(prisma, [userId]);
                await prisma.user.deleteMany({ where: { id: userId } });
            }
        } finally {
            for (const k of KEY_VARS) {
                if (SAVED[k] === undefined) delete process.env[k];
                else process.env[k] = SAVED[k];
            }
            _resetKeyCache();
            _resetTenantDekCache();
            await prisma.$disconnect();
        }
    });

    test('every ciphertext the rotation owns is rewritten under the new key and reads correctly throughout', async () => {
        // ── 1. Before: everything under OLD ─────────────────────────
        const tenant = await createTenantWithDek({ name: RUN, slug: RUN });
        tenantId = tenant.id;
        const user = await prisma.user.create({ data: { email: EMAIL, name: 'Kek Rotation' } });
        userId = user.id;
        // A manifest field holding a GLOBAL-key (v1) ciphertext: what a write
        // with no workspace context, or a bypass source, leaves behind.
        await prisma.tenantSecuritySettings.create({
            data: { tenantId, auditStreamSecretEncrypted: encryptField(SECRET) },
        });
        // The outbox recipient, encrypted in place (v1) by the PII extension.
        await prisma.notificationOutbox.create({
            data: {
                tenantId,
                type: 'DUE_DIGEST',
                toEmail: RECIPIENT,
                subject: 's',
                bodyText: 'b',
                dedupeKey: `${RUN}-dedupe`,
            },
        });

        const readOwned = async () => {
            const [t] = await prisma.$queryRawUnsafe<Array<{ dek: string }>>(
                `SELECT "encryptedDek" AS dek FROM "Tenant" WHERE id = $1`, tenantId);
            const [s] = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
                `SELECT "auditStreamSecretEncrypted" AS v FROM "TenantSecuritySettings" WHERE "tenantId" = $1`, tenantId);
            const [o] = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
                `SELECT "toEmail" AS v FROM "NotificationOutbox" WHERE "tenantId" = $1`, tenantId);
            const [u] = await prisma.$queryRawUnsafe<Array<{ email: string; name: string }>>(
                `SELECT email, name FROM "User" WHERE id = $1`, userId);
            return { dek: t!.dek, secret: s!.v, recipient: o!.v, email: u!.email, name: u!.name };
        };
        const before = await readOwned();
        for (const v of Object.values(before)) expect(getCiphertextVersion(v)).toBe('v1');
        const dekBefore = unwrapDek(before.dek);

        // ── 2. Stage NEW as primary, OLD as previous: mid-flight ────
        setKeys(NEW_KEY, OLD_KEY);
        expect(decryptField(before.secret)).toBe(SECRET);
        expect(decryptField(before.recipient)).toBe(RECIPIENT);
        expect(decryptField(before.email)).toBe(EMAIL);
        expect(unwrapDek(before.dek).equals(dekBefore)).toBe(true);
        // Through the app's client, as a request would read it.
        const ctx = makeRequestContext('ADMIN', { tenantId, userId, requestId: `${RUN}-req` });
        const midFlight = await runInTenantContext(ctx, (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId } }),
        );
        expect(midFlight?.auditStreamSecretEncrypted).toBe(SECRET);
        // Through the PII extension, matched by its (unmoved) lookup hash.
        const found = await prisma.user.findFirst({ where: { email: EMAIL } });
        expect(found?.id).toBe(userId);
        expect(found?.email).toBe(EMAIL);

        // ── 3. Rotate ───────────────────────────────────────────────
        const result = await runKeyRotation({ tenantId, initiatedByUserId: userId, requestId: `${RUN}-req` });
        expect(result.dekRewrapped).toBe(true);
        expect(result.totalErrors).toBe(0);
        // The manifest field and the outbox recipient were each rewritten once.
        const rewrittenBy = (model: string) =>
            result.perField.filter((f) => f.model === model).reduce((n, f) => n + f.rewritten, 0);
        expect(rewrittenBy('TenantSecuritySettings')).toBe(1);
        expect(rewrittenBy('NotificationOutbox')).toBe(1);
        const global = await rotateGlobalPiiColumns();
        expect(global.errors).toBe(0);
        expect(global.perField.find((f) => f.model === 'User' && f.field === 'email')?.rewritten).toBeGreaterThanOrEqual(1);

        // ── 4. Retire the old key ───────────────────────────────────
        setKeys(NEW_KEY, undefined);
        const after = await readOwned();
        // Rewritten: no stored value is the one written under OLD ...
        for (const k of Object.keys(before) as Array<keyof typeof before>) {
            expect({ k, same: after[k] === before[k] }).toEqual({ k, same: false });
        }
        // ... and every one reads under NEW alone.
        expect(decryptField(after.secret)).toBe(SECRET);
        expect(decryptField(after.recipient)).toBe(RECIPIENT);
        expect(decryptField(after.email)).toBe(EMAIL);
        expect(decryptField(after.name)).toBe('Kek Rotation');
        expect(unwrapDek(after.dek).equals(dekBefore)).toBe(true);
        // With OLD gone, a value still under it would not read: the proof
        // that the old key is no longer needed by anything this rotation owns.
        expect(() => decryptField(before.secret)).toThrow();

        // No v1 value in the workspace's manifest and PII columns, or in the
        // user's row, remains that NEW cannot read.
        const v1Left = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
            `SELECT "auditStreamSecretEncrypted" AS v FROM "TenantSecuritySettings" WHERE "tenantId" = $1 AND "auditStreamSecretEncrypted" LIKE 'v1:%'
             UNION ALL SELECT "toEmail" FROM "NotificationOutbox" WHERE "tenantId" = $1 AND "toEmail" LIKE 'v1:%'
             UNION ALL SELECT email FROM "User" WHERE id = $2 AND email LIKE 'v1:%'`,
            tenantId,
            userId,
        );
        expect(v1Left.length).toBe(3);
        for (const row of v1Left) expect(() => decryptField(row.v)).not.toThrow();

        // The app reads the workspace's data after the rotation.
        const afterRead = await runInTenantContext(ctx, (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId } }),
        );
        expect(afterRead?.auditStreamSecretEncrypted).toBe(SECRET);

        // The run is on the workspace's chain, attributed to its initiator.
        const audit = await prisma.auditLog.findMany({
            where: { tenantId, entity: 'TenantKey' },
            orderBy: { createdAt: 'asc' },
            select: { action: true, userId: true, actorType: true },
        });
        expect(audit).toEqual([
            { action: 'KEY_ROTATION_STARTED', userId, actorType: 'SYSTEM' },
            { action: 'KEY_ROTATION_COMPLETED', userId, actorType: 'SYSTEM' },
        ]);
    }, 60_000);
});
