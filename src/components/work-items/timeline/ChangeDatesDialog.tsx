'use client';

/**
 * "Change dates for ISL-123" (roadmap 3.1c; ADR 0010 §6; owner decisions
 * 194, 197, 201 and 203): the confirmation every change of dates on the
 * timeline goes through, from a dropped bar, the schedule table's date
 * pickers or the "No dates" list.
 *
 *   - The old and new start and due dates, the new ones editable with the
 *     product's date pickers (a date the item's type hides is shown, not
 *     offered).
 *   - The preview, from the engine re-run in the browser on the cached rows
 *     (`planDateChange`): items whose earliest start moves, items that become
 *     or stop being critical, and the conflicts the change brings. Each named
 *     item opens its sheet.
 *   - "Also move the N items it pushes later" (decision 194), unticked:
 *     disabled with the count above 100 items, never cut; the items it would
 *     move are listed with their new dates, and those it would not ("not
 *     moved: started") are named.
 *   - "Change dates" and "Cancel". A start after the due date cannot be
 *     confirmed (the server would refuse it with `START_AFTER_DUE`).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import type { TimelineResponse, TimelineRow } from '@/lib/work-items/timeline';
import { planDateChange, RESCHEDULE_MAX, type DatePlan, type ItemDates, type NamedItem, type PushedItem } from '@/lib/work-items/reschedule';

import { formatDay } from './TimelineScheduleTable';

export interface ChangeDatesConfirm {
    to: ItemDates;
    /** The items it pushes later, when the option is ticked; empty otherwise. */
    pushed: PushedItem[];
}

export interface ChangeDatesDialogProps {
    data: TimelineResponse;
    row: TimelineRow;
    /** The dates the drop proposed, or the row's own when the dialog was opened to edit them. */
    proposed: ItemDates;
    hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean };
    onCancel: () => void;
    onConfirm: (choice: ChangeDatesConfirm) => void;
    /** Open an item's sheet (the dialog closes first). */
    onOpen: (id: string) => void;
}

function ItemLink({ item, onOpen }: { item: NamedItem; onOpen: (id: string) => void }) {
    return (
        <button type="button" className="rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => onOpen(item.id)}>
            <span className="font-mono text-xs">{item.key}</span> {item.title}
        </button>
    );
}

function EffectsList({ plan, onOpen }: { plan: DatePlan; onOpen: (id: string) => void }) {
    const tEffects = useTranslations('workItems.timeline.change');
    const tConflict = useTranslations('workItems.timeline.conflict');
    const { moved, becameCritical, stoppedCritical, newConflicts } = plan.effects;
    if (moved.length + becameCritical.length + stoppedCritical.length + newConflicts.length === 0) {
        return <p className="text-sm text-content-muted">{tEffects('noEffect')}</p>;
    }
    const section = (heading: string, id: string, items: Array<{ item: NamedItem; extra?: string }>) =>
        items.length === 0 ? null : (
            <section aria-labelledby={id} className="space-y-tight">
                <h3 id={id} className="text-sm font-semibold text-content-emphasis">
                    {heading}
                </h3>
                <ul className="space-y-tight text-sm">
                    {items.map(({ item, extra }, i) => (
                        <li key={`${item.id}-${i}`} className="flex flex-wrap items-baseline gap-tight">
                            <ItemLink item={item} onOpen={onOpen} />
                            {extra && <span className="text-content-muted">{extra}</span>}
                        </li>
                    ))}
                </ul>
            </section>
        );
    return (
        <div className="space-y-default" data-testid="change-dates-effects">
            {section(
                tEffects('movedHeading'),
                'change-dates-moved',
                moved.map((m) => ({ item: m, extra: m.days >= 0 ? tEffects('movedLater', { days: m.days }) : tEffects('movedEarlier', { days: -m.days }) })),
            )}
            {section(tEffects('criticalHeading'), 'change-dates-critical', becameCritical.map((item) => ({ item })))}
            {section(tEffects('notCriticalHeading'), 'change-dates-not-critical', stoppedCritical.map((item) => ({ item })))}
            {section(tEffects('conflictsHeading'), 'change-dates-conflicts', newConflicts.map((c) => ({ item: c, extra: tConflict(c.conflict) })))}
        </div>
    );
}

export function ChangeDatesDialog({ data, row, proposed, hiddenDates, onCancel, onConfirm, onOpen }: ChangeDatesDialogProps) {
    const tDialog = useTranslations('workItems.timeline.change');
    const [startDate, setStartDate] = useState<string | null>(proposed.startDate);
    const [dueDate, setDueDate] = useState<string | null>(proposed.dueDate);
    const [alsoMove, setAlsoMove] = useState(false);
    const hidden = hiddenDates(row);
    const reversed = Boolean(startDate && dueDate && startDate > dueDate);
    const unchanged = startDate === row.startDate && dueDate === row.dueDate;

    const plan = useMemo(() => planDateChange(data, { id: row.id, startDate, dueDate }, { hiddenDates }), [data, row.id, startDate, dueDate, hiddenDates]);
    const push = plan.ok ? plan.push : null;
    const canPush = Boolean(push && push.items.length > 0 && !push.overLimit);

    const openItem = (id: string) => {
        onCancel();
        onOpen(id);
    };
    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (reversed || unchanged || !plan.ok) return;
        onConfirm({ to: { startDate, dueDate }, pushed: alsoMove && canPush ? push!.items : [] });
    };
    const range = (d: ItemDates) => `${d.startDate ? formatDay(d.startDate) : tDialog('noDate')} – ${d.dueDate ? formatDay(d.dueDate) : tDialog('noDate')}`;

    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onCancel();
            }}
            title={tDialog('title', { key: row.key })}
            onClose={onCancel}
        >
            <Modal.Header title={tDialog('title', { key: row.key })} description={row.title} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-section" data-testid="change-dates-dialog">
                        <p className="text-sm text-content-muted">
                            {tDialog('was', { dates: range({ startDate: row.startDate, dueDate: row.dueDate }) })}
                        </p>
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tDialog('start')} hint={hidden.startDate ? tDialog('hiddenDate') : undefined}>
                                <DatePicker id="change-dates-start" value={parseYMD(startDate)} onChange={(d) => setStartDate(toYMD(d))} disabled={hidden.startDate} clearable />
                            </FormField>
                            <FormField label={tDialog('due')} hint={hidden.dueDate ? tDialog('hiddenDate') : undefined}>
                                <DatePicker id="change-dates-due" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} disabled={hidden.dueDate} clearable />
                            </FormField>
                        </div>
                        {reversed && (
                            <p role="alert" className="text-sm text-content-error">
                                {tDialog('startAfterDue')}
                            </p>
                        )}
                        {!plan.ok ? (
                            <p role="alert" className="text-sm text-content-error">
                                {plan.error === 'CYCLE' ? tDialog('cycle') : tDialog('tooLarge')}
                            </p>
                        ) : unchanged ? (
                            <p className="text-sm text-content-muted">{tDialog('unchanged')}</p>
                        ) : (
                            <>
                                <EffectsList plan={plan} onOpen={openItem} />
                                {push && (push.items.length > 0 || push.notMoved.length > 0) && (
                                    <section aria-labelledby="change-dates-push-heading" className="space-y-tight rounded-md border border-border-subtle p-compact">
                                        <h3 id="change-dates-push-heading" className="sr-only">
                                            {tDialog('pushHeading')}
                                        </h3>
                                        {push.items.length > 0 && (
                                            <label htmlFor="change-dates-also-move" className="flex items-center gap-tight text-sm">
                                                <Checkbox id="change-dates-also-move" checked={alsoMove && canPush} disabled={!canPush} onCheckedChange={(c) => setAlsoMove(c === true)} />
                                                {tDialog('alsoMove', { count: push.items.length })}
                                            </label>
                                        )}
                                        {push.overLimit && (
                                            <p className="text-sm text-content-warning" data-testid="change-dates-over-limit">
                                                {tDialog('overLimit', { count: push.total, limit: RESCHEDULE_MAX })}
                                            </p>
                                        )}
                                        {push.items.length > 0 && !push.overLimit && (
                                            <ul className="space-y-tight text-sm" aria-label={tDialog('pushHeading')}>
                                                {push.items.map((p) => (
                                                    <li key={p.id} className="flex flex-wrap items-baseline gap-tight">
                                                        <ItemLink item={p} onOpen={openItem} />
                                                        <span className="text-content-muted">{tDialog('fromTo', { from: range(p.from), to: range(p.to) })}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {push.notMoved.length > 0 && (
                                            <ul className="space-y-tight text-sm" aria-label={tDialog('notMovedHeading')}>
                                                {push.notMoved.map((n) => (
                                                    <li key={n.id} className="flex flex-wrap items-baseline gap-tight">
                                                        <ItemLink item={n} onOpen={openItem} />
                                                        <span className="text-content-muted">{tDialog(`notMoved.${n.reason}`)}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>
                                )}
                            </>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tDialog('cancel')} onClick={onCancel} />
                        <Button id="change-dates-confirm" type="submit" variant="primary" text={tDialog('confirm')} disabled={reversed || unchanged || !plan.ok} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
