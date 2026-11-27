/**
 * What the milestone pages read on the server (sub-phase 2.5b): the request
 * context (`getTenantCtx`, the same gates the API asks), the project by its
 * key prefix, its milestones or one milestone, the view configuration the
 * shared list renders with, and the writes the pages offer
 * (`milestoneAffordances`, the predicates the usecases assert). An unknown or
 * invisible project or milestone is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayViewAnalytics } from '@/app-layer/policies/analytics.policies';
import { milestoneAffordances, mayReadMilestones } from '@/app-layer/policies/milestone.policies';
import { savedViewAffordances } from '@/app-layer/policies/saved-view.policies';
import { getMilestone, listMilestones } from '@/app-layer/usecases/milestone';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import type { MilestoneAffordances, MilestoneData, SavedViewAffordances, ViewProject, WorkItemViewConfig } from '@/lib/work-items/types';

async function or404<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

export async function milestonesPageContext(
    tenantSlug: string,
    keyPrefix: string,
): Promise<{ project: ViewProject; milestones: MilestoneData[]; affordances: MilestoneAffordances }> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadMilestones(ctx)) notFound();
        const config = await getWorkItemViewConfig(ctx);
        const project = config.projects.find((p) => p.keyPrefix === keyPrefix);
        if (!project) notFound();
        return { project, milestones: await listMilestones(ctx, project.id), affordances: milestoneAffordances(ctx) };
    });
}

export async function milestonePageContext(
    tenantSlug: string,
    keyPrefix: string,
    milestoneId: string,
): Promise<{
    project: ViewProject;
    milestone: MilestoneData;
    config: WorkItemViewConfig;
    affordances: MilestoneAffordances;
    savedViews: SavedViewAffordances;
    forecast: boolean;
}> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadMilestones(ctx)) notFound();
        const config = await getWorkItemViewConfig(ctx, { projectKeyPrefix: keyPrefix });
        const project = config.projects.find((p) => p.keyPrefix === keyPrefix);
        if (!project) notFound();
        const milestone = await getMilestone(ctx, project.id, milestoneId);
        return { project, milestone, config, affordances: milestoneAffordances(ctx), savedViews: savedViewAffordances(ctx), forecast: mayViewAnalytics(ctx) };
    });
}
