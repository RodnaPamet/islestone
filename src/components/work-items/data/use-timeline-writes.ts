'use client';

/**
 * The timeline's writes (roadmap 3.1c; ADR 0010 §6; owner decisions 194 and
 * 195), in the data folder like every other work-item write
 * (`tests/guards/work-item-views-shared-query.test.ts`):
 *
 *   - **One item's dates** (the confirmation unticked): `PATCH
 *     /work-items/:id { startDate, dueDate }` with `If-Match`, the write the
 *     detail makes, so its field-set, permission and audit rules are the
 *     API's. Optimistic over the cached timeline with rollback; the answer is
 *     placed in every mounted view (`applyRow`). A 409 shows "changed by
 *     someone else" and re-reads the timeline.
 *   - **With the items it pushes later** (ticked; decision 194): the new bars
 *     show at once and the write is held five seconds behind the undo toast,
 *     then sent from its action as `POST /work-items/bulk/dates`, each item's
 *     version in the body. Undo sends nothing and puts the bars back. Any
 *     refusal (a 409 when someone changed an item meanwhile) refuses the
 *     whole change: the timeline is read again and the reason shown.
 *   - **A dependency** (decision 195): added through the relation route
 *     (`POST /work-items/:id/relations { type: 'BLOCKS' }`), whose graph lock
 *     refuses a cycle; the caller shows the refusal. It appears only after
 *     the server accepts (the timeline is read again). Removing one goes
 *     through the undo toast (`DELETE …/relations/:relationId`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { useToast, useToastWithUndo } from '@/components/ui/hooks';
import { ApiClientError, apiSend } from '@/lib/data/api-client';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import { withEdge, withoutEdge, withRowDates, type TimelineEdge, type TimelineRow } from '@/lib/work-items/timeline';
import type { ItemDates, PushedItem } from '@/lib/work-items/reschedule';
import type { WorkItemDetailData } from '@/lib/work-items/types';

import { toRow } from './use-work-item-mutations';
import { useWorkItemCache } from './work-item-cache';

/** What a confirmation sends: the changed item and, when ticked, the items it pushes. */
export interface DateChangeRequest {
    row: TimelineRow;
    to: ItemDates;
    pushed: readonly PushedItem[];
}

export function useTimelineWrites() {
    const cache = useWorkItemCache();
    const apiUrl = useTenantApiUrl();
    const toast = useToast();
    const triggerUndo = useToastWithUndo();
    const t = useTranslations('workItems.toast');
    const tTimeline = useTranslations('workItems.timeline.change');

    return useMemo(() => {
        const reasonOf = (err: unknown) => {
            if (err instanceof ApiClientError && err.refusalReason === 'VERSION_CONFLICT') return t('conflict');
            return err instanceof ApiClientError && err.reason ? err.reason : t('failed');
        };
        const refused = (err: unknown) => {
            cache.revalidateTimelines();
            toast.error(reasonOf(err));
        };

        return {
            /** One item's dates (`PATCH`, `If-Match`): resolves `true` once the server has them. */
            async changeDates(row: TimelineRow, to: ItemDates): Promise<boolean> {
                cache.updateTimelines((current) => withRowDates(current, [{ id: row.id, ...to }]));
                try {
                    const saved = await apiSend<WorkItemDetailData>('PATCH', apiUrl(`/work-items/${row.id}`), { startDate: to.startDate, dueDate: to.dueDate }, { ifMatch: row.version });
                    cache.applyRow(toRow(saved), saved);
                    return true;
                } catch (err) {
                    refused(err);
                    return false;
                }
            },

            /**
             * The changed item and the items it pushes later (decision 194):
             * shown now, sent when the undo window closes.
             */
            reschedule({ row, to, pushed }: DateChangeRequest): void {
                const forward = [{ id: row.id, ...to }, ...pushed.map((p) => ({ id: p.id, ...p.to }))];
                const back = [{ id: row.id, startDate: row.startDate, dueDate: row.dueDate }, ...pushed.map((p) => ({ id: p.id, ...p.from }))];
                cache.updateTimelines((current) => withRowDates(current, forward));
                triggerUndo({
                    message: tTimeline('moving', { key: row.key, count: pushed.length }),
                    undoMessage: t('undo'),
                    action: () =>
                        apiSend<{ items: Array<{ id: string; version: number; startDate: string | null; dueDate: string | null }> }>('POST', apiUrl('/work-items/bulk/dates'), {
                            dragged: { id: row.id, version: row.version, startDate: to.startDate, dueDate: to.dueDate },
                            pushed: pushed.map((p) => ({ id: p.id, version: p.version, startDate: p.to.startDate, dueDate: p.to.dueDate })),
                        }),
                    undoAction: () => cache.updateTimelines((current) => withRowDates(current, back)),
                    onCommit: (result) => {
                        cache.updateTimelines((current) => withRowDates(current, result.items));
                        // Lists and details hold these rows too: read them again.
                        cache.revalidateLists();
                        for (const item of result.items) void cache.revalidateItem(item.id);
                    },
                    onError: refused,
                });
            },

            /** "ISL-1 blocks ISL-2": the relation route; a refusal (a cycle) is thrown for the caller to show. */
            async addDependency(fromId: string, toId: string): Promise<void> {
                await apiSend('POST', apiUrl(`/work-items/${fromId}/relations`), { type: 'BLOCKS', toId });
                cache.revalidateTimelines();
                void cache.revalidatePath(`/work-items/${fromId}/relations`);
                void cache.revalidatePath(`/work-items/${toId}/relations`);
            },

            /** Remove a dependency: it leaves the chart now and is deleted when the undo window closes. */
            removeDependency(edge: TimelineEdge, label: string): void {
                cache.updateTimelines((current) => withoutEdge(current, edge.id));
                triggerUndo({
                    message: tTimeline('dependencyRemoved', { label }),
                    undoMessage: t('undo'),
                    action: () => apiSend('DELETE', apiUrl(`/work-items/${edge.fromId}/relations/${edge.id}`)),
                    undoAction: () => cache.updateTimelines((current) => withEdge(current, edge)),
                    onCommit: () => {
                        cache.revalidateTimelines();
                        void cache.revalidatePath(`/work-items/${edge.fromId}/relations`);
                        void cache.revalidatePath(`/work-items/${edge.toId}/relations`);
                    },
                    onError: (err) => {
                        cache.updateTimelines((current) => withEdge(current, edge));
                        refused(err);
                    },
                });
            },
        };
    }, [cache, apiUrl, toast, triggerUndo, t, tTimeline]);
}
