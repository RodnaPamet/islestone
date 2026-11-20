import { WorkflowStatesSettings } from '@/components/settings/WorkflowStatesSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → a team's workflow states (decision 55); the gate is the Settings page's own. */
export default async function TeamWorkflowSettingsPage({ params }: { params: Promise<{ tenantSlug: string; teamId: string }> }) {
    const { tenantSlug, teamId } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <WorkflowStatesSettings teamId={teamId} affordances={affordances} />;
}
