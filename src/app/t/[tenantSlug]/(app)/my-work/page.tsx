import { getTranslations } from 'next-intl/server';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * My Work: the work items assigned to the signed-in member, as a list or a
 * board (sub-phase 2.3). Created, watching and due-soon views arrive with
 * 2.7, which completes this page.
 */
export default async function MyWorkPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { ctx, config } = await workItemPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    const t = await getTranslations('workItems');
    return (
        <WorkConfigProvider config={config}>
            <WorkItemsView scope={{ assigneeId: ctx.userId }} title={tNav('myWork')} description={t('myWork.description')} viewKey="my-work" />
        </WorkConfigProvider>
    );
}
