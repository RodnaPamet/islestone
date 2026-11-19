/**
 * The admin pages ask the edge (#4467, #4466, generalised from #4471): a page
 * offers an admin-API write only where the edge, the route's key and the
 * usecase's floor would all let it through.
 *
 *   - `offersAdminApiWrite` composes the three, and fails on any one;
 *   - the admin pages' edge verdict is #4587's `membershipOpensAdminConsole`
 *     over the membership's own role, and it IS the edge's answer —
 *     `checkAdminAccess` itself — for the custom roles and integrations APIs,
 *     for every role; a missing role is not admitted;
 *
 * Copied from inflect-compliance at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 * The agent-register case (Phase 6) and the tenant-layout case (the layout
 * arrives with the app shell, 1.7) are not ported.
 */
import { checkAdminAccess } from '@/lib/auth/guard';
import { offersAdminApiWrite } from '@/lib/auth/admin-api-affordances';
import { membershipOpensAdminConsole } from '@/lib/auth/edge-admin-roles';
import { getPermissionsForRole } from '@/lib/permissions';
import { TENANT_ROLES } from '@/lib/roles';

const admin = getPermissionsForRole('ADMIN');
const claims = (role: string) => ({ role: 'VIEWER', memberships: [{ slug: 'acme', role }] });

describe('offersAdminApiWrite — all three gates, or nothing', () => {
    const viewer = { edgeAdmits: true, appPermissions: admin, permissions: { canAdmin: true, canWrite: true } };

    it('offers the write when the edge admits, the key is held and the floor is met', () => {
        expect(offersAdminApiWrite(viewer, { key: 'admin.manage', floor: 'canAdmin' })).toBe(true);
        expect(offersAdminApiWrite(viewer, { key: 'admin.manage' })).toBe(true);
        expect(offersAdminApiWrite(viewer, { key: 'admin.manage', floor: true })).toBe(true);
    });

    it('withholds it when any one gate refuses', () => {
        expect(offersAdminApiWrite({ ...viewer, edgeAdmits: false }, { key: 'admin.manage' })).toBe(false);
        expect(
            offersAdminApiWrite(
                { ...viewer, appPermissions: { ...admin, admin: { ...admin.admin, manage: false } } },
                { key: 'admin.manage' },
            ),
        ).toBe(false);
        expect(
            offersAdminApiWrite({ ...viewer, permissions: { canAdmin: false, canWrite: true } }, { key: 'admin.manage', floor: 'canAdmin' }),
        ).toBe(false);
        expect(offersAdminApiWrite(viewer, { key: 'admin.manage', floor: false })).toBe(false);
        expect(offersAdminApiWrite({ ...viewer, appPermissions: null }, { key: 'admin.manage' })).toBe(false);
    });
});

describe('the admin pages’ edge verdict is the edge’s own answer', () => {
    const PAGES = ['/admin/roles', '/admin/roles/cr-1', '/admin/members', '/admin/settings'];

    it.each(TENANT_ROLES)('for a %s membership, it equals checkAdminAccess on the roles, members and settings APIs', (role) => {
        const verdict = membershipOpensAdminConsole(role);
        for (const page of PAGES) {
            for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
                const edge = checkAdminAccess(`/api/t/acme${page}`, 'VIEWER', claims(role).memberships, method) !== 'deny';
                expect({ role, page, method, edge }).toEqual({ role, page, method, edge: verdict });
            }
        }
    });

    it('admits exactly OWNER and ADMIN memberships — a custom role never enters it — and not a missing role', () => {
        expect(TENANT_ROLES.filter((role) => membershipOpensAdminConsole(role))).toEqual(['OWNER', 'ADMIN']);
        expect(membershipOpensAdminConsole(undefined)).toBe(false);
        expect(membershipOpensAdminConsole(null)).toBe(false);
    });
});
