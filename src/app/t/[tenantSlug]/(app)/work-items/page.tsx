import { getTranslations } from 'next-intl/server';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { mayViewAnalytics } from '@/app-layer/policies/analytics.policies';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * Work items: every visible work item of the workspace, as a list or a board
 * (columns by category across teams). Sub-phase 2.3; the layout has already
 * admitted the member. The Forecast action (3.6c) is offered to a caller who
 * reads analytics, asked here.
 */
export default async function WorkItemsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { ctx, config, savedViews } = await workItemPageContext(tenantSlug);
    const t = await getTranslations('workItems');
    return (
        <WorkConfigProvider config={config}>
            <WorkItemsView scope={{}} title={t('list.title')} viewKey="workspace" savedViews={savedViews} forecast={mayViewAnalytics(ctx)} />
        </WorkConfigProvider>
    );
}
