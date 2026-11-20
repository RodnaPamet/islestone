'use client';

/**
 * Settings → Intake (sub-phase 2.6a; owner decisions 93 and 95): per project,
 * whether it takes requests, its notify list (the members a new request
 * rings) and its forms (create, edit, publish, archive, through the
 * builder). The writes are offered only when the server's affordances say
 * so (`intakeAffordances().manage`); a component never checks a role.
 * A published public form (2.6b) offers its link to copy; whether public
 * forms are open on the deployment is asked on the server.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Combobox } from '@/components/ui/combobox';
import { CopyButton } from '@/components/ui/copy-button';
import { useToast } from '@/components/ui/hooks';
import { Switch } from '@/components/ui/switch';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import { intakeFormPath, projectIntakePath, publicIntakeFormPath } from '@/lib/intake/paths';
import type { IntakeAffordances, IntakeFormData, ProjectIntakeSettings } from '@/lib/intake/types';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { env as clientEnv } from '@/env-client';

import { intakeRefusal, useIntakeApi, useIntakeForms, useProjectIntakes } from '@/components/intake/data/intake-data';
import { IntakeFormBuilder } from './IntakeFormBuilder';

function ProjectIntakeCard({
    project,
    forms,
    canManage,
    publicForms,
}: {
    project: ProjectIntakeSettings;
    forms: IntakeFormData[];
    canManage: boolean;
    publicForms: boolean;
}) {
    const tCard = useTranslations('settings.intake');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const { send } = useIntakeApi();
    const { members } = useMembers();
    const [editing, setEditing] = useState<IntakeFormData | 'new' | null>(null);
    const memberOptions = members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id }));
    const notify = memberOptions.filter((o) => project.notifyUserIds.includes(o.value));

    const save = async (body: { enabled: boolean; notifyUserIds?: string[] }) => {
        try {
            await send('PUT', `/projects/${encodeURIComponent(project.projectId)}/intake`, body);
            toast.success(tCard('saved', { project: project.projectName }));
        } catch (err) {
            toast.error(intakeRefusal(err, tCard('failed')));
        }
    };
    const setFormState = async (form: IntakeFormData, change: { published?: boolean; archived?: boolean }) => {
        try {
            await send('PATCH', `/intake/forms/${encodeURIComponent(form.id)}`, change, form.version);
        } catch (err) {
            toast.error(intakeRefusal(err, tCard('failed')));
        }
    };

    return (
        <section aria-labelledby={`intake-project-${project.projectId}`} className="space-y-default rounded-md border border-border-subtle p-default" data-testid="intake-project">
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 id={`intake-project-${project.projectId}`} className="text-lg font-semibold text-content-emphasis">
                    {project.projectName} ({project.keyPrefix})
                </h2>
                <div className="flex items-center gap-tight">
                    {project.enabled && (
                        <Link className="text-sm underline" href={tenantHref(projectIntakePath(project.keyPrefix))}>
                            {tCard('openIntake', { count: project.pendingCount })}
                        </Link>
                    )}
                    <Switch
                        id={`intake-enabled-${project.projectId}`}
                        checked={project.enabled}
                        disabled={!canManage}
                        onCheckedChange={(v) => void save({ enabled: v })}
                        aria-label={tCard('enabledFor', { project: project.projectName })}
                    />
                    <label htmlFor={`intake-enabled-${project.projectId}`} className="text-sm text-content-default">
                        {project.enabled ? tCard('on') : tCard('off')}
                    </label>
                </div>
            </div>
            {project.enabled && (
                <>
                    <div className="space-y-tight">
                        <h3 className="text-sm font-medium text-content-emphasis">{tCard('notify')}</h3>
                        <p className="text-xs text-content-muted">{tCard('notifyHint')}</p>
                        <Combobox
                            id={`intake-notify-${project.projectId}`}
                            multiple
                            selected={notify}
                            setSelected={(opts) => canManage && void save({ enabled: true, notifyUserIds: opts.map((o) => o.value) })}
                            options={memberOptions}
                            disabled={!canManage}
                            caret
                            placeholder={tCard('notifyNone')}
                            buttonProps={{ 'aria-label': tCard('notifyFor', { project: project.projectName }) }}
                        />
                    </div>
                    <div className="space-y-tight">
                        <div className="flex items-center justify-between gap-tight">
                            <h3 className="text-sm font-medium text-content-emphasis">{tCard('forms')}</h3>
                            {canManage && <Button variant="secondary" size="sm" text={tCard('newForm')} onClick={() => setEditing('new')} />}
                        </div>
                        {forms.length === 0 && <p className="text-sm text-content-muted">{tCard('noForms')}</p>}
                        <ul className="divide-y divide-border-subtle">
                            {forms.map((f) => (
                                <li key={f.id} className="flex flex-wrap items-center justify-between gap-tight py-tight">
                                    <span className="text-sm">
                                        {f.published && !f.archived && f.access === 'MEMBERS' ? (
                                            <Link className="text-content-emphasis underline" href={tenantHref(intakeFormPath(f.id))}>
                                                {f.name}
                                            </Link>
                                        ) : (
                                            <span className="text-content-emphasis">{f.name}</span>
                                        )}{' '}
                                        <span className="text-xs text-content-muted">
                                            {f.access === 'PUBLIC' ? tCard('accessPublic') : tCard('accessMembers')} ·{' '}
                                            {f.archived ? tCard('archived') : f.published ? tCard('published') : tCard('draft')} · {tCard('fieldCount', { count: f.definition.fields.length })}
                                        </span>
                                    </span>
                                    {f.access === 'PUBLIC' && f.publicId && f.published && !f.archived && publicForms && (
                                        <CopyButton
                                            value={`${clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '')}${publicIntakeFormPath(f.publicId)}`}
                                            label={tCard('copyLinkNamed', { name: f.name })}
                                            successMessage={tCard('linkCopied')}
                                        />
                                    )}
                                    {canManage && (
                                        <span className="flex flex-wrap gap-tight">
                                            {!f.archived && (
                                                <Button variant="ghost" size="sm" text={tCard('edit')} aria-label={tCard('editNamed', { name: f.name })} onClick={() => setEditing(f)} />
                                            )}
                                            {!f.archived && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    text={f.published ? tCard('unpublish') : tCard('publish')}
                                                    aria-label={f.published ? tCard('unpublishNamed', { name: f.name }) : tCard('publishNamed', { name: f.name })}
                                                    onClick={() => void setFormState(f, { published: !f.published })}
                                                />
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={f.archived ? tCard('restore') : tCard('archive')}
                                                aria-label={f.archived ? tCard('restoreNamed', { name: f.name }) : tCard('archiveNamed', { name: f.name })}
                                                onClick={() => void setFormState(f, { archived: !f.archived })}
                                            />
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </>
            )}
            {editing && (
                <IntakeFormBuilder
                    open
                    onOpenChange={(v) => !v && setEditing(null)}
                    projectId={project.projectId}
                    form={editing === 'new' ? null : editing}
                    publicForms={publicForms}
                />
            )}
        </section>
    );
}

export function IntakeSettings({ affordances, publicForms = false }: { affordances: IntakeAffordances; publicForms?: boolean }) {
    const t = useTranslations('settings.intake');
    const { data: projects, error, isLoading } = useProjectIntakes(affordances.manage);
    const { data: forms } = useIntakeForms(affordances.manage || affordances.view);
    return (
        <DashboardLayout header={{ title: t('title'), description: t('description'), back: { smart: true } }} data-testid="intake-settings">
            {!affordances.manage && <p className="text-sm text-content-muted">{t('readOnly')}</p>}
            {error && <p role="alert">{intakeRefusal(error, t('failed'))}</p>}
            {!isLoading && (projects ?? []).length === 0 && affordances.manage && <p className="text-sm text-content-muted">{t('noProjects')}</p>}
            {(projects ?? []).map((p) => (
                <ProjectIntakeCard key={p.projectId} project={p} forms={(forms ?? []).filter((f) => f.projectId === p.projectId)} canManage={affordances.manage} publicForms={publicForms} />
            ))}
        </DashboardLayout>
    );
}
