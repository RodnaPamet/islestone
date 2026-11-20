import { getTranslations } from 'next-intl/server';

import { FormsView } from '@/components/intake/FormsView';
import { formsPageContext } from '@/lib/server/intake-pages.server';

/** Forms (sub-phase 2.6a): the forms a member may send a request through. */
export default async function FormsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
    const { tenantSlug } = await params;
    const { forms } = await formsPageContext(tenantSlug);
    const tNav = await getTranslations('nav');
    return <FormsView title={tNav('forms')} initialForms={forms} />;
}
