'use client';

/**
 * Settings → Teams (decision 55): every team, each linking to its workflow;
 * create (the server seeds the workflow and, for a first team, the work item
 * types), edit (the name and, from 3.4a, how the team estimates: Points,
 * Hours or Off, decision 257; changing it moves no value), and delete with
 * the undo toast (the server refuses a team that still has projects, and the
 * row comes back with its reason).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { useToast } from '@/components/ui/hooks';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { refusalText, SETTINGS_PATHS, type SettingsTeam, useSettingsApi, useTeams } from './settings-data';
import { SettingsFormModal } from './SettingsFormModal';
import { useUndoDelete, withoutRow } from './use-undo-delete';

type Editing = { mode: 'create' } | { mode: 'rename'; team: SettingsTeam } | null;
type UnitChoice = 'OFF' | 'POINTS' | 'HOURS';
const UNIT_CHOICES: readonly UnitChoice[] = ['OFF', 'POINTS', 'HOURS'];

export function TeamsSettings({ affordances }: { affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const toast = useToast();
    const tenantHref = useTenantHref();
    const { data, error, isLoading } = useTeams();
    const { send, revalidate } = useSettingsApi();
    const undoDelete = useUndoDelete();
    const [editing, setEditing] = useState<Editing>(null);
    const [name, setName] = useState('');
    const [unit, setUnit] = useState<UnitChoice>('OFF');
    const canManage = affordances.manageWorkConfig;
    const unitLabel = (u: 'POINTS' | 'HOURS' | null | undefined) => t(`teams.estimateUnit.${u ?? 'OFF'}`);

    const open = (next: Exclude<Editing, null>) => {
        setName(next.mode === 'rename' ? next.team.name : '');
        setUnit(next.mode === 'rename' ? (next.team.estimateUnit ?? 'OFF') : 'OFF');
        setEditing(next);
    };

    const columns = useMemo(
        () =>
            createColumns<SettingsTeam>([
                {
                    id: 'name',
                    header: t('teams.col.name'),
                    cell: ({ row }) => (
                        <Link href={tenantHref(`/settings/teams/${row.original.id}`)} className="text-content-emphasis hover:underline">
                            {row.original.name}
                        </Link>
                    ),
                },
                {
                    id: 'estimates',
                    header: t('teams.col.estimates'),
                    cell: ({ row }) => <span className="text-sm text-content-muted">{unitLabel(row.original.estimateUnit)}</span>,
                },
                {
                    id: 'actions',
                    header: t('common.actions'),
                    cell: ({ row }) => (
                        <div className="flex flex-wrap gap-tight">
                            <Link
                                href={tenantHref(`/settings/teams/${row.original.id}`)}
                                aria-label={t('teams.editWorkflowNamed', { name: row.original.name })}
                                className="text-sm text-content-emphasis hover:underline"
                            >
                                {t('teams.editWorkflow')}
                            </Link>
                            {canManage && (
                                <>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        text={t('common.edit')}
                                        aria-label={t('teams.editNamed', { name: row.original.name })}
                                        onClick={() => open({ mode: 'rename', team: row.original })}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        text={t('common.delete')}
                                        aria-label={t('common.deleteNamed', { name: row.original.name })}
                                        onClick={() =>
                                            undoDelete<SettingsTeam[]>({
                                                path: SETTINGS_PATHS.teams,
                                                without: withoutRow(row.original.id),
                                                deletePath: SETTINGS_PATHS.team(row.original.id),
                                                message: t('teams.deleted', { name: row.original.name }),
                                            })
                                        }
                                    />
                                </>
                            )}
                        </div>
                    ),
                },
            ]),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- unitLabel reads only `t`
        [t, tenantHref, canManage, undoDelete],
    );

    const submit = async (): Promise<string | null> => {
        if (!editing) return null;
        const value = name.trim();
        if (!value) return t('common.nameRequired');
        try {
            if (editing.mode === 'create') {
                const created = await send<SettingsTeam>('POST', SETTINGS_PATHS.teams, { name: value });
                if (unit !== 'OFF') await send('PATCH', SETTINGS_PATHS.team(created.id), { estimateUnit: unit });
                toast.success(t('teams.created', { name: value }));
            } else {
                const nextUnit = unit === 'OFF' ? null : unit;
                await send('PATCH', SETTINGS_PATHS.team(editing.team.id), {
                    name: value,
                    ...(nextUnit !== (editing.team.estimateUnit ?? null) ? { estimateUnit: nextUnit } : {}),
                });
            }
            // A first team also seeds the work item types.
            await revalidate(SETTINGS_PATHS.teams, SETTINGS_PATHS.types);
            return null;
        } catch (err) {
            return refusalText(err, t('common.failed'));
        }
    };

    return (
        <EntityListPage<SettingsTeam>
            header={{
                title: t('teams.title'),
                description: t('teams.description'),
                back: { smart: true },
                actions: canManage ? (
                    <Button id="new-team-btn" variant="primary" icon={<Plus />} text={t('teams.create')} onClick={() => open({ mode: 'create' })} />
                ) : undefined,
            }}
            table={{
                data: data ?? [],
                columns,
                loading: isLoading,
                error: error ? t('common.loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: t('teams.empty'),
                resourceName: (plural: boolean) => (plural ? t('teams.resourcePlural') : t('teams.resource')),
                'data-testid': 'settings-teams-table',
            }}
        >
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing?.mode === 'rename' ? t('teams.editTitle') : t('teams.createTitle')}
                submitLabel={editing?.mode === 'rename' ? t('common.save') : t('teams.createSubmit')}
                onSubmit={submit}
            >
                <FormField label={t('common.name')} required>
                    <Input id="team-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
                </FormField>
                <fieldset className="space-y-tight">
                    <legend className="text-sm font-medium text-content-emphasis">{t('teams.estimateUnit.legend')}</legend>
                    <RadioGroup value={unit} onValueChange={(v) => setUnit(v as UnitChoice)} aria-describedby="team-estimate-unit-hint">
                        {UNIT_CHOICES.map((choice) => (
                            <label key={choice} className="flex items-center gap-tight text-sm" htmlFor={`team-estimate-unit-${choice}`}>
                                <RadioGroupItem id={`team-estimate-unit-${choice}`} value={choice} />
                                {t(`teams.estimateUnit.${choice}`)}
                            </label>
                        ))}
                    </RadioGroup>
                    <p id="team-estimate-unit-hint" className="text-xs text-content-muted">
                        {t('teams.estimateUnit.hint')}
                    </p>
                </fieldset>
            </SettingsFormModal>
        </EntityListPage>
    );
}
