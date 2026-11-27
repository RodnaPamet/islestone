/**
 * Gates for time tracking (sub-phase 3.4; docs/porting/maps/3.4.md,
 * "Permissions"; ADR 0012; owner decisions 265, 266 and 278). The `time`
 * domain: `time.view` (other people's time on items one can see),
 * `time.track` (one's own entries, timer and week), `time.approve` (decide
 * others' weeks, read any member's week; 3.4c), `time.rates` (money; 3.4d).
 * Owners and Admins hold all four, Members `view` and `track`, Viewers
 * `view`, a Guest nothing (decision 204).
 *
 * The granular key decides (decision 265: "custom roles can grant each;
 * nothing rides on `work_items.edit`"), so a custom role built on VIEWER that
 * grants `time.track` records time; with no granular layer at all (the
 * defensive branch) the coarse tier stands in. Every gate is a predicate and
 * an assertion built on it, so the pages offer exactly what the usecases
 * admit (`timeAffordances`, asked on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import { isTenantSystemUserId } from '@/lib/tenant-system-user';
import type { TimeAffordances } from '@/lib/time/types';

export type TimeViewer = Pick<RequestContext, 'permissions' | 'appPermissions'> & Partial<Pick<RequestContext, 'apiKeyId' | 'actorType' | 'userId'>>;

function key(ctx: TimeViewer, action: 'view' | 'track' | 'approve' | 'rates', coarse: boolean): boolean {
    if (!ctx.appPermissions) return coarse;
    return ctx.appPermissions.time?.[action] === true;
}

/** Other people's time on items the caller can see (decision 266). */
export function mayViewTime(ctx: TimeViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'view', ctx.permissions.canRead);
}

/** One's own entries, timer and week. */
export function mayTrackTime(ctx: TimeViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'track', ctx.permissions.canWrite);
}

/** Decide other members' weeks and read any member's week (3.4c). */
export function mayApproveTime(ctx: TimeViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'approve', ctx.permissions.canAdmin);
}

/**
 * Time is a person's own statement (decision 278, ADR 0003 §4): never an API
 * key or an agent (`apiKeyId`), a job (`actorType`) or the workspace's system
 * user.
 */
export function recordsTimeAsPerson(ctx: TimeViewer): boolean {
    return !ctx.apiKeyId && (ctx.actorType === undefined || ctx.actorType === 'USER') && !(ctx.userId && isTenantSystemUserId(ctx.userId));
}

/** What the Time pages offer the caller (asked on the server; never in a component). */
export function timeAffordances(ctx: TimeViewer): TimeAffordances {
    const track = mayTrackTime(ctx);
    return {
        view: mayViewTime(ctx),
        track,
        approve: mayApproveTime(ctx),
        // Recording is a person's act: a context that is not one sees My time read-only.
        record: track && recordsTimeAsPerson(ctx),
    };
}

export function assertCanTrackTime(ctx: RequestContext): void {
    if (!mayTrackTime(ctx)) throw forbidden('You do not have permission to record time.');
}
