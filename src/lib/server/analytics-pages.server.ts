/**
 * What the Analytics page reads on the server (sub-phase 3.6a;
 * docs/porting/maps/3.6.md, "Where analytics appear"): the request context
 * (`getTenantCtx`, the gates the API asks), what the page offers
 * (`analyticsAffordances` and, since 3.6d, `dashboardPageAffordances`, the
 * predicates the usecases assert), the work-item
 * view configuration its filter toolbar offers, and today in the workspace
 * calendar's zone. A viewer without `analytics.view` gets a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { analyticsAffordances, dashboardPageAffordances, mayViewAnalytics } from '@/app-layer/policies/analytics.policies';
import { getAnalyticsToday } from '@/app-layer/usecases/analytics';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import type { AnalyticsAffordances } from '@/lib/analytics/types';
import type { DashboardPageAffordances } from '@/lib/analytics/dashboard';
import { isAppError } from '@/lib/errors/types';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

export async function analyticsPageContext(
    tenantSlug: string,
): Promise<{ affordances: AnalyticsAffordances; dashboards: DashboardPageAffordances; config: WorkItemViewConfig; today: string }> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayViewAnalytics(ctx)) notFound();
    try {
        return {
            affordances: analyticsAffordances(ctx),
            dashboards: dashboardPageAffordances(ctx),
            config: await getWorkItemViewConfig(ctx, {}),
            today: await getAnalyticsToday(ctx),
        };
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}
