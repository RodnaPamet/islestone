/**
 * `getOrgPermissions` unit contract.
 *
 * Copied from inflect-compliance `tests/unit/org-permissions.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) and cut to the organization
 * flags Islestone keeps (sub-phase 1.3's `OrgPermissionSet`; the parent's
 * dashboard, threat-level, maturity and agent-switch flags are compliance or
 * Phase 6). Any change to the mapping must update this test in the same
 * diff — the explicit per-role assertion makes a "looser ORG_READER" change
 * review-visible.
 */
import { getOrgPermissions } from '@/lib/permissions';
import type { OrgPermissionSet } from '@/lib/permissions';

describe('getOrgPermissions', () => {
    it('ORG_OWNER is granted every capability, the owner-only ones included', () => {
        expect(getOrgPermissions('ORG_OWNER')).toEqual<OrgPermissionSet>({
            canViewWorkspaces: true,
            canManageTenants: true,
            canManageMembers: true,
            canManageOwners: true,
        });
    });

    it('ORG_ADMIN is granted every capability but the owner-only ones', () => {
        expect(getOrgPermissions('ORG_ADMIN')).toEqual<OrgPermissionSet>({
            canViewWorkspaces: true,
            canManageTenants: false,
            canManageMembers: true,
            canManageOwners: false,
        });
    });

    it('ORG_READER sees the workspaces, nothing else', () => {
        expect(getOrgPermissions('ORG_READER')).toEqual<OrgPermissionSet>({
            canViewWorkspaces: true,
            canManageTenants: false,
            canManageMembers: false,
            canManageOwners: false,
        });
    });

    it('an unknown role gets the zero-permission bag (fail closed)', () => {
        expect(getOrgPermissions('NOT_A_ROLE' as never)).toEqual<OrgPermissionSet>({
            canViewWorkspaces: false,
            canManageTenants: false,
            canManageMembers: false,
            canManageOwners: false,
        });
    });
});
