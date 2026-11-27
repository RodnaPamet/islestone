/**
 * What the Workload page reads on the server (sub-phases 3.5a and 3.5b;
 * docs/porting/maps/3.5.md, "The page"): the request context (`getTenantCtx`,
 * the gates the API asks), what the page offers (`workloadAffordances`, the
 * predicates the usecases assert), today in the workspace calendar's zone,
 * and, for a reader of work items, the view configuration (the item sheet a
 * cell's rows open, and the project and team filters' options) and the
 * workspace's recipient lists (the list filter). A viewer without
 * `workload.view` gets a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayReadWorkItems } from '@/app-layer/policies/work-item.policies';
import { mayViewWorkload, workloadAffordances } from '@/app-layer/policies/workload.policies';
import { listRecipientLists } from '@/app-layer/usecases/recipient-list';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { getWorkloadToday } from '@/app-layer/usecases/workload';
import { isAppError } from '@/lib/errors/types';
import type { WorkItemViewConfig } from '@/lib/work-items/types';
import type { WorkloadAffordances } from '@/lib/workload/types';

export interface WorkloadPageContext {
    affordances: WorkloadAffordances;
    userId: string;
    today: string;
    /** NULL for a caller who may not read work items: no item sheet, no project or team filter. */
    config: WorkItemViewConfig | null;
    /** The workspace's live recipient lists (the list filter); empty for a caller who may not read them. */
    recipientLists: Array<{ id: string; name: string }>;
}

async function orEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 403 || err.status === 404)) return empty;
        throw err;
    }
}

export async function workloadPageContext(tenantSlug: string): Promise<WorkloadPageContext> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayViewWorkload(ctx)) notFound();
    const readsItems = mayReadWorkItems(ctx);
    const config = readsItems ? await orEmpty<WorkItemViewConfig | null>(() => getWorkItemViewConfig(ctx), null) : null;
    const lists = readsItems ? await orEmpty(() => listRecipientLists(ctx), []) : [];
    return {
        affordances: workloadAffordances(ctx),
        userId: ctx.userId,
        today: await getWorkloadToday(ctx),
        config,
        recipientLists: lists.filter((l) => l.projectId === null && !l.archived).map((l) => ({ id: l.id, name: l.name })),
    };
}
