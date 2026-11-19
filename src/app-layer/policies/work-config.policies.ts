/**
 * Gates for the workspace's work configuration: teams, workflow states, work
 * item types, labels and projects (sub-phase 2.1).
 *
 * 1.4's `PermissionSet` has a `projects` domain and no domain for teams,
 * workflows, types or labels. Until the owner decides otherwise (reported
 * with sub-phase 2.1), they are workspace settings under `admin.manage`, the
 * key that already guards "change workspace settings", and every member who
 * can read projects (`projects.view`) can read them. Projects use their own
 * keys: `projects.create`, `projects.edit` (rename, prefix), and
 * `projects.archive` for archive, unarchive, delete and restore.
 *
 * Same semantics as `work-item.policies.ts`: the coarse tier always applies,
 * and a present granular layer must also grant the key.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';

function granted(ctx: RequestContext, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

/** Read teams, workflow states, types, labels and projects. */
export function assertCanReadWorkConfig(ctx: RequestContext) {
    if (!ctx.permissions.canRead || !granted(ctx, (p) => p.projects?.view)) {
        throw forbidden('You do not have permission to view projects.');
    }
}

/** Create, change and delete teams, workflow states, work item types and labels. */
export function assertCanManageWorkConfig(ctx: RequestContext) {
    if (!ctx.permissions.canAdmin || !granted(ctx, (p) => p.admin?.manage)) {
        throw forbidden('You do not have permission to change the workspace settings.');
    }
}

export function assertCanCreateProject(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || !granted(ctx, (p) => p.projects?.create)) {
        throw forbidden('You do not have permission to create projects.');
    }
}

export function assertCanEditProject(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || !granted(ctx, (p) => p.projects?.edit)) {
        throw forbidden('You do not have permission to change projects.');
    }
}

/** Archive, unarchive, delete and restore a project. */
export function assertCanArchiveProject(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || !granted(ctx, (p) => p.projects?.archive)) {
        throw forbidden('You do not have permission to archive or delete projects.');
    }
}
