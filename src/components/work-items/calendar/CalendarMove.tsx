'use client';

/**
 * Moving an item on the calendar (roadmap 3.3a; owner decision 241): one
 * path, 3.1c's, never a second date-change rule.
 *
 *   1. A chip dropped on another day names the new due date; "Move to
 *      date…" in the chip's menu (the keyboard path) asks for it with the
 *      product's date picker first.
 *   2. The item's project's timeline is read (`useWorkItemTimeline` with the
 *      project as its only filter, in the one cache): the engine's preview
 *      and "Also move the N items it pushes later" are computed over it in
 *      the browser, as on the timeline (decision 197). The calendar's own
 *      read holds no relations, so it cannot preview a change; the project is
 *      the scope the item's chain lives in (a blocks relation to another
 *      project is one of the timeline's context rows).
 *   3. `editableRows` is asked again on that timeline (a parent whose dates
 *      follow its sub-items, or a row changed meanwhile, is refused with a
 *      sentence), then `ChangeDatesDialog` opens with the due date moved and
 *      the start date, if any, by the same number of days (`moveDueTo`).
 *   4. Confirming sends what the timeline sends (`useTimelineWrites`): the
 *      versioned `PATCH` with `If-Match`, or the bulk change of dates held
 *      behind the undo toast. Both place the new dates in every mounted
 *      calendar and timeline.
 *
 * A project above the timeline's 5,000 items cannot be previewed: the dialog
 * says so and offers the item instead of a change without a preview.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { moveDueTo, type CalendarItem } from '@/lib/work-items/calendar';
import type { TimelineRow } from '@/lib/work-items/timeline';

import { useTimelineWrites } from '../data/use-timeline-writes';
import { useWorkItemTimeline } from '../data/use-work-item-timeline';
import { ChangeDatesDialog, type ChangeDatesConfirm } from '../timeline/ChangeDatesDialog';
import { editableRows } from '../timeline/timeline-model';

export interface CalendarMoveRequest {
    item: CalendarItem;
    /** The day it was dropped on; `null` from "Move to date…" until the person picks one. */
    toDue: string | null;
}

function MoveToDateDialog({ item, onCancel, onContinue }: { item: CalendarItem; onCancel: () => void; onContinue: (ymd: string) => void }) {
    const tMove = useTranslations('workItems.calendar.move');
    const [day, setDay] = useState<string | null>(item.dueDate);
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (day && day !== item.dueDate) onContinue(day);
    };
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onCancel();
            }}
            title={tMove('title', { key: item.key })}
            onClose={onCancel}
        >
            <Modal.Header title={tMove('title', { key: item.key })} description={item.title} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <FormField label={tMove('date')} hint={tMove('hint')}>
                        <DatePicker id="calendar-move-date" value={parseYMD(day)} onChange={(d) => setDay(toYMD(d))} />
                    </FormField>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tMove('cancel')} onClick={onCancel} />
                        <Button id="calendar-move-continue" type="submit" variant="primary" text={tMove('continue')} disabled={!day || day === item.dueDate} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}

function StatusDialog({ item, children, onClose, onOpen }: { item: CalendarItem; children: React.ReactNode; onClose: () => void; onOpen?: () => void }) {
    const tStatus = useTranslations('workItems.calendar.move');
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
                <div role="status" className="text-sm text-content-muted" data-testid="calendar-move-status">
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

function ChangeFromProject({
    item,
    toDue,
    canEdit,
    hiddenDates,
    onDone,
    onOpen,
}: {
    item: CalendarItem;
    toDue: string;
    canEdit: boolean;
    hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean };
    onDone: () => void;
    onOpen: (id: string) => void;
}) {
    const tChange = useTranslations('workItems.calendar.move');
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
            proposed={moveDueTo(row, toDue)}
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

export function CalendarMove({
    request,
    canEdit,
    hiddenDates,
    onDone,
    onOpen,
    onPick,
}: {
    request: CalendarMoveRequest;
    canEdit: boolean;
    hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean };
    onDone: () => void;
    onOpen: (id: string) => void;
    /** "Move to date…" chose a day. */
    onPick: (ymd: string) => void;
}) {
    if (request.toDue === null) return <MoveToDateDialog item={request.item} onCancel={onDone} onContinue={onPick} />;
    return <ChangeFromProject item={request.item} toDue={request.toDue} canEdit={canEdit} hiddenDates={hiddenDates} onDone={onDone} onOpen={onOpen} />;
}
