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
import { isTenantSystemUserId } from '@/lib/tenant-system-user';
import type { AnalyticsAffordances } from '@/lib/analytics/types';
import type { DashboardPageAffordances, DashboardViewerAffordances, DashboardVisibilityName } from '@/lib/analytics/dashboard';

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

/**
 * Does the caller read time waiting per person at all (decision 332)? Only a
 * person does: an API key (5.2) or an agent (6.x) reads the totals and never
 * a party's row, its own authorising person's included, and the workspace's
 * system user is nobody. Phase 6 adds the agent term when `RequestContext`
 * gains it.
 */
export function readsWaitingAsPerson(ctx: Pick<RequestContext, 'apiKeyId' | 'userId'>): boolean {
    return !ctx.apiKeyId && !isTenantSystemUserId(ctx.userId);
}

/** What the Analytics page offers the caller (asked on the server; never in a component). */
export function analyticsAffordances(ctx: AnalyticsViewer): AnalyticsAffordances {
    return { view: mayViewAnalytics(ctx), share: mayShareAnalytics(ctx), people: mayReadAnalyticsPeople(ctx) };
}

export function assertCanViewAnalytics(ctx: RequestContext): void {
    if (!mayViewAnalytics(ctx)) throw forbidden('You do not have permission to see analytics.');
}

// ─── Dashboards (3.6d; owner decisions 326 and 329) ─────────────────

export type DashboardViewer = AnalyticsViewer & Pick<RequestContext, 'userId'>;

export interface DashboardOwnership {
    createdByUserId: string;
    visibility: DashboardVisibilityName;
}

/** An Owner or Admin, who may delete someone else's shared dashboard (decision 326, `DASHBOARD_MODERATED`), never change it. */
function isWorkspaceAdmin(ctx: AnalyticsViewer): boolean {
    if (!ctx.permissions.canAdmin) return false;
    return !ctx.appPermissions || ctx.appPermissions.admin?.manage === true;
}

/**
 * Save a dashboard: a personal one with `analytics.view` (Viewers included,
 * decision 60's widening applied the same way), a shared one with
 * `analytics.share`.
 */
export function maySaveDashboard(ctx: AnalyticsViewer, visibility: DashboardVisibilityName): boolean {
    return mayViewAnalytics(ctx) && (visibility === 'PERSONAL' || mayShareAnalytics(ctx));
}

/** Rename, re-share, unshare or change the widgets: the creator only (decision 59's rule), holding `analytics.share` for a shared one. */
export function mayChangeDashboard(ctx: DashboardViewer, d: DashboardOwnership, nextVisibility?: DashboardVisibilityName): boolean {
    if (!mayViewAnalytics(ctx) || d.createdByUserId !== ctx.userId) return false;
    const touchesShared = d.visibility === 'SHARED' || nextVisibility === 'SHARED';
    return !touchesShared || mayShareAnalytics(ctx);
}

/** Why a delete is allowed: the creator's own, or an Owner or Admin moderating a shared one; `null` when not. */
export function dashboardDeleteBasis(ctx: DashboardViewer, d: DashboardOwnership): 'creator' | 'moderation' | null {
    if (mayChangeDashboard(ctx, d)) return 'creator';
    if (d.visibility === 'SHARED' && d.createdByUserId !== ctx.userId && mayViewAnalytics(ctx) && isWorkspaceAdmin(ctx)) return 'moderation';
    return null;
}

/** What one dashboard offers its viewer (asked on the server; never in a component). */
export function dashboardAffordances(ctx: DashboardViewer, d: DashboardOwnership): DashboardViewerAffordances {
    return { change: mayChangeDashboard(ctx, d), delete: dashboardDeleteBasis(ctx, d) !== null, share: mayShareAnalytics(ctx) };
}

/** What the Analytics page offers about dashboards (asked on the server). */
export function dashboardPageAffordances(ctx: AnalyticsViewer): DashboardPageAffordances {
    return { createPersonal: maySaveDashboard(ctx, 'PERSONAL'), createShared: maySaveDashboard(ctx, 'SHARED') };
}
