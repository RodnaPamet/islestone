import { getTranslations } from 'next-intl/server';

import { IntakeView } from '@/components/intake/IntakeView';
import { WorkConfigProvider } from '@/components/work-items/data/use-work-config';
import { intakePageContext } from '@/lib/server/intake-pages.server';

/**
 * Intake (sub-phase 2.6a; owner decision 91): the requests of every visible
 * project, triaged here. Readers hold `intake.view`; the actions offered are
 * `intakeAffordances`, asked on the server.
 */
export default async function IntakePage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { config, affordances } = await intakePageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return (
        <WorkConfigProvider config={config}>
            <IntakeView title={tNav('intake')} affordances={affordances} />
        </WorkConfigProvider>
    );
}
