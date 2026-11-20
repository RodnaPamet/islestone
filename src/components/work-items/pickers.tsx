'use client';

/**
 * The work-item pickers, each a `Combobox` over a small set the server page
 * read (states, types, labels) or the member roster (`/users/assignable`).
 * Written fresh for Islestone (sub-phase 2.3); the assignee picker replaces
 * inflect-compliance's `UserCombobox` for this surface (the roster read and
 * the "name · email" label follow its contract at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, pattern only).
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { PRIORITY_ORDER } from '@/lib/work-items/presentation';
import type { WorkItemPriority } from '@/lib/work-items/types';

import { memberLabel, useMembers, useWorkConfig } from './data/use-work-config';

interface PickerCommon {
    id?: string;
    /** The accessible name of the trigger when no `<label>` points at it. */
    label?: string;
    disabled?: boolean;
}

export function StatePicker({
    teamId,
    value,
    current,
    onChange,
    ...common
}: PickerCommon & {
    teamId: string;
    value: string;
    /** The item's current state, offered even when it is archived. */
    current?: { id: string; name: string };
    onChange: (stateId: string) => void;
}) {
    const config = useWorkConfig();
    const options = useMemo<ComboboxOption[]>(() => {
        const live = config.statesOfTeam(teamId).map((s) => ({ value: s.id, label: s.name }));
        if (current && !live.some((o) => o.value === current.id)) live.unshift({ value: current.id, label: current.name });
        return live;
    }, [config, teamId, current]);
    const selected = options.find((o) => o.value === value) ?? null;
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            selected={selected}
            setSelected={(o) => o && o.value !== value && onChange(o.value)}
            options={options}
            caret
            matchTriggerWidth
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}

export function AssigneePicker({ value, onChange, ...common }: PickerCommon & { value: string | null; onChange: (userId: string | null) => void }) {
    const tAssignee = useTranslations('workItems');
    const { members, isLoading } = useMembers();
    const options = useMemo<ComboboxOption[]>(
        () => [
            { value: '', label: tAssignee('detail.unassigned') },
            ...members.map((m) => ({ value: m.id, label: memberLabel(m) ?? tAssignee('detail.unknownMember') })),
        ],
        [members, tAssignee],
    );
    const selected = options.find((o) => o.value === (value ?? '')) ?? null;
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            selected={selected}
            setSelected={(o) => o && (o.value || null) !== value && onChange(o.value || null)}
            options={isLoading ? undefined : options}
            caret
            searchPlaceholder={tAssignee('detail.searchMembers')}
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}

export function PriorityPicker({ value, onChange, ...common }: PickerCommon & { value: WorkItemPriority; onChange: (p: WorkItemPriority) => void }) {
    const tPriority = useTranslations('workItems');
    const options = useMemo<ComboboxOption[]>(() => PRIORITY_ORDER.map((p) => ({ value: p, label: tPriority(`priority.${p}`) })), [tPriority]);
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            selected={options.find((o) => o.value === value) ?? null}
            setSelected={(o) => o && o.value !== value && onChange(o.value as WorkItemPriority)}
            options={options}
            caret
            hideSearch
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}

export function TypePicker({ value, onChange, ...common }: PickerCommon & { value: string; onChange: (typeId: string) => void }) {
    const config = useWorkConfig();
    const options = useMemo<ComboboxOption[]>(() => config.types.map((ty) => ({ value: ty.id, label: ty.name })), [config]);
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            selected={options.find((o) => o.value === value) ?? null}
            setSelected={(o) => o && o.value !== value && onChange(o.value)}
            options={options}
            caret
            hideSearch
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}

/**
 * The item's cycle (2.5a): the team's cycles that take items, oldest first,
 * and "No cycle". The current one stays offered when it has completed, so
 * the picker can show it.
 */
export function CyclePicker({
    teamId,
    value,
    onChange,
    ...common
}: PickerCommon & { teamId: string; value: string | null; onChange: (cycleId: string | null) => void }) {
    const tCycle = useTranslations('workItems');
    const config = useWorkConfig();
    const options = useMemo<ComboboxOption[]>(() => {
        const name = (c: { name: string | null; number: number }) => c.name?.trim() || tCycle('cycle.numbered', { number: c.number });
        const open = config.openCyclesOfTeam(teamId).map((c) => ({ value: c.id, label: c.status === 'current' ? tCycle('cycle.currentLabel', { name: name(c) }) : name(c) }));
        const held = value ? config.cycleById.get(value) : undefined;
        if (held && !open.some((o) => o.value === held.id)) open.unshift({ value: held.id, label: name(held) });
        return [{ value: '', label: tCycle('cycle.none') }, ...open];
    }, [config, teamId, value, tCycle]);
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            selected={options.find((o) => o.value === (value ?? '')) ?? null}
            setSelected={(o) => o && (o.value || null) !== value && onChange(o.value || null)}
            options={options}
            caret
            hideSearch
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}

/** Labels usable on an item of `teamId`: workspace labels and the team's. */
export function LabelsPicker({
    teamId,
    value,
    onChange,
    ...common
}: PickerCommon & { teamId: string | null; value: string[]; onChange: (next: string[]) => void }) {
    const tLabels = useTranslations('workItems');
    const config = useWorkConfig();
    const options = useMemo<ComboboxOption[]>(
        () => config.labels.filter((l) => l.teamId === null || l.teamId === teamId).map((l) => ({ value: l.id, label: l.name })),
        [config, teamId],
    );
    const selected = options.filter((o) => value.includes(o.value));
    return (
        <Combobox
            id={common.id}
            disabled={common.disabled}
            multiple
            selected={selected}
            setSelected={(opts) => onChange(opts.map((o) => o.value))}
            options={options}
            caret
            placeholder={tLabels('detail.noLabels')}
            buttonProps={common.label ? { 'aria-label': common.label } : undefined}
        />
    );
}
