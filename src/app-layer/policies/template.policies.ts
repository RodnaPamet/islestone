/**
 * Gates for templates (sub-phase 2.5c). Owner decisions 71 and 72: no new
 * key.
 *
 * - Item templates belong to a project: read under `projects.view`, managed
 *   under `projects.edit` (Members hold it), as custom fields and milestones.
 * - Project templates belong to the workspace: managed under `admin.manage`
 *   ("Save as template", rename, archive, delete), listed and used under
 *   `projects.create` (a project made from one).
 *
 * The predicates are the work-configuration ones; this module names them for
 * templates and builds `templateAffordances`, which the pages read on the
 * server, so a component never restates the rule.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { TemplateAffordances } from '@/lib/work-items/types';
import { mayCreateProject, mayEditProject, mayManageWorkConfig, mayReadWorkConfig, type WorkConfigViewer } from './work-config.policies';

export function mayReadItemTemplates(ctx: WorkConfigViewer): boolean {
    return mayReadWorkConfig(ctx);
}

export function mayManageItemTemplates(ctx: WorkConfigViewer): boolean {
    return mayEditProject(ctx);
}

export function mayUseProjectTemplates(ctx: WorkConfigViewer): boolean {
    return mayCreateProject(ctx);
}

export function mayManageProjectTemplates(ctx: WorkConfigViewer): boolean {
    return mayManageWorkConfig(ctx);
}

export function templateAffordances(ctx: WorkConfigViewer): TemplateAffordances {
    return {
        manageItemTemplates: mayManageItemTemplates(ctx),
        useProjectTemplates: mayUseProjectTemplates(ctx),
        manageProjectTemplates: mayManageProjectTemplates(ctx),
    };
}

export function assertCanReadItemTemplates(ctx: RequestContext) {
    if (!mayReadItemTemplates(ctx)) throw forbidden('You do not have permission to view templates.');
}

export function assertCanManageItemTemplates(ctx: RequestContext) {
    if (!mayManageItemTemplates(ctx)) throw forbidden("You do not have permission to change this project's templates.");
}

export function assertCanUseProjectTemplates(ctx: RequestContext) {
    if (!mayUseProjectTemplates(ctx)) throw forbidden('You do not have permission to use project templates.');
}

export function assertCanManageProjectTemplates(ctx: RequestContext) {
    if (!mayManageProjectTemplates(ctx)) throw forbidden('You do not have permission to change project templates.');
}
