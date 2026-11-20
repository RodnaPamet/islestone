'use client';

/**
 * Settings → a team's workflow (decision 55). The states are listed by
 * category in workflow order, and within a category in the team's order.
 * A state is created with a category that never changes afterwards (the
 * trigger `workflow_state_category_immutable`), renamed, moved up or down
 * within its category, made the default, archived or unarchived, and deleted
 * with the undo toast, its work items moving to a state the person chooses.
 * The server keeps one default and a live DONE and CANCELLED state; its
 * refusals are shown as it words them.
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
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import type { WorkConfigAffordances, WorkflowStateCategory } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, type SettingsState, type SettingsTeamDetail, useSettingsApi, useTeam } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { useUndoDelete } from './use-undo-delete';

/** The states by category (workflow order), each category in the team's order. */
export function orderStates(states: readonly SettingsState[]): SettingsState[] {
    const rank = new Map<string, number>(WORKFLOW_STATE_CATEGORIES.map((c, i) => [c, i]));
    return states
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (rank.get(a.s.category) ?? 0) - (rank.get(b.s.category) ?? 0) || (a.s.sortKey < b.s.sortKey ? -1 : a.s.sortKey > b.s.sortKey ? 1 : a.i - b.i))
        .map((x) => x.s);
}

/** Where "move up" or "move down" places a state: beside its neighbour in the same category. */
export function neighbourPosition(ordered: readonly SettingsState[], state: SettingsState, direction: 'up' | 'down') {
    const same = ordered.filter((s) => s.category === state.category);
    const i = same.findIndex((s) => s.id === state.id);
    if (direction === 'up') return i > 0 ? { beforeId: same[i - 1]!.id } : null;
    return i >= 0 && i < same.length - 1 ? { afterId: same[i + 1]!.id } : null;
}

type Editing = { mode: 'create' } | { mode: 'rename'; state: SettingsState } | null;

export function WorkflowStatesSettings({ teamId, affordances }: { teamId: string; affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const tCategory = useTranslations('workItems.category');
    const toast = useToast();
    const path = SETTINGS_PATHS.team(teamId);
    const { data: team, error, isLoading } = useTeam(teamId);
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const canManage = affordances.manageWorkConfig;

    const [editing, setEditing] = useState<Editing>(null);
    const [name, setName] = useState('');
    const [category, setCategory] = useState<WorkflowStateCategory>('UNSTARTED');
    const [deleting, setDeleting] = useState<SettingsState | null>(null);
    const [moveTo, setMoveTo] = useState('');

    const ordered = useMemo(() => orderStates(team?.workflowStates ?? []), [team]);
    const categoryLabel = (c: WorkflowStateCategory) => tCategory(c);
    const categoryOptions: ComboboxOption[] = WORKFLOW_STATE_CATEGORIES.map((c) => ({ value: c, label: tCategory(c) }));

    /** A PATCH to one state; the server's refusal is shown as a toast. */
    const patch = async (state: SettingsState, body: Record<string, unknown>) => {
        try {
            await send('PATCH', `${path}/workflow-states/${encodeURIComponent(state.id)}`, body);
            await revalidate(path);
        } catch (err) {
            toast.error(refusalText(err, t('common.failed')));
        }
    };

    const openDelete = (state: SettingsState) => {
        const live = ordered.filter((s) => s.id !== state.id && !s.archivedAt);
        const target = live.find((s) => s.category === state.category) ?? live.find((s) => s.isDefault) ?? live[0];
        setMoveTo(target?.id ?? '');
        setDeleting(state);
    };

    const confirmDelete = async (): Promise<string | null> => {
        const state = deleting;
        if (!state) return null;
        const query = moveTo ? `?moveToStateId=${encodeURIComponent(moveTo)}` : '';
        undoDelete<SettingsTeamDetail>({
            path,
            without: (current) => current && { ...current, workflowStates: current.workflowStates.filter((s) => s.id !== state.id) },
            deletePath: `${path}/workflow-states/${encodeURIComponent(state.id)}${query}`,
            message: t('states.deleted', { name: state.name }),
        });
        return null;
    };

    const columns = useMemo(
        () =>
            createColumns<SettingsState>([
                {
                    id: 'name',
                    header: t('states.col.name'),
                    cell: ({ row }) => (
                        <span className="flex items-center gap-tight">
                            <span className="text-content-emphasis">{row.original.name}</span>
                            {row.original.isDefault && <span className="text-xs text-content-muted">({t('states.default')})</span>}
                        </span>
                    ),
                },
                { id: 'category', header: t('states.col.category'), cell: ({ row }) => categoryLabel(row.original.category) },
                {
                    id: 'status',
                    header: t('states.col.status'),
                    cell: ({ row }) => (row.original.archivedAt ? t('common.archived') : t('common.active')),
                },
                ...(canManage
                    ? [
                          {
                              id: 'actions',
                              header: t('common.actions'),
                              cell: ({ row }: { row: { original: SettingsState } }) => {
                                  const s = row.original;
                                  const up = neighbourPosition(ordered, s, 'up');
                                  const down = neighbourPosition(ordered, s, 'down');
                                  return (
                                      <div className="flex flex-wrap gap-tight">
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('states.moveUp')}
                                              aria-label={t('states.moveUpNamed', { name: s.name })}
                                              disabled={!up}
                                              onClick={() => up && void patch(s, { position: up })}
                                          />
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('states.moveDown')}
                                              aria-label={t('states.moveDownNamed', { name: s.name })}
                                              disabled={!down}
                                              onClick={() => down && void patch(s, { position: down })}
                                          />
                                          <Button
                                              variant="ghost"
                                              size="sm"
                                              text={t('common.rename')}
                                              aria-label={t('common.renameNamed', { name: s.name })}
                                              onClick={() => {
                                                  setName(s.name);
                                                  setEditing({ mode: 'rename', state: s });
                                              }}
                                          />
                                          {!s.isDefault && !s.archivedAt && (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  text={t('states.makeDefault')}
                                                  aria-label={t('states.makeDefaultNamed', { name: s.name })}
                                                  onClick={() => void patch(s, { isDefault: true })}
                                              />
                                          )}
                                          {!s.isDefault && (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  text={s.archivedAt ? t('common.unarchive') : t('common.archive')}
                                                  aria-label={
                                                      s.archivedAt ? t('common.unarchiveNamed', { name: s.name }) : t('common.archiveNamed', { name: s.name })
                                                  }
                                                  onClick={() => void patch(s, { archived: !s.archivedAt })}
                                              />
                                          )}
                                          {!s.isDefault && (
                                              <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  text={t('common.delete')}
                                                  aria-label={t('common.deleteNamed', { name: s.name })}
                                                  onClick={() => openDelete(s)}
                                              />
                                          )}
                                      </div>
                                  );
                              },
                          },
                      ]
                    : []),
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read the latest render's state
        [t, tCategory, canManage, ordered],
    );

    const submit = async (): Promise<string | null> => {
        if (!editing) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            if (editing.mode === 'create') {
                await send('POST', `${path}/workflow-states`, { name: value, category });
            } else {
                await send('PATCH', `${path}/workflow-states/${encodeURIComponent(editing.state.id)}`, { name: value });
            }
            await revalidate(path);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    const moveOptions: ComboboxOption[] = ordered
        .filter((s) => s.id !== deleting?.id && !s.archivedAt)
        .map((s) => ({ value: s.id, label: `${s.name} (${categoryLabel(s.category)})` }));

    const notFound = error && 'status' in error && error.status === 404;
    return (
        <EntityListPage<SettingsState>
            header={{
                title: team ? t('states.title', { team: team.name }) : t('teams.title'),
                description: notFound ? t('states.notFound') : t('states.description'),
                back: { smart: true },
                actions: canManage && team ? (
                    <Button
                        id="new-state-btn"
                        variant="primary"
                        icon={<Plus />}
                        text={t('states.create')}
                        onClick={() => {
                            setName('');
                            setCategory('UNSTARTED');
                            setEditing({ mode: 'create' });
                        }}
                    />
                ) : undefined,
            }}
            table={{
                data: ordered,
                columns,
                loading: isLoading,
                error: error && !notFound ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: notFound ? t('states.notFound') : t('states.empty'),
                resourceName: (plural: boolean) => (plural ? t('states.resourcePlural') : t('states.resource')),
                'data-testid': 'settings-states-table',
            }}
        >
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing?.mode === 'rename' ? t('states.renameTitle') : t('states.createTitle')}
                submitLabel={editing?.mode === 'rename' ? t('common.save') : t('states.createSubmit')}
                onSubmit={submit}
            >
                <FormField label={t('common.name')} required>
                    <Input id="state-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
                {editing?.mode === 'create' ? (
                    <FormField label={t('states.category')} description={t('states.categoryFixed')}>
                        <Combobox
                            id="state-category-input"
                            selected={categoryOptions.find((o) => o.value === category) ?? null}
                            setSelected={(o) => o && setCategory(o.value as WorkflowStateCategory)}
                            options={categoryOptions}
                            caret
                        />
                    </FormField>
                ) : editing?.mode === 'rename' ? (
                    <p className="text-sm text-content-muted">{t('states.categoryOf', { category: categoryLabel(editing.state.category) })}</p>
                ) : null}
            </SettingsFormModal>
            <SettingsFormModal
                open={deleting !== null}
                onOpenChange={(v) => !v && setDeleting(null)}
                title={t('states.deleteTitle', { name: deleting?.name ?? '' })}
                description={t('states.deleteBody', { name: deleting?.name ?? '' })}
                submitLabel={t('states.deleteConfirm')}
                onSubmit={confirmDelete}
            >
                <FormField label={t('states.moveItemsTo')}>
                    <Combobox
                        id="state-move-to-input"
                        selected={moveOptions.find((o) => o.value === moveTo) ?? null}
                        setSelected={(o) => o && setMoveTo(o.value)}
                        options={moveOptions}
                        caret
                    />
                </FormField>
            </SettingsFormModal>
        </EntityListPage>
    );
}
