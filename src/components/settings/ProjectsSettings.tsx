'use client';

/**
 * Settings → Projects (decision 55): every project, archived ones included;
 * create (a team, a name and a key prefix), rename, archive behind a typed
 * confirmation (its work items stop taking changes), and unarchive. Delete,
 * restore and a key-prefix change stay API-only for now (the coordinator's
 * decision for this pull request). The create dialog is `ProjectCreateDialog`,
 * shared with the Projects page (decision 57); with no team yet, it sends the
 * person to Teams first. A project's custom fields open from its row (2.4,
 * `CustomFieldsManager`, offered on `manageCustomFields`).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { CustomFieldsManager } from '@/components/work-items/fields/CustomFieldsManager';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { createColumns } from '@/components/ui/table';
import { projectRecipientListsHref } from '@/components/recipient-lists/ProjectRecipientListsLink';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { Switch } from '@/components/ui/switch';
import type { TemplateAffordances, WorkConfigAffordances } from '@/lib/work-items/types';
import type { GoalAffordances } from '@/lib/goals/types';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

import { ProjectCreateDialog } from './ProjectCreateDialog';
import { refusalText, SETTINGS_PATHS, type SettingsProject, useInitiatives, useProjects, useSettingsApi, useTeams } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { ProjectTimeDialog } from '@/components/time/ProjectTimeDialog';
import { TypedConfirmModal } from './TypedConfirmModal';

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`;

const NO_TEMPLATES: TemplateAffordances = { manageItemTemplates: false, useProjectTemplates: false, manageProjectTemplates: false };
const NO_GOALS: GoalAffordances = { view: false, manage: false, setHealth: false, linkProject: false, setItemGoal: false };

export function ProjectsSettings({
    affordances,
    templates = NO_TEMPLATES,
    goals = NO_GOALS,
    rates = false,
}: {
    affordances: WorkConfigAffordances;
    templates?: TemplateAffordances;
    /** A project's initiative (3.2a): shown with `view`, changed with `linkProject`, asked on the server. */
    goals?: GoalAffordances;
    /** A project's billable default and rates (3.4d, `time.rates`), asked on the server. */
    rates?: boolean;
}) {
    const t = useTranslations('settings');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const { data, error, isLoading } = useProjects();
    const { data: teams } = useTeams();
    const { send, revalidate } = useSettingsApi();
    const [creating, setCreating] = useState(false);
    const [renaming, setRenaming] = useState<SettingsProject | null>(null);
    const [datingDue, setDatingDue] = useState<SettingsProject | null>(null);
    const [dueDate, setDueDate] = useState<string | null>(null);
    const [archiving, setArchiving] = useState<SettingsProject | null>(null);
    const [fieldsOf, setFieldsOf] = useState<SettingsProject | null>(null);
    const [timeOf, setTimeOf] = useState<SettingsProject | null>(null);
    const [name, setName] = useState('');
    const [savingAsTemplate, setSavingAsTemplate] = useState<SettingsProject | null>(null);
    const [templateName, setTemplateName] = useState('');
    const [includeItems, setIncludeItems] = useState(false);
    const teamName = useMemo(() => new Map((teams ?? []).map((x) => [x.id, x.name])), [teams]);
    const { data: initiativeList } = useInitiatives(goals.view);
    const initiativeName = useMemo(() => new Map((initiativeList?.initiatives ?? []).map((x) => [x.id, x.name])), [initiativeList]);
    const [linking, setLinking] = useState<SettingsProject | null>(null);
    const [initiativeId, setInitiativeId] = useState('');

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
        const showActions = affordances.editProject || affordances.archiveProject || affordances.manageCustomFields || templates.manageProjectTemplates || goals.linkProject || rates;
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
            { id: 'dueDate', header: t('projects.col.dueDate'), cell: ({ row }) => <span className="tabular-nums">{row.original.dueDate ?? ''}</span> },
            ...(goals.view
                ? [
                      {
                          // The initiative the project serves (3.2a); a deleted or archived one is not listed by name.
                          id: 'initiative',
                          header: t('projects.col.initiative'),
                          cell: ({ row }: { row: { original: SettingsProject } }) =>
                              row.original.initiativeId ? (initiativeName.get(row.original.initiativeId) ?? t('projects.initiativeUnavailable')) : '',
                      },
                  ]
                : []),
            {
                // A project's recipient lists (2.7e): its own page, read by every member.
                id: 'recipientLists',
                header: t('projects.col.recipientLists'),
                cell: ({ row }) => (
                    <Link
                        href={tenantHref(projectRecipientListsHref(row.original.keyPrefix))}
                        className="text-sm text-content-emphasis underline"
                        aria-label={t('projects.recipientListsOf', { name: row.original.name })}
                    >
                        {t('projects.recipientLists')}
                    </Link>
                ),
            },
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
                                                  setRenaming(project);
                                              }}
                                          />
                                      )}
                                      {affordances.editProject && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('projects.editDueDate')}
                                              aria-label={t('projects.editDueDateNamed', { name: project.name })}
                                              onClick={() => {
                                                  setDueDate(project.dueDate ?? null);
                                                  setDatingDue(project);
                                              }}
                                          />
                                      )}
                                      {goals.linkProject && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('projects.changeInitiative')}
                                              aria-label={t('projects.changeInitiativeNamed', { name: project.name })}
                                              onClick={() => {
                                                  setInitiativeId(project.initiativeId ?? '');
                                                  setLinking(project);
                                              }}
                                          />
                                      )}
                                      {affordances.manageCustomFields && !project.archivedAt && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('projects.fields')}
                                              aria-label={t('projects.fieldsOf', { name: project.name })}
                                              onClick={() => setFieldsOf(project)}
                                          />
                                      )}
                                      {rates && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('projects.time')}
                                              aria-label={t('projects.timeOf', { name: project.name })}
                                              onClick={() => setTimeOf(project)}
                                          />
                                      )}
                                      {templates.manageProjectTemplates && (
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('projects.saveAsTemplate')}
                                              aria-label={t('projects.saveAsTemplateNamed', { name: project.name })}
                                              onClick={() => {
                                                  setTemplateName(project.name);
                                                  setIncludeItems(false);
                                                  setSavingAsTemplate(project);
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
    }, [t, tenantHref, teamName, initiativeName, affordances, templates, goals, rates, send, revalidate, toast]);

    const saveInitiative = async (): Promise<string | null> => {
        const project = linking;
        if (!project) return null;
        try {
            await send('PUT', `${projectPath(project.id)}/initiative`, { initiativeId: initiativeId || null });
            await revalidate(SETTINGS_PATHS.projects);
            toast.success(t('projects.initiativeSaved', { name: project.name }));
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };
    const initiativeOptions: ComboboxOption[] = [
        { value: '', label: t('projects.noInitiative') },
        ...(initiativeList?.initiatives ?? []).map((x) => ({ value: x.id, label: x.name })),
    ];

    const saveAsTemplate = async (): Promise<string | null> => {
        const project = savingAsTemplate;
        if (!project) return null;
        const value = templateName.trim();
        if (!value) return t('common.nameRequired');
        try {
            await send('POST', SETTINGS_PATHS.projectTemplates, { fromProjectId: project.id, name: value, includeItems });
            await revalidate(SETTINGS_PATHS.projectTemplates, SETTINGS_PATHS.projectTemplatesAll);
            toast.success(t('projects.savedAsTemplate', { name: value }));
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    const rename = async (): Promise<string | null> => {
        const project = renaming;
        if (!project) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            await send('PATCH', projectPath(project.id), { name: value });
            await revalidate(SETTINGS_PATHS.projects);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    const saveDueDate = async (): Promise<string | null> => {
        const project = datingDue;
        if (!project) return null;
        try {
            await send('PATCH', projectPath(project.id), { dueDate });
            await revalidate(SETTINGS_PATHS.projects);
            toast.success(t('projects.dueDateSaved', { name: project.name }));
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
                        onClick={() => setCreating(true)}
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
            <ProjectCreateDialog
                open={creating}
                onOpenChange={setCreating}
                offerInitiative={goals.view}
                onCreated={async () => {
                    await revalidate(SETTINGS_PATHS.projects);
                }}
            />
            <SettingsFormModal
                open={renaming !== null}
                onOpenChange={(v) => !v && setRenaming(null)}
                title={t('projects.renameTitle')}
                submitLabel={t('common.save')}
                onSubmit={rename}
            >
                <FormField label={t('common.name')} required>
                    <Input id="project-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
            </SettingsFormModal>
            <SettingsFormModal
                open={linking !== null}
                onOpenChange={(v) => !v && setLinking(null)}
                title={t('projects.changeInitiativeTitle', { name: linking?.name ?? '' })}
                submitLabel={t('common.save')}
                onSubmit={saveInitiative}
            >
                <FormField label={t('projects.initiative')} description={t('projects.initiativeHint')}>
                    <Combobox
                        id="project-change-initiative-input"
                        selected={initiativeOptions.find((o) => o.value === initiativeId) ?? null}
                        setSelected={(o) => o && setInitiativeId(o.value)}
                        options={initiativeOptions}
                        caret
                    />
                </FormField>
            </SettingsFormModal>
            <SettingsFormModal
                open={datingDue !== null}
                onOpenChange={(v) => !v && setDatingDue(null)}
                title={t('projects.editDueDateTitle', { name: datingDue?.name ?? '' })}
                submitLabel={t('common.save')}
                onSubmit={saveDueDate}
            >
                <FormField label={t('projects.dueDate')} description={t('projects.dueDateHint')}>
                    <DatePicker id="project-due-date-input" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
                </FormField>
            </SettingsFormModal>
            {timeOf && <ProjectTimeDialog project={timeOf} open onOpenChange={(open) => !open && setTimeOf(null)} />}
            {fieldsOf && (
                <CustomFieldsManager
                    projectId={fieldsOf.id}
                    projectName={fieldsOf.name}
                    open
                    onOpenChange={(open) => !open && setFieldsOf(null)}
                />
            )}
            <SettingsFormModal
                open={savingAsTemplate !== null}
                onOpenChange={(v) => !v && setSavingAsTemplate(null)}
                title={t('projects.saveAsTemplateTitle', { name: savingAsTemplate?.name ?? '' })}
                description={t('projects.saveAsTemplateBody')}
                submitLabel={t('projects.saveAsTemplateSubmit')}
                onSubmit={saveAsTemplate}
            >
                <FormField label={t('projectTemplates.name')} required>
                    <Input id="template-name-input" value={templateName} onChange={(e) => setTemplateName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
                <FormField label={t('projects.includeItems')} description={t('projects.includeItemsHint')}>
                    <Switch id="template-include-items" checked={includeItems} onCheckedChange={setIncludeItems} aria-label={t('projects.includeItems')} />
                </FormField>
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
