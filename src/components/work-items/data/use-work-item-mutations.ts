'use client';

/**
 * Every work-item write the views make, each optimistic with rollback
 * (ADR 0005 §2):
 *
 *   1. the change is applied to every view at once (`useWorkItemCache`);
 *   2. the request goes out, with `If-Match` naming the version the person
 *      saw for every versioned write (ADR 0002 §9);
 *   3. on success the server's row replaces the optimistic one, so the
 *      server's `sortKey` and `version` win;
 *   4. on a 409 `VERSION_CONFLICT`, the write is retried once with the current
 *      version when none of the fields it changes moved on the server;
 *      otherwise the item is re-read, every view shows the server's row, and
 *      the person is told the item changed;
 *   5. on any other refusal the previous row is put back everywhere and the
 *      server's reason is shown.
 *
 * Writes for one item are serialised (ADR 0005 §3: a per-item queue), so two
 * quick edits never conflict with each other.
 *
 * Destructive verbs (delete, and the bulk delete) go through the undo toast:
 * the row leaves every view at once, and the request is sent only when the
 * undo window closes.
 *
 * Written fresh for Islestone (sub-phase 2.3); the shape of the bulk
 * rollback and the partial-success toast follows inflect-compliance's tasks
 * client (`TasksClient.tsx` lines 668–856 at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e).
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { CustomFieldValueData } from '@/lib/work-items/custom-fields';
import type { WorkItemDetailData, WorkItemRow, WorkflowStateCategory } from '@/lib/work-items/types';

import { useWorkConfig, type WorkConfigIndex } from './use-work-config';
import { useWorkItemCache, type WorkItemCache } from './work-item-cache';

/** The row fields of a detail (or a row) answer. */
export function toRow(item: WorkItemRow): WorkItemRow {
    return {
        id: item.id,
        key: item.key,
        number: item.number,
        title: item.title,
        projectId: item.projectId,
        teamId: item.teamId,
        typeId: item.typeId,
        stateId: item.stateId,
        stateCategory: item.stateCategory,
        priority: item.priority,
        assigneeId: item.assigneeId,
        createdByUserId: item.createdByUserId,
        parentId: item.parentId,
        sortKey: item.sortKey,
        startDate: item.startDate,
        dueDate: item.dueDate,
        version: item.version,
        labelIds: item.labelIds,
        customFields: item.customFields ?? {},
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
    };
}

/** The detail fields a row change implies (the state's name, the labels). */
export function detailExtrasFor(config: WorkConfigIndex, row: WorkItemRow): Partial<WorkItemDetailData> {
    const state = config.stateById.get(row.stateId);
    return {
        ...(state ? { state: { id: state.id, name: state.name, category: state.category } } : {}),
        labels: row.labelIds.flatMap((id) => {
            const label = config.labelById.get(id);
            return label ? [{ id: label.id, name: label.name, color: label.color }] : [];
        }),
    };
}

// ─── Per-item write queue (ADR 0005 §3) ───────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

/** Run `task` after every earlier write for the same item settles. */
export function enqueueItemWrite<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    queues.set(id, tail);
    void tail.then(() => {
        if (queues.get(id) === tail) queues.delete(id);
    });
    return next;
}

function sameValue(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

export interface ConflictDetails {
    version: number;
    item: WorkItemRow;
}

export function conflictOf(err: unknown): ConflictDetails | null {
    if (!(err instanceof ApiClientError) || err.status !== 409 || err.refusalReason !== 'VERSION_CONFLICT') return null;
    const d = err.details as Partial<ConflictDetails> | undefined;
    if (!d || typeof d.version !== 'number' || !d.item) return null;
    return { version: d.version, item: d.item };
}

/**
 * The one versioned write path. `fields` are the row fields this write
 * changes; `send(version)` performs the request with that `If-Match`.
 */
async function versionedWrite(
    cache: WorkItemCache,
    config: WorkConfigIndex,
    messages: { conflict: string; failed: string },
    notify: (message: string) => void,
    before: WorkItemRow,
    fields: Partial<WorkItemRow>,
    send: (version: number) => Promise<WorkItemDetailData>,
    canRetry = true,
): Promise<WorkItemDetailData | null> {
    const optimistic = { ...before, ...fields };
    cache.applyRow(optimistic, detailExtrasFor(config, optimistic));
    return enqueueItemWrite(before.id, async () => {
        let version = before.version;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const saved = await send(version);
                cache.applyRow(toRow(saved), saved);
                return saved;
            } catch (err) {
                const conflict = conflictOf(err);
                if (conflict) {
                    const untouched = (Object.keys(fields) as Array<keyof WorkItemRow>).every((k) =>
                        sameValue(conflict.item[k], before[k]),
                    );
                    if (canRetry && untouched && attempt === 0) {
                        version = conflict.version;
                        continue;
                    }
                    // A real conflict: show the server's row everywhere and say so.
                    cache.applyRow(conflict.item, detailExtrasFor(config, conflict.item));
                    void cache.revalidateItem(before.id);
                    notify(messages.conflict);
                    return null;
                }
                cache.applyRow(before, detailExtrasFor(config, before));
                void cache.revalidateItem(before.id);
                notify(err instanceof ApiClientError && err.reason ? err.reason : messages.failed);
                return null;
            }
        }
        return null;
    });
}

export interface BoardMove {
    stateId: string;
    afterId?: string;
    beforeId?: string;
    /** The client's key between the neighbours; the server's wins on answer. */
    sortKey?: string;
}

export interface BulkResult {
    count: number;
    results: Array<{ id: string; status: 'ok' | 'not_found' }>;
}

export function useWorkItemMutations() {
    const cache = useWorkItemCache();
    const config = useWorkConfig();
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.toast');

    return useMemo(() => {
        const notify = (message: string) => {
            toast.error(message);
        };
        const messages = { conflict: t('conflict'), failed: t('failed') };
        const url = (path: string) => apiUrl(path);
        const write = (
            before: WorkItemRow,
            fields: Partial<WorkItemRow>,
            send: (version: number) => Promise<WorkItemDetailData>,
            canRetry = true,
        ) => versionedWrite(cache, config, messages, notify, before, fields, send, canRetry);
        const reason = (err: unknown) => (err instanceof ApiClientError && err.reason ? err.reason : t('failed'));

        return {
            /** Edit title, description, priority, type or dates (`PATCH`, `If-Match`). */
            updateFields(item: WorkItemRow, patch: Partial<Pick<WorkItemRow, 'title' | 'priority' | 'typeId' | 'dueDate' | 'startDate'>> & { description?: string | null }) {
                const { description, ...rowFields } = patch;
                // A description edit is never retried on its own: the conflict
                // answer carries no description, so the client cannot tell
                // whether someone else changed it.
                return write(
                    item,
                    rowFields,
                    (version) => apiSend<WorkItemDetailData>('PATCH', url(`/work-items/${item.id}`), patch, { ifMatch: version }),
                    description === undefined,
                ).then((saved) => {
                    if (saved && description !== undefined) void cache.revalidateItem(item.id);
                    return saved;
                });
            },

            /** Move to another state of the item's team (`If-Match`). */
            setState(item: WorkItemRow, stateId: string) {
                const state = config.stateById.get(stateId);
                const fields: Partial<WorkItemRow> = { stateId, ...(state ? { stateCategory: state.category } : {}) };
                return write(item, fields, (version) =>
                    apiSend<WorkItemDetailData>('POST', url(`/work-items/${item.id}/state`), { stateId }, { ifMatch: version }),
                );
            },

            /**
             * Set or clear one custom field (2.4): `PUT …/custom-fields/:id`
             * with `If-Match`, optimistic over the row's `customFields`.
             * `null` (or an empty list) clears.
             */
            setCustomField(item: WorkItemRow, fieldId: string, value: CustomFieldValueData | null) {
                const next = { ...(item.customFields ?? {}) };
                const empty = value === null || value === false || (Array.isArray(value) && value.length === 0) || value === '';
                if (empty) delete next[fieldId];
                else next[fieldId] = value;
                return write(item, { customFields: next }, (version) =>
                    apiSend<WorkItemDetailData>('PUT', url(`/work-items/${item.id}/custom-fields/${fieldId}`), { value: empty ? null : value }, { ifMatch: version }),
                );
            },

            /** Assign or clear (`If-Match`). */
            assign(item: WorkItemRow, assigneeId: string | null) {
                return write(item, { assigneeId }, (version) =>
                    apiSend<WorkItemDetailData>('POST', url(`/work-items/${item.id}/assign`), { assigneeId }, { ifMatch: version }),
                );
            },

            /**
             * A board drop: the state and the place among the column's
             * neighbours, in one request (`POST /move`). A refused move (an
             * archived state, another team's state) rolls back with the
             * server's reason.
             */
            moveOnBoard(item: WorkItemRow, move: BoardMove) {
                const state = config.stateById.get(move.stateId);
                const fields: Partial<WorkItemRow> = {
                    stateId: move.stateId,
                    ...(state ? { stateCategory: state.category } : {}),
                    ...(move.sortKey ? { sortKey: move.sortKey } : {}),
                };
                const position = move.afterId ? { afterId: move.afterId } : move.beforeId ? { beforeId: move.beforeId } : undefined;
                return write(item, fields, (version) =>
                    apiSend<WorkItemDetailData>(
                        'POST',
                        url(`/work-items/${item.id}/move`),
                        { stateId: move.stateId, ...(position ? { position } : {}) },
                        { ifMatch: version },
                    ),
                );
            },

            /** Delete with undo: the row leaves every view now, the request goes when the window closes. */
            remove(item: WorkItemRow, onDeleted?: () => void) {
                cache.removeRow(item.id);
                onDeleted?.();
                triggerUndo({
                    message: t('deleted', { key: item.key }),
                    undoMessage: t('undo'),
                    action: () => apiSend('DELETE', url(`/work-items/${item.id}`)),
                    undoAction: () => cache.applyRow(item),
                    onCommit: () => cache.revalidateLists(),
                    onError: (err) => {
                        cache.applyRow(item);
                        notify(reason(err));
                    },
                });
            },

            /** Restore a deleted item (and its deletion group) from the Deleted view. */
            async restore(item: WorkItemRow) {
                try {
                    await apiSend('POST', url(`/work-items/${item.id}/restore`));
                    cache.revalidateLists();
                    void cache.revalidatePath('/work-items/deleted');
                    toast.success(t('restored', { key: item.key }));
                    return true;
                } catch (err) {
                    notify(reason(err));
                    return false;
                }
            },

            /** Bulk state (a state of one team, or a category across teams). */
            async bulkState(items: WorkItemRow[], target: { stateId: string } | { stateCategory: WorkflowStateCategory }) {
                const planned = items.map((item) => {
                    const state =
                        'stateId' in target ? config.stateById.get(target.stateId) : config.defaultStateOf(item.teamId, target.stateCategory);
                    return { item, next: state ? { ...item, stateId: state.id, stateCategory: state.category } : item };
                });
                for (const p of planned) cache.applyRow(p.next, detailExtrasFor(config, p.next));
                return bulkSend(planned.map((p) => p.item), 'state', { ...target });
            },

            async bulkAssign(items: WorkItemRow[], assigneeId: string | null) {
                for (const item of items) cache.applyRow({ ...item, assigneeId });
                return bulkSend(items, 'assign', { assigneeId });
            },

            /** Bulk delete with undo. */
            bulkRemove(items: WorkItemRow[]) {
                for (const item of items) cache.removeRow(item.id);
                triggerUndo({
                    message: t('bulkDeleted', { count: items.length }),
                    undoMessage: t('undo'),
                    action: () => apiSend<BulkResult>('POST', url('/work-items/bulk/delete'), { workItemIds: items.map((i) => i.id) }),
                    undoAction: () => {
                        for (const item of items) cache.applyRow(item);
                    },
                    onCommit: () => cache.revalidateLists(),
                    onError: (err) => {
                        for (const item of items) cache.applyRow(item);
                        notify(reason(err));
                    },
                });
            },

            /** Create; the new row appears in every list it matches when the server answers. */
            async create(body: Record<string, unknown>): Promise<WorkItemDetailData | ApiClientError> {
                try {
                    const created = await apiSend<WorkItemDetailData>('POST', url('/work-items'), body);
                    cache.applyRow(toRow(created), created);
                    cache.revalidateLists();
                    return created;
                } catch (err) {
                    return err instanceof ApiClientError ? err : new ApiClientError(t('failed'), 'UNKNOWN', 0);
                }
            },
        };

        async function bulkSend(items: WorkItemRow[], verb: 'state' | 'assign', body: Record<string, unknown>) {
            try {
                const result = await apiSend<BulkResult>('POST', url(`/work-items/bulk/${verb}`), {
                    workItemIds: items.map((i) => i.id),
                    ...body,
                });
                const failed = new Set(result.results.filter((r) => r.status !== 'ok').map((r) => r.id));
                for (const item of items) if (failed.has(item.id)) cache.applyRow(item);
                if (failed.size > 0) toast.warning(t('bulkPartial', { done: result.count, total: items.length }));
                cache.revalidateLists();
                return result;
            } catch (err) {
                for (const item of items) cache.applyRow(item, detailExtrasFor(config, item));
                notify(reason(err));
                return null;
            }
        }
    }, [cache, config, apiUrl, toast, triggerUndo, t]);
}

export type WorkItemMutations = ReturnType<typeof useWorkItemMutations>;
