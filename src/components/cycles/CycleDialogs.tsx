'use client';

/**
 * The cycle pages' dialogs (sub-phase 2.5a): a one-off cycle's form (create,
 * rename, move its dates) and a team's cycle schedule (owner decisions 63
 * and 64). Both post to the cycle routes through `useCycleWrites`; the
 * server's refusal (an overlap, a date rule) is shown in the dialog. Opened
 * only where the server offered `manageCycles`.
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
import { Switch } from '@/components/ui/switch';
import { CYCLE_LENGTH_WEEKS, CYCLE_UPCOMING_COUNT } from '@/app-layer/domain/cycle';
import type { CycleData, CycleScheduleData } from '@/lib/work-items/types';

import { cycleRefusal, useCycleSchedule, useCycleWrites } from './use-cycles';

function range(min: number, max: number): number[] {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Create a one-off cycle for `teamId`, or change `cycle`. */
export function CycleFormDialog({
    open,
    onOpenChange,
    teamId,
    cycle,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    teamId: string;
    cycle?: CycleData;
}) {
    const tForm = useTranslations('cycles');
    const toast = useToast();
    const writes = useCycleWrites();
    const [name, setName] = useState('');
    const [startsOn, setStartsOn] = useState<string | null>(null);
    const [endsOn, setEndsOn] = useState<string | null>(null);

    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setName(cycle?.name ?? '');
            setStartsOn(cycle?.startsOn ?? null);
            setEndsOn(cycle?.endsOn ?? null);
        }
    }
    // A started cycle keeps its start; a completed one is never opened here.
    const startLocked = cycle !== undefined && cycle.status !== 'upcoming';

    const submit = async (): Promise<string | null> => {
        if (!startsOn || !endsOn) return tForm('form.datesRequired');
        try {
            if (cycle) {
                await writes.update(cycle.id, {
                    name: name.trim() || null,
                    ...(startLocked ? {} : { startsOn }),
                    endsOn,
                });
                toast.success(tForm('form.saved'));
            } else {
                await writes.create(teamId, { name: name.trim() || null, startsOn, endsOn });
                toast.success(tForm('form.created'));
            }
            return null;
        } catch (err) {
            return cycleRefusal(err, tForm('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={cycle ? tForm('form.editTitle') : tForm('form.createTitle')}
            submitLabel={cycle ? tForm('form.save') : tForm('form.create')}
            onSubmit={submit}
        >
            <FormField label={tForm('form.name')} description={tForm('form.nameHint')}>
                <Input id="cycle-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </FormField>
            <FormField label={tForm('form.startsOn')} required>
                <DatePicker id="cycle-starts-input" value={parseYMD(startsOn)} onChange={(d) => setStartsOn(toYMD(d))} disabled={startLocked} />
            </FormField>
            <FormField label={tForm('form.endsOn')} required>
                <DatePicker id="cycle-ends-input" value={parseYMD(endsOn)} onChange={(d) => setEndsOn(toYMD(d))} />
            </FormField>
        </SettingsFormModal>
    );
}

/** A team's cycle schedule. */
export function CycleScheduleDialog({
    open,
    onOpenChange,
    teamId,
    teamName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    teamId: string;
    teamName: string;
}) {
    const tSchedule = useTranslations('cycles');
    const toast = useToast();
    const writes = useCycleWrites();
    const { data } = useCycleSchedule(open ? teamId : null);
    const [form, setForm] = useState<Omit<CycleScheduleData, 'teamId' | 'saved'> | null>(null);

    const [loadedFor, setLoadedFor] = useState<CycleScheduleData | undefined>(undefined);
    if (open && data && data !== loadedFor) {
        setLoadedFor(data);
        setForm({
            enabled: data.saved ? data.enabled : true,
            lengthWeeks: data.lengthWeeks,
            firstStartsOn: data.firstStartsOn,
            upcomingCount: data.upcomingCount,
            rollover: data.rollover,
        });
    }
    if (!open && loadedFor) {
        setLoadedFor(undefined);
        setForm(null);
    }

    const lengths: ComboboxOption[] = range(CYCLE_LENGTH_WEEKS.min, CYCLE_LENGTH_WEEKS.max).map((n) => ({ value: String(n), label: tSchedule('schedule.weeks', { count: n }) }));
    const upcoming: ComboboxOption[] = range(CYCLE_UPCOMING_COUNT.min, CYCLE_UPCOMING_COUNT.max).map((n) => ({ value: String(n), label: String(n) }));
    const rollovers: ComboboxOption[] = [
        { value: 'NEXT_CYCLE', label: tSchedule('schedule.rolloverNext') },
        { value: 'NO_CYCLE', label: tSchedule('schedule.rolloverNone') },
    ];

    const submit = async (): Promise<string | null> => {
        if (!form) return tSchedule('failed');
        try {
            await writes.saveSchedule(teamId, form);
            toast.success(tSchedule('schedule.saved'));
            return null;
        } catch (err) {
            return cycleRefusal(err, tSchedule('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tSchedule('schedule.title', { team: teamName })}
            description={tSchedule('schedule.description')}
            submitLabel={tSchedule('schedule.save')}
            submitDisabled={!form}
            onSubmit={submit}
        >
            {form && (
                <>
                    <FormField label={tSchedule('schedule.enabled')} description={tSchedule('schedule.enabledHint')}>
                        <Switch
                            id="cycle-schedule-enabled"
                            checked={form.enabled}
                            onCheckedChange={(enabled) => setForm({ ...form, enabled })}
                            aria-label={tSchedule('schedule.enabled')}
                        />
                    </FormField>
                    <FormField label={tSchedule('schedule.length')}>
                        <Combobox
                            id="cycle-schedule-length"
                            selected={lengths.find((o) => o.value === String(form.lengthWeeks)) ?? null}
                            setSelected={(o) => o && setForm({ ...form, lengthWeeks: Number(o.value) })}
                            options={lengths}
                            caret
                            hideSearch
                        />
                    </FormField>
                    <FormField label={tSchedule('schedule.firstStartsOn')} description={tSchedule('schedule.firstStartsOnHint')}>
                        <DatePicker
                            id="cycle-schedule-first"
                            value={parseYMD(form.firstStartsOn)}
                            onChange={(d) => setForm({ ...form, firstStartsOn: toYMD(d) ?? form.firstStartsOn })}
                        />
                    </FormField>
                    <FormField label={tSchedule('schedule.upcoming')} description={tSchedule('schedule.upcomingHint')}>
                        <Combobox
                            id="cycle-schedule-upcoming"
                            selected={upcoming.find((o) => o.value === String(form.upcomingCount)) ?? null}
                            setSelected={(o) => o && setForm({ ...form, upcomingCount: Number(o.value) })}
                            options={upcoming}
                            caret
                            hideSearch
                        />
                    </FormField>
                    <FormField label={tSchedule('schedule.rollover')} description={tSchedule('schedule.rolloverHint')}>
                        <Combobox
                            id="cycle-schedule-rollover"
                            selected={rollovers.find((o) => o.value === form.rollover) ?? null}
                            setSelected={(o) => o && setForm({ ...form, rollover: o.value as CycleScheduleData['rollover'] })}
                            options={rollovers}
                            caret
                            hideSearch
                        />
                    </FormField>
                </>
            )}
        </SettingsFormModal>
    );
}
