import { getTranslations } from 'next-intl/server';

import { PlaceholderPage } from '@/components/layout/PlaceholderPage';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { MyWorkView } from '@/components/work-items/MyWorkView';
import { myWorkPageContext } from '@/lib/server/work-item-pages.server';

/**
 * My Work: the signed-in member's work items in four sections, assigned to
 * them, created by them, watched by them and due soon (owner decision 54),
 * each a read of the shared list query. The person is the server context's
 * user; the "Watching" section asks the server for `watching=me`.
 *
 * A caller who may read no work items (a GUEST until sub-phase 8.4, owner
 * decision 204) lands here too, and gets one empty state saying they have no
 * access yet, with nothing of the workspace read.
 */
export default async function MyWorkPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const page = await myWorkPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    if (page.noAccess) {
        const t = await getTranslations('noAccess');
        return <PlaceholderPage title={tNav('myWork')} emptyTitle={t('title')} body={t('body')} testId="no-access-my-work" />;
    }
    return (
        <WorkConfigProvider config={page.config}>
            <MyWorkView userId={page.ctx.userId} title={tNav('myWork')} />
        </WorkConfigProvider>
    );
}
