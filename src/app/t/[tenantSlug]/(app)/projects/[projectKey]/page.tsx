import { notFound } from 'next/navigation';

import { ProjectMilestonesLink } from '@/components/milestones/ProjectMilestonesLink';
import { ProjectRecipientListsLink } from '@/components/recipient-lists/ProjectRecipientListsLink';
import { ProjectTemplatesButton } from '@/components/work-items/templates/ProjectTemplatesButton';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { templateAffordances } from '@/app-layer/policies/template.policies';
import { workItemPageContext } from '@/lib/server/work-item-pages.server';

/**
 * A project's work items, as a list or as the board whose columns are its
 * team's workflow states (sub-phase 2.3). The URL names the project by its
 * key prefix (`/projects/ISL`); an unknown or invisible prefix is a 404.
 */
export default async function ProjectPage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string }> }) {
    const { tenantSlug, projectKey } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const { ctx, config, savedViews, workConfig } = await workItemPageContext(tenantSlug, { projectKeyPrefix: prefix });
    const project = config.projects.find((p) => p.keyPrefix === prefix);
    if (!project) notFound();
    return (
        <WorkConfigProvider config={config}>
            <WorkItemsView
                scope={{ projectId: project.id, teamId: project.teamId }}
                title={project.name}
                description={project.keyPrefix}
                viewKey={`project:${project.id}`}
                savedViews={savedViews}
                manageCustomFields={workConfig.manageCustomFields && !project.archived}
                headerLinks={
                    <>
                        <ProjectMilestonesLink keyPrefix={project.keyPrefix} />
                        <ProjectRecipientListsLink keyPrefix={project.keyPrefix} />
                        {templateAffordances(ctx).manageItemTemplates && !project.archived && (
                            <ProjectTemplatesButton projectId={project.id} teamId={project.teamId} projectName={project.name} />
                        )}
                    </>
                }
            />
        </WorkConfigProvider>
    );
}
