/**
 * What every work-item page reads on the server (sub-phase 2.3): the
 * request context (`getTenantCtx`, the same gates the API asks: membership
 * and the workspace MFA gate) and the view configuration the client renders
 * with. A workspace the person is not in, or a refusal, is a 404, never a
 * page that names what they may not do.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import type { RequestContext } from '@/app-layer/types';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import { savedViewAffordances } from '@/app-layer/policies/saved-view.policies';
import { mayReadWorkItems } from '@/app-layer/policies/work-item.policies';
import { mayViewWorkload } from '@/app-layer/policies/workload.policies';
import { workConfigAffordances } from '@/app-layer/policies/work-config.policies';
import type { SavedViewAffordances, WorkConfigAffordances, WorkItemViewConfig } from '@/lib/work-items/types';

export async function workItemPageContext(
    tenantSlug: string,
    opts: { projectKeyPrefix?: string } = {},
): Promise<{ ctx: RequestContext; config: WorkItemViewConfig; savedViews: SavedViewAffordances; workConfig: WorkConfigAffordances }> {
    try {
        const ctx = await getTenantCtx({ tenantSlug });
        const config = await getWorkItemViewConfig(ctx, opts);
        return { ctx, config, savedViews: savedViewAffordances(ctx), workConfig: workConfigAffordances(ctx) };
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

/**
 * My Work, the workspace's landing page (`/t/<slug>` goes there). A caller who
 * may read no work items, which is a GUEST until sub-phase 8.4 (owner
 * decision 204: a guest holds no key), gets `{ noAccess: true }` and the page
 * says so, rather than a 404 on the first page they land on. Nothing of the
 * workspace is read for them: the view configuration (teams, types, labels,
 * cycles) is read only past the check, and its usecase asks the keys again.
 */
export async function myWorkPageContext(
    tenantSlug: string,
): Promise<{ noAccess: true } | { noAccess: false; ctx: RequestContext; config: WorkItemViewConfig; workload: boolean }> {
    try {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadWorkItems(ctx)) return { noAccess: true };
        const config = await getWorkItemViewConfig(ctx);
        // The line of the person's load (3.5b, decision 300) for a holder of workload.view.
        return { noAccess: false, ctx, config, workload: mayViewWorkload(ctx) };
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

/** Run a page read; a 404 or 403 from the usecase is the page's 404. */
export async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}
