/**
 * Gates for capacity, time off and the Workload page (sub-phase 3.5;
 * docs/porting/maps/3.5.md, "Keys and who sees what"; ADR 0013 §2, §3 and §9;
 * owner decisions 287, 288 and 298). The `workload` domain:
 * `workload.view` (the Workload page: everyone's capacity, time-off dates and
 * hours), `workload.time_off` (one's own time off), `workload.manage` (the
 * default, anyone's capacity, anyone's time off, every time-off type). Owners
 * and Admins hold all three, Members and Viewers `view` and `time_off`, a
 * Guest nothing (decision 204).
 *
 * The granular key decides, so a custom role may grant each; with no granular
 * layer at all (the defensive branch) the coarse tier stands in. Writes are a
 * signed-in person's only (never an API key, an agent, a job or the system
 * user), and so is reading a time-off type: "Sick" is health data (decision
 * 287), shown only to the person themselves and to holders of
 * `workload.manage`. Every gate is a predicate, so the pages offer exactly
 * what the usecases admit (`workloadAffordances`, asked on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import { isTenantSystemUserId } from '@/lib/tenant-system-user';
import type { WorkloadAffordances } from '@/lib/workload/types';

export type WorkloadViewer = Pick<RequestContext, 'permissions' | 'appPermissions'> & Partial<Pick<RequestContext, 'apiKeyId' | 'actorType' | 'userId'>>;

function key(ctx: WorkloadViewer, action: 'view' | 'time_off' | 'manage', coarse: boolean): boolean {
    if (!ctx.appPermissions) return coarse;
    return ctx.appPermissions.workload?.[action] === true;
}

/** The Workload page and every read of capacity and time-off dates and hours. */
export function mayViewWorkload(ctx: WorkloadViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'view', ctx.permissions.canRead);
}

/** One's own time off (decision 288): Viewers too, as time off is about oneself. */
export function mayRecordOwnTimeOff(ctx: WorkloadViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'time_off', ctx.permissions.canRead);
}

/** The workspace default, anyone's capacity and time off, and every time-off type. */
export function mayManageWorkload(ctx: WorkloadViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'manage', ctx.permissions.canAdmin);
}

/**
 * Capacity and time off are written by a signed-in person (ADR 0003 §4, ADR
 * 0013 §9): never an API key or an agent (`apiKeyId`), a job (`actorType`) or
 * the workspace's system user.
 */
export function actsOnWorkloadAsPerson(ctx: WorkloadViewer): boolean {
    return !ctx.apiKeyId && (ctx.actorType === undefined || ctx.actorType === 'USER') && !(ctx.userId && isTenantSystemUserId(ctx.userId));
}

/**
 * Whether `ctx` may read the time-off TYPE of `userId` (decision 287): the
 * person themselves or a holder of `workload.manage`, signed in. An agent or
 * a key never reads one (ADR 0003 §4).
 */
export function mayReadTimeOffType(ctx: WorkloadViewer, userId: string): boolean {
    if (!actsOnWorkloadAsPerson(ctx)) return false;
    return ctx.userId === userId || mayManageWorkload(ctx);
}

/** What the Workload pages offer the caller (asked on the server; never in a component). */
export function workloadAffordances(ctx: WorkloadViewer): WorkloadAffordances {
    const person = actsOnWorkloadAsPerson(ctx);
    return {
        view: mayViewWorkload(ctx),
        recordOwnTimeOff: person && mayRecordOwnTimeOff(ctx),
        manage: person && mayManageWorkload(ctx),
    };
}

export function assertCanViewWorkload(ctx: RequestContext): void {
    if (!mayViewWorkload(ctx)) throw forbidden('You do not have permission to see workload.');
}
