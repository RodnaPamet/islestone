/**
 * Gates for analytics (sub-phase 3.6; docs/porting/maps/3.6.md, "Reads,
 * routes and keys"; ADR 0014 §11; owner decisions 329 and 330). The
 * `analytics` domain: `analytics.view` (every analytics read over the items
 * one can see; from 3.6c forecasts; from 3.6d one's own dashboards and shared
 * ones), `analytics.share` (shared dashboards, 3.6d), `analytics.people`
 * (time waiting per person beyond one's own row, 3.6b). Owners and Admins
 * hold all three, Members `view` and `share`, Viewers `view`, a Guest nothing
 * (decision 204).
 *
 * The granular key decides, so a custom role may grant or remove each; with
 * no granular layer at all (the defensive branch) the coarse tier stands in.
 * Every read runs under the caller's own project visibility. No gate groups
 * a measure by assignee (decision 330). The page offers what these admit
 * (`analyticsAffordances`, asked on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { AnalyticsAffordances } from '@/lib/analytics/types';

export type AnalyticsViewer = Pick<RequestContext, 'permissions' | 'appPermissions'>;

function key(ctx: AnalyticsViewer, action: 'view' | 'share' | 'people', coarse: boolean): boolean {
    if (!ctx.appPermissions) return coarse;
    return ctx.appPermissions.analytics?.[action] === true;
}

/** The Analytics page and every analytics read. */
export function mayViewAnalytics(ctx: AnalyticsViewer): boolean {
    return ctx.permissions.canRead && key(ctx, 'view', ctx.permissions.canRead);
}

/** Shared dashboards (3.6d). */
export function mayShareAnalytics(ctx: AnalyticsViewer): boolean {
    return mayViewAnalytics(ctx) && key(ctx, 'share', ctx.permissions.canWrite);
}

/** Time waiting per person beyond one's own row (3.6b). */
export function mayReadAnalyticsPeople(ctx: AnalyticsViewer): boolean {
    return mayViewAnalytics(ctx) && key(ctx, 'people', ctx.permissions.canAdmin);
}

/** What the Analytics page offers the caller (asked on the server; never in a component). */
export function analyticsAffordances(ctx: AnalyticsViewer): AnalyticsAffordances {
    return { view: mayViewAnalytics(ctx), share: mayShareAnalytics(ctx), people: mayReadAnalyticsPeople(ctx) };
}

export function assertCanViewAnalytics(ctx: RequestContext): void {
    if (!mayViewAnalytics(ctx)) throw forbidden('You do not have permission to see analytics.');
}
