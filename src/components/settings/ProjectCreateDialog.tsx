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
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useMayOpenSettings } from '@/components/layout/nav-config';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { refusalText, type SettingsProject, useSettingsApi, useTeams } from './settings-data';
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

    // Each opening starts empty: reset on the closed-to-open transition only,
    // never while the person types.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName('');
            setTeamId('');
            setKeyPrefix('');
        }
    }

    const noTeams = teams !== undefined && teams.length === 0;
    // The first team until the person picks one, also when the teams arrive
    // after the dialog opened.
    const chosenTeamId = teamId || teams?.[0]?.id || '';
    const teamOptions: ComboboxOption[] = (teams ?? []).map((team) => ({ value: team.id, label: team.name }));

    const submit = async (): Promise<string | null> => {
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            const project = await send<SettingsProject>('POST', '/projects', {
                teamId: chosenTeamId,
                name: value,
                keyPrefix: keyPrefix.trim().toUpperCase(),
            });
            toast.success(t('projects.created', { name: value }));
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
        </SettingsFormModal>
    );
}
