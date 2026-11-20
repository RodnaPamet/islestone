/**
 * Who may see, save, change and delete a saved view (sub-phase 2.4;
 * docs/porting/maps/2.4.md, "Saved views: permissions"). 1.4's `views`
 * domain (`view`, `create`, `edit`, `share`) is the only set of keys read;
 * no key is added. Owner decisions 59 and 60 (2026-11-20):
 *
 *   - see: your own personal views, and every shared view whose scope you
 *     can see (`views.view`; the scope is the repository's predicate);
 *   - save a personal view: `views.create`; a shared one, or share it later:
 *     also `views.share`. A VIEWER holds `views.create` and `views.edit` but
 *     not `views.share` (decision 60), so it saves, changes and deletes its
 *     own personal views and never a shared one;
 *   - change or delete: the CREATOR only, holding `views.edit` (and
 *     `views.share` for a shared view);
 *   - a workspace admin (`admin.manage`) may DELETE someone else's shared
 *     view, for moderation (decision 59: audited `SAVED_VIEW_MODERATED`),
 *     never change it.
 *
 * The coarse tier applies first: reading needs `canRead`; with no granular
 * layer at all (the defensive branch), writing needs `canWrite`. Each rule is
 * a predicate the pages ask on the server and the usecases ask (which audit a
 * refusal past the route's key as `AUTHZ_DENIED`).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';

export type SavedViewViewer = Pick<RequestContext, 'userId' | 'permissions' | 'appPermissions'>;

type ViewsKey = 'view' | 'create' | 'edit' | 'share';

function holds(ctx: SavedViewViewer, key: ViewsKey): boolean {
    if (!ctx.permissions.canRead) return false;
    if (!ctx.appPermissions) return key === 'view' || ctx.permissions.canWrite;
    return ctx.appPermissions.views?.[key] === true;
}

function isWorkspaceAdmin(ctx: SavedViewViewer): boolean {
    if (!ctx.permissions.canAdmin) return false;
    return !ctx.appPermissions || ctx.appPermissions.admin?.manage === true;
}

export interface ViewOwnership {
    createdByUserId: string;
    visibility: 'PERSONAL' | 'SHARED';
}

export function mayReadSavedViews(ctx: SavedViewViewer): boolean {
    return holds(ctx, 'view');
}

export function maySaveSavedView(ctx: SavedViewViewer, visibility: 'PERSONAL' | 'SHARED'): boolean {
    return holds(ctx, 'create') && (visibility === 'PERSONAL' || holds(ctx, 'share'));
}

/** Rename, re-filter, re-share or unshare: the creator, holding the keys the result needs. */
export function mayChangeSavedView(ctx: SavedViewViewer, view: ViewOwnership, nextVisibility?: 'PERSONAL' | 'SHARED'): boolean {
    if (view.createdByUserId !== ctx.userId || !holds(ctx, 'edit')) return false;
    const touchesShared = view.visibility === 'SHARED' || nextVisibility === 'SHARED';
    return !touchesShared || holds(ctx, 'share');
}

/** Why a delete is allowed: the creator's own, or an admin moderating; `null` when not. */
export function savedViewDeleteBasis(ctx: SavedViewViewer, view: ViewOwnership): 'creator' | 'moderation' | null {
    if (mayChangeSavedView(ctx, view)) return 'creator';
    if (view.visibility === 'SHARED' && view.createdByUserId !== ctx.userId && holds(ctx, 'edit') && isWorkspaceAdmin(ctx)) {
        return 'moderation';
    }
    return null;
}

/** What the views menu offers this viewer, asked on the server. */
export function savedViewAffordances(ctx: SavedViewViewer) {
    return {
        savePersonal: maySaveSavedView(ctx, 'PERSONAL'),
        saveShared: maySaveSavedView(ctx, 'SHARED'),
        moderate: isWorkspaceAdmin(ctx) && holds(ctx, 'edit'),
    };
}

export function assertCanReadSavedViews(ctx: RequestContext) {
    if (!mayReadSavedViews(ctx)) throw forbidden('You do not have permission to view saved views.');
}
