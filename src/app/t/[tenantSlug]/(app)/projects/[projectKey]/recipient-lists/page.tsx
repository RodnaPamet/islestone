import { getTranslations } from 'next-intl/server';

import { RecipientListsView } from '@/components/recipient-lists/RecipientListsView';
import { projectRecipientListsPageContext } from '@/lib/server/recipient-list-pages.server';

/**
 * A project's recipient lists (sub-phase 2.7e; owner decisions 138 to 141),
 * reached from the project page and from Settings → Projects. Managed under
 * `projects.edit` (decision 140), asked on the server. An unknown or
 * invisible project is a 404.
 */
export default async function ProjectRecipientListsPage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string }> }) {
    const { tenantSlug, projectKey } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const { project, canManage } = await projectRecipientListsPageContext(tenantSlug, prefix);
    const t = await getTranslations('recipientLists');
    return (
        <RecipientListsView
            owner={{ kind: 'project', projectId: project.id }}
            title={t('projectTitle', { project: project.name })}
            description={t('projectDescription')}
            canManage={canManage}
            readOnlyReason={project.archived ? t('projectArchived') : t('readOnly')}
        />
    );
}
