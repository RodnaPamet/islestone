'use client';

/**
 * Forms (sub-phase 2.6a): the forms a member may send a request through now,
 * by project, each opening its page. Anyone who sees a project may send a
 * request through its open forms (owner decision 92), Viewers included.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { intakeFormPath } from '@/lib/intake/paths';
import type { OpenIntakeForm } from '@/lib/intake/types';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { useOpenIntakeForms } from './data/intake-data';

export function FormsView({ title, initialForms }: { title: string; initialForms: OpenIntakeForm[] }) {
    const t = useTranslations('intake.forms');
    const tenantHref = useTenantHref();
    const { data } = useOpenIntakeForms();
    const forms = data ?? initialForms;
    const byProject = new Map<string, OpenIntakeForm[]>();
    for (const f of forms) byProject.set(f.projectId, [...(byProject.get(f.projectId) ?? []), f]);

    return (
        <DashboardLayout header={{ title, description: t('description') }} data-testid="forms-page">
            {forms.length === 0 && <p className="text-sm text-content-muted">{t('none')}</p>}
            {[...byProject.values()].map((list) => (
                <section key={list[0]!.projectId} aria-labelledby={`forms-${list[0]!.projectId}`} className="space-y-tight">
                    <h2 id={`forms-${list[0]!.projectId}`} className="text-lg font-semibold text-content-emphasis">
                        {list[0]!.projectName} ({list[0]!.projectKeyPrefix})
                    </h2>
                    <ul className="space-y-tight">
                        {list.map((f) => (
                            <li key={f.id}>
                                <Link className="text-content-emphasis underline" href={tenantHref(intakeFormPath(f.id))}>
                                    {f.name}
                                </Link>
                                {f.definition.intro && <p className="text-sm text-content-muted">{f.definition.intro.slice(0, 160)}</p>}
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </DashboardLayout>
    );
}
