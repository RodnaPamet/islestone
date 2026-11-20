'use client';

/**
 * One internal form's page (sub-phase 2.6a): the form, and after a send, its
 * confirmation text and a short reference (owner decision 89's on-screen
 * confirmation, for members).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { intakeReference } from '@/lib/intake/reference';
import type { IntakeRequestRow, OpenIntakeForm } from '@/lib/intake/types';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { intakeRefusal, useIntakeApi } from './data/intake-data';
import { IntakeFormRenderer } from './IntakeFormRenderer';

export function IntakeFormPage({ form }: { form: OpenIntakeForm }) {
    const t = useTranslations('intake.form');
    const tenantHref = useTenantHref();
    const { send } = useIntakeApi();
    const [sent, setSent] = useState<IntakeRequestRow | null>(null);

    return (
        <DashboardLayout
            header={{ title: form.name, description: t('in', { project: `${form.projectName} (${form.projectKeyPrefix})` }), back: { smart: true } }}
            data-testid="intake-form-page"
        >
            {sent ? (
                <div role="status" className="space-y-default" data-testid="intake-sent">
                    <p className="text-content-emphasis">{form.definition.confirmation || t('sent')}</p>
                    <p className="text-sm text-content-muted">{t('reference', { reference: intakeReference(sent.id) })}</p>
                    <div className="flex gap-tight">
                        <Button variant="secondary" text={t('another')} onClick={() => setSent(null)} />
                        <Link className="self-center text-sm underline" href={tenantHref('/forms')}>
                            {t('allForms')}
                        </Link>
                    </div>
                </div>
            ) : (
                <IntakeFormRenderer
                    definition={form.definition}
                    formKey={form.id}
                    onSubmit={async (input) => {
                        try {
                            setSent(await send<IntakeRequestRow>('POST', `/intake/forms/${encodeURIComponent(form.id)}/requests`, input));
                            return null;
                        } catch (err) {
                            return intakeRefusal(err, t('failed'));
                        }
                    }}
                />
            )}
        </DashboardLayout>
    );
}
