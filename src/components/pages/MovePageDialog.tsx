'use client';

/**
 * Move a page with the pages below it (sub-phase 4.1a, decision 341): to
 * another tree (the workspace's or a project's, from the trees the server
 * offered), at its top level or under a page found by title in that tree
 * (`GET /pages/search`). The server holds every rule (no page under itself,
 * ten levels, no archived project) and its refusal is shown here.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import type { PageData, PageTreeKey, PageTreeOption } from '@/lib/pages/types';

import { pageRefusal, usePageSearch, usePageWrites } from './use-pages';

export type { PageTreeOption };

const keyOf = (tree: PageTreeKey): string => (tree.kind === 'workspace' ? 'workspace' : `project:${tree.projectId}`);
const TOP_LEVEL = '__top__';

export function MovePageDialog({
    page,
    trees,
    onClose,
}: {
    page: Pick<PageData, 'id' | 'title' | 'projectId' | 'parentId'> | null;
    trees: readonly PageTreeOption[];
    onClose: () => void;
}) {
    const tMove = useTranslations('pages.move');
    const toast = useToast();
    const writes = usePageWrites();
    const [treeKey, setTreeKey] = useState('workspace');
    const [parent, setParent] = useState<ComboboxOption | null>(null);
    const [search, setSearch] = useState('');

    const [shown, setShown] = useState<typeof page>(null);
    if (page !== shown) {
        setShown(page);
        if (page) {
            setTreeKey(page.projectId ? `project:${page.projectId}` : 'workspace');
            setParent(null);
            setSearch('');
        }
    }

    const tree = trees.find((t) => keyOf(t.key) === treeKey)?.key ?? { kind: 'workspace' as const };
    const found = usePageSearch(search, tree).data?.pages;
    const treeOptions: ComboboxOption[] = trees.map((t) => ({ value: keyOf(t.key), label: t.label }));
    const parentOptions = useMemo<ComboboxOption[]>(
        () => [{ value: TOP_LEVEL, label: tMove('topLevel') }, ...(found ?? []).filter((p) => p.id !== page?.id).map((p) => ({ value: p.id, label: p.title }))],
        [found, page?.id, tMove],
    );

    const submit = async (): Promise<string | null> => {
        if (!page) return null;
        try {
            await writes.move(page, {
                projectId: tree.kind === 'project' ? tree.projectId : null,
                parentId: parent && parent.value !== TOP_LEVEL ? parent.value : null,
            });
            toast.success(tMove('moved', { title: page.title }));
            return null;
        } catch (err) {
            return pageRefusal(err, tMove('failed'));
        }
    };

    return (
        <SettingsFormModal
            open={page !== null}
            onOpenChange={(o) => !o && onClose()}
            title={tMove('title', { title: page?.title ?? '' })}
            description={tMove('description')}
            submitLabel={tMove('submit')}
            onSubmit={submit}
        >
            <FormField label={tMove('tree')}>
                <Combobox
                    id="page-move-tree-input"
                    selected={treeOptions.find((o) => o.value === treeKey) ?? null}
                    setSelected={(o) => {
                        if (!o) return;
                        setTreeKey(o.value);
                        setParent(null);
                    }}
                    options={treeOptions}
                    caret
                />
            </FormField>
            <FormField label={tMove('parent')} description={tMove('parentHint')}>
                <Combobox
                    id="page-move-parent-input"
                    selected={parent ?? parentOptions[0] ?? null}
                    setSelected={(o) => setParent(o)}
                    options={parentOptions}
                    onSearchChange={setSearch}
                    shouldFilter={false}
                    caret
                />
            </FormField>
        </SettingsFormModal>
    );
}
