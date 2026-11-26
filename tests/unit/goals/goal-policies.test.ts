/**
 * The goals gates (sub-phase 3.2a; decisions 211, 213 and 214), as the pages
 * read them (`goalAffordances`) and the usecases assert them: Owners, Admins
 * and Members view and manage, Viewers view, a Guest nothing; naming a
 * project's initiative needs projects.edit and goals.view, an item's goal
 * work_items.edit and goals.view; health a person only.
 */
import type { Role } from '@prisma/client';

import { goalAffordances, mayManageGoals, mayNameGoals, mayReadGoals } from '@/app-layer/policies/goal.policies';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../../helpers/make-context';

const ctxOf = (role: Role) => makeRequestContext(role, { tenantId: 't' });

describe('goal policies', () => {
    it.each([
        ['OWNER', { view: true, manage: true, setHealth: true, linkProject: true, setItemGoal: true }],
        ['ADMIN', { view: true, manage: true, setHealth: true, linkProject: true, setItemGoal: true }],
        ['MEMBER', { view: true, manage: true, setHealth: true, linkProject: true, setItemGoal: true }],
        ['VIEWER', { view: true, manage: false, setHealth: false, linkProject: false, setItemGoal: false }],
        ['GUEST', { view: false, manage: false, setHealth: false, linkProject: false, setItemGoal: false }],
    ] as const)('%s', (role, expected) => {
        expect(goalAffordances(ctxOf(role))).toEqual(expected);
    });

    it('a custom role without goals.view names nothing; health never for an API key', () => {
        const perms = getPermissionsForRole('MEMBER');
        perms.goals.view = false;
        const blind = { ...ctxOf('MEMBER'), appPermissions: perms };
        expect(mayReadGoals(blind)).toBe(false);
        expect(mayNameGoals(blind)).toBe(false);
        expect(goalAffordances(blind)).toMatchObject({ linkProject: false, setItemGoal: false });
        expect(mayManageGoals({ ...ctxOf('MEMBER'), apiKeyId: 'k' })).toBe(true);
        expect(goalAffordances({ ...ctxOf('MEMBER'), apiKeyId: 'k' }).setHealth).toBe(false);
    });
});
