'use client';

/**
 * Settings → Labels (decision 55): workspace labels and team labels; create
 * (with the scope, fixed afterwards), rename, and delete with the undo toast
 * (the server detaches the label from every item). Names only: colour is
 * API-only for now (the coordinator's decision for this pull request).
 *
 * Written fresh for Islestone.
 */
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
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, type SettingsLabel, useLabels, useSettingsApi, useTeams } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { useUndoDelete, withoutRow } from './use-undo-delete';

type Editing = { mode: 'create' } | { mode: 'rename'; label: SettingsLabel } | null;

const WORKSPACE = '';
const labelPath = (id: string) => `/labels/${encodeURIComponent(id)}`;

export function LabelsSettings({ affordances }: { affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const toast = useToast();
    const { data, error, isLoading } = useLabels();
    const { data: teams } = useTeams();
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const [editing, setEditing] = useState<Editing>(null);
    const [name, setName] = useState('');
    const [scope, setScope] = useState(WORKSPACE);
    const canManage = affordances.manageWorkConfig;
    const teamName = useMemo(() => new Map((teams ?? []).map((x) => [x.id, x.name])), [teams]);

    const columns = useMemo(
        () =>
            createColumns<SettingsLabel>([
                { id: 'name', header: t('labels.col.name'), cell: ({ row }) => <span className="text-content-emphasis">{row.original.name}</span> },
                {
                    id: 'scope',
                    header: t('labels.col.scope'),
                    cell: ({ row }) => (row.original.teamId ? (teamName.get(row.original.teamId) ?? '') : t('labels.scopeWorkspace')),
                },
                ...(canManage
                    ? [
                          {
                              id: 'actions',
                              header: t('common.actions'),
                              cell: ({ row }: { row: { original: SettingsLabel } }) => {
                                  const label = row.original;
                                  return (
                                      <div className="flex flex-wrap gap-tight">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('common.rename')}
                                              aria-label={t('common.renameNamed', { name: label.name })}
                                              onClick={() => {
                                                  setName(label.name);
                                                  setEditing({ mode: 'rename', label });
                                              }}
                                          />
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('common.delete')}
                                              aria-label={t('common.deleteNamed', { name: label.name })}
                                              onClick={() =>
                                                  undoDelete<SettingsLabel[]>({
                                                      path: SETTINGS_PATHS.labels,
                                                      without: withoutRow(label.id),
                                                      deletePath: labelPath(label.id),
                                                      message: t('labels.deleted', { name: label.name }),
                                                  })
                                              }
                                          />
                                      </div>
                                  );
                              },
                          },
                      ]
                    : []),
            ]),
        [t, canManage, teamName, undoDelete],
    );

    const scopeOptions: ComboboxOption[] = [
        { value: WORKSPACE, label: t('labels.scopeWorkspace') },
        ...(teams ?? []).map((team) => ({ value: team.id, label: team.name })),
    ];

    const submit = async (): Promise<string | null> => {
        if (!editing) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            if (editing.mode === 'create') {
                await send('POST', SETTINGS_PATHS.labels, { name: value, ...(scope ? { teamId: scope } : {}) });
                toast.success(t('labels.created', { name: value }));
            } else {
                await send('PATCH', labelPath(editing.label.id), { name: value });
            }
            await revalidate(SETTINGS_PATHS.labels);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    return (
        <EntityListPage<SettingsLabel>
            header={{
                title: t('labels.title'),
                description: t('labels.description'),
                back: { smart: true },
                actions: canManage ? (
                    <Button
                        id="new-label-btn"
                        variant="primary"
                        icon={<Plus />}
                        text={t('labels.create')}
                        onClick={() => {
                            setName('');
                            setScope(WORKSPACE);
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
                emptyState: t('labels.empty'),
                resourceName: (plural: boolean) => (plural ? t('labels.resourcePlural') : t('labels.resource')),
                'data-testid': 'settings-labels-table',
            }}
        >
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing?.mode === 'rename' ? t('labels.renameTitle') : t('labels.createTitle')}
                submitLabel={editing?.mode === 'rename' ? t('common.save') : t('labels.createSubmit')}
                onSubmit={submit}
            >
                <FormField label={t('common.name')} required>
                    <Input id="label-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
                {editing?.mode === 'create' && (
                    <FormField label={t('labels.scope')}>
                        <Combobox
                            id="label-scope-input"
                            selected={scopeOptions.find((o) => o.value === scope) ?? null}
                            setSelected={(o) => o && setScope(o.value)}
                            options={scopeOptions}
                            caret
                        />
                    </FormField>
                )}
            </SettingsFormModal>
        </EntityListPage>
    );
}
