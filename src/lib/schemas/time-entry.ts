/**
 * Request schemas for time entries and timers (sub-phase 3.4b;
 * docs/porting/maps/3.4.md, "Time entries and timers (3.4b)"). Every body is
 * `.strict()`; dates are date-only (`YYYY-MM-DD`); minutes whole, 1 to 1,440
 * (decision 264). Descriptions are sanitised by the usecase
 * (`sanitizePlainText`) before they are stored, and their plaintext length is
 * checked there too.
 */
import { z } from 'zod';

import { TIME_LIMITS } from '@/lib/time/entries';
import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);
const Minutes = z.number().int().min(1).max(TIME_LIMITS.minutesMax);
const Description = z.string().max(TIME_LIMITS.descriptionMax);

export const CreateTimeEntrySchema = z
    .object({
        workItemId: Id,
        workDate: DateOnly,
        minutes: Minutes,
        billable: z.boolean().optional(),
        description: Description.nullish(),
    })
    .strict();

export const UpdateTimeEntrySchema = z
    .object({
        workItemId: Id.optional(),
        workDate: DateOnly.optional(),
        minutes: Minutes.optional(),
        billable: z.boolean().optional(),
        description: Description.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'Name at least one field to change.' });

export const StartTimerSchema = z
    .object({
        workItemId: Id,
        /** The browser's IANA zone: the timer counts on today's date there (decision 263). */
        timeZone: z.string().trim().min(1).max(64),
    })
    .strict();

export const StopTimerSchema = z
    .object({
        /** Fewer minutes than the timer counted (decision 263); never more. */
        minutes: Minutes.optional(),
    })
    .strict();

export const TimeWeekQuerySchema = z
    .object({
        /** Any date of the week; the week is the Monday-to-Sunday holding it. */
        week: DateOnly,
        userId: Id.optional(),
    })
    .strict();

export const WorkItemTimeQuerySchema = z
    .object({
        cursor: z.string().min(1).max(1024).optional(),
    })
    .strict();
