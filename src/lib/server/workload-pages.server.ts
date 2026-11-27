/**
 * What the Workload page reads on the server (sub-phase 3.5a;
 * docs/porting/maps/3.5.md, "The page"): the request context (`getTenantCtx`,
 * the gates the API asks), what the page offers (`workloadAffordances`, the
 * predicates the usecases assert), and today in the workspace calendar's zone.
 * A viewer without `workload.view` gets a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayViewWorkload, workloadAffordances } from '@/app-layer/policies/workload.policies';
import { getWorkloadToday } from '@/app-layer/usecases/workload';
import type { WorkloadAffordances } from '@/lib/workload/types';

export async function workloadPageContext(tenantSlug: string): Promise<{ affordances: WorkloadAffordances; userId: string; today: string }> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayViewWorkload(ctx)) notFound();
    return { affordances: workloadAffordances(ctx), userId: ctx.userId, today: await getWorkloadToday(ctx) };
}
