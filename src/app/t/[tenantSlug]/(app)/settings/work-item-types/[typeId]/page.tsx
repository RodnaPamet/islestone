import { WorkItemTypeFieldsSettings } from '@/components/settings/WorkItemTypeFieldsSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → a work item type's fields (2.4b-b, decision 108); the gate is the Settings page's own. */
export default async function WorkItemTypeFieldsPage({ params }: { params: Promise<{ tenantSlug: string; typeId: string }> }) {
    const { tenantSlug, typeId } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <WorkItemTypeFieldsSettings typeId={typeId} affordances={affordances} />;
}
