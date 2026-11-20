/**
 * Gates for milestones (sub-phase 2.5b). A milestone is part of its project
 * (ADR 0002, ADR 0006), so owner decision 72 puts it under the project keys:
 * `projects.view` reads milestones and their progress, `projects.edit`
 * creates, renames, re-dates, reorders and deletes them (Members hold it).
 * Aiming an item at a milestone is an item edit (`work_items.edit`).
 *
 * The predicates are the work-configuration ones; this module only names them
 * for milestones and builds `milestoneAffordances`, which the pages read on
 * the server, so a component never restates the rule.
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { MilestoneAffordances } from '@/lib/work-items/types';
import { mayEditProject, mayReadWorkConfig, type WorkConfigViewer } from './work-config.policies';
import { mayPlanItems } from './cycle.policies';

export function mayReadMilestones(ctx: WorkConfigViewer): boolean {
    return mayReadWorkConfig(ctx);
}

export function mayManageMilestones(ctx: WorkConfigViewer): boolean {
    return mayEditProject(ctx);
}

export function milestoneAffordances(ctx: WorkConfigViewer): MilestoneAffordances {
    return { manageMilestones: mayManageMilestones(ctx), planItems: mayPlanItems(ctx) };
}

export function assertCanReadMilestones(ctx: RequestContext) {
    if (!mayReadMilestones(ctx)) throw forbidden('You do not have permission to view milestones.');
}

export function assertCanManageMilestones(ctx: RequestContext) {
    if (!mayManageMilestones(ctx)) throw forbidden('You do not have permission to change milestones.');
}
