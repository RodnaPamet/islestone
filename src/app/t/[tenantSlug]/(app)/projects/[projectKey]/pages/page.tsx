import { getTranslations } from 'next-intl/server';

import { PageTreeView } from '@/components/pages/PageTreeView';
import { pageTreePageContext } from '@/lib/server/page-pages.server';

/**
 * A project's Pages (sub-phase 4.1a; decision 341): its page tree. An
 * unknown or invisible project, or a caller without `pages.view`, is a 404.
 */
export default async function ProjectPagesPage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string }> }) {
    const { tenantSlug, projectKey } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const t = await getTranslations('pages');
    const { scope, children, affordances, trees } = await pageTreePageContext(tenantSlug, prefix, t('workspaceTitle'));
    return <PageTreeView scope={scope} initialChildren={children} affordances={affordances} trees={trees} />;
}
