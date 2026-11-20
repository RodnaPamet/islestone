/**
 * What a project's recipient-lists page reads on the server (sub-phase 2.7e):
 * the request context (`getTenantCtx`, the gates the API asks), the project
 * by its key prefix, and whether the viewer manages its lists
 * (`recipientListAffordances`, the predicates the usecases assert; an
 * archived project's lists are read-only). An unknown or invisible project
 * is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayReadRecipientLists, recipientListAffordances } from '@/app-layer/policies/recipient-list.policies';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import type { ViewProject } from '@/lib/work-items/types';

export async function projectRecipientListsPageContext(tenantSlug: string, keyPrefix: string): Promise<{ project: ViewProject; canManage: boolean }> {
    try {
        const ctx = await getTenantCtx({ tenantSlug });
        if (!mayReadRecipientLists(ctx)) notFound();
        const config = await getWorkItemViewConfig(ctx);
        const project = config.projects.find((p) => p.keyPrefix === keyPrefix);
        if (!project) notFound();
        return { project, canManage: recipientListAffordances(ctx).manageProjectLists && !project.archived };
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}
