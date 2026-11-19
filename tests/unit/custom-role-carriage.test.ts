/**
 * Which custom roles only an ADMIN membership may carry — THE RULE, as the
 * pure predicate every writer asks.
 *
 *   1. On any membership but ADMIN, a custom role may not grant one of the
 *      `ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS` (`admin.sso`, `admin.scim`).
 *   2. A custom role built on ADMIN may only be carried by an ADMIN
 *      membership: its base sets the coarse tier everywhere but the edge.
 *
 * Only what a change ADDS is refused, so a row written before the rule is
 * never trapped. The writers and their census are
 * `tests/unit/custom-role-carriage-writers.test.ts`.
 *
 * Copied from inflect-compliance `tests/unit/custom-role-carriage.test.ts`
 * (5528464fc54a8681956f3b9ce23ca9c075f0420e) and rewritten for Islestone's
 * two keys and roles: the parent's eleven keys were agent and DSAR keys.
 */
import type { CustomRoleForCarriage } from '@/lib/roles';
import {
    ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS,
    CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
    CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
    TENANT_ROLES,
    adminMembershipOnlyKeysGranted,
    customRoleCarriageDetails,
    customRoleCarriageMessage,
    customRoleCarriageOffence,
    customRoleCarriageRefusal,
    customRoleCarriageRefusalOf,
} from '@/lib/roles';
import type { PermissionSet } from '@/lib/permissions';
import { PERMISSION_SCHEMA, getPermissionsForRole } from '@/lib/permissions';

const NON_ADMIN_CARRIERS = ['MEMBER', 'VIEWER', 'GUEST'] as const;

/** A full blob: `base`'s defaults with `admin` keys switched as given. */
function role(base: string, admin: Partial<PermissionSet['admin']> = {}): CustomRoleForCarriage {
    const defaults = getPermissionsForRole(base as never);
    return { baseRole: base, grantsJson: { ...defaults, admin: { ...defaults.admin, ...admin } } };
}

const on = (membershipRole: string, customRole: CustomRoleForCarriage | null) => ({ membershipRole, customRole });

describe('the list', () => {
    it('is exactly sso and scim, and each is a real admin key', () => {
        expect([...ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS]).toEqual(['sso', 'scim']);
        for (const key of ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS) expect(PERMISSION_SCHEMA.admin).toContain(key);
    });

    it('no MEMBER, VIEWER or GUEST holds one by default, so a custom role copying its own role breaks nothing', () => {
        for (const r of NON_ADMIN_CARRIERS) {
            expect(adminMembershipOnlyKeysGranted(getPermissionsForRole(r))).toEqual([]);
        }
    });
});

describe('rule 1 — the admin-membership-only keys', () => {
    it.each(NON_ADMIN_CARRIERS)('a VIEWER-based role granting sso is refused on a %s membership', (carrier) => {
        expect(customRoleCarriageRefusal(on(carrier, role('VIEWER', { sso: true })), null)).toEqual({
            reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
            keys: ['sso'],
        });
    });

    it('the same role on an ADMIN membership is allowed — both keys at once', () => {
        expect(customRoleCarriageRefusal(on('ADMIN', role('VIEWER', { sso: true, scim: true })), null)).toBeNull();
    });

    it('every other admin key stays allowed on any membership', () => {
        const others = PERMISSION_SCHEMA.admin.filter((k) => !(ADMIN_MEMBERSHIP_ONLY_ADMIN_KEYS as readonly string[]).includes(k));
        const grant = Object.fromEntries(others.map((k) => [k, true])) as Partial<PermissionSet['admin']>;
        expect(customRoleCarriageOffence(on('VIEWER', role('VIEWER', grant))).adminKeys).toEqual([]);
    });

    it('names every key granted, in list order, and only those', () => {
        expect(customRoleCarriageOffence(on('MEMBER', role('MEMBER', { scim: true, sso: true }))).adminKeys).toEqual([
            'sso',
            'scim',
        ]);
    });

    it('reads the EFFECTIVE grant: a legacy blob missing a key takes its base’s default for it', () => {
        // A blob with no `admin` domain on an ADMIN base takes ADMIN's sso and scim.
        const legacy: CustomRoleForCarriage = { baseRole: 'ADMIN', grantsJson: {} };
        expect(customRoleCarriageOffence(on('MEMBER', legacy)).adminKeys).toEqual(['sso', 'scim']);
    });
});

describe('rule 2 — an ADMIN base', () => {
    it.each(NON_ADMIN_CARRIERS)('a role built on ADMIN is refused on a %s membership', (carrier) => {
        expect(customRoleCarriageRefusal(on(carrier, role('ADMIN', { sso: false, scim: false })), null)).toEqual({
            reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL,
            baseRole: 'ADMIN',
        });
    });

    it('is asked before the keys: an ADMIN-built role granting keys is refused for its base', () => {
        expect(customRoleCarriageRefusal(on('VIEWER', role('ADMIN')), null)?.reason).toBe(CUSTOM_ROLE_ADMIN_BASE_REFUSAL);
    });

    it('an OWNER base is judged by its tier, as ADMIN is', () => {
        expect(customRoleCarriageOffence(on('MEMBER', role('OWNER', { sso: false, scim: false }))).adminBase).toBe('OWNER');
    });

    it('allowed on an ADMIN membership, and a MEMBER or VIEWER base is allowed on any', () => {
        expect(customRoleCarriageRefusal(on('ADMIN', role('ADMIN')), null)).toBeNull();
        for (const base of ['MEMBER', 'VIEWER']) {
            for (const carrier of NON_ADMIN_CARRIERS) {
                expect(customRoleCarriageRefusal(on(carrier, role(base)), null)).toBeNull();
            }
        }
    });
});

describe('only what a change ADDS is refused — existing rows are not trapped', () => {
    const offending = role('VIEWER', { sso: true, scim: true });

    it('clearing the custom role, or replacing it with one that offends less, passes', () => {
        expect(customRoleCarriageRefusal(on('VIEWER', null), on('VIEWER', offending))).toBeNull();
        expect(customRoleCarriageRefusal(on('VIEWER', role('VIEWER', { sso: true })), on('VIEWER', offending))).toBeNull();
    });

    it('keeping the offence passes (a rename)', () => {
        expect(customRoleCarriageRefusal(on('VIEWER', offending), on('VIEWER', offending))).toBeNull();
    });

    it('adding a key to a role is refused for that key alone', () => {
        const before = on('MEMBER', role('MEMBER', { sso: true }));
        const after = on('MEMBER', role('MEMBER', { sso: true, scim: true }));
        expect(customRoleCarriageRefusal(after, before)).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['scim'] });
    });

    it('raising the base to ADMIN is refused even when the keys were already there', () => {
        const before = on('MEMBER', offending);
        const after = on('MEMBER', role('ADMIN', { sso: true, scim: true }));
        expect(customRoleCarriageRefusal(after, before)?.reason).toBe(CUSTOM_ROLE_ADMIN_BASE_REFUSAL);
    });

    it('moving an ADMIN who carries one off ADMIN is refused; moving them back is allowed', () => {
        expect(customRoleCarriageRefusal(on('MEMBER', offending), on('ADMIN', offending))?.reason).toBe(
            CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
        );
        expect(customRoleCarriageRefusal(on('ADMIN', offending), on('MEMBER', offending))).toBeNull();
    });
});

describe('the rule treats MEMBER, VIEWER and GUEST alike', () => {
    it('and only ADMIN is exempt among the roles that may carry a custom role at all', () => {
        const offences = TENANT_ROLES.filter((r) => r !== 'OWNER').map(
            (r) => customRoleCarriageOffence(on(r, role('VIEWER', { sso: true }))).adminKeys.length > 0,
        );
        expect(offences).toEqual([false, true, true, true]);
    });
});

describe('the refusal as the API carries it', () => {
    it('details name the reason and the keys as permission keys, or the base, and a save’s count', () => {
        expect(customRoleCarriageDetails({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['sso', 'scim'] })).toEqual({
            reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL,
            keys: ['admin.sso', 'admin.scim'],
        });
        expect(
            customRoleCarriageDetails({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN' }, { blockingMemberships: 3 }),
        ).toEqual({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN', blockingMemberships: 3 });
    });

    it('each message says only ADMIN may carry it, and the save message counts the members', () => {
        for (const asked of ['assign-custom-role', 'change-role', 'invite'] as const) {
            expect(customRoleCarriageMessage({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['scim'] }, asked)).toMatch(
                /^A custom role granting admin\.scim can only be carried by an ADMIN membership\./,
            );
        }
        expect(
            customRoleCarriageMessage({ reason: CUSTOM_ROLE_ADMIN_BASE_REFUSAL, baseRole: 'ADMIN' }, 'save-custom-role', 2),
        ).toBe(
            'A custom role built on ADMIN can only be carried by an ADMIN membership. 2 member(s) carrying this role ' +
                'hold another role. Change their role to ADMIN or give them another custom role first.',
        );
    });

    it('a page reads the refusal back from an error body, and anything else as null', () => {
        expect(
            customRoleCarriageRefusalOf({
                error: { details: { reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.sso', 7], blockingMemberships: 2 } },
            }),
        ).toEqual({ reason: CUSTOM_ROLE_ADMIN_KEYS_REFUSAL, keys: ['admin.sso'], baseRole: null, blockingMemberships: 2 });
        expect(customRoleCarriageRefusalOf({ error: { details: { reason: 'OTHER' } } })).toBeNull();
    });
});
