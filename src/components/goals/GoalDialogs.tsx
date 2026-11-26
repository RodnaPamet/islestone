'use client';

/**
 * A goal's and an initiative's form (sub-phase 3.2b): create one, or change
 * its title or name, description, status, due date, lead and parent goal (an
 * initiative's goal). The server checks the tree (three levels, no cycle,
 * an archived or deleted target refused) and shows its refusal here. A
 * change of title, name or description names the version it was read at
 * (`If-Match`). Opened only where the server offered `manage`.
 *
 * Written fresh for Islestone; built on the Settings form modal so every
 * small form reads alike.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { GoalData, GoalStatusValue, InitiativeData, ViewGoal } from '@/lib/goals/types';
import { GOAL_DESCRIPTION_MAX, GOAL_TITLE_MAX, INITIATIVE_NAME_MAX } from '@/lib/goals/limits';

import { STATUS_OPTIONS } from './goal-parts';
import { goalRefusal, useGoalWrites } from './use-goals';

function useCommonOptions() {
    const tOptions = useTranslations('roadmap');
    const { members } = useMembers();
    const statusOptions: ComboboxOption[] = STATUS_OPTIONS.map((s) => ({ value: s, label: tOptions(`status.${s}`) }));
    const leadOptions: ComboboxOption[] = [{ value: '', label: tOptions('form.noLead') }, ...members.map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id }))];
    return { statusOptions, leadOptions };
}

/** Goals as a parent picker names them, nested by their parents ("Parent › Child"). */
function goalOptions(goals: readonly ViewGoal[], none: string, exclude?: string): ComboboxOption[] {
    const byId = new Map(goals.map((g) => [g.id, g]));
    const pathOf = (g: ViewGoal): string => {
        const parts = [g.title];
        let cur = g.parentId ? byId.get(g.parentId) : undefined;
        for (let i = 0; cur && i < 3; i++) {
            parts.unshift(cur.title);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return parts.join(' › ');
    };
    return [{ value: '', label: none }, ...goals.filter((g) => g.id !== exclude).map((g) => ({ value: g.id, label: pathOf(g) }))];
}

export function GoalDialog({
    open,
    onOpenChange,
    goal,
    goals,
    presetParentId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The goal to edit; a new goal without it. */
    goal?: GoalData;
    /** The live, unarchived goals a parent may be (the server's). */
    goals: readonly ViewGoal[];
    presetParentId?: string;
}) {
    const tGoalForm = useTranslations('roadmap');
    const tGoals = useTranslations('goals');
    const toast = useToast();
    const writes = useGoalWrites();
    const { statusOptions, leadOptions } = useCommonOptions();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<GoalStatusValue>('PLANNED');
    const [dueDate, setDueDate] = useState<string | null>(null);
    const [leadUserId, setLeadUserId] = useState('');
    const [parentId, setParentId] = useState('');

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setTitle(goal?.title ?? '');
            setDescription(goal?.description ?? '');
            setStatus(goal?.status ?? 'PLANNED');
            setDueDate(goal?.dueDate ?? null);
            setLeadUserId(goal?.leadUserId ?? '');
            setParentId(goal?.parentId ?? presetParentId ?? '');
        }
    }

    const parents = goalOptions(goals, tGoalForm('form.noParent'), goal?.id);
    const submit = async (): Promise<string | null> => {
        if (!title.trim()) return tGoalForm('form.titleRequired');
        const input = { title: title.trim(), description: description.trim() || null, status, dueDate, leadUserId: leadUserId || null, parentId: parentId || null };
        try {
            if (goal) {
                // The parent is sent only when the person changed it: an archived parent is not offered, and must not be read as "none".
                const { parentId: nextParent, ...rest } = input;
                await writes.updateGoal(goal.id, goal.version, nextParent === goal.parentId ? rest : input);
                toast.success(tGoals('form.saved'));
            } else {
                await writes.createGoal(input);
                toast.success(tGoals('form.created'));
            }
            return null;
        } catch (err) {
            return goalRefusal(err, tGoalForm('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={goal ? tGoals('form.editTitle') : tGoals('form.createTitle')}
            submitLabel={goal ? tGoalForm('form.save') : tGoals('form.create')}
            onSubmit={submit}
        >
            <FormField label={tGoalForm('form.title')} required>
                <Input id="goal-title-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={GOAL_TITLE_MAX} autoFocus />
            </FormField>
            <FormField label={tGoalForm('form.description')}>
                <Textarea id="goal-description-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={GOAL_DESCRIPTION_MAX} rows={4} />
            </FormField>
            <FormField label={tGoalForm('form.status')}>
                <Combobox
                    id="goal-status-input"
                    selected={statusOptions.find((o) => o.value === status) ?? null}
                    setSelected={(o) => o && setStatus(o.value as GoalStatusValue)}
                    options={statusOptions}
                    caret
                    hideSearch
                />
            </FormField>
            <FormField label={tGoalForm('form.parent')}>
                <Combobox id="goal-parent-input" selected={parents.find((o) => o.value === parentId) ?? null} setSelected={(o) => o && setParentId(o.value)} options={parents} caret />
            </FormField>
            <FormField label={tGoalForm('form.dueDate')} description={tGoalForm('form.dueDateHint')}>
                <DatePicker id="goal-due-date-input" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
            </FormField>
            <FormField label={tGoalForm('form.lead')} description={tGoalForm('form.leadHint')}>
                <Combobox id="goal-lead-input" selected={leadOptions.find((o) => o.value === leadUserId) ?? null} setSelected={(o) => o && setLeadUserId(o.value)} options={leadOptions} caret />
            </FormField>
        </SettingsFormModal>
    );
}

export function InitiativeDialog({
    open,
    onOpenChange,
    initiative,
    goals,
    presetGoalId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initiative?: InitiativeData;
    goals: readonly ViewGoal[];
    presetGoalId?: string;
}) {
    const tIniForm = useTranslations('roadmap');
    const tInitiatives = useTranslations('initiatives');
    const toast = useToast();
    const writes = useGoalWrites();
    const { statusOptions, leadOptions } = useCommonOptions();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<GoalStatusValue>('PLANNED');
    const [dueDate, setDueDate] = useState<string | null>(null);
    const [leadUserId, setLeadUserId] = useState('');
    const [goalId, setGoalId] = useState('');

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName(initiative?.name ?? '');
            setDescription(initiative?.description ?? '');
            setStatus(initiative?.status ?? 'PLANNED');
            setDueDate(initiative?.dueDate ?? null);
            setLeadUserId(initiative?.leadUserId ?? '');
            setGoalId(initiative?.goalId ?? presetGoalId ?? '');
        }
    }

    const goalChoices = goalOptions(goals, tIniForm('form.noGoal'));
    const submit = async (): Promise<string | null> => {
        if (!name.trim()) return tIniForm('form.nameRequired');
        const input = { name: name.trim(), description: description.trim() || null, status, dueDate, leadUserId: leadUserId || null, goalId: goalId || null };
        try {
            if (initiative) {
                // The goal is sent only when the person changed it (an archived goal is not offered).
                const { goalId: nextGoal, ...rest } = input;
                await writes.updateInitiative(initiative.id, initiative.version, nextGoal === initiative.goalId ? rest : input);
                toast.success(tInitiatives('form.saved'));
            } else {
                await writes.createInitiative(input);
                toast.success(tInitiatives('form.created'));
            }
            return null;
        } catch (err) {
            return goalRefusal(err, tIniForm('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={initiative ? tInitiatives('form.editTitle') : tInitiatives('form.createTitle')}
            submitLabel={initiative ? tIniForm('form.save') : tInitiatives('form.create')}
            onSubmit={submit}
        >
            <FormField label={tIniForm('form.name')} required>
                <Input id="initiative-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={INITIATIVE_NAME_MAX} autoFocus />
            </FormField>
            <FormField label={tIniForm('form.description')}>
                <Textarea id="initiative-description-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={GOAL_DESCRIPTION_MAX} rows={4} />
            </FormField>
            <FormField label={tIniForm('form.goal')}>
                <Combobox id="initiative-goal-input" selected={goalChoices.find((o) => o.value === goalId) ?? null} setSelected={(o) => o && setGoalId(o.value)} options={goalChoices} caret />
            </FormField>
            <FormField label={tIniForm('form.status')}>
                <Combobox
                    id="initiative-status-input"
                    selected={statusOptions.find((o) => o.value === status) ?? null}
                    setSelected={(o) => o && setStatus(o.value as GoalStatusValue)}
                    options={statusOptions}
                    caret
                    hideSearch
                />
            </FormField>
            <FormField label={tIniForm('form.dueDate')} description={tIniForm('form.dueDateHint')}>
                <DatePicker id="initiative-due-date-input" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
            </FormField>
            <FormField label={tIniForm('form.lead')} description={tIniForm('form.leadHint')}>
                <Combobox id="initiative-lead-input" selected={leadOptions.find((o) => o.value === leadUserId) ?? null} setSelected={(o) => o && setLeadUserId(o.value)} options={leadOptions} caret />
            </FormField>
        </SettingsFormModal>
    );
}
