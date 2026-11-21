/**
 * Who may see, save, change and delete a saved view (sub-phase 2.4,
 * `src/app-layer/policies/saved-view.policies.ts`), over the built-in roles
 * and a custom role, with the `views.*` keys only.
 */
import type { Role } from '@prisma/client';

import {
    mayChangeSavedView,
    mayReadSavedViews,
    maySaveSavedView,
    savedViewAffordances,
    savedViewDeleteBasis,
} from '@/app-layer/policies/saved-view.policies';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = (role: Role, userId = 'me', appPermissions = getPermissionsForRole(role)) => makeRequestContext(role, { userId, appPermissions });

describe('saved-view policies', () => {
    it('every workspace-wide role reads; OWNER, ADMIN and MEMBER save personal and shared; VIEWER personal only (decision 60); GUEST nothing, not even a read (decision 204)', () => {
        for (const role of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as Role[]) expect(mayReadSavedViews(ctx(role))).toBe(true);
        expect(mayReadSavedViews(ctx('GUEST'))).toBe(false);
        for (const role of ['OWNER', 'ADMIN', 'MEMBER'] as Role[]) {
            expect(maySaveSavedView(ctx(role), 'PERSONAL')).toBe(true);
            expect(maySaveSavedView(ctx(role), 'SHARED')).toBe(true);
        }
        expect(maySaveSavedView(ctx('VIEWER'), 'PERSONAL')).toBe(true);
        expect(maySaveSavedView(ctx('VIEWER'), 'SHARED')).toBe(false);
        expect(maySaveSavedView(ctx('GUEST'), 'PERSONAL')).toBe(false);
        expect(maySaveSavedView(ctx('GUEST'), 'SHARED')).toBe(false);
    });

    it('a VIEWER changes and deletes its own personal view, never shares it, and never touches a shared or another person\'s view (decision 60)', () => {
        const own = { createdByUserId: 'me', visibility: 'PERSONAL' as const };
        const ownShared = { createdByUserId: 'me', visibility: 'SHARED' as const };
        const othersShared = { createdByUserId: 'someone', visibility: 'SHARED' as const };
        const othersPersonal = { createdByUserId: 'someone', visibility: 'PERSONAL' as const };
        const viewer = ctx('VIEWER');
        expect(mayChangeSavedView(viewer, own)).toBe(true);
        expect(mayChangeSavedView(viewer, own, 'PERSONAL')).toBe(true);
        expect(mayChangeSavedView(viewer, own, 'SHARED')).toBe(false);
        expect(savedViewDeleteBasis(viewer, own)).toBe('creator');
        // A shared view it somehow holds (saved before a demotion) stays out of reach.
        expect(mayChangeSavedView(viewer, ownShared)).toBe(false);
        expect(mayChangeSavedView(viewer, ownShared, 'PERSONAL')).toBe(false);
        expect(mayChangeSavedView(viewer, othersShared)).toBe(false);
        expect(savedViewDeleteBasis(viewer, othersShared)).toBeNull();
        expect(mayChangeSavedView(viewer, othersPersonal)).toBe(false);
        expect(savedViewDeleteBasis(viewer, othersPersonal)).toBeNull();
    });

    it('a custom role without views.share saves personal views only, and cannot share one later', () => {
        const perms = getPermissionsForRole('MEMBER');
        perms.views.share = false;
        const c = ctx('MEMBER', 'me', perms);
        expect(maySaveSavedView(c, 'PERSONAL')).toBe(true);
        expect(maySaveSavedView(c, 'SHARED')).toBe(false);
        expect(mayChangeSavedView(c, { createdByUserId: 'me', visibility: 'PERSONAL' })).toBe(true);
        expect(mayChangeSavedView(c, { createdByUserId: 'me', visibility: 'PERSONAL' }, 'SHARED')).toBe(false);
        expect(mayChangeSavedView(c, { createdByUserId: 'me', visibility: 'SHARED' })).toBe(false);
    });

    it('only the creator changes a view; an admin deletes someone else\'s shared view as moderation, never a personal one', () => {
        const shared = { createdByUserId: 'someone', visibility: 'SHARED' as const };
        const personal = { createdByUserId: 'someone', visibility: 'PERSONAL' as const };
        expect(mayChangeSavedView(ctx('ADMIN'), shared)).toBe(false);
        expect(savedViewDeleteBasis(ctx('ADMIN'), shared)).toBe('moderation');
        expect(savedViewDeleteBasis(ctx('ADMIN'), personal)).toBeNull();
        expect(savedViewDeleteBasis(ctx('MEMBER'), shared)).toBeNull();
        expect(savedViewDeleteBasis(ctx('MEMBER', 'someone'), shared)).toBe('creator');
        const noManage = getPermissionsForRole('ADMIN');
        noManage.admin.manage = false;
        expect(savedViewDeleteBasis(ctx('ADMIN', 'me', noManage), shared)).toBeNull();
    });

    it('affordances are the predicates', () => {
        expect(savedViewAffordances(ctx('MEMBER'))).toEqual({ savePersonal: true, saveShared: true, moderate: false });
        expect(savedViewAffordances(ctx('OWNER'))).toEqual({ savePersonal: true, saveShared: true, moderate: true });
        expect(savedViewAffordances(ctx('VIEWER'))).toEqual({ savePersonal: true, saveShared: false, moderate: false });
        expect(savedViewAffordances(ctx('GUEST'))).toEqual({ savePersonal: false, saveShared: false, moderate: false });
    });
});
