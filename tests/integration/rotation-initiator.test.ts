/**
 * A key rotation acts as the person who asked while they still may, and
 * finishes as the workspace's system user when they no longer may (owner
 * decision, 2026-11-19; `src/app-layer/jobs/rotation-actor.ts`).
 *
 * Against a real database, for both rotations:
 *
 *   - the initiator is still an ACTIVE OWNER (`admin.tenant_lifecycle`): the
 *     job's STARTED and COMPLETED entries name them, `actorType: 'USER'`,
 *     `authority: 'INITIATOR'`;
 *   - the initiator was removed from the workspace before the job ran: the
 *     rotation still finishes (the DEK re-wrapped, the previous DEK cleared),
 *     its entries are the system user's (`sys_<tenantId>`, `actorType: 'JOB'`)
 *     with `authority: 'SYSTEM'`, `requestedByUserId` and the refusal, the
 *     job result says the same, and no entry names the departed person as its
 *     actor;
 *   - an initiator demoted below the key, or deactivated, is refused the same
 *     way, with the reason named.
 *
 * Every assertion reads real `AuditLog` rows, and the chain verifies.
 *
 * Written for Islestone (sub-phase 1.5b).
 */
import { MembershipStatus, Role, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

import { runKeyRotation } from '@/app-layer/jobs/key-rotation';
import { runTenantDekRotation } from '@/app-layer/jobs/tenant-dek-rotation';
import { verifyAuditChain } from '@/lib/audit';
import { _resetTenantDekCache, createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { generateDek, unwrapDek, wrapDek } from '@/lib/security/tenant-keys';
import { tenantSystemUserId } from '@/lib/tenant-system-user';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = randomUUID().slice(0, 8);

describeFn('rotation jobs re-resolve the person who asked (owner decision, 2026-11-19)', () => {
    let db: PrismaClient;
    let tenantId = '';
    let sys = '';
    let owner = '';
    let departed = '';
    let demoted = '';
    let deactivated = '';

    async function member(label: string, role: Role, status: MembershipStatus = MembershipStatus.ACTIVE) {
        const u = await db.user.create({ data: { email: `${label}-${TAG}@example.test`, name: label } });
        await db.tenantMembership.create({ data: { tenantId, userId: u.id, role, status } });
        return u.id;
    }

    /** The job's own entries (STARTED / COMPLETED), oldest first. */
    async function rotationEntries(prefix: 'KEY_ROTATION_' | 'TENANT_DEK_ROTATION_') {
        return db.auditLog.findMany({
            where: { tenantId, action: { startsWith: prefix } },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { action: true, userId: true, actorType: true, detailsJson: true },
        });
    }

    beforeAll(async () => {
        db = prismaTestClient();
        const tenant = await createTenantWithDek({ name: `rot-actor-${TAG}`, slug: `rot-actor-${TAG}` });
        tenantId = tenant.id;
        sys = tenantSystemUserId(tenantId);
        owner = await member('owner', Role.OWNER);
        departed = await member('departed', Role.OWNER);
        demoted = await member('demoted', Role.ADMIN);
        deactivated = await member('deactivated', Role.OWNER, MembershipStatus.DEACTIVATED);
    });

    afterAll(async () => {
        _resetTenantDekCache();
        // TRUNCATE: the last-owner trigger would refuse deleting the owners
        // one by one, and the audit rows block the tenant delete.
        await resetDatabase(db);
    });

    beforeEach(() => {
        _resetTenantDekCache();
    });

    test('master key, initiator still an OWNER: the job acts as them', async () => {
        const result = await runKeyRotation({ tenantId, initiatedByUserId: owner, requestId: `${TAG}-a` });

        expect(result.totalErrors).toBe(0);
        expect(result.dekRewrapped).toBe(true);
        expect(result.actor).toEqual({ authority: 'INITIATOR', requestedByUserId: owner, actorUserId: owner, refusal: null });
        const entries = await rotationEntries('KEY_ROTATION_');
        expect(entries.map((e) => [e.action, e.userId, e.actorType])).toEqual([
            ['KEY_ROTATION_STARTED', owner, 'USER'],
            ['KEY_ROTATION_COMPLETED', owner, 'USER'],
        ]);
        for (const e of entries) {
            expect(e.detailsJson).toMatchObject({ authority: 'INITIATOR', requestedByUserId: owner, refusal: null });
        }
        // Nobody had to be the system user.
        expect(await db.user.count({ where: { id: sys } })).toBe(0);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test('workspace DEK, initiator still an OWNER: the job acts as them', async () => {
        // A rotation in flight: an outgoing DEK no row is under.
        await db.tenant.update({ where: { id: tenantId }, data: { previousEncryptedDek: wrapDek(generateDek()) } });

        const result = await runTenantDekRotation({ tenantId, initiatedByUserId: owner, requestId: `${TAG}-b` });

        expect(result.previousEncryptedDekCleared).toBe(true);
        expect(result.actor).toEqual({ authority: 'INITIATOR', requestedByUserId: owner, actorUserId: owner, refusal: null });
        const entries = await rotationEntries('TENANT_DEK_ROTATION_');
        expect(entries.map((e) => [e.action, e.userId, e.actorType])).toEqual([
            ['TENANT_DEK_ROTATION_STARTED', owner, 'USER'],
            ['TENANT_DEK_ROTATION_COMPLETED', owner, 'USER'],
        ]);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test('master key, initiator REMOVED before the job ran: it still finishes, as the system user, and says who asked', async () => {
        // Removed: the membership row is deleted, as the members usecase does.
        await db.tenantMembership.deleteMany({ where: { tenantId, userId: departed } });
        const before = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { encryptedDek: true } });

        const result = await runKeyRotation({ tenantId, initiatedByUserId: departed, requestId: `${TAG}-c` });

        // Not stopped: the DEK was re-wrapped and nothing failed.
        expect(result.totalErrors).toBe(0);
        expect(result.dekRewrapped).toBe(true);
        const after = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { encryptedDek: true } });
        expect(after.encryptedDek).not.toBe(before.encryptedDek);
        expect(unwrapDek(after.encryptedDek!).equals(unwrapDek(before.encryptedDek!))).toBe(true);

        const record = { authority: 'SYSTEM', requestedByUserId: departed, refusal: { reason: 'NOT_A_MEMBER' } };
        expect(result.actor).toEqual({ ...record, actorUserId: sys });
        const entries = (await rotationEntries('KEY_ROTATION_')).slice(2);
        expect(entries.map((e) => [e.action, e.userId, e.actorType])).toEqual([
            ['KEY_ROTATION_STARTED', sys, 'JOB'],
            ['KEY_ROTATION_COMPLETED', sys, 'JOB'],
        ]);
        for (const e of entries) expect(e.detailsJson).toMatchObject(record);

        // The departed person is named only as the requester, never as an actor.
        expect(await db.auditLog.count({ where: { tenantId, userId: departed } })).toBe(0);
        // The system user's creation is on the chain, once.
        expect(await db.auditLog.count({ where: { tenantId, action: 'SYSTEM_USER_CREATED' } })).toBe(1);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test('workspace DEK, initiator REMOVED before the job ran: the sweep still clears the previous DEK, as the system user', async () => {
        await db.tenant.update({ where: { id: tenantId }, data: { previousEncryptedDek: wrapDek(generateDek()) } });

        const result = await runTenantDekRotation({ tenantId, initiatedByUserId: departed, requestId: `${TAG}-d` });

        expect(result.totalErrors).toBe(0);
        expect(result.previousEncryptedDekCleared).toBe(true);
        const after = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { previousEncryptedDek: true } });
        expect(after.previousEncryptedDek).toBeNull();

        const record = { authority: 'SYSTEM', requestedByUserId: departed, refusal: { reason: 'NOT_A_MEMBER' } };
        expect(result.actor).toEqual({ ...record, actorUserId: sys });
        const entries = (await rotationEntries('TENANT_DEK_ROTATION_')).slice(2);
        expect(entries.map((e) => [e.action, e.userId, e.actorType])).toEqual([
            ['TENANT_DEK_ROTATION_STARTED', sys, 'JOB'],
            ['TENANT_DEK_ROTATION_COMPLETED', sys, 'JOB'],
        ]);
        for (const e of entries) expect(e.detailsJson).toMatchObject(record);
        expect(await db.auditLog.count({ where: { tenantId, userId: departed } })).toBe(0);
        // Still one: the system user already existed.
        expect(await db.auditLog.count({ where: { tenantId, action: 'SYSTEM_USER_CREATED' } })).toBe(1);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });

    test.each([
        ['demoted below the key (an ADMIN)', () => demoted, { reason: 'LACKS_PERMISSION', permission: 'admin.tenant_lifecycle' }],
        ['deactivated', () => deactivated, { reason: 'NOT_ACTIVE', status: 'DEACTIVATED' }],
    ])('an initiator %s is not acted for, and the reason is named', async (_label, who, refusal) => {
        const result = await runKeyRotation({ tenantId, initiatedByUserId: who(), requestId: `${TAG}-e` });

        expect(result.totalErrors).toBe(0);
        expect(result.actor).toEqual({ authority: 'SYSTEM', requestedByUserId: who(), actorUserId: sys, refusal });
        expect(await db.auditLog.count({ where: { tenantId, userId: who() } })).toBe(0);
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
