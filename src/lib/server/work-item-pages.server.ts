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

/** Run a page read; a 404 or 403 from the usecase is the page's 404. */
export async function orNotFound<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}
