/**
 * Request schemas for working calendars (roadmap 3.1a; ADR 0010 §5). Written
 * fresh for Islestone.
 */
import { z } from 'zod';

import { WORKING_CALENDAR_LIMITS } from '@/lib/scheduling/working-calendar';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD.');

export const SetWorkingCalendarSchema = z
    .object({
        name: z.string().trim().min(1).max(WORKING_CALENDAR_LIMITS.nameMax).optional(),
        timeZone: z.string().trim().min(1).max(64),
        workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    })
    .strict();

export const AddHolidaysSchema = z
    .object({
        holidays: z
            .array(z.object({ day: Day, name: z.string().trim().min(1).max(WORKING_CALENDAR_LIMITS.holidayNameMax) }).strict())
            .min(1)
            .max(WORKING_CALENDAR_LIMITS.holidaysPerRequest),
    })
    .strict();

export type SetWorkingCalendarInput = z.infer<typeof SetWorkingCalendarSchema>;
export type AddHolidaysInput = z.infer<typeof AddHolidaysSchema>;
