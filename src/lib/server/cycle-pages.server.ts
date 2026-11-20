/**
 * What the cycle pages read on the server (sub-phase 2.5a): the request
 * context (`getTenantCtx`, the same gates the API asks), the cycles or one
 * cycle, the view configuration the shared list renders with, and the writes
 * the pages offer (`cycleAffordances`, the predicates the usecases assert). A
 * viewer without `cycles.view`, or a cycle they cannot see, is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { cycleAffordances, mayReadCycles } from '@/app-layer/policies/cycle.policies';
import { savedViewAffordances } from '@/app-layer/policies/saved-view.policies';
import { getCycle, listCycles } from '@/app-layer/usecases/cycle';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import type { CycleAffordances, CycleData, SavedViewAffordances, WorkItemViewConfig } from '@/lib/work-items/types';

async function or404<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

export async function cyclesPageContext(tenantSlug: string): Promise<{
    teams: WorkItemViewConfig['teams'];
    cycles: CycleData[];
    affordances: CycleAffordances;
}> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadCycles(ctx)) notFound();
        const [config, cycles] = await Promise.all([getWorkItemViewConfig(ctx), listCycles(ctx)]);
        return { teams: config.teams, cycles, affordances: cycleAffordances(ctx) };
    });
}

export async function cyclePageContext(tenantSlug: string, cycleId: string): Promise<{
    cycle: CycleData;
    teamName: string;
    config: WorkItemViewConfig;
    affordances: CycleAffordances;
    savedViews: SavedViewAffordances;
}> {
    return or404(async () => {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadCycles(ctx)) notFound();
        const [cycle, config] = await Promise.all([getCycle(ctx, cycleId), getWorkItemViewConfig(ctx)]);
        const { team, ...data } = cycle;
        return { cycle: data, teamName: team.name, config, affordances: cycleAffordances(ctx), savedViews: savedViewAffordances(ctx) };
    });
}
