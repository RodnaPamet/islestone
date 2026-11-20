import { getTranslations } from 'next-intl/server';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * Work items: every visible work item of the workspace, as a list or a board
 * (columns by category across teams). Sub-phase 2.3; the layout has already
 * admitted the member.
 */
export default async function WorkItemsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { config, savedViews } = await workItemPageContext(tenantSlug);
    const t = await getTranslations('workItems');
    return (
        <WorkConfigProvider config={config}>
            <WorkItemsView scope={{}} title={t('list.title')} viewKey="workspace" savedViews={savedViews} />
        </WorkConfigProvider>
    );
}
