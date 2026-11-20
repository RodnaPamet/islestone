/**
 * Gates for recipient lists (sub-phase 2.7e; owner decision 140). Workspace
 * lists are workspace settings, managed under `admin.manage` (the predicate
 * teams and labels take); a project's lists are part of the project, managed
 * under `projects.edit` (the milestones' key, decision 72); any member who
 * reads projects reads both (`projects.view`). Copying a list onto an item's
 * watchers is an item edit (`work_items.edit`, the key adding another
 * watcher takes).
 *
 * The predicates are the work-configuration ones; this module names them for
 * lists and builds `recipientListAffordances`, which the pages read on the
 * server, so a component never restates the rule.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { RecipientListAffordances } from '@/lib/recipient-lists/types';
import { mayEditProject, mayManageWorkConfig, mayReadWorkConfig, type WorkConfigViewer } from './work-config.policies';

export function mayReadRecipientLists(ctx: WorkConfigViewer): boolean {
    return mayReadWorkConfig(ctx);
}

export function mayManageWorkspaceLists(ctx: WorkConfigViewer): boolean {
    return mayManageWorkConfig(ctx);
}

export function mayManageProjectLists(ctx: WorkConfigViewer): boolean {
    return mayEditProject(ctx);
}

/** Whether the viewer may manage a list of this scope (`null`: the workspace). */
export function mayManageListsOf(ctx: WorkConfigViewer, projectId: string | null): boolean {
    return projectId === null ? mayManageWorkspaceLists(ctx) : mayManageProjectLists(ctx);
}

export function recipientListAffordances(ctx: WorkConfigViewer): RecipientListAffordances {
    return { manageWorkspaceLists: mayManageWorkspaceLists(ctx), manageProjectLists: mayManageProjectLists(ctx) };
}

export function assertCanReadRecipientLists(ctx: RequestContext) {
    if (!mayReadRecipientLists(ctx)) throw forbidden('You do not have permission to view recipient lists.');
}

export function assertCanManageListsOf(ctx: RequestContext, projectId: string | null) {
    if (!mayManageListsOf(ctx, projectId)) {
        throw forbidden(projectId === null ? 'You do not have permission to change the workspace\'s recipient lists.' : 'You do not have permission to change this project\'s recipient lists.');
    }
}
