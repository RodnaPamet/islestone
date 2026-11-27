/**
 * Gates for pages (sub-phase 4.1a; owner decisions 339 and 342; ADR 0015
 * §1 and §10). The `pages` domain: `view` reads pages in the trees one can
 * see, `create` makes them, `edit` renames, moves and reorders them (from
 * 4.1b the body and versions), `comment` (4.1d), `delete` deletes and
 * restores them and reads the Deleted list. Owners, Admins and Members hold
 * all, Viewers `view`, a Guest nothing until 8.4 (decision 204).
 *
 * No page is narrower than its tree (decision 342): a project page is
 * readable exactly when its project is visible and live, a workspace page by
 * every holder of `pages.view`. An archived project's pages are readable and
 * take no write (409 `PROJECT_ARCHIVED`, decided in the usecases).
 *
 * Same semantics as `goal.policies.ts`: the coarse tier always applies, and a
 * present granular layer must also grant the key. Each gate is a predicate
 * and an assertion built on it, so the pages offer exactly the writes the
 * usecases admit (`pageAffordances`, read on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { PageAffordances } from '@/lib/pages/types';

export type PageViewer = Pick<RequestContext, 'permissions'> & Partial<Pick<RequestContext, 'appPermissions'>>;

function granted(ctx: PageViewer, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

export function mayReadPages(ctx: PageViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.pages?.view);
}

export function mayCreatePages(ctx: PageViewer): boolean {
    return ctx.permissions.canWrite && mayReadPages(ctx) && granted(ctx, (p) => p.pages?.create);
}

export function mayEditPages(ctx: PageViewer): boolean {
    return ctx.permissions.canWrite && mayReadPages(ctx) && granted(ctx, (p) => p.pages?.edit);
}

export function mayDeletePages(ctx: PageViewer): boolean {
    return ctx.permissions.canWrite && mayReadPages(ctx) && granted(ctx, (p) => p.pages?.delete);
}

/**
 * What the caller may do in a tree, or on a page of it: nothing but reading
 * in an archived project's tree.
 */
export function pageAffordances(ctx: PageViewer, opts: { archived?: boolean } = {}): PageAffordances {
    const writable = !opts.archived;
    return {
        view: mayReadPages(ctx),
        create: writable && mayCreatePages(ctx),
        edit: writable && mayEditPages(ctx),
        delete: writable && mayDeletePages(ctx),
    };
}

export function assertCanReadPages(ctx: RequestContext) {
    if (!mayReadPages(ctx)) throw forbidden('You do not have permission to view pages.');
}

export function assertCanCreatePages(ctx: RequestContext) {
    if (!mayCreatePages(ctx)) throw forbidden('You do not have permission to create pages.');
}

export function assertCanEditPages(ctx: RequestContext) {
    if (!mayEditPages(ctx)) throw forbidden('You do not have permission to change pages.');
}

export function assertCanDeletePages(ctx: RequestContext) {
    if (!mayDeletePages(ctx)) throw forbidden('You do not have permission to delete or restore pages.');
}
