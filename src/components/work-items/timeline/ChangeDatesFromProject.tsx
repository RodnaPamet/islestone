'use client';

/**
 * Changing one item's dates from outside the timeline (roadmap 3.3a and 3.5c;
 * owner decisions 241 and 299): one path, 3.1c's, never a second date-change
 * rule. The calendar's drop and "Move to date…" and the Workload page's
 * "Move dates" open it with the dates they propose.
 *
 *   1. The item's project's timeline is read (`useWorkItemTimeline` with the
 *      project as its only filter, in the one cache): the engine's preview
 *      and "Also move the N items it pushes later" are computed over it in
 *      the browser, as on the timeline (decision 197). The project is the
 *      scope the item's chain lives in (a blocks relation to another project
 *      is one of the timeline's context rows).
 *   2. `editableRows` is asked again on that timeline (a parent whose dates
 *      follow its sub-items, or a row changed meanwhile, is refused with a
 *      sentence), then `ChangeDatesDialog` opens with the proposed dates.
 *   3. Confirming sends what the timeline sends (`useTimelineWrites`): the
 *      versioned `PATCH` with `If-Match`, or the bulk change of dates held
 *      behind the undo toast. Both place the new dates in every mounted
 *      calendar and timeline, and re-read every mounted workload.
 *
 * A project above the timeline's 5,000 items cannot be previewed: the dialog
 * says so and offers the item instead of a change without a preview.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { resolveFieldSet } from '@/lib/work-items/field-sets';
import type { ItemDates } from '@/lib/work-items/reschedule';
import type { TimelineRow } from '@/lib/work-items/timeline';

import { useTimelineWrites } from '../data/use-timeline-writes';
import { useWorkConfig } from '../data/use-work-config';
import { useWorkItemTimeline } from '../data/use-work-item-timeline';
import { ChangeDatesDialog, type ChangeDatesConfirm } from './ChangeDatesDialog';
import { editableRows } from './timeline-model';

/** The item whose dates change, as the caller holds it. */
export interface ChangeDatesItem {
    id: string;
    key: string;
    title: string;
    projectId: string;
}

/** A type's start and due date rules (2.4b-b: built-in rules are the type's across the workspace). */
export function useHiddenDates(): (row: TimelineRow) => { startDate: boolean; dueDate: boolean } {
    const config = useWorkConfig();
    return useMemo(() => {
        const of = (typeId: string) => {
            const set = resolveFieldSet(config.fieldSetEntries, typeId);
            return { startDate: set.builtIn.startDate === 'HIDDEN', dueDate: set.builtIn.dueDate === 'HIDDEN' };
        };
        const byType = new Map((config.types ?? []).map((t) => [t.id, of(t.id)] as const));
        return (row: TimelineRow) => byType.get(row.typeId) ?? of(row.typeId);
    }, [config.fieldSetEntries, config.types]);
}

function StatusDialog({ item, children, onClose, onOpen }: { item: ChangeDatesItem; children: React.ReactNode; onClose: () => void; onOpen?: () => void }) {
    const tStatus = useTranslations('workItems.timeline.fromProject');
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onClose();
            }}
            title={tStatus('changeTitle', { key: item.key })}
            onClose={onClose}
        >
            <Modal.Header title={tStatus('changeTitle', { key: item.key })} description={item.title} />
            <Modal.Body>
                <div role="status" className="text-sm text-content-muted" data-testid="change-dates-status">
                    {children}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Modal.Actions>
                    {onOpen && <Button type="button" variant="secondary" text={tStatus('openItem')} onClick={onOpen} />}
                    <Button type="button" variant="primary" text={tStatus('close')} onClick={onClose} />
                </Modal.Actions>
            </Modal.Footer>
        </Modal>
    );
}

export function ChangeDatesFromProject({
    item,
    proposed,
    canEdit,
    hiddenDates,
    onDone,
    onOpen,
}: {
    item: ChangeDatesItem;
    /** The dates proposed for the item's row as the timeline holds it. */
    proposed: (row: TimelineRow) => ItemDates;
    canEdit: boolean;
    hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean };
    onDone: () => void;
    onOpen: (id: string) => void;
}) {
    const tChange = useTranslations('workItems.timeline.fromProject');
    const filters = useMemo(() => ({ projectId: item.projectId }), [item.projectId]);
    const timeline = useWorkItemTimeline(filters);
    const writes = useTimelineWrites();
    const data = timeline.data;
    const row = data?.rows.find((r) => r.id === item.id && !r.context);
    const editable = useMemo(() => (data ? editableRows(data, { canEdit, hiddenDates }) : null), [data, canEdit, hiddenDates]);
    const openItem = () => {
        onDone();
        onOpen(item.id);
    };

    if (timeline.tooLarge) {
        return (
            <StatusDialog item={item} onClose={onDone} onOpen={openItem}>
                {tChange('tooLarge', { count: timeline.tooLarge.count, limit: timeline.tooLarge.limit })}
            </StatusDialog>
        );
    }
    if (timeline.error) {
        return (
            <StatusDialog item={item} onClose={onDone}>
                {tChange('loadFailed')}
            </StatusDialog>
        );
    }
    if (!data || !editable) {
        return (
            <StatusDialog item={item} onClose={onDone}>
                {tChange('loading', { key: item.key })}
            </StatusDialog>
        );
    }
    if (!row || !editable.dates.has(row.id)) {
        const summary = data.schedule.ok && data.schedule.items.some((i) => i.id === item.id && i.summary);
        return (
            <StatusDialog item={item} onClose={onDone} onOpen={openItem}>
                {summary ? tChange('summaryRow', { key: item.key }) : tChange('notHere', { key: item.key })}
            </StatusDialog>
        );
    }
    const confirm = (choice: ChangeDatesConfirm) => {
        onDone();
        if (choice.pushed.length > 0) writes.reschedule({ row, to: choice.to, pushed: choice.pushed });
        else void writes.changeDates(row, choice.to);
    };
    return (
        <ChangeDatesDialog
            data={data}
            row={row}
            proposed={proposed(row)}
            hiddenDates={hiddenDates}
            onCancel={onDone}
            onConfirm={confirm}
            onOpen={(id) => {
                onDone();
                onOpen(id);
            }}
        />
    );
}
