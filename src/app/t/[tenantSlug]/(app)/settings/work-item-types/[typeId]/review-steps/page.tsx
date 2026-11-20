import { WorkItemTypeReviewStepsSettings } from '@/components/settings/WorkItemTypeReviewStepsSettings';
import { settingsPageAccess } from '@/lib/server/settings-pages.server';

/** Settings → a work item type's review steps (2.8c, decisions 149 and 159); the gate is the Settings page's own. */
export default async function WorkItemTypeReviewStepsPage({ params }: { params: Promise<{ tenantSlug: string; typeId: string }> }) {
    const { tenantSlug, typeId } = await params;
    const { affordances } = await settingsPageAccess(tenantSlug);
    return <WorkItemTypeReviewStepsSettings typeId={typeId} affordances={affordances} />;
}
