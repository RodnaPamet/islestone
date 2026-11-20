/**
 * Gates for the workspace's work configuration: teams, workflow states, work
 * item types, labels and projects (sub-phase 2.1).
 *
 * 1.4's `PermissionSet` has a `projects` domain and no domain for teams,
 * workflows, types or labels. They are workspace settings under
 * `admin.manage`, the key that already guards "change workspace settings",
 * and every member who can read projects (`projects.view`) can read them.
 * Projects use their own keys: `projects.create`, `projects.edit` (rename,
 * prefix), and `projects.archive` for archive, unarchive, delete and restore.
 * Owner decision, 2026-11-19: kept as built. Admins configure the workspace,
 * and a workspace that wants others to configure grants `admin.manage`
 * through a custom role.
 *
 * Same semantics as `work-item.policies.ts`: the coarse tier always applies,
 * and a present granular layer must also grant the key.
 *
 * Each gate is a predicate (`may…`) and an assertion built on it, so the
 * Settings pages offer exactly the writes these assertions admit
 * (`workConfigAffordances`, read on the server): a page never restates the
 * rule.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

/** What the gates read of a caller: a request context, or a page's server context. */
export type WorkConfigViewer = Pick<RequestContext, 'permissions' | 'appPermissions'>;

function granted(ctx: WorkConfigViewer, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

export function mayReadWorkConfig(ctx: WorkConfigViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.projects?.view);
}

export function mayManageWorkConfig(ctx: WorkConfigViewer): boolean {
    return ctx.permissions.canAdmin && granted(ctx, (p) => p.admin?.manage);
}

export function mayCreateProject(ctx: WorkConfigViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.projects?.create);
}

export function mayEditProject(ctx: WorkConfigViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.projects?.edit);
}

/**
 * Define a project's custom fields and their options (sub-phase 2.4). A
 * field is part of its project (ADR 0006: a project has "its own key prefix
 * and custom fields"), so the key is `projects.edit`, the one re-prefixing
 * takes. Owner question (docs/porting/maps/2.4.md, open question 1):
 * `admin.manage` instead.
 */
export function mayManageCustomFields(ctx: WorkConfigViewer): boolean {
    return mayEditProject(ctx);
}

export function mayArchiveProject(ctx: WorkConfigViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.projects?.archive);
}

/**
 * The writes the Settings pages offer this viewer: each is the predicate its
 * usecase asserts (the route's `requirePermission` key is the same key, read
 * from the same permission set). Asked on the server and handed to the page.
 */
export function workConfigAffordances(ctx: WorkConfigViewer): WorkConfigAffordances {
    return {
        manageWorkConfig: mayManageWorkConfig(ctx),
        createProject: mayCreateProject(ctx),
        editProject: mayEditProject(ctx),
        archiveProject: mayArchiveProject(ctx),
        manageCustomFields: mayManageCustomFields(ctx),
    };
}

/** Read teams, workflow states, types, labels and projects. */
export function assertCanReadWorkConfig(ctx: RequestContext) {
    if (!mayReadWorkConfig(ctx)) {
        throw forbidden('You do not have permission to view projects.');
    }
}

/** Create, change and delete teams, workflow states, work item types and labels. */
export function assertCanManageWorkConfig(ctx: RequestContext) {
    if (!mayManageWorkConfig(ctx)) {
        throw forbidden('You do not have permission to change the workspace settings.');
    }
}

export function assertCanCreateProject(ctx: RequestContext) {
    if (!mayCreateProject(ctx)) {
        throw forbidden('You do not have permission to create projects.');
    }
}

export function assertCanEditProject(ctx: RequestContext) {
    if (!mayEditProject(ctx)) {
        throw forbidden('You do not have permission to change projects.');
    }
}

/** Archive, unarchive, delete and restore a project. */
export function assertCanArchiveProject(ctx: RequestContext) {
    if (!mayArchiveProject(ctx)) {
        throw forbidden('You do not have permission to archive or delete projects.');
    }
}

/** Create, rename, reorder and archive a project's custom fields and options. */
export function assertCanManageCustomFields(ctx: RequestContext) {
    if (!mayManageCustomFields(ctx)) {
        throw forbidden('You do not have permission to change this project\'s fields.');
    }
}
