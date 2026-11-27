'use client';

/**
 * Add or change one time entry (sub-phase 3.4b; owner decisions 260, 264 and
 * 267): the date, the time spent (typed as "1h 30m", "1.5h" or "90m" through
 * the estimate's one parser, never rounded), billable and a description. On
 * My time the item is picked too; on an item's Time panel it is the item.
 * Billable starts at the project's default (3.4d, decision 271) where the
 * caller knows it; where it does not (an item just picked), it is `null`
 * until the person ticks or unticks it, and the server applies the default.
 * The server's refusal (a full day, an archived project) is shown in the
 * dialog.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { WorkItemPicker } from '@/components/work-items/WorkItemPicker';
import { TIME_LIMITS, isValidEntryMinutes } from '@/lib/time/entries';
import { formatDuration, parseDuration } from '@/lib/work-items/estimate';

export interface TimeEntryDraft {
    workItem: { id: string; label: string } | null;
    workDate: string;
    minutes: number | null;
    /** `null`: the project's default, decided by the server (3.4d, decision 271). */
    billable: boolean | null;
    description: string;
}

export function TimeEntryDialog({
    open,
    onOpenChange,
    title,
    initial,
    pickItem,
    onSave,
    onDelete,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    initial: TimeEntryDraft;
    /** Offer the item picker (My time's "Add row"); else the item is fixed. */
    pickItem?: boolean;
    /** Resolves to a refusal to show, or null when saved. */
    onSave: (draft: TimeEntryDraft & { minutes: number }) => Promise<string | null>;
    /** Offer Delete (a change of one's own entry); the caller sends it through the undo toast. */
    onDelete?: () => void;
}) {
    const t = useTranslations('time.dialog');
    const [item, setItem] = useState(initial.workItem);
    const [date, setDate] = useState(initial.workDate);
    const [spent, setSpent] = useState(initial.minutes ? formatDuration(initial.minutes) : '');
    const [billable, setBillable] = useState(initial.billable);
    const [description, setDescription] = useState(initial.description);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const minutes = parseDuration(spent);
        if (pickItem && !item) return setError(t('pickItem'));
        if (!date) return setError(t('pickDate'));
        if (minutes === null || !isValidEntryMinutes(minutes)) return setError(t('invalidDuration'));
        if (description.length > TIME_LIMITS.descriptionMax) return setError(t('descriptionTooLong', { max: TIME_LIMITS.descriptionMax }));
        setSaving(true);
        const failure = await onSave({ workItem: item, workDate: date, minutes, billable, description });
        setSaving(false);
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
            title={title}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={title} description={t('description')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        {pickItem && (
                            <FormField label={t('item')}>
                                <WorkItemPicker id="time-entry-item" value={item} onChange={setItem} label={t('item')} />
                            </FormField>
                        )}
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={t('date')}>
                                <DatePicker id="time-entry-date" value={parseYMD(date)} onChange={(d) => setDate(toYMD(d) ?? '')} />
                            </FormField>
                            <FormField label={t('spent')} hint={t('spentHint')}>
                                <Input id="time-entry-spent" value={spent} onChange={(e) => setSpent(e.target.value)} autoComplete="off" />
                            </FormField>
                        </div>
                        <div>
                            <label className="flex items-center gap-tight text-sm" htmlFor="time-entry-billable">
                                <Checkbox id="time-entry-billable" checked={billable === true} onCheckedChange={(c) => setBillable(c === true)} />
                                {t('billable')}
                            </label>
                            {billable === null && <p className="mt-tight text-xs text-content-muted">{t('billableDefault')}</p>}
                        </div>
                        <FormField label={t('descriptionLabel')}>
                            <Textarea id="time-entry-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={TIME_LIMITS.descriptionMax} />
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
                        {onDelete && <Button type="button" variant="ghost" text={t('delete')} onClick={onDelete} />}
                        <Button type="button" variant="secondary" text={t('cancel')} onClick={() => onOpenChange(false)} />
                        <Button id="time-entry-save" type="submit" variant="primary" text={t('save')} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
