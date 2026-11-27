/**
 * Moving an item's dates whole (roadmap 3.1c and 3.5c; ADR 0010 §6; owner
 * decisions 194 and 299): the one rule a move keeps the item's working-day
 * duration by. Pure and client-safe, like the rest of the engine.
 *
 *   - **Both dates, start not after due**: the new start is the first
 *     working day on or after the old start plus `days`, and the due date is
 *     the duration's last working day from it, the duration being the
 *     working days from the old start to the old due date (at least one).
 *   - **One date, or start after due**: each date the item has moves by
 *     `days` and snaps forward to a working day.
 *
 * The timeline's drop (`proposeDates` in `src/lib/work-items/reschedule.ts`)
 * and the Workload page's "Move dates" (`domain/workload/options.ts`) both
 * move through it, so a date moved from either place lands on the same days.
 *
 * Written fresh for Islestone.
 */
import { addWorkingDays, nextWorkingDay, workingDaysInclusive, type CompiledCalendar } from './calendar';
import type { PlannedDates } from './span';

/** `dates` moved `days` calendar days (positive: later), keeping the item's working-day duration on `calendar`. */
export function movePlannedDates(dates: PlannedDates, calendar: CompiledCalendar, days: number): PlannedDates {
    const { startDate: start, dueDate: due } = dates;
    if (start !== null && due !== null && start <= due) {
        const duration = Math.max(1, workingDaysInclusive(calendar, start, due));
        const newStart = nextWorkingDay(calendar, start + days);
        return { startDate: newStart, dueDate: addWorkingDays(calendar, newStart, duration - 1) };
    }
    return {
        startDate: start === null ? null : nextWorkingDay(calendar, start + days),
        dueDate: due === null ? null : nextWorkingDay(calendar, due + days),
    };
}
