/**
 * An OWNER membership never carries a custom role (#3720) — against a real
 * database, across two tenants.
 *
 * A mocked client cannot establish what matters here, so each property is shown
 * on real rows:
 *
 *   - the CHECK `TenantMembership_built_in_scope_role_no_custom_role` refuses the
 *     combination on INSERT and on UPDATE, in raw SQL that no usecase stands in
 *     front of, and the migration VALIDATED it;
 *   - the usecases refuse first, with the named reason: assigning to an OWNER
 *     (an ADMIN and an OWNER alike), promoting a member who carries a custom
 *     role (members page, invite), and an ADMIN's clear of a legacy OWNER
 *     custom role, while an OWNER's clear goes through;
 *   - an OWNER of tenant A reaches nothing in tenant B, and a custom role in A
 *     holds nobody back in B — not even the same person.
 *
 * No teardown deletes: every row is under a per-run slug, the last-OWNER
 * trigger refuses a bare membership delete, and `resetDatabase` truncates.
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * Islestone has no AI_ADMIN role and no ownership transfer yet (8.3), so those
 * cases are gone. Its CHECK is created with the table in
 * `20261119130000_auth_and_roles`, validated, so the parent's NOT VALID
 * branch for pre-existing offending rows does not exist here and its replay
 * test is not ported; the legacy-row case adds the CHECK back with the
 * migration's own statement. Audit assertions read real `AuditLog` rows.
 */
import { randomBytes } from 'crypto';

import { DB_AVAILABLE } from './db-helper';
import { createTenantWithOwner } from '../helpers/tenant-fixture';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { getPermissionsForRole } from '@/lib/permissions';
import type { PrismaClient, Role } from '@prisma/client';

import { assignCustomRole, createCustomRole } from '@/app-layer/usecases/custom-roles';
import { updateTenantMemberRole } from '@/app-layer/usecases/tenant-admin';
import {
    createInviteToken,
    redeemInvite,
    redeemPendingInvitesByEmail,
} from '@/app-layer/usecases/tenant-invites';
import { BUILT_IN_SCOPE_REFUSAL, OWNER_TIER_CLEAR_REFUSAL } from '@/lib/roles';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const CHECK = 'TenantMembership_built_in_scope_role_no_custom_role';
/** The migration's own statement, used to put the CHECK back after the legacy-row case. */
const ADD_CHECK = `ALTER TABLE "TenantMembership" ADD CONSTRAINT "${CHECK}" CHECK (NOT ("role" = 'OWNER' AND "customRoleId" IS NOT NULL))`;

describeFn('an OWNER never carries a custom role (real DB, two tenants)', () => {
    let prisma: PrismaClient;
    const stamp = Date.now();

    beforeAll(async () => {
        prisma = prismaTestClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    async function tenant(suffix: string) {
        const slug = `owner-cr-${suffix}-${stamp}`;
        const result = await createTenantWithOwner({
            name: `Owner custom role ${suffix}`,
            slug,
            ownerEmail: `owner-cr-owner-${suffix}-${stamp}@example.com`,
            requestId: `req-${suffix}`,
        });
        const ownerCtx = makeRequestContext('OWNER', {
            userId: result.ownerUserId,
            tenantId: result.tenant.id,
            tenantSlug: slug,
            appPermissions: getPermissionsForRole('OWNER'),
        });
        const reader = await createCustomRole(ownerCtx, {
            name: `Readers ${suffix} ${stamp}`,
            baseRole: 'VIEWER',
            grantsJson: getPermissionsForRole('VIEWER'),
        });
        return { tenantId: result.tenant.id, slug, ownerCtx, ownerUserId: result.ownerUserId, customRoleId: reader.id };
    }

    const emailOf = (suffix: string) => `owner-cr-${suffix}-${stamp}@example.com`;

    async function user(suffix: string) {
        return prisma.user.create({ data: { email: emailOf(suffix), name: suffix }, select: { id: true } });
    }

    async function member(tenantId: string, userId: string, role: Role, customRoleId: string | null = null) {
        return prisma.tenantMembership.create({
            data: { tenantId, userId, role, status: 'ACTIVE', customRoleId },
            select: { id: true },
        });
    }

    async function adminOf(t: { tenantId: string; slug: string }, suffix: string) {
        const u = await user(`admin-${suffix}`);
        await member(t.tenantId, u.id, 'ADMIN');
        return makeRequestContext('ADMIN', {
            userId: u.id,
            tenantId: t.tenantId,
            tenantSlug: t.slug,
            appPermissions: getPermissionsForRole('ADMIN'),
        });
    }

    const stateOf = async (membershipId: string) =>
        prisma.tenantMembership.findUniqueOrThrow({
            where: { id: membershipId },
            select: { role: true, customRoleId: true, status: true },
        });

    const checkState = async () =>
        prisma.$queryRawUnsafe<Array<{ contype: string; convalidated: boolean }>>(
            `SELECT contype::text AS contype, convalidated FROM pg_constraint WHERE conname = $1`,
            CHECK,
        );

    /** A raw SQL statement's failure, as text — `null` when it succeeded. */
    async function sqlError(run: () => Promise<unknown>): Promise<string | null> {
        try {
            await run();
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    // FIRST, on purpose: a later test drops and re-adds the CHECK, and this one
    // must see what the migration itself left behind.
    it('the migration added the CHECK and VALIDATED it on a clean database', async () => {
        expect(await checkState()).toEqual([{ contype: 'c', convalidated: true }]);
    });

    it('the CHECK refuses the combination on INSERT and UPDATE, for OWNER — raw SQL, no usecase in front', async () => {
        const a = await tenant('sql');
        const insert = (id: string, userId: string, role: string, customRoleId: string | null) =>
            prisma.$executeRawUnsafe(
                `INSERT INTO "TenantMembership" (id, "tenantId", "userId", role, status, "customRoleId", "updatedAt")
                 VALUES ($1, $2, $3, $4::"Role", 'ACTIVE', $5, NOW())`,
                id,
                a.tenantId,
                userId,
                role,
                customRoleId,
            );
        const update = (id: string, set: string, ...values: unknown[]) =>
            prisma.$executeRawUnsafe(`UPDATE "TenantMembership" SET ${set} WHERE id = $1`, id, ...values);

        for (const role of ['OWNER']) {
            const tag = role.toLowerCase();
            // INSERT with a custom role: refused.
            const refusedInsert = await sqlError(async () =>
                insert(`m-${tag}-ins-${stamp}`, (await user(`sql-ins-${tag}`)).id, role, a.customRoleId),
            );
            expect(refusedInsert).toContain(CHECK);

            // INSERT without, then UPDATE a custom role onto it: refused.
            const clean = `m-${tag}-upd-${stamp}`;
            await insert(clean, (await user(`sql-upd-${tag}`)).id, role, null);
            expect(await sqlError(() => update(clean, `"customRoleId" = $2`, a.customRoleId))).toContain(CHECK);
            expect(await stateOf(clean)).toMatchObject({ role, customRoleId: null });

            // A member who carries a custom role, UPDATEd into the role: refused.
            const carrier = `m-${tag}-promote-${stamp}`;
            await insert(carrier, (await user(`sql-promote-${tag}`)).id, 'MEMBER', a.customRoleId);
            expect(await sqlError(() => update(carrier, `role = $2::"Role"`, role))).toContain(CHECK);
            expect(await stateOf(carrier)).toMatchObject({ role: 'MEMBER', customRoleId: a.customRoleId });
        }

        // Every other role still takes one — the CHECK is not a blanket ban.
        for (const role of ['ADMIN', 'MEMBER', 'VIEWER', 'GUEST']) {
            const id = `m-${role.toLowerCase()}-ok-${stamp}`;
            expect(
                await sqlError(async () => insert(id, (await user(`sql-ok-${role}`)).id, role, a.customRoleId)),
            ).toBeNull();
        }
    });

    it('assigning a custom role to an OWNER is refused for an ADMIN and for an OWNER; tenant B is unreachable and untouched', async () => {
        const a = await tenant('assign-a');
        const b = await tenant('assign-b');
        const adminA = await adminOf(a, 'assign-a');
        const secondOwner = await member(a.tenantId, (await user('second-owner')).id, 'OWNER');
        const ownerInB = await prisma.tenantMembership.findFirstOrThrow({
            where: { tenantId: b.tenantId, userId: b.ownerUserId },
            select: { id: true },
        });

        for (const ctx of [adminA, a.ownerCtx]) {
            await expect(assignCustomRole(ctx, secondOwner.id, a.customRoleId)).rejects.toMatchObject({
                status: 409,
                details: { reason: BUILT_IN_SCOPE_REFUSAL },
            });
        }
        // The caller's own OWNER membership, by the OWNER: refused all the same.
        const ownOwnerRow = await prisma.tenantMembership.findFirstOrThrow({
            where: { tenantId: a.tenantId, userId: a.ownerUserId },
            select: { id: true },
        });
        await expect(assignCustomRole(a.ownerCtx, ownOwnerRow.id, a.customRoleId)).rejects.toMatchObject({
            status: 409,
        });
        expect(await stateOf(secondOwner.id)).toMatchObject({ role: 'OWNER', customRoleId: null });
        expect(
            await prisma.auditLog.count({
                where: { tenantId: a.tenantId, entityId: secondOwner.id, action: 'MEMBER_CUSTOM_ROLE_CHANGED' },
            }),
        ).toBe(0);

        // Tenant A's OWNER cannot reach tenant B's OWNER, with A's role or B's.
        for (const roleId of [a.customRoleId, b.customRoleId]) {
            await expect(assignCustomRole(a.ownerCtx, ownerInB.id, roleId)).rejects.toThrow(/not found/i);
        }
        expect(await stateOf(ownerInB.id)).toMatchObject({ role: 'OWNER', customRoleId: null });
        expect(await prisma.auditLog.count({ where: { tenantId: b.tenantId, entityId: ownerInB.id } })).toBe(0);
    });

    it('promoting a member who carries a custom role to OWNER is refused on the members page until it is removed; B is not held back', async () => {
        const a = await tenant('promote-a');
        const b = await tenant('promote-b');
        const personUser = await user('promote-person');
        const inA = await member(a.tenantId, personUser.id, 'MEMBER');
        const inB = await member(b.tenantId, personUser.id, 'MEMBER');
        await assignCustomRole(a.ownerCtx, inA.id, a.customRoleId);

        await expect(
            updateTenantMemberRole(a.ownerCtx, { membershipId: inA.id, role: 'OWNER' }),
        ).rejects.toMatchObject({ status: 409, details: { reason: BUILT_IN_SCOPE_REFUSAL } });
        expect(await stateOf(inA.id)).toMatchObject({ role: 'MEMBER', customRoleId: a.customRoleId });
        const ownerRowA = await prisma.tenantMembership.findFirstOrThrow({
            where: { tenantId: a.tenantId, userId: a.ownerUserId },
            select: { role: true },
        });
        expect(ownerRowA.role).toBe('OWNER');

        // The same person in tenant B carries nothing there: B's promotion goes through.
        await updateTenantMemberRole(b.ownerCtx, { membershipId: inB.id, role: 'OWNER' });
        expect(await stateOf(inB.id)).toMatchObject({ role: 'OWNER', customRoleId: null });

        // The way through in A: remove the custom role, then promote.
        await assignCustomRole(a.ownerCtx, inA.id, null);
        await updateTenantMemberRole(a.ownerCtx, { membershipId: inA.id, role: 'OWNER' });
        expect(await stateOf(inA.id)).toMatchObject({ role: 'OWNER', customRoleId: null });
    });

    it('an OWNER invite for a person whose inactive membership carries a custom role is refused at creation and at redemption, and skipped at sign-in', async () => {
        const a = await tenant('invite');
        const person = await user('invite-person');
        const row = await member(a.tenantId, person.id, 'MEMBER', a.customRoleId);
        await prisma.tenantMembership.update({ where: { id: row.id }, data: { status: 'DEACTIVATED' } });

        await expect(
            createInviteToken(a.ownerCtx, { email: emailOf('invite-person'), role: 'OWNER' }),
        ).rejects.toMatchObject({ status: 409, details: { reason: BUILT_IN_SCOPE_REFUSAL } });
        expect(await prisma.tenantInvite.count({ where: { tenantId: a.tenantId } })).toBe(0);

        // An invite row written around `createInviteToken` (or before the custom
        // role was assigned) still materialises no OWNER-with-custom-role.
        const token = randomBytes(32).toString('base64url');
        const invite = await prisma.tenantInvite.create({
            data: {
                tenantId: a.tenantId,
                email: emailOf('invite-person'),
                role: 'OWNER',
                token,
                invitedById: a.ownerUserId,
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
            select: { id: true },
        });
        await expect(
            redeemInvite({ token, userId: person.id, userEmail: emailOf('invite-person') }),
        ).rejects.toMatchObject({ status: 409, details: { reason: BUILT_IN_SCOPE_REFUSAL } });
        expect(await stateOf(row.id)).toEqual({ role: 'MEMBER', customRoleId: a.customRoleId, status: 'DEACTIVATED' });

        // Re-arm it: the sign-in path skips it BEFORE claiming, so it stays pending.
        await prisma.tenantInvite.update({
            where: { id: invite.id },
            data: { acceptedAt: null, token: randomBytes(32).toString('base64url') },
        });
        await expect(
            redeemPendingInvitesByEmail({ userId: person.id, userEmail: emailOf('invite-person') }),
        ).resolves.toEqual([]);
        expect(
            (await prisma.tenantInvite.findUniqueOrThrow({ where: { id: invite.id }, select: { acceptedAt: true } }))
                .acceptedAt,
        ).toBeNull();
        expect(await stateOf(row.id)).toEqual({ role: 'MEMBER', customRoleId: a.customRoleId, status: 'DEACTIVATED' });
    });

    it('a legacy OWNER custom role: an ADMIN’s clear is refused, an OWNER’s goes through, and the CHECK is back and validated after', async () => {
        const a = await tenant('legacy');
        const adminA = await adminOf(a, 'legacy');
        const legacyOwner = await member(a.tenantId, (await user('legacy-owner')).id, 'OWNER');

        // A legacy row can only be made with the CHECK out of the way, and the
        // usecases run on their own connections, so this cannot sit inside one
        // rolled-back transaction. `finally` restores the CHECK with the
        // migration's own statement.
        await prisma.$executeRawUnsafe(`ALTER TABLE "TenantMembership" DROP CONSTRAINT "${CHECK}"`);
        try {
            await prisma.$executeRawUnsafe(
                `UPDATE "TenantMembership" SET "customRoleId" = $2 WHERE id = $1`,
                legacyOwner.id,
                a.customRoleId,
            );

            await expect(assignCustomRole(adminA, legacyOwner.id, null)).rejects.toMatchObject({
                status: 403,
                details: { reason: OWNER_TIER_CLEAR_REFUSAL },
            });
            expect(await stateOf(legacyOwner.id)).toMatchObject({ role: 'OWNER', customRoleId: a.customRoleId });

            await assignCustomRole(a.ownerCtx, legacyOwner.id, null);
            expect(await stateOf(legacyOwner.id)).toMatchObject({ role: 'OWNER', customRoleId: null });
            const audit = await prisma.auditLog.findMany({
                where: { tenantId: a.tenantId, entityId: legacyOwner.id, action: 'MEMBER_CUSTOM_ROLE_CHANGED' },
                select: { userId: true },
            });
            expect(audit).toEqual([{ userId: a.ownerUserId }]);
        } finally {
            await prisma.$executeRawUnsafe(
                `UPDATE "TenantMembership" SET "customRoleId" = NULL WHERE "tenantId" = $1 AND role = 'OWNER'`,
                a.tenantId,
            );
            await prisma.$executeRawUnsafe(ADD_CHECK);
        }
        expect(await checkState()).toEqual([{ contype: 'c', convalidated: true }]);
    });
});
