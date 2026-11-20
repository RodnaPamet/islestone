'use client';

/**
 * A confirmation for a change with a large consequence (archiving a
 * project): the person types a word the dialog names (the project's key
 * prefix) before the destructive button enables. CLAUDE.md ("Destructive
 * actions"): a typed confirmation where the undo window is too short for
 * what the change does.
 *
 * Written fresh for Islestone (decision 55), on the shared `Modal`.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

import { SettingsFormModal } from './SettingsFormModal';

export function TypedConfirmModal({
    open,
    onOpenChange,
    title,
    body,
    word,
    fieldLabel,
    confirmLabel,
    onConfirm,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    body: string;
    /** What the person must type, compared exactly. */
    word: string;
    fieldLabel: string;
    confirmLabel: string;
    onConfirm: () => Promise<string | null>;
}) {
    const t = useTranslations('settings.common');
    const [typed, setTyped] = useState('');
    const matches = typed.trim() === word;
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={(next) => {
                if (!next) setTyped('');
                onOpenChange(next);
            }}
            title={title}
            description={body}
            submitLabel={confirmLabel}
            submitDisabled={!matches}
            onSubmit={async () => (matches ? onConfirm() : t('failed'))}
        >
            <FormField label={fieldLabel} required>
                <Input id="typed-confirm-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
            </FormField>
        </SettingsFormModal>
    );
}
