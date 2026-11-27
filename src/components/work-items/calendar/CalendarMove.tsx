'use client';

/**
 * Moving an item on the calendar (roadmap 3.3a; owner decision 241): one
 * path, 3.1c's, never a second date-change rule.
 *
 *   1. A chip dropped on another day names the new due date; "Move to
 *      date…" in the chip's menu (the keyboard path) asks for it with the
 *      product's date picker first.
 *   2. `ChangeDatesFromProject` (`../timeline/`, shared with the Workload
 *      page's "Move dates") reads the item's project's timeline, asks
 *      `editableRows` again and opens `ChangeDatesDialog` with the due date
 *      moved and the start date, if any, by the same number of days
 *      (`moveDueTo`); confirming sends what the timeline sends. The
 *      calendar's own read holds no relations, so it cannot preview a change.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { moveDueTo, type CalendarItem } from '@/lib/work-items/calendar';
import type { TimelineRow } from '@/lib/work-items/timeline';

import { ChangeDatesFromProject } from '../timeline/ChangeDatesFromProject';

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
    const toDue = request.toDue;
    return <ChangeDatesFromProject item={request.item} proposed={(row) => moveDueTo(row, toDue)} canEdit={canEdit} hiddenDates={hiddenDates} onDone={onDone} onOpen={onOpen} />;
}
