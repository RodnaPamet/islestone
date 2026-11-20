import { getTranslations } from 'next-intl/server';

import { IntakeView } from '@/components/intake/IntakeView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { intakePageContext } from '@/lib/server/intake-pages.server';

/** One project's Intake (sub-phase 2.6a). An unknown or invisible prefix is a 404. */
export default async function ProjectIntakePage({ params }: { params: Promise<{ tenantSlug: string; projectKey: string }> }) {
    const { tenantSlug, projectKey } = await params;
    const prefix = decodeURIComponent(projectKey).toUpperCase();
    const { config, affordances, project } = await intakePageContext(tenantSlug, { projectKeyPrefix: prefix });
    const t = await getTranslations('intake');
    return (
        <WorkConfigProvider config={config}>
            <IntakeView title={t('projectTitle', { project: project!.name })} description={project!.keyPrefix} projectId={project!.id} affordances={affordances} back />
        </WorkConfigProvider>
    );
}
