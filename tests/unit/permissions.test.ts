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

import { PERMISSION_SCHEMA, effectiveRoleOfMembership, getPermissionsForRole, parsePermissionsJson, permissionsForMembership } from '@/lib/permissions';
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
            'goals',
            'time',
            'workload',
            'analytics',
            'pages',
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

    it('MEMBER does the work and administers nothing (pages: all five keys, decision 339)', () => {
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
                'goals.view',
                'goals.manage',
                'time.view',
                'time.track',
                'workload.view',
                'workload.time_off',
                'analytics.view',
                'analytics.share',
                'pages.view',
                'pages.create',
                'pages.edit',
                'pages.comment',
                'pages.delete',
                'canvas.view',
                'canvas.edit',
                'automations.view',
                'integrations.view',
                'agents.view',
                'agents.delegate',
            ].sort(),
        );
    });

    it('VIEWER reads every project and agent, and writes nothing but its own personal views (decision 60) and its own time off (decision 298)', () => {
        expect(granted(getPermissionsForRole('VIEWER'))).toEqual(
            [
                'workspace.view',
                'projects.view',
                'work_items.view',
                'views.view',
                'views.create',
                'views.edit',
                'cycles.view',
                'goals.view',
                'time.view',
                'workload.view',
                'workload.time_off',
                'analytics.view',
                'pages.view',
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

    it('goals (decision 213): Owners, Admins and Members view and manage, Viewers view, Guests nothing', () => {
        const goalKeys = (role: Role) => granted(getPermissionsForRole(role)).filter((k) => k.startsWith('goals.'));
        expect(goalKeys('OWNER')).toEqual(['goals.manage', 'goals.view']);
        expect(goalKeys('ADMIN')).toEqual(['goals.manage', 'goals.view']);
        expect(goalKeys('MEMBER')).toEqual(['goals.manage', 'goals.view']);
        expect(goalKeys('VIEWER')).toEqual(['goals.view']);
        expect(goalKeys('GUEST')).toEqual([]);
    });

    it('time (decision 265): Owners and Admins all four keys, Members view and track, Viewers view, Guests nothing', () => {
        const timeKeys = (role: Role) => granted(getPermissionsForRole(role)).filter((k) => k.startsWith('time.'));
        expect(timeKeys('OWNER')).toEqual(['time.approve', 'time.rates', 'time.track', 'time.view']);
        expect(timeKeys('ADMIN')).toEqual(['time.approve', 'time.rates', 'time.track', 'time.view']);
        expect(timeKeys('MEMBER')).toEqual(['time.track', 'time.view']);
        expect(timeKeys('VIEWER')).toEqual(['time.view']);
        expect(timeKeys('GUEST')).toEqual([]);
    });

    it('a custom role stored before 3.4 has no time domain and takes its base role time keys', () => {
        const before = Object.fromEntries(Object.entries(getPermissionsForRole('MEMBER')).filter(([d]) => d !== 'time'));
        expect(parsePermissionsJson(before, 'MEMBER').time).toEqual({ view: true, track: true, approve: false, rates: false });
        expect(parsePermissionsJson(before, 'VIEWER').time).toEqual({ view: true, track: false, approve: false, rates: false });
    });

    it('workload (decision 298): Owners and Admins all three keys, Members and Viewers view and time_off, Guests nothing', () => {
        const workloadKeys = (role: Role) => granted(getPermissionsForRole(role)).filter((k) => k.startsWith('workload.'));
        expect(workloadKeys('OWNER')).toEqual(['workload.manage', 'workload.time_off', 'workload.view']);
        expect(workloadKeys('ADMIN')).toEqual(['workload.manage', 'workload.time_off', 'workload.view']);
        expect(workloadKeys('MEMBER')).toEqual(['workload.time_off', 'workload.view']);
        expect(workloadKeys('VIEWER')).toEqual(['workload.time_off', 'workload.view']);
        expect(workloadKeys('GUEST')).toEqual([]);
    });

    it('a custom role stored before 3.5 has no workload domain and takes its base role workload keys', () => {
        const before = Object.fromEntries(Object.entries(getPermissionsForRole('MEMBER')).filter(([d]) => d !== 'workload'));
        expect(parsePermissionsJson(before, 'MEMBER').workload).toEqual({ view: true, time_off: true, manage: false });
        expect(parsePermissionsJson(before, 'ADMIN').workload).toEqual({ view: true, time_off: true, manage: true });
    });

    it('analytics (decision 329): Owners and Admins all three keys, Members view and share, Viewers view, Guests nothing', () => {
        const analyticsKeys = (role: Role) => granted(getPermissionsForRole(role)).filter((k) => k.startsWith('analytics.'));
        expect(analyticsKeys('OWNER')).toEqual(['analytics.people', 'analytics.share', 'analytics.view']);
        expect(analyticsKeys('ADMIN')).toEqual(['analytics.people', 'analytics.share', 'analytics.view']);
        expect(analyticsKeys('MEMBER')).toEqual(['analytics.share', 'analytics.view']);
        expect(analyticsKeys('VIEWER')).toEqual(['analytics.view']);
        expect(analyticsKeys('GUEST')).toEqual([]);
    });

    it('a custom role stored before 3.6 has no analytics domain and takes its base role analytics keys', () => {
        const before = Object.fromEntries(Object.entries(getPermissionsForRole('MEMBER')).filter(([d]) => d !== 'analytics'));
        expect(parsePermissionsJson(before, 'MEMBER').analytics).toEqual({ view: true, share: true, people: false });
        expect(parsePermissionsJson(before, 'VIEWER').analytics).toEqual({ view: true, share: false, people: false });
        expect(parsePermissionsJson(before, 'ADMIN').analytics).toEqual({ view: true, share: true, people: true });
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
        ['MEMBER', 'goals.manage', true],
        ['VIEWER', 'goals.view', true],
        ['VIEWER', 'goals.manage', false],
        ['GUEST', 'goals.view', false],
        ['MEMBER', 'time.track', true],
        ['MEMBER', 'time.approve', false],
        ['MEMBER', 'time.rates', false],
        ['VIEWER', 'time.view', true],
        ['VIEWER', 'time.track', false],
        ['ADMIN', 'time.approve', true],
        ['ADMIN', 'time.rates', true],
        ['GUEST', 'time.view', false],
        ['GUEST', 'time.track', false],
        ['MEMBER', 'workload.time_off', true],
        ['MEMBER', 'workload.manage', false],
        ['VIEWER', 'workload.view', true],
        ['VIEWER', 'workload.time_off', true],
        ['VIEWER', 'workload.manage', false],
        ['ADMIN', 'workload.manage', true],
        ['GUEST', 'workload.view', false],
        ['GUEST', 'workload.time_off', false],
        ['MEMBER', 'analytics.view', true],
        ['MEMBER', 'analytics.people', false],
        ['VIEWER', 'analytics.view', true],
        ['VIEWER', 'analytics.share', false],
        ['ADMIN', 'analytics.people', true],
        ['GUEST', 'analytics.view', false],
    ] as const)('%s → %s is %s', (role, key, expected) => {
        expect(hasPermission(getPermissionsForRole(role), key)).toBe(expected);
    });
});
