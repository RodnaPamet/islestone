import { getTranslations } from 'next-intl/server';

import { PageView } from '@/components/pages/PageView';
import { pagePageContext } from '@/lib/server/page-pages.server';

/**
 * A page (sub-phase 4.1a): its breadcrumb, header and subpages, in either
 * kind of tree (the URL names the page alone, so a move keeps it). An
 * unknown, deleted or invisible page is a 404.
 */
export default async function PagePage({ params }: { params: Promise<{ tenantSlug: string; pageId: string }> }) {
    const { tenantSlug, pageId } = await params;
    const t = await getTranslations('pages');
    const { detail, trees } = await pagePageContext(tenantSlug, decodeURIComponent(pageId), t('workspaceTitle'));
    return <PageView initialDetail={detail} trees={trees} />;
}
