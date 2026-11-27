import { getTranslations } from 'next-intl/server';

import { PageTreeView } from '@/components/pages/PageTreeView';
import { pageTreePageContext } from '@/lib/server/page-pages.server';

/**
 * Workspace pages (sub-phase 4.1a; decision 341): the workspace's page tree.
 * A caller without `pages.view` is a 404. The Pages sidebar entry that leads
 * here is held back until 4.1b (docs/porting/maps/4.1.md, "Split").
 */
export default async function WorkspacePagesPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const t = await getTranslations('pages');
    const { scope, children, affordances, trees } = await pageTreePageContext(tenantSlug, null, t('workspaceTitle'));
    return <PageTreeView scope={scope} initialChildren={children} affordances={affordances} trees={trees} />;
}
