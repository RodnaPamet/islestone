/**
 * Gates for repeats (sub-phase 2.5d, owner decisions 70 and 72). Setting,
 * changing, holding or resuming a repeat makes future items in the caller's
 * name, so it takes `work_items.create` AND `work_items.edit` on the item;
 * stopping one takes `work_items.edit`. The nightly job asks
 * `mayCreateWorkItems` of the rule's owner, re-resolved, before each copy.
 *
 * Same semantics as `work-item.policies.ts`: the coarse tier always applies,
 * and a present granular layer must also grant the key. Written fresh for
 * Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';

type Viewer = Pick<RequestContext, 'permissions' | 'appPermissions'>;

function granted(ctx: Viewer, flag: 'create' | 'edit'): boolean {
    if (!ctx.appPermissions) return true;
    return ctx.appPermissions.work_items?.[flag] === true;
}

export function mayCreateWorkItems(ctx: Viewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, 'create');
}

export function maySetRepeats(ctx: Viewer): boolean {
    return mayCreateWorkItems(ctx) && ctx.permissions.canWrite && granted(ctx, 'edit');
}

export function assertCanSetRepeats(ctx: RequestContext) {
    if (!maySetRepeats(ctx)) throw forbidden('You do not have permission to set a repeat: it needs creating and editing work items.');
}
