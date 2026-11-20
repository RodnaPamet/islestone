'use client';

/**
 * Settings → Work item types (decision 55): create, rename, archive and
 * unarchive. An archived type stays on the items that have it and is
 * refused for new ones. Names only: icon, colour and order are API-only
 * for now (the coordinator's decision for this pull request).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { createColumns } from '@/components/ui/table';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, type SettingsType, useSettingsApi, useWorkItemTypes } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';

type Editing = { mode: 'create' } | { mode: 'rename'; type: SettingsType } | null;

const typePath = (id: string) => `/work-item-types/${encodeURIComponent(id)}`;

export function WorkItemTypesSettings({ affordances }: { affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const toast = useToast();
    const { data, error, isLoading } = useWorkItemTypes();
    const { send, revalidate } = useSettingsApi();
    const [editing, setEditing] = useState<Editing>(null);
    const [name, setName] = useState('');
    const canManage = affordances.manageWorkConfig;

    const columns = useMemo(() => {
        const setArchived = async (type: SettingsType, archived: boolean) => {
            try {
                await send('PATCH', typePath(type.id), { archived });
                await revalidate(SETTINGS_PATHS.types);
            } catch (err) {
                toast.error(refusalText(err, t('common.failed')));
            }
        };
        return createColumns<SettingsType>([
            { id: 'name', header: t('types.col.name'), cell: ({ row }) => <span className="text-content-emphasis">{row.original.name}</span> },
            { id: 'status', header: t('types.col.status'), cell: ({ row }) => (row.original.archivedAt ? t('common.archived') : t('common.active')) },
            ...(canManage
                ? [
                      {
                          id: 'actions',
                          header: t('common.actions'),
                          cell: ({ row }: { row: { original: SettingsType } }) => {
                              const type = row.original;
                              return (
                                  <div className="flex flex-wrap gap-tight">
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={t('common.rename')}
                                          aria-label={t('common.renameNamed', { name: type.name })}
                                          onClick={() => {
                                              setName(type.name);
                                              setEditing({ mode: 'rename', type });
                                          }}
                                      />
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={type.archivedAt ? t('common.unarchive') : t('common.archive')}
                                          aria-label={type.archivedAt ? t('common.unarchiveNamed', { name: type.name }) : t('common.archiveNamed', { name: type.name })}
                                          onClick={() => void setArchived(type, !type.archivedAt)}
                                      />
                                  </div>
                              );
                          },
                      },
                  ]
                : []),
        ]);
    }, [t, canManage, send, revalidate, toast]);

    const submit = async (): Promise<string | null> => {
        if (!editing) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            if (editing.mode === 'create') {
                await send('POST', '/work-item-types', { name: value });
                toast.success(t('types.created', { name: value }));
            } else {
                await send('PATCH', typePath(editing.type.id), { name: value });
            }
            await revalidate(SETTINGS_PATHS.types);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    return (
        <EntityListPage<SettingsType>
            header={{
                title: t('types.title'),
                description: t('types.description'),
                back: { smart: true },
                actions: canManage ? (
                    <Button
                        id="new-type-btn"
                        variant="primary"
                        icon={<Plus />}
                        text={t('types.create')}
                        onClick={() => {
                            setName('');
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
                emptyState: t('types.empty'),
                resourceName: (plural: boolean) => (plural ? t('types.resourcePlural') : t('types.resource')),
                'data-testid': 'settings-types-table',
            }}
        >
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing?.mode === 'rename' ? t('types.renameTitle') : t('types.createTitle')}
                submitLabel={editing?.mode === 'rename' ? t('common.save') : t('types.createSubmit')}
                onSubmit={submit}
            >
                <FormField label={t('common.name')} required>
                    <Input id="type-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
            </SettingsFormModal>
        </EntityListPage>
    );
}
