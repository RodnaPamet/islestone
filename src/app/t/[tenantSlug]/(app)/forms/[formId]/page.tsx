import { IntakeFormPage } from '@/components/intake/IntakeFormPage';
import { formPageContext } from '@/lib/server/intake-pages.server';

/** One internal form (sub-phase 2.6a). A form that is not open now is a 404. */
export default async function FormPage({ params }: { params: Promise<{ tenantSlug: string; formId: string }> }) {
    const { tenantSlug, formId } = await params;
    const { form } = await formPageContext(tenantSlug, decodeURIComponent(formId));
    return <IntakeFormPage form={form} />;
}
