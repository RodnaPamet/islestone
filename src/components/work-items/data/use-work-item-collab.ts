'use client';

/**
 * The detail's own reads and their writes: comments, watchers, labels,
 * relations and links. Each read is one SWR key under the item
 * (`/work-items/<id>/comments`, …), shared by the full page and the sheet.
 * Each write is optimistic with rollback; each removal (a comment, a watcher,
 * a label, a relation, a link) goes through the undo toast, so nothing leaves
 * the server until the undo window closes.
 *
 * A label change increases the item's version (2.2), so it re-reads the item
 * afterwards; the other writes do not touch the item row.
 *
 * Written fresh for Islestone (sub-phase 2.3).
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { RecipientListWatchersResult } from '@/lib/recipient-lists/types';
import type { CommentRow, LinkRow, RelationRow, WatcherRow, WorkItemDetailData } from '@/lib/work-items/types';

import { workItemDetailPath, useWorkItemCache } from './work-item-cache';

export interface CommentsPage {
    items: CommentRow[];
    pageInfo: { nextCursor?: string; hasNextPage: boolean };
}

export interface RelationsData {
    outgoing: RelationRow[];
    incoming: RelationRow[];
}

export const itemPaths = (id: string) => {
    const base = workItemDetailPath(id);
    return {
        item: base,
        comments: `${base}/comments`,
        watchers: `${base}/watchers`,
        relations: `${base}/relations`,
        links: `${base}/links`,
        activity: `${base}/activity`,
    };
};

/** The detail read: the full page and the sheet both call it. */
export function useWorkItem(id: string | null) {
    return useTenantSWR<WorkItemDetailData>(id ? itemPaths(id).item : null);
}

export function useWorkItemComments(id: string) {
    return useTenantSWR<CommentsPage>(itemPaths(id).comments);
}

export function useWorkItemWatchers(id: string) {
    return useTenantSWR<WatcherRow[]>(itemPaths(id).watchers);
}

export function useWorkItemRelations(id: string) {
    return useTenantSWR<RelationsData>(itemPaths(id).relations);
}

export function useWorkItemLinks(id: string) {
    return useTenantSWR<LinkRow[]>(itemPaths(id).links);
}

export function useWorkItemCollab(id: string) {
    const cache = useWorkItemCache();
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.toast');

    return useMemo(() => {
        const paths = itemPaths(id);
        const reason = (err: unknown) => (err instanceof ApiClientError && err.reason ? err.reason : t('failed'));
        const fail = (err: unknown) => toast.error(reason(err));
        // My Work's "Watching" list: the watcher set is not on the row, so the
        // lists filtered by it re-read once the caller's own watch changes.
        const revalidateWatching = () => cache.revalidateLists((f) => !!f.watching);

        /** An optimistic edit of one key, rolled back to its prior value on failure. */
        async function optimistic<T>(path: string, change: (current: T | undefined) => T | undefined, send: () => Promise<unknown>) {
            let previous: T | undefined;
            await cache.setPath<T>(path, (current) => {
                previous = current;
                return change(current);
            });
            try {
                await send();
                void cache.revalidatePath(path);
                return true;
            } catch (err) {
                await cache.setPath<T>(path, () => previous);
                fail(err);
                return false;
            }
        }

        /** A removal through the undo toast: hidden now, sent when the window closes. */
        function removeWithUndo<T>(path: string, change: (current: T | undefined) => T | undefined, message: string, send: () => Promise<unknown>, after?: () => void) {
            let previous: T | undefined;
            void cache.setPath<T>(path, (current) => {
                previous = current;
                return change(current);
            });
            triggerUndo({
                message,
                undoMessage: t('undo'),
                action: send,
                undoAction: () => {
                    void cache.setPath<T>(path, () => previous);
                },
                onCommit: () => {
                    void cache.revalidatePath(path);
                    after?.();
                },
                onError: (err) => {
                    void cache.setPath<T>(path, () => previous);
                    fail(err);
                },
            });
        }

        return {
            // ── Comments (decision 53: the author edits; the author or an admin deletes) ──
            addComment(body: string, authorUserId: string) {
                const temp: CommentRow = {
                    id: `pending-${Date.now()}`,
                    workItemId: id,
                    authorUserId,
                    body,
                    editedAt: null,
                    createdAt: new Date().toISOString(),
                };
                return optimistic<CommentsPage>(
                    paths.comments,
                    (c) => ({ items: [temp, ...(c?.items ?? [])], pageInfo: c?.pageInfo ?? { hasNextPage: false } }),
                    () => apiSend('POST', apiUrl(paths.comments), { body }),
                );
            },
            editComment(commentId: string, body: string) {
                return optimistic<CommentsPage>(
                    paths.comments,
                    (c) =>
                        c && {
                            ...c,
                            items: c.items.map((x) => (x.id === commentId ? { ...x, body, editedAt: new Date().toISOString() } : x)),
                        },
                    () => apiSend('PATCH', apiUrl(`${paths.comments}/${commentId}`), { body }),
                );
            },
            deleteComment(commentId: string) {
                removeWithUndo<CommentsPage>(
                    paths.comments,
                    (c) => c && { ...c, items: c.items.filter((x) => x.id !== commentId) },
                    t('commentDeleted'),
                    () => apiSend('DELETE', apiUrl(`${paths.comments}/${commentId}`)),
                );
            },

            // ── Watchers ──
            watch(userId: string, self: boolean) {
                return optimistic<WatcherRow[]>(
                    paths.watchers,
                    (w) => [...(w ?? []).filter((x) => x.userId !== userId), { userId, createdAt: new Date().toISOString() }],
                    () => apiSend('POST', apiUrl(self ? paths.watchers : `${paths.watchers}/${userId}`)),
                ).then((ok) => {
                    if (ok && self) revalidateWatching();
                    return ok;
                });
            },
            removeWatcher(userId: string, self: boolean) {
                removeWithUndo<WatcherRow[]>(
                    paths.watchers,
                    (w) => (w ?? []).filter((x) => x.userId !== userId),
                    t('watcherRemoved'),
                    () => apiSend('DELETE', apiUrl(self ? paths.watchers : `${paths.watchers}/${userId}`)),
                    self ? revalidateWatching : undefined,
                );
            },

            /**
             * Copy a recipient list's people onto the watchers (2.7e, decision
             * 139): the server resolves who may see the item; the panel
             * re-reads the watchers and says how many were added.
             */
            async addRecipientList(listId: string, listName: string) {
                try {
                    const result = await apiSend<RecipientListWatchersResult>('POST', apiUrl(`${paths.watchers}/recipient-list`), { listId });
                    void cache.revalidatePath(paths.watchers);
                    revalidateWatching();
                    if (result.added.length > 0) toast.success(t('listWatchersAdded', { count: result.added.length, list: listName }));
                    else toast.info(t('listWatchersNone', { list: listName }));
                    return result;
                } catch (err) {
                    fail(err);
                    return null;
                }
            },

            // ── Labels (each change increases the item's version) ──
            addLabels(labelIds: string[]) {
                return optimistic<WorkItemDetailData>(
                    paths.item,
                    (d) => d && { ...d, labelIds: [...new Set([...d.labelIds, ...labelIds])] },
                    () => apiSend('POST', apiUrl(`${paths.item}/labels`), { labelIds }),
                ).then((ok) => {
                    cache.revalidateLists();
                    return ok;
                });
            },
            removeLabel(labelId: string) {
                removeWithUndo<WorkItemDetailData>(
                    paths.item,
                    (d) => d && { ...d, labelIds: d.labelIds.filter((x) => x !== labelId), labels: d.labels.filter((l) => l.id !== labelId) },
                    t('labelRemoved'),
                    () => apiSend('DELETE', apiUrl(`${paths.item}/labels/${labelId}`)),
                    () => cache.revalidateLists(),
                );
            },

            // ── Relations ──
            addRelation(type: RelationRow['type'], toId: string) {
                return optimistic<RelationsData>(
                    paths.relations,
                    (r) => r,
                    () => apiSend('POST', apiUrl(paths.relations), { type, toId }),
                ).then((ok) => {
                    // Marking a duplicate moves the item to its team's CANCELLED state.
                    if (ok && type === 'DUPLICATES') void cache.revalidateItem(id);
                    return ok;
                });
            },
            /** "This item is blocked by `blockerId`": written from the blocker. */
            addBlockedBy(blockerId: string) {
                return optimistic<RelationsData>(
                    paths.relations,
                    (r) => r,
                    () => apiSend('POST', apiUrl(`${itemPaths(blockerId).relations}`), { type: 'BLOCKS', toId: id }),
                );
            },
            removeRelation(relationId: string) {
                removeWithUndo<RelationsData>(
                    paths.relations,
                    (r) => r && { outgoing: r.outgoing.filter((x) => x.id !== relationId), incoming: r.incoming.filter((x) => x.id !== relationId) },
                    t('relationRemoved'),
                    () => apiSend('DELETE', apiUrl(`${paths.relations}/${relationId}`)),
                );
            },

            // ── Links (URL links in 2.3) ──
            addLink(location: string, title: string | null) {
                return optimistic<LinkRow[]>(
                    paths.links,
                    (l) => l,
                    () => apiSend('POST', apiUrl(paths.links), { type: 'URL', location, title }),
                );
            },
            removeLink(linkId: string) {
                removeWithUndo<LinkRow[]>(
                    paths.links,
                    (l) => (l ?? []).filter((x) => x.id !== linkId),
                    t('linkRemoved'),
                    () => apiSend('DELETE', apiUrl(`${paths.links}/${linkId}`)),
                );
            },
        };
    }, [id, cache, apiUrl, toast, triggerUndo, t]);
}
