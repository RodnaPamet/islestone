/**
 * Custom Role Permission Helpers. Copied from inflect-compliance
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) with Islestone's domains.
 *
 * Tests for validatePermissionsJson, parsePermissionsJson, and
 * backward compatibility of getPermissionsForRole.
 */
import {
    getPermissionsForRole,
    validatePermissionsJson,
    parsePermissionsJson,
    type PermissionSet,
} from '@/lib/permissions';

// ─── Helper: build a complete valid PermissionSet JSON ───

function makeValidPermissions(overrides: Partial<Record<keyof PermissionSet, Partial<Record<string, boolean>>>> = {}): PermissionSet {
    const base = getPermissionsForRole('VIEWER');
    for (const [domain, actions] of Object.entries(overrides)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (base as any)[domain] = {
            ...(base as Record<string, Record<string, boolean>>)[domain],
            ...actions,
        };
    }
    return base;
}

// ═══════════════════════════════════════════════════════════════
//  getPermissionsForRole — backward compatibility
// ═══════════════════════════════════════════════════════════════

describe('getPermissionsForRole', () => {
    test('ADMIN gets full permissions', () => {
        const perms = getPermissionsForRole('ADMIN');
        expect(perms.admin.manage).toBe(true);
        expect(perms.admin.members).toBe(true);
        expect(perms.projects.create).toBe(true);
        expect(perms.billing.manage).toBe(true);
    });

    test('VIEWER gets view-only', () => {
        const perms = getPermissionsForRole('VIEWER');
        expect(perms.projects.view).toBe(true);
        expect(perms.projects.create).toBe(false);
        expect(perms.admin.manage).toBe(false);
    });

    test('all five roles produce valid PermissionSet shapes', () => {
        const roles = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER', 'GUEST'] as const;
        for (const role of roles) {
            const perms = getPermissionsForRole(role);
            // Every PermissionSet must have all sixteen domains (intake, 2.6a; goals, 3.2a; time, 3.4b; workload, 3.5a). Spelled out
            // rather than derived from PERMISSION_SCHEMA on purpose: derived,
            // it would compare the runtime bag against a list the same commit
            // edits, and agree with itself. A widening of the permission model
            // has to be written here too, which is what makes it deliberate.
            expect(Object.keys(perms).sort()).toEqual([
                'admin', 'agents', 'automations', 'billing', 'canvas', 'cycles',
                'docs', 'goals', 'intake', 'integrations', 'projects', 'time', 'views', 'work_items', 'workload', 'workspace',
            ]);
        }
    });
});

// ═══════════════════════════════════════════════════════════════
//  validatePermissionsJson
// ═══════════════════════════════════════════════════════════════

describe('validatePermissionsJson', () => {
    test('valid PermissionSet returns zero errors', () => {
        const perms = getPermissionsForRole('MEMBER');
        expect(validatePermissionsJson(perms)).toEqual([]);
    });

    test('null input returns error', () => {
        const errors = validatePermissionsJson(null);
        expect(errors).toEqual(['grantsJson must be a non-null object']);
    });

    test('array input returns error', () => {
        const errors = validatePermissionsJson([]);
        expect(errors).toEqual(['grantsJson must be a non-null object']);
    });

    test('string input returns error', () => {
        const errors = validatePermissionsJson('hello');
        expect(errors).toEqual(['grantsJson must be a non-null object']);
    });

    test('missing domain is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const partial = { ...perms } as any;
        delete partial.admin;
        const errors = validatePermissionsJson(partial);
        expect(errors).toContain('Missing permission domain: "admin"');
    });

    test('missing action within a domain is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const modified = { ...perms, projects: { view: true, create: true } } as any;
        // "edit" is missing
        const errors = validatePermissionsJson(modified);
        expect(errors).toContain('Missing action "projects.edit"');
    });

    test('non-boolean action value is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        const modified = {
            ...perms,
            projects: { view: 'yes', create: false, edit: false },
        };
        const errors = validatePermissionsJson(modified);
        expect(errors).toContain('"projects.view" must be boolean, got string');
    });

    test('unexpected domain is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        const modified = { ...perms, controls: { view: true } };
        const errors = validatePermissionsJson(modified);
        expect(errors).toContain('Unexpected permission domain: "controls"');
    });

    test('unexpected action within a domain is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        const modified = {
            ...perms,
            projects: { ...perms.projects, destroy: true },
        };
        const errors = validatePermissionsJson(modified);
        expect(errors).toContain('Unexpected action "projects.destroy"');
    });

    test('domain that is not an object is flagged', () => {
        const perms = getPermissionsForRole('VIEWER');
        const modified = { ...perms, projects: 'invalid' };
        const errors = validatePermissionsJson(modified);
        expect(errors).toContain('Permission domain "projects" must be an object');
    });

    test('custom role with all permissions valid passes', () => {
        const custom = makeValidPermissions({
            projects: { create: true, edit: true },
            admin: { view: true, manage: true, members: true, sso: false, scim: false },
        });
        expect(validatePermissionsJson(custom)).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════
//  parsePermissionsJson
// ═══════════════════════════════════════════════════════════════

describe('parsePermissionsJson', () => {
    test('valid JSON returns exact PermissionSet', () => {
        const input = getPermissionsForRole('MEMBER');
        const result = parsePermissionsJson(input, 'VIEWER');
        expect(result).toEqual(input);
    });

    test('null falls back to base role defaults', () => {
        const result = parsePermissionsJson(null, 'ADMIN');
        expect(result).toEqual(getPermissionsForRole('ADMIN'));
    });

    test('empty object falls back to base role for all domains', () => {
        const result = parsePermissionsJson({}, 'MEMBER');
        expect(result).toEqual(getPermissionsForRole('MEMBER'));
    });

    test('partial override merges with base role defaults', () => {
        const partial = {
            projects: { view: true, create: true, edit: true },
            // Other domains missing — should fall back to VIEWER defaults
        };
        const result = parsePermissionsJson(partial, 'VIEWER');
        // Override applied
        expect(result.projects.create).toBe(true);
        // Fallback preserved
        expect(result.admin).toEqual(getPermissionsForRole('VIEWER').admin);
        expect(result.workspace).toEqual(getPermissionsForRole('VIEWER').workspace);
    });

    test('invalid action types within a domain fall back to base role', () => {
        const input = {
            ...getPermissionsForRole('VIEWER'),
            projects: { view: 'not-a-boolean', create: false, edit: false },
        };
        const result = parsePermissionsJson(input, 'ADMIN');
        // The invalid "view" falls back to ADMIN default (true)
        expect(result.projects.view).toBe(true);
        // The valid booleans are preserved
        expect(result.projects.create).toBe(false);
    });

    test('missing actions within a domain fall back to base role', () => {
        const input = {
            ...getPermissionsForRole('VIEWER'),
            // "edit" is missing from controls
            projects: { view: false, create: true },
        };
        const result = parsePermissionsJson(input, 'MEMBER');
        // Present fields used
        expect(result.projects.view).toBe(false);
        expect(result.projects.create).toBe(true);
        // Missing "edit" falls back to MEMBER default (true)
        expect(result.projects.edit).toBe(true);
    });

    test('array input falls back to base role defaults', () => {
        const result = parsePermissionsJson([], 'GUEST');
        expect(result).toEqual(getPermissionsForRole('GUEST'));
    });
});
