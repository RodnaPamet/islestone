'use client';

/**
 * Why a week is returned or reopened (sub-phase 3.4c; owner decision 270):
 * the approver's explanation, 1 to 2,000 characters, shown to the person
 * only (never audited or notified). Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { TIMESHEET_LIMITS } from '@/lib/time/timesheets';

export function ExplanationDialog({
    open,
    title,
    description,
    confirmText,
    onOpenChange,
    onConfirm,
}: {
    open: boolean;
    title: string;
    description: string;
    confirmText: string;
    onOpenChange: (open: boolean) => void;
    /** Returns a refusal's sentence, or null when done. */
    onConfirm: (explanation: string) => Promise<string | null>;
}) {
    const t = useTranslations('time.timesheets');
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (text.trim().length === 0) return setError(t('explanationRequired'));
        setSaving(true);
        const failure = await onConfirm(text.trim());
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
            <Modal.Header title={title} description={description} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <FormField label={t('explanation')} hint={t('explanationHint')}>
                        <Textarea id="timesheet-explanation" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={TIMESHEET_LIMITS.explanationMax} />
                    </FormField>
                    {error && (
                        <p role="alert" className="mt-tight text-sm text-content-error">
                            {error}
                        </p>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={t('cancel')} onClick={() => onOpenChange(false)} />
                        <Button id="timesheet-explanation-confirm" type="submit" variant="primary" text={confirmText} loading={saving} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
