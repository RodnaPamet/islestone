import { notFound } from 'next/navigation';

import { ProjectMilestonesLink } from '@/components/milestones/ProjectMilestonesLink';
import { ProjectPagesLink } from '@/components/pages/ProjectPagesLink';
import { ProjectDueDate } from '@/components/projects/ProjectDueDate';
import { ProjectRecipientListsLink } from '@/components/recipient-lists/ProjectRecipientListsLink';
import { ProjectTimeButton } from '@/components/time/ProjectTimeButton';
import { ProjectTemplatesButton } from '@/components/work-items/templates/ProjectTemplatesButton';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { ForecastSection } from '@/components/analytics/forecast/ForecastSection';
import { mayViewAnalytics } from '@/app-layer/policies/analytics.policies';
import { mayReadPages } from '@/app-layer/policies/page.policies';
import { templateAffordances } from '@/app-layer/policies/template.policies';
import { mayManageRates } from '@/app-layer/policies/time.policies';
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
    // The Forecast section of the project's open items and the toolbar's action for its filters (3.6c, decision 324).
    const forecast = mayViewAnalytics(ctx);
    return (
        <WorkConfigProvider config={config}>
            <WorkItemsView
                scope={{ projectId: project.id, teamId: project.teamId }}
                title={project.name}
                description={project.keyPrefix}
                viewKey={`project:${project.id}`}
                savedViews={savedViews}
                forecast={forecast}
                belowFilters={forecast && !project.archived ? <ForecastSection filters={{ projectId: project.id }} compact /> : undefined}
                manageCustomFields={workConfig.manageCustomFields && !project.archived}
                headerLinks={
                    <>
                        <ProjectDueDate projectId={project.id} projectName={project.name} dueDate={project.dueDate ?? null} canEdit={workConfig.editProject && !project.archived} />
                        <ProjectMilestonesLink keyPrefix={project.keyPrefix} />
                        {/* The project's page tree (4.1a): a reader of pages (`pages.view`), asked on the server. */}
                        {mayReadPages(ctx) && <ProjectPagesLink keyPrefix={project.keyPrefix} />}
                        <ProjectRecipientListsLink keyPrefix={project.keyPrefix} />
                        {templateAffordances(ctx).manageItemTemplates && !project.archived && (
                            <ProjectTemplatesButton projectId={project.id} teamId={project.teamId} projectName={project.name} />
                        )}
                        {/* A project's billable default and rates (3.4d): a rates holder's (time.rates), asked on the server. */}
                        {mayManageRates(ctx) && <ProjectTimeButton projectId={project.id} projectName={project.name} />}
                    </>
                }
            />
        </WorkConfigProvider>
    );
}
