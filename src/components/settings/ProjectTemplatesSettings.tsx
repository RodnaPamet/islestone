'use client';

/**
 * Settings → Project templates (sub-phase 2.5c, owner decision 71): the
 * workspace's project templates with what each holds; rename, archive,
 * unarchive and delete (through the undo toast) for a viewer offered
 * `manageProjectTemplates`. A template is made from a project ("Save as
 * template" in Settings → Projects); its content is not edited here.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { createColumns } from '@/components/ui/table';
import type { ProjectTemplateSummary, TemplateAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, useAllProjectTemplates, useSettingsApi } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { useUndoDelete, withoutRow } from './use-undo-delete';

const templatePath = (id: string) => `/project-templates/${encodeURIComponent(id)}`;

export function ProjectTemplatesSettings({ templates }: { templates: TemplateAffordances }) {
    const t = useTranslations('settings');
    const toast = useToast();
    const { data, error, isLoading } = useAllProjectTemplates();
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const [renaming, setRenaming] = useState<ProjectTemplateSummary | null>(null);
    const [name, setName] = useState('');
    const canManage = templates.manageProjectTemplates;

    const columns = useMemo(() => {
        const setArchived = async (template: ProjectTemplateSummary, archived: boolean) => {
            try {
                await send('PATCH', templatePath(template.id), { archived });
                await revalidate(SETTINGS_PATHS.projectTemplatesAll, SETTINGS_PATHS.projectTemplates);
            } catch (err) {
                toast.error(refusalText(err, t('common.failed')));
            }
        };
        return createColumns<ProjectTemplateSummary>([
            { id: 'name', header: t('projectTemplates.col.name'), cell: ({ row }) => <span className="text-content-emphasis">{row.original.name}</span> },
            {
                id: 'holds',
                header: t('projectTemplates.col.holds'),
                cell: ({ row }) =>
                    row.original.counts
                        ? t('projectTemplates.holds', {
                              fields: row.original.counts.customFields,
                              milestones: row.original.counts.milestones,
                              templates: row.original.counts.itemTemplates,
                              items: row.original.counts.items,
                          })
                        : t('projectTemplates.unreadable'),
            },
            { id: 'status', header: t('projectTemplates.col.status'), cell: ({ row }) => (row.original.archived ? t('common.archived') : t('common.active')) },
            ...(canManage
                ? [
                      {
                          id: 'actions',
                          header: t('common.actions'),
                          cell: ({ row }: { row: { original: ProjectTemplateSummary } }) => {
                              const template = row.original;
                              return (
                                  <div className="flex flex-wrap gap-tight">
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={t('common.rename')}
                                          aria-label={t('common.renameNamed', { name: template.name })}
                                          onClick={() => {
                                              setName(template.name);
                                              setRenaming(template);
                                          }}
                                      />
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={template.archived ? t('common.unarchive') : t('common.archive')}
                                          aria-label={template.archived ? t('common.unarchiveNamed', { name: template.name }) : t('common.archiveNamed', { name: template.name })}
                                          onClick={() => void setArchived(template, !template.archived)}
                                      />
                                      <Button
                                          variant="ghost"
                                          size="sm"
                                          text={t('common.delete')}
                                          aria-label={t('common.deleteNamed', { name: template.name })}
                                          onClick={() =>
                                              undoDelete<ProjectTemplateSummary[]>({
                                                  path: SETTINGS_PATHS.projectTemplatesAll,
                                                  without: withoutRow(template.id),
                                                  deletePath: templatePath(template.id),
                                                  message: t('projectTemplates.deleted', { name: template.name }),
                                                  alsoRevalidate: [SETTINGS_PATHS.projectTemplates],
                                              })
                                          }
                                      />
                                  </div>
                              );
                          },
                      },
                  ]
                : []),
        ]);
    }, [t, canManage, send, revalidate, toast, undoDelete]);

    const rename = async (): Promise<string | null> => {
        if (!renaming) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            await send('PATCH', templatePath(renaming.id), { name: value });
            await revalidate(SETTINGS_PATHS.projectTemplatesAll, SETTINGS_PATHS.projectTemplates);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    return (
        <EntityListPage<ProjectTemplateSummary>
            header={{ title: t('projectTemplates.title'), description: t('projectTemplates.description'), back: { smart: true } }}
            table={{
                data: data ?? [],
                columns,
                loading: isLoading,
                error: error ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: t('projectTemplates.empty'),
                resourceName: (plural: boolean) => (plural ? t('projectTemplates.resourcePlural') : t('projectTemplates.resource')),
                'data-testid': 'settings-project-templates-table',
            }}
        >
            <SettingsFormModal
                open={renaming !== null}
                onOpenChange={(v) => !v && setRenaming(null)}
                title={t('projectTemplates.renameTitle')}
                submitLabel={t('common.save')}
                onSubmit={rename}
            >
                <FormField label={t('projectTemplates.name')} required>
                    <Input id="project-template-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
            </SettingsFormModal>
        </EntityListPage>
    );
}
