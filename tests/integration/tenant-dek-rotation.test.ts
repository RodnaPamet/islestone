/**
 * Integration test: per-workspace DEK rotation, end-to-end against a real DB.
 *
 * Behaviours covered:
 *
 *   1. `rotateTenantDek` swaps the DEK atomically — the old wrapped DEK ends
 *      up in `previousEncryptedDek`, a new one in `encryptedDek`, and the new
 *      DEK round-trips under the master KEK.
 *
 *   2. While `previousEncryptedDek` is non-null a second rotation is refused
 *      ("already mid-rotation"); once the sweep clears it, a rotation is
 *      accepted again.
 *
 *   3. The full lifecycle: a value written before the rotation stays
 *      readable mid-flight — through the production read path
 *      (`runInTenantContext`, whose extension tries the new primary DEK first
 *      and falls back to the previous one) and through
 *      `decryptWithKeyOrPrevious` directly — and after the sweep every
 *      ciphertext in the workspace is under the new DEK alone.
 *
 *   4. The sweep does not trust its process's DEK cache (#5057): a worker
 *      that cached the OLD key still rewrites under the NEW one, and a row
 *      that reads under neither key keeps the previous DEK.
 *
 * The queue is a double: the sweep is run here directly, which is what the
 * worker's executor does with the job.
 *
 * Copied from inflect-compliance `tests/integration/tenant-dek-rotation.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.5b). Islestone's
 * one manifest field, `TenantSecuritySettings.auditStreamSecretEncrypted`,
 * replaces `Risk.threat`; that table holds ONE row per workspace, so the
 * lifecycle seeds one ciphertext per workspace rather than three. The
 * mid-flight read through the app's own client and the second-rotation-after-
 * the-sweep case are new; the CHECK-constraint case lives in
 * `tenant-dek-schema.test.ts`.
 */

import {
    rotateTenantDek,
    getTenantDek,
    _resetTenantDekCache,
} from '@/lib/security/tenant-key-manager';
import { generateDek, wrapDek, unwrapDek } from '@/lib/security/tenant-keys';
import {
    encryptWithKey,
    decryptWithKey,
    decryptWithKeyOrPrevious,
} from '@/lib/security/encryption';
import { runTenantDekRotation } from '@/app-layer/jobs/tenant-dek-rotation';
import type { TenantDekRotationProgress } from '@/app-layer/jobs/tenant-dek-rotation';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import type { PrismaClient } from '@prisma/client';
import { deleteAuditRowsForTenants, deleteAuditRowsForUsers } from '../helpers/audit-cleanup';

// The queue is a double, so no Redis is needed; the sweep is run directly.
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: jest.fn().mockResolvedValue({ id: 'integration-test-job' }),
}));

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const RUN = `dekrot-${Date.now()}`;

describeFn('rotateTenantDek and the sweep (integration — real DB)', () => {
    let prisma: PrismaClient;
    const tenantIds: string[] = [];
    const userIds: string[] = [];

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        try {
            if (tenantIds.length > 0) {
                await deleteAuditRowsForTenants(prisma, tenantIds);
                await prisma.tenantSecuritySettings.deleteMany({ where: { tenantId: { in: tenantIds } } });
                await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
            }
            if (userIds.length > 0) {
                await deleteAuditRowsForUsers(prisma, userIds);
                await prisma.user.deleteMany({ where: { id: { in: userIds } } });
            }
        } catch {
            /* best effort */
        }
        _resetTenantDekCache();
        await prisma.$disconnect();
    });

    beforeEach(() => {
        _resetTenantDekCache();
    });

    async function tenantWith(label: string, encryptedDek: string, previousEncryptedDek?: string) {
        const slug = `${RUN}-${label}`;
        const t = await prisma.tenant.create({
            data: { name: slug, slug, encryptedDek, previousEncryptedDek: previousEncryptedDek ?? null },
        });
        tenantIds.push(t.id);
        return t;
    }

    async function userFor(label: string) {
        const email = `${RUN}-${label}@test.local`;
        const u = await prisma.user.create({ data: { email, name: label } });
        userIds.push(u.id);
        return u;
    }

    /** The workspace's one manifest ciphertext, read raw (no extension). */
    async function storedSecret(tenantId: string): Promise<string> {
        const rows = await prisma.$queryRawUnsafe<Array<{ secret: string }>>(
            `SELECT "auditStreamSecretEncrypted" AS secret FROM "TenantSecuritySettings" WHERE "tenantId" = $1`,
            tenantId,
        );
        expect(rows).toHaveLength(1);
        return rows[0]!.secret;
    }

    test('atomically swaps encryptedDek and populates previousEncryptedDek', async () => {
        const initialDek = generateDek();
        const initialWrapped = wrapDek(initialDek);
        const tenant = await tenantWith('happy', initialWrapped);

        const result = await rotateTenantDek({ tenantId: tenant.id, initiatedByUserId: 'user-int-1' });
        expect(result.tenantId).toBe(tenant.id);
        expect(result.jobId).toBe('integration-test-job');

        const after = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        // Previous slot now carries the OLD wrapped DEK.
        expect(after?.previousEncryptedDek).toBe(initialWrapped);
        // Primary slot has a NEW wrapped DEK, a 32-byte key that is not the old one.
        expect(after?.encryptedDek).not.toBe(initialWrapped);
        const recovered = unwrapDek(after!.encryptedDek!);
        expect(recovered.length).toBe(32);
        expect(recovered.equals(initialDek)).toBe(false);
    });

    test('refuses a second rotation while the sweep is in flight, and accepts one after it', async () => {
        const user = await userFor('double');
        const tenant = await tenantWith('double', wrapDek(generateDek()));

        await rotateTenantDek({ tenantId: tenant.id, initiatedByUserId: user.id });
        const inFlight = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });

        // Second attempt is refused — the operator must wait for the sweep —
        // and changes nothing.
        await expect(
            rotateTenantDek({ tenantId: tenant.id, initiatedByUserId: user.id }),
        ).rejects.toThrow(/already mid-rotation/);
        const unchanged = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        expect(unchanged).toEqual(inFlight);

        // The sweep finishes (nothing to rewrite) and clears the slot ...
        const swept = await runTenantDekRotation({ tenantId: tenant.id, initiatedByUserId: user.id });
        expect(swept.previousEncryptedDekCleared).toBe(true);

        // ... after which a rotation is accepted again.
        await expect(
            rotateTenantDek({ tenantId: tenant.id, initiatedByUserId: user.id }),
        ).resolves.toMatchObject({ tenantId: tenant.id });
    });

    test('full lifecycle: readable mid-flight (primary first, then previous), all under the new DEK after the sweep', async () => {
        const user = await userFor('lifecycle');
        const initialDek = generateDek();
        const initialWrapped = wrapDek(initialDek);
        const tenant = await tenantWith('lifecycle', initialWrapped);
        const ctx = makeRequestContext('OWNER', { tenantId: tenant.id, userId: user.id, requestId: `${RUN}-req` });
        const SECRET = 'lifecycle-stream-secret-0001'; // pragma: allowlist secret — test fixture

        // Written through the app's client: the extension resolves the
        // workspace DEK and stores a v2 ciphertext under it.
        await runInTenantContext(ctx, (db) =>
            db.tenantSecuritySettings.create({
                data: { tenantId: tenant.id, auditStreamSecretEncrypted: SECRET },
            }),
        );
        const before = await storedSecret(tenant.id);
        expect(before.startsWith('v2:')).toBe(true);
        expect(decryptWithKey(initialDek, before)).toBe(SECRET);

        // ── Phase 1: the swap ───────────────────────────────────────
        await rotateTenantDek({ tenantId: tenant.id, initiatedByUserId: user.id });
        const afterSwap = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        expect(afterSwap?.previousEncryptedDek).toBe(initialWrapped);
        const newDek = unwrapDek(afterSwap!.encryptedDek!);
        const previousDek = unwrapDek(afterSwap!.previousEncryptedDek!);

        // ── Mid-flight: the row is still under the PREVIOUS key on disk ──
        expect(await storedSecret(tenant.id)).toBe(before);
        expect(() => decryptWithKey(newDek, before)).toThrow();
        expect(decryptWithKeyOrPrevious(newDek, previousDek, before)).toBe(SECRET);
        // The production read path, from a cold cache as another process
        // would be: primary fails AES-GCM, the previous DEK decrypts.
        _resetTenantDekCache();
        const midFlight = await runInTenantContext(ctx, (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId: tenant.id } }),
        );
        expect(midFlight?.auditStreamSecretEncrypted).toBe(SECRET);

        // ── Phase 2: the sweep ──────────────────────────────────────
        const progressEvents: TenantDekRotationProgress[] = [];
        const sweep = await runTenantDekRotation({
            tenantId: tenant.id,
            initiatedByUserId: user.id,
            batchSize: 1, // one row per page, so the cursor has to advance
            onProgress: async (p) => {
                progressEvents.push(p);
            },
        });
        expect(sweep.previousEncryptedDekCleared).toBe(true);
        expect(sweep.totalErrors).toBe(0);
        expect(sweep.totalRewritten).toBe(1);
        // Every manifest field is swept; this workspace holds one ciphertext.
        expect(sweep.perField).toEqual(
            expect.arrayContaining([
                {
                    model: 'TenantSecuritySettings',
                    field: 'auditStreamSecretEncrypted',
                    scanned: 1,
                    rewritten: 1,
                    skipped: 0,
                    errors: 0,
                },
            ]),
        );
        expect(sweep.perField.map((f) => `${f.model}.${f.field}`).sort()).toEqual([
            'Comment.body',
            // Sub-phase 2.6c: a follow-up email's text.
            'IntakeFollowUp.body',
            // Sub-phase 2.6a: an intake request's text, answers and remarks.
            'IntakeRequest.answersJson',
            'IntakeRequest.body',
            'IntakeRequest.declineExplanation',
            'IntakeRequest.internalRemark',
            'ProjectTemplate.contentJson',
            'TenantSecuritySettings.auditStreamSecretEncrypted',
            'WorkItem.description',
            // Sub-phase 2.8a: a reviewer's response text (its trigger admits the re-wrap).
            'WorkItemReviewer.responseText',
            'WorkItemTemplate.description',
        ]);

        const phases = progressEvents.map((p) => p.phase);
        expect(phases[0]).toBe('starting');
        expect(phases).toContain('sweeping');
        expect(phases).toContain('finalising');
        expect(phases[phases.length - 1]).toBe('complete');
        expect(progressEvents[progressEvents.length - 1]!.totalRewritten).toBe(sweep.totalRewritten);

        // ── Phase 3: after — the previous slot is clear, the row is under the new DEK alone ──
        const afterSweep = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { encryptedDek: true, previousEncryptedDek: true },
        });
        expect(afterSweep?.previousEncryptedDek).toBeNull();
        expect(afterSweep?.encryptedDek).toBe(afterSwap?.encryptedDek);
        const swept = await storedSecret(tenant.id);
        expect(swept.startsWith('v2:')).toBe(true);
        expect(decryptWithKey(newDek, swept)).toBe(SECRET);
        expect(() => decryptWithKey(previousDek, swept)).toThrow();

        // And the app still reads it, with no previous key left to fall back on.
        _resetTenantDekCache();
        const afterRead = await runInTenantContext(ctx, (db) =>
            db.tenantSecuritySettings.findFirst({ where: { tenantId: tenant.id } }),
        );
        expect(afterRead?.auditStreamSecretEncrypted).toBe(SECRET);

        // The sweep recorded itself on the workspace's chain.
        const actions = (
            await prisma.auditLog.findMany({
                where: { tenantId: tenant.id, entity: 'TenantKey' },
                orderBy: { createdAt: 'asc' },
                select: { action: true, userId: true, actorType: true },
            })
        ).map((r) => r.action);
        expect(actions).toEqual(['TENANT_DEK_ROTATION_STARTED', 'TENANT_DEK_ROTATION_COMPLETED']);
    }, 30_000);

    test('a row already under the new DEK is SKIPPED, not an error, and the slot still clears', async () => {
        const user = await userFor('skip');
        const previousDek = generateDek();
        const newDek = generateDek();
        const tenant = await tenantWith('skip', wrapDek(newDek), wrapDek(previousDek));
        await prisma.tenantSecuritySettings.create({
            data: { tenantId: tenant.id, auditStreamSecretEncrypted: encryptWithKey(newDek, 'already new') },
        });

        // batchSize 0 is clamped to 1.
        const res = await runTenantDekRotation({ tenantId: tenant.id, initiatedByUserId: user.id, batchSize: 0 });

        expect(res.totalErrors).toBe(0);
        expect(res.totalRewritten).toBe(0);
        expect(res.totalSkipped).toBe(1);
        expect(res.previousEncryptedDekCleared).toBe(true);
    });

    // ─── #5057: the sweep must not trust its process cache ──────────
    //
    // The rotation is primed in the WEB process; the sweep runs in the
    // WORKER, whose DEK cache may still hold the workspace's OLD key as the
    // current one. These cases set up exactly that: the old DEK cached in this
    // process, the swap written to the row behind the cache's back.

    async function swapBehindTheCache(tenantId: string, oldDek: Buffer) {
        const newDek = generateDek();
        await prisma.tenant.update({
            where: { id: tenantId },
            data: { encryptedDek: wrapDek(newDek), previousEncryptedDek: wrapDek(oldDek) },
        });
        return newDek;
    }

    test('a worker that cached the OLD DEK still rewrites every row under the NEW one (#5057)', async () => {
        const user = await userFor('stale-cache');
        const oldDek = generateDek();
        const tenant = await tenantWith('stale-cache', wrapDek(oldDek));
        await prisma.tenantSecuritySettings.create({
            data: { tenantId: tenant.id, auditStreamSecretEncrypted: encryptWithKey(oldDek, 'secret value') },
        });
        // This process — the "worker" — has used the workspace's key.
        expect((await getTenantDek(tenant.id)).equals(oldDek)).toBe(true);
        const newDek = await swapBehindTheCache(tenant.id, oldDek);

        const swept = await runTenantDekRotation({ tenantId: tenant.id, initiatedByUserId: user.id });

        expect(swept.totalErrors).toBe(0);
        expect(swept.previousEncryptedDekCleared).toBe(true);
        expect(decryptWithKey(newDek, await storedSecret(tenant.id))).toBe('secret value');
        // And the process no longer hands out the old key for new writes.
        expect((await getTenantDek(tenant.id)).equals(newDek)).toBe(true);
    }, 30_000);

    test('a row that reads under neither key keeps the previous DEK (#5057)', async () => {
        const user = await userFor('unreadable');
        const oldDek = generateDek();
        const tenant = await tenantWith('unreadable', wrapDek(oldDek));
        await prisma.tenantSecuritySettings.create({
            data: { tenantId: tenant.id, auditStreamSecretEncrypted: encryptWithKey(generateDek(), 'lost') },
        });
        await swapBehindTheCache(tenant.id, oldDek);

        const swept = await runTenantDekRotation({ tenantId: tenant.id, initiatedByUserId: user.id });

        expect(swept.totalErrors).toBeGreaterThan(0);
        expect(swept.previousEncryptedDekCleared).toBe(false);
        const after = await prisma.tenant.findUnique({
            where: { id: tenant.id },
            select: { previousEncryptedDek: true },
        });
        expect(after?.previousEncryptedDek).not.toBeNull();
    }, 30_000);

    test('a sweep with nothing to do (no previous DEK) reports noop and clears nothing', async () => {
        const user = await userFor('noop');
        const tenant = await tenantWith('noop', wrapDek(generateDek()));
        const phases: string[] = [];

        const res = await runTenantDekRotation({
            tenantId: tenant.id,
            initiatedByUserId: user.id,
            onProgress: async (p) => {
                phases.push(p.phase);
            },
        });

        expect(res.previousEncryptedDekCleared).toBe(false);
        expect(res.perField).toEqual([]);
        expect(res.totalScanned).toBe(0);
        expect(phases).toEqual(['starting', 'noop']);
    });

    test('a sweep for a workspace that does not exist fails rather than succeeding silently', async () => {
        // The STARTED audit insert references Tenant (ON DELETE RESTRICT), so
        // a missing workspace rejects there, before the in-code guard.
        const user = await userFor('missing');
        await expect(
            runTenantDekRotation({ tenantId: `${RUN}-missing`, initiatedByUserId: user.id }),
        ).rejects.toThrow();
    });
});
