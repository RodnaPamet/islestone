import { getTranslations } from 'next-intl/server';

import { ProjectsList } from '@/components/work-items/ProjectsList';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * Projects: every project the member can see, each linking to its list and
 * board (sub-phase 2.3). Projects are created through the API and, later,
 * the workspace settings.
 */
export default async function ProjectsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { config } = await workItemPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return <ProjectsList title={tNav('projects')} projects={config.projects} teams={config.teams} />;
}
