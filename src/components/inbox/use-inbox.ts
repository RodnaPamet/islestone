'use client';

/**
 * The Inbox's reads and writes (sub-phase 2.7c; owner decision 134).
 *
 * Reads: one view's pages from `GET /notifications?view=…`, cursor by cursor
 * (`swr/infinite`, keyed through `useTenantApiUrl`, so a workspace never reads
 * another's cache), each with the unread count. Writes: `PATCH
 * /notifications/:id` and `POST /notifications/bulk` through `apiSend`, then
 * every page is read again. Read and unread are shown at once (an override
 * until the read comes back). Marking Done goes through the undo toast
 * (`tests/guards/undo-toast-coverage.test.ts`): the row leaves the view at
 * once and the write is sent when the window closes.
 *
 * Written fresh for Islestone.
 */
import type { NotificationType } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import useSWRInfinite from 'swr/infinite';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiGet, apiSend } from '@/lib/data/api-client';
import type { InboxPageData, InboxView, NotificationRowData } from '@/lib/notifications/inbox';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';

export const INBOX_PAGE_SIZE = 50;

export const INBOX_PATHS = {
    page: (view: InboxView, type: NotificationType | null, cursor?: string) =>
        `/notifications?view=${view}&limit=${INBOX_PAGE_SIZE}${type ? `&type=${type}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    one: (id: string) => `/notifications/${encodeURIComponent(id)}`,
    bulk: '/notifications/bulk',
    preferences: '/notification-preferences',
} as const;

/** The refusal a person reads: the server's sentence, or `fallback`. */
export function inboxRefusal(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

export function useInbox(view: InboxView, type: NotificationType | null) {
    const apiUrl = useTenantApiUrl();
    const t = useTranslations('inbox');
    const toast = useToast();
    const triggerUndo = useToastWithUndo();

    const getKey = useCallback(
        (index: number, previous: InboxPageData | null) => {
            if (previous && !previous.pageInfo.hasNextPage) return null;
            return apiUrl(INBOX_PATHS.page(view, type, index === 0 ? undefined : previous?.pageInfo.nextCursor));
        },
        [apiUrl, view, type],
    );
    const swr = useSWRInfinite<InboxPageData, ApiClientError | Error>(getKey, (url: string) => apiGet<InboxPageData>(url), {
        revalidateOnFocus: true,
        revalidateFirstPage: true,
    });
    const { data, mutate, setSize, size, isLoading, error } = swr;

    // Shown at once, until the next read: read/unread per row, and rows moved
    // out of this view (Done, or back in the Inbox from the Done tab).
    const [readOverride, setReadOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
    // A fresh read replaces what was shown ahead of it (state adjusted while
    // rendering, React's pattern for state derived from a changed input).
    const [readFor, setReadFor] = useState(data);
    if (readFor !== data) {
        setReadFor(data);
        setReadOverride(new Map());
        setHidden(new Set());
    }

    const rows = useMemo<NotificationRowData[]>(() => {
        const all = (data ?? []).flatMap((p) => p.items);
        return all
            .filter((r) => !hidden.has(r.id))
            .map((r) => (readOverride.has(r.id) ? { ...r, read: readOverride.get(r.id)! } : r));
    }, [data, hidden, readOverride]);

    const unreadCount = data?.[0]?.unreadCount ?? 0;
    const hasMore = !!data && data[data.length - 1]?.pageInfo.hasNextPage === true;

    const refresh = useCallback(() => mutate(), [mutate]);

    const setRead = useCallback(
        async (row: NotificationRowData, read: boolean) => {
            setReadOverride((m) => new Map(m).set(row.id, read));
            try {
                await apiSend('PATCH', apiUrl(INBOX_PATHS.one(row.id)), { read });
            } catch (err) {
                toast.error(inboxRefusal(err, t('failed')));
            }
            await refresh();
        },
        [apiUrl, refresh, t, toast],
    );

    /** Done (or, from the Done tab, back to the Inbox), through the undo toast. */
    const setDone = useCallback(
        (row: NotificationRowData, done: boolean) => {
            setHidden((s) => new Set(s).add(row.id));
            const putBack = () =>
                setHidden((s) => {
                    const next = new Set(s);
                    next.delete(row.id);
                    return next;
                });
            triggerUndo({
                message: done ? t('doneToast') : t('restoredToast'),
                undoMessage: t('undo'),
                action: () => apiSend('PATCH', apiUrl(INBOX_PATHS.one(row.id)), { done }),
                undoAction: () => putBack(),
                onCommit: () => {
                    void refresh();
                },
                onError: (err) => {
                    putBack();
                    void refresh();
                    toast.error(inboxRefusal(err, t('failed')));
                },
            });
        },
        [apiUrl, refresh, t, toast, triggerUndo],
    );

    const markAllRead = useCallback(async () => {
        try {
            await apiSend('POST', apiUrl(INBOX_PATHS.bulk), { action: 'mark-all-read' });
        } catch (err) {
            toast.error(inboxRefusal(err, t('failed')));
        }
        await refresh();
    }, [apiUrl, refresh, t, toast]);

    return {
        rows,
        unreadCount,
        hasMore,
        isLoading,
        error,
        loadMore: () => setSize(size + 1),
        setRead,
        setDone,
        markAllRead,
    };
}
