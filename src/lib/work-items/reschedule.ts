/**
 * Changing dates from the timeline (roadmap 3.1c; ADR 0010 §6; owner
 * decisions 194, 197 and 201): what a drop proposes, and what the "Change
 * dates" confirmation previews, computed in the browser with the scheduling
 * engine the server runs (`computeTimelineSchedule`, no second pass).
 * Client-safe and pure: no clock, no zone, no request.
 *
 *   - **The proposed dates** ({@link proposeDates}). A move keeps the item's
 *     working-day duration on its own calendar: the new start snaps forward
 *     to a working day and the due date is the duration's last working day
 *     from it. A resize changes the one date it drags, snapped to a working
 *     day and never past the other date.
 *   - **The effects** ({@link planDateChange}): the items whose earliest
 *     start moves (by how many working days), those that become or stop being
 *     critical, and the conflicts the change brings.
 *   - **"Also move the N items it pushes later"** (decision 194): the items
 *     downstream of the changed one through the timeline's blocks relations
 *     (context rows included) that are open and not started, have a date,
 *     sit in an unarchived project and whose type shows the dates they carry,
 *     and whose planned start the change would put before a blocker's finish
 *     (`STARTS_BEFORE_BLOCKER_FINISHES` that the change brings or worsens).
 *     Each moves LATER only, to its earliest start, keeping its working-day
 *     duration (an item with only a due date moves it to its earliest
 *     finish); the engine is re-run until nothing more moves, so a chain
 *     moves together. Items the change would let start earlier are never
 *     pulled. Started, undated, hidden-date, reversed and archived items are
 *     named, never moved. At most {@link RESCHEDULE_MAX} items with the
 *     changed one: above it the option is refused with the count, never cut.
 *
 * Written fresh for Islestone.
 */
import {
    addWorkingDays,
    compileCalendar,
    fromEpochDay,
    nextWorkingDay,
    previousWorkingDay,
    toEpochDay,
    workingDayDiff,
    workingDaysInclusive,
    type CompiledCalendar,
} from '@/app-layer/domain/schedule/calendar';
import type { ItemSchedule, ScheduleConflict } from '@/app-layer/domain/schedule/types';

import { withRowDates, type TimelineResponse, type TimelineRow } from './timeline';

/** At most this many items change in one confirmation, the dragged one included (decision 194; `BULK_MAX`). */
export const RESCHEDULE_MAX = 100;

/** How a bar was dragged: moved whole, or one end resized. */
export type DropMode = 'move' | 'start' | 'end';

export interface ItemDates {
    startDate: string | null;
    dueDate: string | null;
}

/** The dates a drop proposes (step 2 of the map): `days` is the drag in calendar days, as the widget reports it. */
export function proposeDates(row: ItemDates, calendar: CompiledCalendar, mode: DropMode, days: number): ItemDates {
    const start = row.startDate ? toEpochDay(row.startDate) : null;
    const due = row.dueDate ? toEpochDay(row.dueDate) : null;
    if (mode === 'move') {
        if (start !== null && due !== null && start <= due) {
            const duration = Math.max(1, workingDaysInclusive(calendar, start, due));
            const newStart = nextWorkingDay(calendar, start + days);
            return { startDate: fromEpochDay(newStart), dueDate: fromEpochDay(addWorkingDays(calendar, newStart, duration - 1)) };
        }
        return {
            startDate: start === null ? null : fromEpochDay(nextWorkingDay(calendar, start + days)),
            dueDate: due === null ? null : fromEpochDay(nextWorkingDay(calendar, due + days)),
        };
    }
    // A resize: the bar of a one-date item spans that date, so either end is it.
    const anchor = start ?? due;
    if (anchor === null) return row;
    if (mode === 'start') {
        const end = due ?? anchor;
        let newStart = nextWorkingDay(calendar, (start ?? anchor) + days);
        if (newStart > end) newStart = end;
        return { startDate: fromEpochDay(newStart), dueDate: row.dueDate };
    }
    const first = start ?? anchor;
    let newDue = previousWorkingDay(calendar, (due ?? anchor) + days);
    if (newDue < first) newDue = first;
    return { startDate: row.startDate, dueDate: fromEpochDay(newDue) };
}

/** A row the confirmation names, with a link to its sheet. */
export interface NamedItem {
    id: string;
    key: string;
    title: string;
}

export type NotMovedReason = 'started' | 'undated' | 'hidden' | 'archived' | 'reversed';

export interface PushedItem extends NamedItem {
    version: number;
    from: ItemDates;
    to: ItemDates;
}

export interface DatePlanEffects {
    /** Other items whose earliest start moves, by working days on their own calendar (positive: later). */
    moved: Array<NamedItem & { days: number }>;
    becameCritical: NamedItem[];
    stoppedCritical: NamedItem[];
    /** Conflicts the change brings (a blocker finishing after its successor starts, a missed due date). */
    newConflicts: Array<NamedItem & { conflict: ScheduleConflict }>;
}

export interface DatePlan {
    ok: true;
    /** The timeline with the change alone (the preview, and what an unticked confirmation places). */
    after: TimelineResponse;
    effects: DatePlanEffects;
    push: {
        /** The items that would move, in key order; empty when nothing is pushed. */
        items: PushedItem[];
        notMoved: Array<NamedItem & { reason: NotMovedReason }>;
        /** The items one confirmation would change: the changed one and the pushed ones. */
        total: number;
        /** More than {@link RESCHEDULE_MAX}: the option is refused, never cut. */
        overLimit: boolean;
        /** The timeline with the change and every push (what a ticked confirmation places). */
        withPushes: TimelineResponse;
    };
}

export type DatePlanResult = DatePlan | { ok: false; error: 'CYCLE' | 'TOO_LARGE' };

export interface PlanOptions {
    /** Whether a row's type hides its start or due date (its field set, read on the server). */
    hiddenDates: (row: TimelineRow) => { startDate: boolean; dueDate: boolean };
}

const STARTS_BEFORE = 'STARTS_BEFORE_BLOCKER_FINISHES' satisfies ScheduleConflict;
/** Bounded: a chain of 5,000 items settles long before this; a cycle never reaches here (the engine refuses one). */
const MAX_ROUNDS = 1_000;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const named = (r: TimelineRow): NamedItem => ({ id: r.id, key: r.key, title: r.title });

function scheduleMap(t: TimelineResponse): Map<string, ItemSchedule> | null {
    return t.schedule.ok ? new Map(t.schedule.items.map((i) => [i.id, i])) : null;
}

/** Every item the changed one reaches through the timeline's blocks relations, itself excluded. */
export function downstreamOf(data: Pick<TimelineResponse, 'edges'>, id: string): Set<string> {
    const next = new Map<string, string[]>();
    for (const e of data.edges) next.set(e.fromId, [...(next.get(e.fromId) ?? []), e.toId]);
    const seen = new Set<string>();
    const stack = [...(next.get(id) ?? [])];
    while (stack.length > 0) {
        const at = stack.pop()!;
        if (at === id || seen.has(at)) continue;
        seen.add(at);
        stack.push(...(next.get(at) ?? []));
    }
    return seen;
}

function calendarsOf(data: TimelineResponse): Map<string, CompiledCalendar> {
    return new Map(
        data.calendars.map((c) => [c.id, compileCalendar({ id: c.id, workingWeekdays: c.workingWeekdays, holidays: c.holidays.map((h) => toEpochDay(h)) })]),
    );
}

/** The confirmation's preview for new dates on one row: its effects and the items it would push later. */
export function planDateChange(data: TimelineResponse, change: { id: string } & ItemDates, options: PlanOptions): DatePlanResult {
    if (!data.schedule.ok) return { ok: false, error: data.schedule.error };
    const after = withRowDates(data, [{ id: change.id, startDate: change.startDate, dueDate: change.dueDate }]);
    if (!after.schedule.ok) return { ok: false, error: after.schedule.error };
    const before = scheduleMap(data)!;
    const afterMap = scheduleMap(after)!;
    const rows = new Map(data.rows.map((r) => [r.id, r]));
    const calendars = calendarsOf(data);
    const projects = new Map(data.projects.map((p) => [p.id, p]));
    const byKey = (a: NamedItem, b: NamedItem) => compareText(a.key, b.key) || compareText(a.id, b.id);

    // ── The effects of the change alone ──
    const effects: DatePlanEffects = { moved: [], becameCritical: [], stoppedCritical: [], newConflicts: [] };
    for (const [id, a] of afterMap) {
        const b = before.get(id);
        const row = rows.get(id);
        if (!b || !row || a.summary) continue;
        const cal = calendars.get(row.calendarId);
        if (id !== change.id && !a.unscheduled && a.earliestStart !== b.earliestStart && cal) {
            effects.moved.push({ ...named(row), days: workingDayDiff(cal, b.earliestStart, a.earliestStart) });
        }
        if (a.critical && !b.critical) effects.becameCritical.push(named(row));
        if (!a.critical && b.critical) effects.stoppedCritical.push(named(row));
        for (const conflict of a.conflicts) if (!b.conflicts.includes(conflict)) effects.newConflicts.push({ ...named(row), conflict });
    }
    effects.moved.sort(byKey);
    effects.becameCritical.sort(byKey);
    effects.stoppedCritical.sort(byKey);
    effects.newConflicts.sort((x, y) => byKey(x, y) || compareText(x.conflict, y.conflict));

    // ── The items it pushes later (decision 194) ──
    const downstream = [...downstreamOf(data, change.id)].sort(compareText);
    /** Did the change bring (or worsen) this item's start before a blocker's finish? */
    const pushedByChange = (id: string, s: ItemSchedule): boolean => {
        if (!s.conflicts.includes(STARTS_BEFORE)) return false;
        const b = before.get(id);
        return !b || !b.conflicts.includes(STARTS_BEFORE) || s.earliestStart > b.earliestStart;
    };
    const pushed = new Map<string, PushedItem>();
    const notMoved = new Map<string, NotMovedReason>();
    let current = after;
    for (let round = 0; round < MAX_ROUNDS; round++) {
        const sched = scheduleMap(current);
        if (!sched) break;
        const currentRows = new Map(current.rows.map((r) => [r.id, r]));
        const changes: Array<{ id: string } & ItemDates> = [];
        for (const id of downstream) {
            const row = currentRows.get(id);
            const s = sched.get(id);
            if (!row || !s || s.summary) continue;
            const original = rows.get(id)!;
            if (row.stateCategory === 'STARTED') {
                if (pushedByChange(id, s)) notMoved.set(id, 'started');
                continue;
            }
            if (row.stateCategory !== 'BACKLOG' && row.stateCategory !== 'UNSTARTED') continue;
            if (!row.startDate && !row.dueDate) {
                const b = before.get(id);
                if (b && s.earliestStart > b.earliestStart) notMoved.set(id, 'undated');
                continue;
            }
            if (!pushedByChange(id, s)) continue;
            const hidden = options.hiddenDates(original);
            if ((row.startDate && hidden.startDate) || (row.dueDate && hidden.dueDate)) {
                notMoved.set(id, 'hidden');
                continue;
            }
            if (projects.get(row.projectId)?.archived) {
                notMoved.set(id, 'archived');
                continue;
            }
            if (row.startDate && row.dueDate && row.startDate > row.dueDate) {
                notMoved.set(id, 'reversed');
                continue;
            }
            const cal = calendars.get(row.calendarId);
            if (!cal) continue;
            let to: ItemDates;
            if (row.startDate) {
                const start = Math.max(toEpochDay(row.startDate), s.earliestStart);
                const due = row.dueDate ? Math.max(toEpochDay(row.dueDate), addWorkingDays(cal, start, Math.max(1, s.durationDays) - 1)) : null;
                to = { startDate: fromEpochDay(start), dueDate: due === null ? null : fromEpochDay(due) };
            } else {
                to = { startDate: null, dueDate: fromEpochDay(Math.max(toEpochDay(row.dueDate!), s.earliestFinish)) };
            }
            if (to.startDate === row.startDate && to.dueDate === row.dueDate) continue;
            changes.push({ id, ...to });
            pushed.set(id, { ...named(original), version: original.version, from: { startDate: original.startDate, dueDate: original.dueDate }, to });
        }
        if (changes.length === 0) break;
        current = withRowDates(current, changes);
    }
    for (const id of pushed.keys()) notMoved.delete(id);

    const items = [...pushed.values()].sort(byKey);
    const total = items.length + 1;
    return {
        ok: true,
        after,
        effects,
        push: {
            items,
            notMoved: [...notMoved].map(([id, reason]) => ({ ...named(rows.get(id)!), reason })).sort(byKey),
            total,
            overLimit: total > RESCHEDULE_MAX,
            withPushes: current,
        },
    };
}
