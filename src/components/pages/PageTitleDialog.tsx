'use client';

/**
 * A page's title form (sub-phase 4.1a): create a page in a tree (under an
 * optional parent), or rename one (the version it was based on goes as
 * `If-Match`; a 409 says someone else changed it). The server's refusal is
 * shown in the dialog. Opened only where the server offered the write.
 *
 * Written fresh for Islestone; built on the Settings form modal so every
 * small form reads alike.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { PAGE_TITLE_MAX, type PageData } from '@/lib/pages/types';

import { pageRefusal, usePageWrites, type PageTreeKey } from './use-pages';

export type PageTitleDialogTarget =
    | { mode: 'create'; tree: PageTreeKey; parentId: string | null }
    | { mode: 'rename'; page: Pick<PageData, 'id' | 'title' | 'version'> };

export function PageTitleDialog({
    target,
    onClose,
    onCreated,
}: {
    target: PageTitleDialogTarget | null;
    onClose: () => void;
    onCreated?: (page: PageData) => void;
}) {
    const tForm = useTranslations('pages.form');
    const toast = useToast();
    const writes = usePageWrites();
    const [title, setTitle] = useState('');
    const open = target !== null;

    const [shown, setShown] = useState<PageTitleDialogTarget | null>(null);
    if (target !== shown) {
        setShown(target);
        if (target) setTitle(target.mode === 'rename' ? target.page.title : '');
    }

    const submit = async (): Promise<string | null> => {
        if (!target) return null;
        try {
            if (target.mode === 'rename') {
                if (!title.trim()) return tForm('titleRequired');
                await writes.rename(target.page, title.trim());
                toast.success(tForm('renamed'));
            } else {
                const created = await writes.create({
                    projectId: target.tree.kind === 'project' ? target.tree.projectId : null,
                    parentId: target.parentId,
                    ...(title.trim() ? { title: title.trim() } : {}),
                });
                toast.success(tForm('created'));
                onCreated?.(created);
            }
            return null;
        } catch (err) {
            return pageRefusal(err, tForm('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={(o) => !o && onClose()}
            title={target?.mode === 'rename' ? tForm('renameTitle') : target?.parentId ? tForm('createSubpageTitle') : tForm('createTitle')}
            submitLabel={target?.mode === 'rename' ? tForm('rename') : tForm('create')}
            onSubmit={submit}
        >
            <FormField label={tForm('title')} description={target?.mode === 'create' ? tForm('titleHint') : undefined} required={target?.mode === 'rename'}>
                <Input id="page-title-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={PAGE_TITLE_MAX} autoFocus />
            </FormField>
        </SettingsFormModal>
    );
}
