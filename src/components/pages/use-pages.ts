'use client';

/**
 * The pages' reads and writes (sub-phase 4.1a; docs/pages.md): a tree's
 * children, a page with its breadcrumb, a tree's Deleted list and the title
 * search, read through `use-tenant-swr.ts` at the routes' own paths; writes
 * through `apiSend`, then every pages read is read again. A rename sends the
 * version it was based on (`If-Match`). Deleting a page goes through the
 * undo toast (`tests/guards/undo-toast-coverage.test.ts`): the DELETE is sent
 * when the window closes.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { DeletedPageData, PageChildren, PageData, PageDetail, PageTreeKey } from '@/lib/pages/types';

export type { PageTreeKey };

const treeQuery = (tree: PageTreeKey): string => (tree.kind === 'workspace' ? 'scope=workspace' : `projectId=${encodeURIComponent(tree.projectId)}`);

export const PAGE_PATHS = {
    root: '/pages',
    children: (tree: PageTreeKey, parentId?: string | null, after?: string | null) =>
        `/pages?${treeQuery(tree)}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    one: (id: string) => `/pages/${encodeURIComponent(id)}`,
    move: (id: string) => `/pages/${encodeURIComponent(id)}/move`,
    restore: (id: string) => `/pages/${encodeURIComponent(id)}/restore`,
    deleted: (tree: PageTreeKey) => `/pages/deleted?${treeQuery(tree)}`,
    search: (q: string, tree?: PageTreeKey) => `/pages/search?q=${encodeURIComponent(q)}${tree ? `&${treeQuery(tree)}` : ''}`,
} as const;

export const usePageChildren = (tree: PageTreeKey, parentId: string | null, opts: { fallback?: PageChildren; after?: string | null } = {}) =>
    useTenantSWR<PageChildren>(PAGE_PATHS.children(tree, parentId, opts.after), opts.fallback ? { fallbackData: opts.fallback } : {});

export const usePage = (id: string, fallback?: PageDetail) => useTenantSWR<PageDetail>(PAGE_PATHS.one(id), fallback ? { fallbackData: fallback } : {});

export const useDeletedPages = (tree: PageTreeKey, enabled: boolean) =>
    useTenantSWR<{ pages: DeletedPageData[] }>(enabled ? PAGE_PATHS.deleted(tree) : null);

export const usePageSearch = (q: string, tree?: PageTreeKey) =>
    useTenantSWR<{ pages: Array<{ id: string; title: string; projectId: string | null }> }>(q.trim().length > 0 ? PAGE_PATHS.search(q.trim(), tree) : null);

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function pageRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export interface PagePlacement {
    afterId?: string | null;
    beforeId?: string | null;
}

export function usePageWrites() {
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const triggerUndo = useToastWithUndo();
    const toast = useToast();
    const t = useTranslations('pages');
    const root = apiUrl(PAGE_PATHS.root);

    /** Every pages read again: a tree, a page, a Deleted list, a search. */
    const revalidate = useCallback(() => mutate((key) => typeof key === 'string' && key.startsWith(root)), [mutate, root]);

    const remove = useCallback(
        (page: Pick<PageData, 'id' | 'title'>, onGone?: () => void) => {
            triggerUndo({
                message: t('deletedToast', { title: page.title }),
                undoMessage: t('undo'),
                action: () => apiSend('DELETE', apiUrl(PAGE_PATHS.one(page.id))),
                onCommit: () => {
                    void revalidate();
                    onGone?.();
                },
                onError: (err) => {
                    void revalidate();
                    toast.error(pageRefusal(err, t('failed')));
                },
            });
        },
        [apiUrl, revalidate, toast, triggerUndo, t],
    );

    return useMemo(
        () => ({
            revalidate,
            create: async (input: { projectId: string | null; parentId?: string | null; title?: string } & PagePlacement) => {
                const created = await apiSend<PageData>('POST', root, input);
                await revalidate();
                return created;
            },
            rename: async (page: Pick<PageData, 'id' | 'version'>, title: string) => {
                const saved = await apiSend<PageData>('PATCH', apiUrl(PAGE_PATHS.one(page.id)), { title }, { ifMatch: page.version });
                await revalidate();
                return saved;
            },
            move: async (page: Pick<PageData, 'id'>, input: { projectId: string | null; parentId: string | null } & PagePlacement) => {
                const moved = await apiSend<PageData>('POST', apiUrl(PAGE_PATHS.move(page.id)), input);
                await revalidate();
                return moved;
            },
            /** Move up or down among its siblings; a refusal is a toast. */
            reorder: async (page: Pick<PageData, 'id' | 'projectId' | 'parentId'>, place: PagePlacement) => {
                try {
                    await apiSend<PageData>('POST', apiUrl(PAGE_PATHS.move(page.id)), { projectId: page.projectId, parentId: page.parentId, ...place });
                } catch (err) {
                    toast.error(pageRefusal(err, t('failed')));
                }
                await revalidate();
            },
            restore: async (page: Pick<DeletedPageData, 'id'>) => {
                try {
                    await apiSend<PageData>('POST', apiUrl(PAGE_PATHS.restore(page.id)));
                    toast.success(t('restored'));
                } catch (err) {
                    toast.error(pageRefusal(err, t('failed')));
                }
                await revalidate();
            },
            remove,
        }),
        [apiUrl, remove, revalidate, root, toast, t],
    );
}
