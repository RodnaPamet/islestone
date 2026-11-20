import { getTranslations } from 'next-intl/server';

import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { MyWorkView } from '@/components/work-items/MyWorkView';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * My Work: the signed-in member's work items in four sections, assigned to
 * them, created by them, watched by them and due soon (owner decision 54),
 * each a read of the shared list query. The person is the server context's
 * user; the "Watching" section asks the server for `watching=me`.
 */
export default async function MyWorkPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { ctx, config } = await workItemPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return (
        <WorkConfigProvider config={config}>
            <MyWorkView userId={ctx.userId} title={tNav('myWork')} />
        </WorkConfigProvider>
    );
}
