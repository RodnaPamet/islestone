'use client';

/**
 * Delete a row from a Settings list with the undo toast (CLAUDE.md, "Writes
 * are optimistic with rollback"; `tests/guards/undo-toast-coverage.test.ts`):
 * the row leaves the list at once, and the DELETE is sent from inside the
 * toast's action when the window closes. Undo puts the row back; a refusal
 * puts it back and shows the server's reason.
 *
 * Written fresh for Islestone (decision 55).
 */
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';

import { refusalText, useSettingsApi } from './settings-data';

export function useUndoDelete() {
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('settings.common');
    const { send, revalidate, setPath } = useSettingsApi();

    return useCallback(
        <T,>(input: {
            /** The cache entry the row is shown in. */
            path: string;
            /** The entry without the row (`current` is undefined before the first read). */
            without: (current: T | undefined) => T | undefined;
            /** The DELETE's tenant-relative path, query included. */
            deletePath: string;
            message: string;
            /** Other entries to revalidate once the delete is committed. */
            alsoRevalidate?: string[];
        }) => {
            let before: T | undefined;
            void setPath<T>(input.path, (current) => {
                before = current;
                return input.without(current);
            });
            const putBack = () => setPath<T>(input.path, () => before);
            triggerUndo({
                message: input.message,
                undoMessage: t('undo'),
                action: () => send('DELETE', input.deletePath),
                undoAction: () => {
                    void putBack();
                },
                onCommit: () => {
                    void revalidate(input.path, ...(input.alsoRevalidate ?? []));
                },
                onError: (err) => {
                    void putBack().then(() => revalidate(input.path));
                    toast.error(refusalText(err, t('failed')));
                },
            });
        },
        [triggerUndo, toast, t, send, revalidate, setPath],
    );
}

/** `without` for a list: the rows but the one with `id`. */
export const withoutRow =
    <R extends { id: string }>(id: string) =>
    (rows: R[] | undefined) =>
        rows?.filter((r) => r.id !== id);
