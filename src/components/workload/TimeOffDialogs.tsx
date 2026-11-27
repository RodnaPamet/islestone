'use client';

/**
 * Adding and changing time off (sub-phase 3.5a; docs/porting/maps/3.5.md, "The
 * page"; owner decisions 286 to 288 and 303).
 *
 *   - `AddTimeOffDialog`: from and to, the type (Vacation, Sick, Other), whole
 *     days or hours off each day (typed through the estimate's one parser),
 *     then a preview of the working days it fills, each removable before
 *     saving; the dates that already hold time off are named as replaced. One
 *     batch write, carrying each replaced date's version.
 *   - `EditTimeOffDialog`: one date's hours and type, changed in place under
 *     its version, or removed through the undo toast.
 *
 * Only someone who may write the person's time off sees these (the person, or
 * a holder of `workload.manage`), and the type is theirs to see (decision
 * 287). Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { formatDay } from '@/components/time/time-format';
import { ApiClientError } from '@/lib/data/api-client';
import { addDays } from '@/lib/time/week';
import { formatDuration, parseDuration } from '@/lib/work-items/estimate';
import { TIME_OFF_TYPES, WORKLOAD_LIMITS, type TimeOffType } from '@/lib/workload/time-off';
import type { TimeOffDayData } from '@/lib/workload/types';

import { useTimeOff, useTimeOffWrites } from './data/use-time-off';
import { hoursText, workingDatesIn } from './workload-model';

type Extent = 'whole' | 'hours';

/** Minutes off a day from the form, or null when the hours do not parse to 1 minute to 23h 59m. */
function minutesOf(extent: Extent, hours: string): number | null | 'invalid' {
    if (extent === 'whole') return null;
    const m = parseDuration(hours);
    return m === null || m < 1 || m > WORKLOAD_LIMITS.timeOffMinutesMax ? 'invalid' : m;
}

function refusalOf(err: ApiClientError, fallback: string): string {
    return err.reason ?? fallback;
}

function TypeChoice({ idPrefix, value, onChange }: { idPrefix: string; value: TimeOffType; onChange: (t: TimeOffType) => void }) {
    const tType = useTranslations('workload.timeOff.type');
    const tChoice = useTranslations('workload.dialog');
    return (
        <FormField label={tChoice('type')} hint={tChoice('typeNote')}>
            <RadioGroup value={value} onValueChange={(v) => onChange(v as TimeOffType)} className="flex flex-wrap gap-default">
                {TIME_OFF_TYPES.map((code) => (
                    <label key={code} htmlFor={`${idPrefix}-type-${code}`} className="flex items-center gap-tight text-sm">
                        <RadioGroupItem id={`${idPrefix}-type-${code}`} value={code} />
                        {tType(code)}
                    </label>
                ))}
            </RadioGroup>
        </FormField>
    );
}

function ExtentChoice({ idPrefix, extent, hours, onExtent, onHours }: { idPrefix: string; extent: Extent; hours: string; onExtent: (e: Extent) => void; onHours: (h: string) => void }) {
    const tExtent = useTranslations('workload.dialog');
    return (
        <div className="space-y-tight">
            <RadioGroup value={extent} onValueChange={(v) => onExtent(v as Extent)} className="flex flex-wrap gap-default" aria-label={tExtent('extent')}>
                <label htmlFor={`${idPrefix}-whole`} className="flex items-center gap-tight text-sm">
                    <RadioGroupItem id={`${idPrefix}-whole`} value="whole" />
                    {tExtent('whole')}
                </label>
                <label htmlFor={`${idPrefix}-hours-choice`} className="flex items-center gap-tight text-sm">
                    <RadioGroupItem id={`${idPrefix}-hours-choice`} value="hours" />
                    {tExtent('hoursChoice')}
                </label>
            </RadioGroup>
            {extent === 'hours' && (
                <FormField label={tExtent('hours')} hint={tExtent('hoursHint')}>
                    <Input id={`${idPrefix}-hours`} value={hours} onChange={(e) => onHours(e.target.value)} autoComplete="off" />
                </FormField>
            )}
        </div>
    );
}

export function AddTimeOffDialog({
    open,
    onOpenChange,
    userId,
    initialFrom,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Another member's (a holder of `workload.manage`); one's own when absent. */
    userId?: string;
    initialFrom: string;
}) {
    const t = useTranslations('workload.dialog');
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialFrom);
    const [type, setType] = useState<TimeOffType>('VACATION');
    const [extent, setExtent] = useState<Extent>('whole');
    const [hours, setHours] = useState('4h');
    const [dropped, setDropped] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const writes = useTimeOffWrites(userId);

    const rangeOk = from !== '' && to !== '' && from <= to && to <= addDays(from, WORKLOAD_LIMITS.timeOffReadDays - 1);
    const existing = useTimeOff(rangeOk ? from : initialFrom, rangeOk ? to : initialFrom, userId);
    const byDay = useMemo(() => new Map((existing.data?.days ?? []).map((d) => [d.day, d] as const)), [existing.data]);
    const dates = useMemo(
        () => (rangeOk && existing.data ? workingDatesIn(from, to, existing.data.calendar.workingWeekdays, existing.data.calendar.holidays, WORKLOAD_LIMITS.timeOffDaysPerWrite) : []),
        [rangeOk, from, to, existing.data],
    );
    const chosen = dates.filter((d) => !dropped.has(d));
    const replaced = chosen.filter((d) => byDay.has(d));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!rangeOk) return setError(t('pickRange'));
        const minutes = minutesOf(extent, hours);
        if (minutes === 'invalid') return setError(t('invalidHours'));
        if (chosen.length === 0) return setError(t('previewNone'));
        setSaving(true);
        const out = await writes.setDays(chosen.map((day) => ({ day, minutes, type, version: byDay.get(day)?.version })));
        setSaving(false);
        if (out instanceof ApiClientError) return setError(refusalOf(out, t('failed')));
        onOpenChange(false);
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={t('title')}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={t('title')} description={t('description')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={t('from')}>
                                <DatePicker id="time-off-from" value={parseYMD(from)} onChange={(d) => { setFrom(toYMD(d) ?? ''); setDropped(new Set()); }} />
                            </FormField>
                            <FormField label={t('to')}>
                                <DatePicker id="time-off-to" value={parseYMD(to)} onChange={(d) => { setTo(toYMD(d) ?? ''); setDropped(new Set()); }} />
                            </FormField>
                        </div>
                        <TypeChoice idPrefix="time-off-add" value={type} onChange={setType} />
                        <ExtentChoice idPrefix="time-off-add" extent={extent} hours={hours} onExtent={setExtent} onHours={setHours} />
                        <section aria-labelledby="time-off-preview-heading" className="space-y-tight">
                            <h3 id="time-off-preview-heading" className="text-sm font-semibold text-content-emphasis">
                                {t('preview', { count: chosen.length })}
                            </h3>
                            {rangeOk && existing.data && dates.length === 0 && <p className="text-sm text-content-muted">{t('previewNone')}</p>}
                            {replaced.length > 0 && <p className="text-sm text-content-muted">{t('replaces', { count: replaced.length })}</p>}
                            <ul className="max-h-48 space-y-tight overflow-y-auto text-sm" data-testid="time-off-preview">
                                {dates.map((d) => {
                                    const kept = !dropped.has(d);
                                    const old = byDay.get(d);
                                    return (
                                        <li key={d} className="flex items-center justify-between gap-tight">
                                            <span className={kept ? '' : 'text-content-muted line-through'}>
                                                {formatDay(d, 'long')}
                                                {old && <span className="ml-tight text-xs text-content-muted">{t('replacesDay', { value: old.minutes === null ? t('wholeDay') : hoursText(old.minutes) })}</span>}
                                            </span>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                text={kept ? t('removeDate') : t('keepDate')}
                                                aria-label={kept ? t('removeDateNamed', { date: formatDay(d, 'long') }) : t('keepDateNamed', { date: formatDay(d, 'long') })}
                                                onClick={() =>
                                                    setDropped((prev) => {
                                                        const next = new Set(prev);
                                                        if (next.has(d)) next.delete(d);
                                                        else next.add(d);
                                                        return next;
                                                    })
                                                }
                                            />
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={t('cancel')} onClick={() => onOpenChange(false)} />
                        <Button id="time-off-save" type="submit" variant="primary" text={t('save')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

export function EditTimeOffDialog({
    open,
    onOpenChange,
    userId,
    day,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userId?: string;
    day: TimeOffDayData;
}) {
    const tEdit = useTranslations('workload.dialog');
    const [type, setType] = useState<TimeOffType>(day.type ?? 'OTHER');
    const [extent, setExtent] = useState<Extent>(day.minutes === null ? 'whole' : 'hours');
    const [hours, setHours] = useState(day.minutes === null ? '4h' : formatDuration(day.minutes));
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const writes = useTimeOffWrites(userId);
    const title = tEdit('editTitle', { date: formatDay(day.day, 'long') });

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const minutes = minutesOf(extent, hours);
        if (minutes === 'invalid') return setError(tEdit('invalidHours'));
        setSaving(true);
        const out = await writes.setDays([{ day: day.day, minutes, type, version: day.version }]);
        setSaving(false);
        if (out instanceof ApiClientError) return setError(refusalOf(out, tEdit('failed')));
        onOpenChange(false);
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={title}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={title} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        <TypeChoice idPrefix="time-off-edit" value={type} onChange={setType} />
                        <ExtentChoice idPrefix="time-off-edit" extent={extent} hours={hours} onExtent={setExtent} onHours={setHours} />
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button
                            type="button"
                            variant="ghost"
                            text={tEdit('remove')}
                            onClick={() => {
                                writes.removeDays([{ day: day.day, version: day.version }]);
                                onOpenChange(false);
                            }}
                        />
                        <Button type="button" variant="secondary" text={tEdit('cancel')} onClick={() => onOpenChange(false)} />
                        <Button id="time-off-edit-save" type="submit" variant="primary" text={tEdit('save')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
