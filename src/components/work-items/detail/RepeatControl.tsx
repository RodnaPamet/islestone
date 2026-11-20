'use client';

/**
 * The detail's Repeat control (sub-phase 2.5d, owner decisions 67 to 70):
 * what the repeat set on the item does (every N days, weeks, months or
 * years; the weekdays; the end; the lead days), its next date, and why it is
 * on hold; for a viewer who may create and edit work items, set or change it,
 * put it on hold or resume it (resuming makes them its owner), and stop it
 * through the undo toast. An item that is an occurrence of a series says so
 * and links to the item where the repeat was set.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { usePermissions, useTenantHref } from '@/lib/tenant-context-provider';
import type { RecurrenceData, RecurrenceFrequencyName } from '@/lib/work-items/types';

import { useWorkItemSeries, type RepeatInput } from '../data/use-recurrence';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const UNIT: Record<RecurrenceFrequencyName, string> = { DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months', YEARLY: 'years' };
/** Monday first, as the weeks are counted. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

/** The rule in one line: "Every 2 weeks on Mon, Fri · 5 times". */
export function describeRepeat(rule: Pick<RecurrenceData, 'frequency' | 'interval' | 'weekdays' | 'endsOn' | 'maxOccurrences'>, t: Translate): string {
    const parts = [rule.interval === 1 ? t(`every.${rule.frequency}`) : t(`everyN.${UNIT[rule.frequency]}`, { count: rule.interval })];
    if (rule.frequency === 'WEEKLY' && rule.weekdays.length > 0) {
        parts.push(t('onDays', { days: WEEK.filter((d) => rule.weekdays.includes(d)).map((d) => t(`weekday.${d}`)).join(', ') }));
    }
    if (rule.endsOn) parts.push(t('until', { date: rule.endsOn }));
    if (rule.maxOccurrences) parts.push(t('times', { count: rule.maxOccurrences }));
    return parts.join(' · ');
}

type Ends = 'never' | 'on' | 'after';

function RepeatDialog({
    open,
    onOpenChange,
    initial,
    onSave,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initial: RecurrenceData | null;
    onSave: (input: RepeatInput) => Promise<string | null>;
}) {
    const tDialog = useTranslations('workItems.repeat');
    const [frequency, setFrequency] = useState<RecurrenceFrequencyName>(initial?.frequency ?? 'WEEKLY');
    const [interval, setInterval] = useState(String(initial?.interval ?? 1));
    const [weekdays, setWeekdays] = useState<number[]>(initial?.weekdays ?? []);
    const [ends, setEnds] = useState<Ends>(initial?.endsOn ? 'on' : initial?.maxOccurrences ? 'after' : 'never');
    const [endsOn, setEndsOn] = useState<string | null>(initial?.endsOn ?? null);
    const [times, setTimes] = useState(String(initial?.maxOccurrences ?? 10));
    const [lead, setLead] = useState(String(initial?.leadDays ?? 3));
    const [error, setError] = useState<string | null>(null);

    const frequencyOptions: ComboboxOption[] = (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => ({ value: f, label: tDialog(`frequency.${f}`) }));
    const endOptions: ComboboxOption[] = (['never', 'on', 'after'] as const).map((e) => ({ value: e, label: tDialog(`ends.${e}`) }));

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const n = Number(interval);
        const days = Number(lead);
        const count = Number(times);
        if (!/^\d{1,2}$/.test(interval) || n < 1) return setError(tDialog('invalidInterval'));
        if (!/^\d{1,2}$/.test(lead) || days > 30) return setError(tDialog('invalidLead'));
        if (ends === 'after' && (!/^\d{1,4}$/.test(times) || count < 2 || count > 1000)) return setError(tDialog('invalidTimes'));
        if (ends === 'on' && !endsOn) return setError(tDialog('invalidEndsOn'));
        const failure = await onSave({
            frequency,
            interval: n,
            weekdays: frequency === 'WEEKLY' ? weekdays : [],
            endsOn: ends === 'on' ? endsOn : null,
            maxOccurrences: ends === 'after' ? count : null,
            leadDays: days,
        });
        if (failure) setError(failure);
        else onOpenChange(false);
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={tDialog('dialogTitle')}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={tDialog('dialogTitle')} description={tDialog('dialogDescription')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tDialog('frequencyLabel')}>
                                <Combobox
                                    id="repeat-frequency"
                                    selected={frequencyOptions.find((o) => o.value === frequency) ?? null}
                                    setSelected={(o) => o && setFrequency(o.value as RecurrenceFrequencyName)}
                                    options={frequencyOptions}
                                    caret
                                    hideSearch
                                />
                            </FormField>
                            <FormField label={tDialog('intervalLabel')} hint={tDialog('intervalHint')}>
                                <Input id="repeat-interval" inputMode="numeric" maxLength={2} value={interval} onChange={(e) => setInterval(e.target.value)} />
                            </FormField>
                        </div>
                        {frequency === 'WEEKLY' && (
                            <fieldset className="space-y-tight">
                                <legend className="text-sm text-content-emphasis">{tDialog('weekdaysLabel')}</legend>
                                <div className="flex flex-wrap gap-default">
                                    {WEEK.map((d) => (
                                        <label key={d} className="flex items-center gap-1 text-sm" htmlFor={`repeat-day-${d}`}>
                                            <Checkbox
                                                id={`repeat-day-${d}`}
                                                checked={weekdays.includes(d)}
                                                onCheckedChange={(c) => setWeekdays((w) => (c === true ? [...w, d] : w.filter((x) => x !== d)))}
                                            />
                                            {tDialog(`weekday.${d}`)}
                                        </label>
                                    ))}
                                </div>
                                <p className="text-xs text-content-muted">{tDialog('weekdaysHint')}</p>
                            </fieldset>
                        )}
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tDialog('endsLabel')}>
                                <Combobox
                                    id="repeat-ends"
                                    selected={endOptions.find((o) => o.value === ends) ?? null}
                                    setSelected={(o) => o && setEnds(o.value as Ends)}
                                    options={endOptions}
                                    caret
                                    hideSearch
                                />
                            </FormField>
                            {ends === 'on' && (
                                <FormField label={tDialog('endsOnLabel')}>
                                    <DatePicker id="repeat-ends-on" value={parseYMD(endsOn)} onChange={(d) => setEndsOn(toYMD(d))} />
                                </FormField>
                            )}
                            {ends === 'after' && (
                                <FormField label={tDialog('timesLabel')} hint={tDialog('timesHint')}>
                                    <Input id="repeat-times" inputMode="numeric" maxLength={4} value={times} onChange={(e) => setTimes(e.target.value)} />
                                </FormField>
                            )}
                        </div>
                        <FormField label={tDialog('leadLabel')} hint={tDialog('leadHint')}>
                            <Input id="repeat-lead" inputMode="numeric" maxLength={2} value={lead} onChange={(e) => setLead(e.target.value)} />
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tDialog('cancel')} onClick={() => onOpenChange(false)} />
                        <Button id="repeat-save-btn" type="submit" variant="primary" text={tDialog('save')} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

export function RepeatControl({ itemId, hasDueDate, archived }: { itemId: string; hasDueDate: boolean; archived: boolean }) {
    const tRepeat = useTranslations('workItems.repeat');
    const tenantHref = useTenantHref();
    const perms = usePermissions().work_items;
    const { series, save, stop } = useWorkItemSeries(itemId);
    const [editing, setEditing] = useState(false);
    const canSet = perms.create && perms.edit && !archived;
    const rule = series?.rule ?? null;

    const saveRule = async (input: RepeatInput): Promise<string | null> => {
        const out = await save(input);
        return out instanceof Error ? (out.reason ?? tRepeat('failed')) : null;
    };
    const toInput = (r: RecurrenceData, onHold: boolean): RepeatInput => ({
        frequency: r.frequency,
        interval: r.interval,
        weekdays: r.weekdays,
        endsOn: r.endsOn,
        maxOccurrences: r.maxOccurrences,
        leadDays: r.leadDays,
        onHold,
    });

    return (
        <div className="space-y-tight" data-testid="repeat-control">
            {series?.occurrenceOf && (
                <p className="text-xs text-content-muted">
                    {tRepeat('occurrenceOf', { date: series.occurrenceOf.occurrenceOn ?? '' })}{' '}
                    <Link href={tenantHref(`/work-items/${series.occurrenceOf.key}`)} className="text-content-emphasis hover:underline">
                        {series.occurrenceOf.key}
                    </Link>
                </p>
            )}
            {rule ? (
                <>
                    <p className="text-sm text-content-emphasis">{describeRepeat(rule, tRepeat)}</p>
                    {rule.heldReason ? (
                        <p role="status" className="text-xs text-content-warning">
                            {tRepeat(`held.${rule.heldReason}`)}
                        </p>
                    ) : (
                        rule.nextOccurrenceOn && <p className="text-xs text-content-muted">{tRepeat('next', { date: rule.nextOccurrenceOn, lead: rule.leadDays })}</p>
                    )}
                    {canSet && (
                        <div className="flex flex-wrap gap-tight">
                            <Button variant="ghost" size="sm" text={tRepeat('edit')} onClick={() => setEditing(true)} />
                            {rule.heldReason ? (
                                <Button variant="ghost" size="sm" text={tRepeat('resume')} onClick={() => void saveRule(toInput(rule, false))} />
                            ) : (
                                <Button variant="ghost" size="sm" text={tRepeat('hold')} onClick={() => void saveRule(toInput(rule, true))} />
                            )}
                            <Button variant="ghost" size="sm" text={tRepeat('stop')} onClick={stop} />
                        </div>
                    )}
                </>
            ) : (
                <div className="flex flex-wrap items-center gap-tight">
                    <span className="text-sm text-content-muted">{tRepeat('none')}</span>
                    {canSet &&
                        (hasDueDate ? (
                            <Button variant="ghost" size="sm" text={tRepeat('set')} onClick={() => setEditing(true)} />
                        ) : (
                            <span className="text-xs text-content-muted">{tRepeat('needsDueDate')}</span>
                        ))}
                </div>
            )}
            {canSet && editing && <RepeatDialog open onOpenChange={setEditing} initial={rule} onSave={saveRule} />}
        </div>
    );
}
