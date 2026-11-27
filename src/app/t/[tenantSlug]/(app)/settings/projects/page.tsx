import { ProjectsSettings } from '@/components/settings/ProjectsSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Projects (decision 55); the gate is the Settings page's own. */
export default async function ProjectsSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances, templates, goals, manageRates } = await settingsPageAccess(tenantSlug);
    return <ProjectsSettings affordances={affordances} templates={templates} goals={goals} rates={manageRates} />;
}
