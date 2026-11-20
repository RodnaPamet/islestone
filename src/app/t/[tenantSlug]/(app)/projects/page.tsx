import { getTranslations } from 'next-intl/server';

import { mayCreateProject } from '@/app-layer/policies/work-config.policies';
import { ProjectsList } from '@/components/work-items/ProjectsList';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * Projects: every project the member can see, each linking to its list and
 * board (sub-phase 2.3). Anyone who holds `projects.create` creates a project
 * here, through the same dialog as Settings → Projects (owner decision 57);
 * whether to offer it is `mayCreateProject`, the predicate the usecase
 * asserts, asked on the server.
 */
export default async function ProjectsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { ctx, config } = await workItemPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return <ProjectsList title={tNav('projects')} projects={config.projects} teams={config.teams} mayCreateProject={mayCreateProject(ctx)} />;
}
