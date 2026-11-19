/**
 * Only an ADMIN membership carries a custom role built on ADMIN or granting an
 * admin-membership-only key (owner decision, 2026-10-30) — against a real
 * database, across two tenants.
 *
 * The rule has no CHECK: it depends on `grantsJson` parsed over a base
 * role's defaults, which SQL cannot see. So the usecases are the only line,
 * and each property is shown on real rows:
 *
 *   - ASSIGNMENT: a role granting a listed key, or built on ADMIN, is refused on
 *     an EDITOR membership and taken by an ADMIN one; the refused row is
 *     unchanged;
 *   - ROLE CHANGE: an ADMIN who carries an ADMIN-built role is not moved to
 *     EDITOR with it kept;
 *   - SAVE: a custom role carried by an EDITOR is not given a listed key or an
 *     ADMIN base, and the refusal counts the members holding it back; carried
 *     by ADMINs only, the same save goes through;
 *   - LEGACY: a row written before the rule — an EDITOR carrying an ADMIN-built
 *     role — is not trapped: its role can be narrowed, renamed and cleared;
 *   - TWO TENANTS: a member who is an EDITOR in tenant B and an ADMIN in tenant
 *     A takes an ADMIN-built role in A; carriers in B never count against a
 *     save in A.
 *
 * No teardown deletes: every row is under a per-run slug, and `resetDatabase`
 * truncates.
 */
import { DB_AVAILABLE } from './db-helper';
import { prismaTestClient } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { getPermissionsForRole, type PermissionSet } from '@/lib/permissions';
import type { PrismaClient, Role } from '@prisma/client';

import { assignCustomRole, createCustomRole, updateCustomRole } from '@/app-layer/usecases/custom-roles';
import { updateTenantMemberRole } from '@/app-layer/usecases/tenant-admin';
import { createTenantWithOwner } from '../helpers/tenant-fixture';
import { CUSTOM_ROLE_ADMIN_BASE_REFUSAL, CUSTOM_ROLE_ADMIN_KEYS_REFUSAL } from '@/lib/roles';
import { ADMIN_BASE_ONLY_PERMISSIONS } from '@/lib/custom-role-admin-base-rule';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

function blob(base: Role, admin: Partial<PermissionSet['admin']> = {}): PermissionSet {
    const d = getPermissionsForRole(base);
    return { ...d, admin: { ...d.admin, ...admin } };
}

describeFn('only an ADMIN membership carries an admin-only custom role (real DB, two tenants)', () => {
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
        const slug = `cr-carry-${suffix}-${stamp}`;
        const result = await createTenantWithOwner({
            name: `Carriage ${suffix}`,
            slug,
            ownerEmail: `cr-carry-owner-${suffix}-${stamp}@example.com`,
            requestId: `req-${suffix}`,
        });
        const ownerCtx = makeRequestContext('OWNER', {
            userId: result.ownerUserId,
            tenantId: result.tenant.id,
            tenantSlug: slug,
            appPermissions: getPermissionsForRole('OWNER'),
        });
        const role = async (name: string, baseRole: Role, grantsJson: PermissionSet) =>
            (await createCustomRole(ownerCtx, { name: `${name} ${suffix} ${stamp}`, baseRole, grantsJson })).id;
        return {
            tenantId: result.tenant.id,
            ownerCtx,
            card: await role('SSO editors', 'VIEWER', blob('VIEWER', { sso: true })),
            adminBuilt: await role('Admin built', 'ADMIN', blob('ADMIN')),
            plain: await role('Plain', 'VIEWER', blob('VIEWER')),
        };
    }

    async function user(suffix: string) {
        return prisma.user.create({
            data: { email: `cr-carry-${suffix}-${stamp}@example.com`, name: suffix },
            select: { id: true },
        });
    }

    async function member(tenantId: string, userId: string, role: Role, customRoleId: string | null = null) {
        return prisma.tenantMembership.create({
            data: { tenantId, userId, role, status: 'ACTIVE', customRoleId },
            select: { id: true },
        });
    }

    const stateOf = (id: string) =>
        prisma.tenantMembership.findUniqueOrThrow({ where: { id }, select: { role: true, customRoleId: true } });

    const refusal = async (p: Promise<unknown>) => {
        const err = (await p.catch((e) => e)) as { status?: number; details?: Record<string, unknown> };
        expect(err.status).toBe(409);
        return err.details;
    };

    it('ASSIGNMENT: refused on an EDITOR membership, the row unchanged; taken by an ADMIN one', async () => {
        const a = await tenant('assign');
        const editor = await member(a.tenantId, (await user('assign-editor')).id, 'MEMBER');
        const admin = await member(a.tenantId, (await user('assign-admin')).id, 'ADMIN');

        expect(await refusal(assignCustomRole(a.ownerCtx, editor.id, a.card))).toEqual({
            reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
            keys: ['admin.sso'],
        });
        expect(await refusal(assignCustomRole(a.ownerCtx, editor.id, a.adminBuilt))).toEqual({
            reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
            baseRole: 'ADMIN',
        });
        expect(await stateOf(editor.id)).toEqual({ role: 'MEMBER', customRoleId: null });

        await assignCustomRole(a.ownerCtx, editor.id, a.plain);
        await assignCustomRole(a.ownerCtx, admin.id, a.adminBuilt);
        expect(await stateOf(editor.id)).toEqual({ role: 'MEMBER', customRoleId: a.plain });
        expect(await stateOf(admin.id)).toEqual({ role: 'ADMIN', customRoleId: a.adminBuilt });
    });

    it('ROLE CHANGE: an ADMIN carrying an ADMIN-built role is not moved to EDITOR with it kept', async () => {
        const a = await tenant('change');
        const admin = await member(a.tenantId, (await user('change-admin')).id, 'ADMIN', null);
        // A second ACTIVE ADMIN, so the last-admin guard is not what refuses.
        await member(a.tenantId, (await user('change-admin-2')).id, 'ADMIN');
        await assignCustomRole(a.ownerCtx, admin.id, a.adminBuilt);

        expect(await refusal(updateTenantMemberRole(a.ownerCtx, { membershipId: admin.id, role: 'MEMBER' }))).toEqual({
            reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
            baseRole: 'ADMIN',
        });
        expect(await stateOf(admin.id)).toEqual({ role: 'ADMIN', customRoleId: a.adminBuilt });

        await assignCustomRole(a.ownerCtx, admin.id, a.plain);
        await updateTenantMemberRole(a.ownerCtx, { membershipId: admin.id, role: 'MEMBER' });
        expect(await stateOf(admin.id)).toEqual({ role: 'MEMBER', customRoleId: a.plain });
    });

    it('SAVE: a role an EDITOR carries gains no listed key and no ADMIN base, and the refusal counts its carriers', async () => {
        const a = await tenant('save');
        for (const n of [1, 2]) await member(a.tenantId, (await user(`save-editor-${n}`)).id, 'MEMBER', a.plain);
        await member(a.tenantId, (await user('save-admin')).id, 'ADMIN', a.plain);

        expect(
            await refusal(updateCustomRole(a.ownerCtx, a.plain, { grantsJson: blob('VIEWER', { scim: true }) })),
        ).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.scim'], blockingMemberships: 2 });
        expect(await refusal(updateCustomRole(a.ownerCtx, a.plain, { baseRole: 'ADMIN' }))).toEqual({
            reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
            baseRole: 'ADMIN',
            blockingMemberships: 2,
        });
        const stored = await prisma.tenantCustomRole.findUniqueOrThrow({ where: { id: a.plain } });
        expect(stored.baseRole).toBe('VIEWER');
        expect((stored.grantsJson as PermissionSet).admin.scim).toBe(false);

        // Carried by ADMINs only, the same save goes through.
        const adminsOnly = await createCustomRole(a.ownerCtx, {
            name: `Admins only ${stamp}`,
            baseRole: 'VIEWER',
            grantsJson: blob('VIEWER'),
        });
        await member(a.tenantId, (await user('save-admin-only')).id, 'ADMIN', adminsOnly.id);
        await updateCustomRole(a.ownerCtx, adminsOnly.id, { baseRole: 'ADMIN' });
        expect((await prisma.tenantCustomRole.findUniqueOrThrow({ where: { id: adminsOnly.id } })).baseRole).toBe('ADMIN');
    });

    it('LEGACY: an EDITOR carrying an ADMIN-built role from before the rule is narrowed, renamed and cleared', async () => {
        const a = await tenant('legacy');
        // Written around every usecase, as data from before the rule would be.
        const legacy = await member(a.tenantId, (await user('legacy-editor')).id, 'MEMBER', a.adminBuilt);

        await updateCustomRole(a.ownerCtx, a.adminBuilt, { name: `Renamed ${stamp}` });
        // Narrowed: an admin-only key off, and every permission the Admin-base
        // rule keeps to an ADMIN base off (#4536, #4581 A), so the base can be
        // lowered next.
        const narrowed = structuredClone(blob('ADMIN', { sso: false }));
        for (const key of ADMIN_BASE_ONLY_PERMISSIONS) {
            const [domain, action] = key.split('.') as [keyof PermissionSet, string];
            (narrowed[domain] as Record<string, boolean>)[action] = false;
        }
        await updateCustomRole(a.ownerCtx, a.adminBuilt, { grantsJson: narrowed });
        await updateCustomRole(a.ownerCtx, a.adminBuilt, { baseRole: 'MEMBER' });
        await updateTenantMemberRole(a.ownerCtx, { membershipId: legacy.id, role: 'VIEWER' });
        await assignCustomRole(a.ownerCtx, legacy.id, null);
        expect(await stateOf(legacy.id)).toEqual({ role: 'VIEWER', customRoleId: null });
    });

    it('TWO TENANTS: an ADMIN in A takes an ADMIN-built role there whatever they are in B, and B’s carriers never count in A', async () => {
        const a = await tenant('two-a');
        const b = await tenant('two-b');
        const person = await user('two-person');
        const inA = await member(a.tenantId, person.id, 'ADMIN');
        await member(b.tenantId, person.id, 'MEMBER', b.plain);

        await assignCustomRole(a.ownerCtx, inA.id, a.adminBuilt);
        expect(await stateOf(inA.id)).toEqual({ role: 'ADMIN', customRoleId: a.adminBuilt });

        // A has no non-ADMIN carrier of its `plain`; B's EDITOR carries B's.
        await updateCustomRole(a.ownerCtx, a.plain, { baseRole: 'ADMIN' });
        expect(await refusal(updateCustomRole(b.ownerCtx, b.plain, { baseRole: 'ADMIN' }))).toMatchObject({
            blockingMemberships: 1,
        });

        // And A's owner cannot reach B's membership at all.
        const inB = await prisma.tenantMembership.findFirstOrThrow({
            where: { tenantId: b.tenantId, userId: person.id },
            select: { id: true },
        });
        await expect(assignCustomRole(a.ownerCtx, inB.id, a.plain)).rejects.toMatchObject({ status: 404 });
    });
});
