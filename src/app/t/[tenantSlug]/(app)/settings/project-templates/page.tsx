import { ProjectTemplatesSettings } from '@/components/settings/ProjectTemplatesSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → Project templates (sub-phase 2.5c); the gate is the Settings page's own. */
export default async function ProjectTemplatesSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { templates } = await settingsPageAccess(tenantSlug);
    return <ProjectTemplatesSettings templates={templates} />;
}
