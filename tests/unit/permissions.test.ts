/**
 * The role matrix — the record of Islestone's `PermissionSet` (sub-phase 1.4).
 *
 * REWRITE of inflect-compliance `tests/unit/permissions.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e): the parent's sample of
 * compliance keys becomes the whole matrix of docs/porting/maps/1.4.md,
 * "Permission set", spelled out cell by cell, so a change to any grant shows
 * as a change here. Until the docs site (8.6) generates the roles page, this
 * table is the matrix's record.
 */
import type { Role } from '@prisma/client';

import { PERMISSION_SCHEMA, effectiveRoleOfMembership, getPermissionsForRole, permissionsForMembership } from '@/lib/permissions';
import type { PermissionSet } from '@/lib/permissions';
import { hasPermission } from '@/lib/security/permission-middleware';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'];

/** Every key a role holds, as `domain.action`. */
function granted(set: PermissionSet): string[] {
    const out: string[] = [];
    for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
        for (const action of PERMISSION_SCHEMA[domain]) {
            if ((set[domain] as Record<string, boolean>)[action]) out.push(`${domain}.${action}`);
        }
    }
    return out.sort();
}

const ALL = (Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[])
    .flatMap((d) => PERMISSION_SCHEMA[d].map((a) => `${d}.${a}`))
    .sort();

describe('the PermissionSet schema', () => {
    it('names exactly the project-management domains of roadmap 1.4', () => {
        expect(Object.keys(PERMISSION_SCHEMA)).toEqual([
            'workspace',
            'projects',
            'work_items',
            'views',
            'cycles',
            'intake',
            'docs',
            'canvas',
            'automations',
            'integrations',
            'agents',
            'billing',
            'admin',
        ]);
    });

    it('every role resolves to a complete set: each schema key present and boolean', () => {
        for (const role of ROLES) {
            const set = getPermissionsForRole(role) as unknown as Record<string, Record<string, unknown>>;
            expect(Object.keys(set).sort()).toEqual(Object.keys(PERMISSION_SCHEMA).sort());
            for (const domain of Object.keys(PERMISSION_SCHEMA) as (keyof PermissionSet)[]) {
                expect(Object.keys(set[domain]!).sort()).toEqual([...PERMISSION_SCHEMA[domain]].sort());
                for (const v of Object.values(set[domain]!)) expect(typeof v).toBe('boolean');
            }
        }
    });

    it('carries none of the parent compliance domains', () => {
        for (const gone of ['controls', 'evidence', 'policies', 'risks', 'audits', 'frameworks', 'reports', 'tasks']) {
            expect(PERMISSION_SCHEMA).not.toHaveProperty(gone);
        }
    });
});

describe('the role matrix', () => {
    it('OWNER holds every key', () => {
        expect(granted(getPermissionsForRole('OWNER'))).toEqual(ALL);
    });

    it('ADMIN holds every key but the two OWNER-only ones', () => {
        expect(granted(getPermissionsForRole('ADMIN'))).toEqual(
            ALL.filter((k) => k !== 'admin.tenant_lifecycle' && k !== 'admin.owner_management'),
        );
    });

    it('MEMBER does the work and administers nothing', () => {
        expect(granted(getPermissionsForRole('MEMBER'))).toEqual(
            [
                'workspace.view',
                'projects.view',
                'projects.create',
                'projects.edit',
                'work_items.view',
                'work_items.create',
                'work_items.edit',
                'work_items.assign',
                'work_items.comment',
                'views.view',
                'views.create',
                'views.edit',
                'views.share',
                'cycles.view',
                'cycles.manage',
                'intake.view',
                'intake.triage',
                'docs.view',
                'docs.create',
                'docs.edit',
                'canvas.view',
                'canvas.edit',
                'automations.view',
                'integrations.view',
                'agents.view',
                'agents.delegate',
            ].sort(),
        );
    });

    it('VIEWER reads every project and agent, and writes nothing but its own personal views (decision 60)', () => {
        expect(granted(getPermissionsForRole('VIEWER'))).toEqual(
            [
                'workspace.view',
                'projects.view',
                'work_items.view',
                'views.view',
                'views.create',
                'views.edit',
                'cycles.view',
                'docs.view',
                'canvas.view',
                'agents.view',
            ].sort(),
        );
    });

    it('GUEST holds no key until 8.4 (owner decision 204): it reads no workspace data and writes nothing', () => {
        expect(granted(getPermissionsForRole('GUEST'))).toEqual([]);
    });

    it('a GUEST membership resolves to nothing and stays GUEST whatever custom role it carries (decision 204)', () => {
        const everything = Object.fromEntries(Object.entries(PERMISSION_SCHEMA).map(([d, actions]) => [d, Object.fromEntries(actions.map((a) => [a, true]))]));
        const carried = { role: 'GUEST' as const, customRole: { baseRole: 'MEMBER' as const, grantsJson: everything } };
        expect(granted(permissionsForMembership(carried))).toEqual([]);
        expect(effectiveRoleOfMembership(carried)).toBe('GUEST');
        // Any other membership keeps its custom role, as before.
        const member = { role: 'VIEWER' as const, customRole: { baseRole: 'MEMBER' as const, grantsJson: everything } };
        expect(granted(permissionsForMembership(member))).toContain('work_items.edit');
        expect(effectiveRoleOfMembership(member)).toBe('MEMBER');
        expect(effectiveRoleOfMembership({ role: 'VIEWER', customRole: null })).toBe('VIEWER');
    });

    it('intake (decision 92): Owners and Admins hold all three keys, Members read and triage, Viewers and Guests none', () => {
        const intakeKeys = (role: Role) => granted(getPermissionsForRole(role)).filter((k) => k.startsWith('intake.'));
        expect(intakeKeys('OWNER')).toEqual(['intake.manage', 'intake.triage', 'intake.view']);
        expect(intakeKeys('ADMIN')).toEqual(['intake.manage', 'intake.triage', 'intake.view']);
        expect(intakeKeys('MEMBER')).toEqual(['intake.triage', 'intake.view']);
        expect(intakeKeys('VIEWER')).toEqual([]);
        expect(intakeKeys('GUEST')).toEqual([]);
    });

    it('no role but OWNER and ADMIN holds an admin or billing key', () => {
        for (const role of ['MEMBER', 'VIEWER', 'GUEST'] as const) {
            const keys = granted(getPermissionsForRole(role));
            expect(keys.filter((k) => k.startsWith('admin.') || k.startsWith('billing.'))).toEqual([]);
        }
    });

    it('an unknown role falls back to VIEWER, never GUEST (ADR 0006)', () => {
        expect(getPermissionsForRole('NOT_A_ROLE' as Role)).toEqual(getPermissionsForRole('VIEWER'));
        expect(getPermissionsForRole('NOT_A_ROLE' as Role)).not.toEqual(getPermissionsForRole('GUEST'));
    });

    it('each call returns a fresh object: mutating one result does not change the next', () => {
        const first = getPermissionsForRole('ADMIN');
        first.admin.owner_management = true;
        expect(getPermissionsForRole('ADMIN').admin.owner_management).toBe(false);
    });
});

describe('hasPermission over the matrix', () => {
    it.each([
        ['OWNER', 'admin.tenant_lifecycle', true],
        ['ADMIN', 'admin.tenant_lifecycle', false],
        ['ADMIN', 'admin.members', true],
        ['MEMBER', 'admin.members', false],
        ['MEMBER', 'work_items.create', true],
        ['VIEWER', 'work_items.create', false],
        ['VIEWER', 'views.create', true],
        ['VIEWER', 'views.edit', true],
        ['VIEWER', 'views.share', false],
        ['GUEST', 'views.create', false],
        ['GUEST', 'work_items.comment', false],
        ['GUEST', 'work_items.view', false],
        ['GUEST', 'projects.view', false],
        ['GUEST', 'agents.view', false],
        ['ADMIN', 'intake.manage', true],
        ['MEMBER', 'intake.manage', false],
        ['MEMBER', 'intake.triage', true],
        ['VIEWER', 'intake.view', false],
        ['GUEST', 'intake.view', false],
    ] as const)('%s → %s is %s', (role, key, expected) => {
        expect(hasPermission(getPermissionsForRole(role), key)).toBe(expected);
    });
});
