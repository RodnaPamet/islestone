/**
 * Gates for goals and initiatives (sub-phase 3.2; owner decisions 211, 213
 * and 214). The `goals` domain: `goals.view` reads goals and initiatives,
 * `goals.manage` creates, changes, archives, deletes and restores them (and,
 * from 3.2b, sets their health, a person only). Owners, Admins and Members
 * hold both, Viewers `view`, a Guest nothing (decision 204).
 *
 * A project's initiative is a project field (`projects.edit`) and an item's
 * goal a work-item field (`work_items.edit`); naming one also asks
 * `goals.view` (`mayNameGoals`), clearing one asks only the field's key.
 *
 * Same semantics as `work-config.policies.ts`: the coarse tier always
 * applies, and a present granular layer must also grant the key. Each gate is
 * a predicate and an assertion built on it, so the pages offer exactly the
 * writes the usecases admit (`goalAffordances`, read on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { GoalAffordances } from '@/lib/goals/types';
import { mayEditProject, type WorkConfigViewer } from './work-config.policies';
import { mayPlanItems } from './cycle.policies';

export type GoalViewer = WorkConfigViewer & Partial<Pick<RequestContext, 'apiKeyId'>>;

function granted(ctx: GoalViewer, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

export function mayReadGoals(ctx: GoalViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.goals?.view);
}

export function mayManageGoals(ctx: GoalViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.goals?.manage);
}

/** Naming a goal or an initiative on a project or an item asks to read them. */
export function mayNameGoals(ctx: GoalViewer): boolean {
    return mayReadGoals(ctx);
}

export function goalAffordances(ctx: GoalViewer): GoalAffordances {
    const view = mayReadGoals(ctx);
    const manage = mayManageGoals(ctx);
    return {
        view,
        manage,
        // Health is a person's act (decision 214): never an API key or an agent.
        setHealth: manage && !ctx.apiKeyId,
        linkProject: mayEditProject(ctx) && view,
        setItemGoal: mayPlanItems(ctx) && view,
    };
}

export function assertCanReadGoals(ctx: RequestContext) {
    if (!mayReadGoals(ctx)) throw forbidden('You do not have permission to view goals and initiatives.');
}

export function assertCanManageGoals(ctx: RequestContext) {
    if (!mayManageGoals(ctx)) throw forbidden('You do not have permission to change goals and initiatives.');
}

/** Naming (not clearing) a goal or an initiative on a project or an item. */
export function assertCanNameGoals(ctx: RequestContext) {
    if (!mayNameGoals(ctx)) throw forbidden('Naming a goal or an initiative needs permission to view goals.');
}
