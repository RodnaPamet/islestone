'use client';

/**
 * The one "new project" dialog (decisions 55 and 57): a team (the first team
 * until the person picks one, also when the teams arrive after the dialog
 * opened), a name and a key prefix, posted to the projects route. Settings →
 * Projects and the Projects page both open it, so the two cannot drift.
 *
 * With no team, the dialog says a project needs one and refuses to submit;
 * it links to Settings → Teams only for a viewer who may open Settings (the
 * sidebar's own rule, `useMayOpenSettings`), and asks anyone else to ask an
 * admin. Whether the viewer may create a project at all is the caller's
 * server-side answer: this dialog is opened only where it is offered.
 *
 * Roadmap 3.1a (decision 188): an optional Due date, a deadline for the
 * project's schedule; a template's due date applies when none is chosen.
 *
 * Sub-phase 2.5c: a "Template" picker lists the workspace's live project
 * templates (`GET /project-templates`, which takes the same key as the
 * create); the server applies the chosen one in the create's transaction,
 * and what it named that the workspace does not hold is shown after.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMayOpenSettings } from '@/components/layout/nav-config';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { refusalText, type SettingsProject, useProjectTemplates, useSettingsApi, useTeams } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';

export function ProjectCreateDialog({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called with the created project before the dialog closes; show it here. */
    onCreated: (project: SettingsProject) => void | Promise<void>;
}) {
    const t = useTranslations('settings');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const mayOpenSettings = useMayOpenSettings();
    const { data: teams } = useTeams();
    const { send } = useSettingsApi();
    const [name, setName] = useState('');
    const [teamId, setTeamId] = useState('');
    const [keyPrefix, setKeyPrefix] = useState('');
    const [templateId, setTemplateId] = useState('');
    const [dueDate, setDueDate] = useState<string | null>(null);
    const { data: templates } = useProjectTemplates(open);

    // Each opening starts empty: reset on the closed-to-open transition only,
    // never while the person types.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName('');
            setTeamId('');
            setKeyPrefix('');
            setTemplateId('');
            setDueDate(null);
        }
    }

    const noTeams = teams !== undefined && teams.length === 0;
    // The first team until the person picks one, also when the teams arrive
    // after the dialog opened.
    const chosenTeamId = teamId || teams?.[0]?.id || '';
    const teamOptions: ComboboxOption[] = (teams ?? []).map((team) => ({ value: team.id, label: team.name }));
    const templateOptions: ComboboxOption[] = [{ value: '', label: t('projects.noTemplate') }, ...(templates ?? []).map((x) => ({ value: x.id, label: x.name }))];

    const submit = async (): Promise<string | null> => {
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            const project = await send<SettingsProject & { fromTemplate?: { skipped: string[] } }>('POST', '/projects', {
                teamId: chosenTeamId,
                name: value,
                keyPrefix: keyPrefix.trim().toUpperCase(),
                ...(templateId ? { templateId } : {}),
                ...(dueDate ? { dueDate } : {}),
            });
            toast.success(t('projects.created', { name: value }));
            const skipped = project.fromTemplate?.skipped ?? [];
            if (skipped.length > 0) toast.warning(t('projects.templateSkipped', { list: skipped.map((x) => x.replace(/^[a-zA-Z]+:/, '')).join(', ') }));
            await onCreated(project);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={t('projects.createTitle')}
            submitLabel={t('projects.createSubmit')}
            submitDisabled={noTeams || !chosenTeamId}
            onSubmit={submit}
        >
            {noTeams && (
                <p role="status" className="text-sm text-content-muted">
                    {t('projects.noTeams')}{' '}
                    {mayOpenSettings ? (
                        <Link href={tenantHref('/settings/teams')} className="text-content-emphasis underline">
                            {t('projects.goTeams')}
                        </Link>
                    ) : (
                        t('projects.noTeamsAskAdmin')
                    )}
                </p>
            )}
            <FormField label={t('common.name')} required>
                <Input id="project-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
            </FormField>
            <FormField label={t('projects.team')} required>
                <Combobox
                    id="project-team-input"
                    selected={teamOptions.find((o) => o.value === chosenTeamId) ?? null}
                    setSelected={(o) => o && setTeamId(o.value)}
                    options={teamOptions}
                    caret
                />
            </FormField>
            {(templates ?? []).length > 0 && (
                <FormField label={t('projects.template')} description={t('projects.templateHint')}>
                    <Combobox
                        id="project-template-input"
                        selected={templateOptions.find((o) => o.value === templateId) ?? null}
                        setSelected={(o) => o && setTemplateId(o.value)}
                        options={templateOptions}
                        caret
                        hideSearch
                    />
                </FormField>
            )}
            <FormField label={t('projects.keyPrefix')} description={t('projects.keyPrefixHint')} required>
                <Input
                    id="project-key-prefix-input"
                    value={keyPrefix}
                    onChange={(e) => setKeyPrefix(e.target.value.toUpperCase())}
                    maxLength={10}
                    autoComplete="off"
                    className="font-mono"
                />
            </FormField>
            <FormField label={t('projects.dueDate')} description={t('projects.dueDateHint')}>
                <DatePicker id="project-due-date-input" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
            </FormField>
        </SettingsFormModal>
    );
}
