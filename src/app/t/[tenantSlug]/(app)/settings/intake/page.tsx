import { IntakeSettings } from '@/components/settings/IntakeSettings';
import { intakeSettingsAccess } from '@/lib/server/intake-pages.server';

/** Settings → Intake (sub-phase 2.6a; owner decision 93); the gate is the Settings page's own. */
export default async function IntakeSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { affordances } = await intakeSettingsAccess(tenantSlug);
    return <IntakeSettings affordances={affordances} />;
}
