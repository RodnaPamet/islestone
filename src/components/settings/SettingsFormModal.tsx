'use client';

/**
 * The Settings pages' create and rename dialog: a title, the fields the
 * caller passes, and the server's refusal shown in the dialog with the
 * person's text kept. `onSubmit` answers `null` on success (the dialog
 * closes) or the sentence to show.
 *
 * Written fresh for Islestone (decision 55), on the shared `Modal`.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Modal } from '@/components/ui/modal';

export function SettingsFormModal({
    open,
    onOpenChange,
    title,
    description,
    submitLabel,
    onSubmit,
    submitDisabled,
    children,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    submitLabel: string;
    onSubmit: () => Promise<string | null>;
    submitDisabled?: boolean;
    children: ReactNode;
}) {
    const t = useTranslations('settings.common');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const close = () => {
        setError(null);
        onOpenChange(false);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        const refusal = await onSubmit();
        setSubmitting(false);
        if (refusal) setError(refusal);
        else close();
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) close();
            }}
            title={title}
            onClose={close}
        >
            <Modal.Header title={title} description={description} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default">
                        {children}
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" onClick={close} text={t('cancel')} />
                        <Button type="submit" variant="primary" loading={submitting} disabled={submitDisabled} text={submitLabel} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
