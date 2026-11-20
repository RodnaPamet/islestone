import { notFound, redirect } from 'next/navigation';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import { parseKey } from '@/app-layer/domain/work-item-key';
import { getWorkItem, getWorkItemByKey } from '@/app-layer/usecases/work-item';
import { orNotFound, workItemPageContext } from '@/lib/server/work-item-pages.server';
import { tenantWorkItemPath } from '@/lib/work-item-paths';

/**
 * One work item's full page (sub-phase 2.3). The URL names the item by its
 * key (`ISL-12`); an old key (a retired prefix, or a key the item had before
 * it moved project) and a bare id redirect to the current key, so every link
 * 2.2's notifications built keeps working.
 */
export default async function WorkItemPage({ params }: { params: Promise<{ tenantSlug: string; workItemKey: string }> }) {
    const { tenantSlug, workItemKey } = await params;
    const { ctx, config } = await workItemPageContext(tenantSlug);
    const raw = decodeURIComponent(workItemKey);

    let id: string;
    if (parseKey(raw)) {
        const found = await orNotFound(() => getWorkItemByKey(ctx, raw));
        if (found.canonicalKey !== raw) redirect(tenantWorkItemPath(tenantSlug, found.canonicalKey));
        id = found.item.id;
    } else {
        const item = await orNotFound(() => getWorkItem(ctx, raw));
        redirect(tenantWorkItemPath(tenantSlug, item.key));
    }
    if (!id) notFound();

    return (
        <WorkConfigProvider config={config}>
            <WorkItemDetail workItemId={id} variant="page" />
        </WorkConfigProvider>
    );
}
