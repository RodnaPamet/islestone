'use client';

/**
 * Settings → Projects (decision 55): every project, archived ones included;
 * create (a team, a name and a key prefix), rename, archive behind a typed
 * confirmation (its work items stop taking changes), and unarchive. Delete,
 * restore and a key-prefix change stay API-only for now (the coordinator's
 * decision for this pull request). With no team yet, the dialog sends the
 * person to Teams first.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, type SettingsProject, useProjects, useSettingsApi, useTeams } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { TypedConfirmModal } from './TypedConfirmModal';

type Editing = { mode: 'create' } | { mode: 'rename'; project: SettingsProject } | null;

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

export function ProjectsSettings({ affordances }: { affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const { data, error, isLoading } = useProjects();
    const { data: teams } = useTeams();
    const { send, revalidate } = useSettingsApi();
    const [editing, setEditing] = useState<Editing>(null);
    const [archiving, setArchiving] = useState<SettingsProject | null>(null);
    const [name, setName] = useState('');
    const [teamId, setTeamId] = useState('');
    const [keyPrefix, setKeyPrefix] = useState('');
    const teamName = useMemo(() => new Map((teams ?? []).map((x) => [x.id, x.name])), [teams]);
    const noTeams = teams !== undefined && teams.length === 0;

    const columns = useMemo(() => {
        const unarchive = async (project: SettingsProject) => {
            try {
                await send('POST', `${projectPath(project.id)}/archive`, { archived: false });
                await revalidate(SETTINGS_PATHS.projects);
                toast.success(t('projects.unarchivedToast', { name: project.name }));
            } catch (err) {
                toast.error(refusalText(err, t('common.failed')));
            }
        };
        const showActions = affordances.editProject || affordances.archiveProject;
        return createColumns<SettingsProject>([
            {
                id: 'name',
                header: t('projects.col.name'),
                cell: ({ row }) => (
                    <Link href={tenantHref(`/projects/${row.original.keyPrefix}`)} className="text-content-emphasis hover:underline">
                        {row.original.name}
                    </Link>
                ),
            },
            { id: 'key', header: t('projects.col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.keyPrefix}</span> },
            { id: 'team', header: t('projects.col.team'), cell: ({ row }) => teamName.get(row.original.teamId) ?? '' },
            { id: 'status', header: t('projects.col.status'), cell: ({ row }) => (row.original.archivedAt ? t('common.archived') : t('common.active')) },
            ...(showActions
                ? [
                      {
                          id: 'actions',
                          header: t('common.actions'),
                          cell: ({ row }: { row: { original: SettingsProject } }) => {
                              const project = row.original;
                              return (
                                  <div className="flex flex-wrap gap-tight">
                                      {affordances.editProject && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('common.rename')}
                                              aria-label={t('common.renameNamed', { name: project.name })}
                                              onClick={() => {
                                                  setName(project.name);
                                                  setEditing({ mode: 'rename', project });
                                              }}
                                          />
                                      )}
                                      {affordances.archiveProject &&
                                          (project.archivedAt ? (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  text={t('common.unarchive')}
                                                  aria-label={t('common.unarchiveNamed', { name: project.name })}
                                                  onClick={() => void unarchive(project)}
                                              />
                                          ) : (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  text={t('common.archive')}
                                                  aria-label={t('common.archiveNamed', { name: project.name })}
                                                  onClick={() => setArchiving(project)}
                                              />
                                          ))}
                                  </div>
                              );
                          },
                      },
                  ]
                : []),
        ]);
    }, [t, tenantHref, teamName, affordances, send, revalidate, toast]);

    const teamOptions: ComboboxOption[] = (teams ?? []).map((team) => ({ value: team.id, label: team.name }));

    const submit = async (): Promise<string | null> => {
        if (!editing) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            if (editing.mode === 'create') {
                await send('POST', '/projects', { teamId, name: value, keyPrefix: keyPrefix.trim().toUpperCase() });
                toast.success(t('projects.created', { name: value }));
            } else {
                await send('PATCH', projectPath(editing.project.id), { name: value });
            }
            await revalidate(SETTINGS_PATHS.projects);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    const archive = async (): Promise<string | null> => {
        const project = archiving;
        if (!project) return null;
        try {
            await send('POST', `${projectPath(project.id)}/archive`, { archived: true });
            await revalidate(SETTINGS_PATHS.projects);
            toast.success(t('projects.archivedToast', { name: project.name }));
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    const creating = editing?.mode === 'create';
    return (
        <EntityListPage<SettingsProject>
            header={{
                title: t('projects.title'),
                description: t('projects.description'),
                back: { smart: true },
                actions: affordances.createProject ? (
                    <Button
                        id="new-project-btn"
                        variant="primary"
                        icon={<Plus />}
                        text={t('projects.create')}
                        onClick={() => {
                            setName('');
                            setKeyPrefix('');
                            setTeamId(teams?.[0]?.id ?? '');
                            setEditing({ mode: 'create' });
                        }}
                    />
                ) : undefined,
            }}
            table={{
                data: data ?? [],
                columns,
                loading: isLoading,
                error: error ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: t('projects.empty'),
                resourceName: (plural: boolean) => (plural ? t('projects.resourcePlural') : t('projects.resource')),
                'data-testid': 'settings-projects-table',
            }}
        >
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing?.mode === 'rename' ? t('projects.renameTitle') : t('projects.createTitle')}
                submitLabel={editing?.mode === 'rename' ? t('common.save') : t('projects.createSubmit')}
                submitDisabled={creating && (noTeams || !teamId)}
                onSubmit={submit}
            >
                {creating && noTeams && (
                    <p role="status" className="text-sm text-content-muted">
                        {t('projects.noTeams')}{' '}
                        <Link href={tenantHref('/settings/teams')} className="text-content-emphasis underline">
                            {t('projects.goTeams')}
                        </Link>
                    </p>
                )}
                <FormField label={t('common.name')} required>
                    <Input id="project-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
                {creating && (
                    <>
                        <FormField label={t('projects.team')} required>
                            <Combobox
                                id="project-team-input"
                                selected={teamOptions.find((o) => o.value === teamId) ?? null}
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
                    </>
                )}
            </SettingsFormModal>
            <TypedConfirmModal
                open={archiving !== null}
                onOpenChange={(v) => !v && setArchiving(null)}
                title={t('projects.archiveTitle', { name: archiving?.name ?? '' })}
                body={t('projects.archiveBody')}
                word={archiving?.keyPrefix ?? ''}
                fieldLabel={t('projects.archiveTypeToConfirm', { prefix: archiving?.keyPrefix ?? '' })}
                confirmLabel={t('projects.archiveConfirm')}
                onConfirm={archive}
            />
        </EntityListPage>
    );
}
