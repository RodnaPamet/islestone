/**
 * Gates for cycles and cycle schedules (sub-phase 2.5a). 1.4's `PermissionSet`
 * has a `cycles` domain: `cycles.view` reads cycles, their counts and burn-up;
 * `cycles.manage` creates, changes and deletes cycles and changes a team's
 * cycle schedule (owner decision 72: no new key; Members hold both, Viewers
 * and Guests `view`). Putting an item in a cycle is an item edit
 * (`work_items.edit`, `assertCanEditWorkItems`).
 *
 * Same semantics as `work-config.policies.ts`: the coarse tier always
 * applies, and a present granular layer must also grant the key. Each gate is
 * a predicate and an assertion built on it, so the pages offer exactly the
 * writes the usecases admit (`cycleAffordances`, read on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { CycleAffordances } from '@/lib/work-items/types';

export type CycleViewer = Pick<RequestContext, 'permissions' | 'appPermissions'>;

function granted(ctx: CycleViewer, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

export function mayReadCycles(ctx: CycleViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.cycles?.view);
}

export function mayManageCycles(ctx: CycleViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.cycles?.manage);
}

/** Put an item in a cycle: the work-item edit key (as `assertCanEditWorkItems` reads it). */
export function mayPlanItems(ctx: CycleViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.work_items?.edit);
}

export function cycleAffordances(ctx: CycleViewer): CycleAffordances {
    return { manageCycles: mayManageCycles(ctx), planItems: mayPlanItems(ctx) };
}

export function assertCanReadCycles(ctx: RequestContext) {
    if (!mayReadCycles(ctx)) throw forbidden('You do not have permission to view cycles.');
}

export function assertCanManageCycles(ctx: RequestContext) {
    if (!mayManageCycles(ctx)) throw forbidden('You do not have permission to change cycles.');
}
