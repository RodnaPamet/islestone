/**
 * Request schemas for timesheets and the time tracking settings (sub-phase
 * 3.4c; docs/porting/maps/3.4.md, "Timesheets and approval (3.4c)"). Every
 * body is `.strict()`; a week is any date in it (`YYYY-MM-DD`). An
 * explanation is sanitised by the usecase (`sanitizePlainText`) before it is
 * stored, and its plaintext length is checked there too.
 */
import { z } from 'zod';

import { TIMESHEET_LIMITS } from '@/lib/time/timesheets';
import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);
const Explanation = z.string().trim().min(1).max(TIMESHEET_LIMITS.explanationMax);

export const SubmitTimesheetSchema = z
    .object({
        /** Any date of the week; the week is the Monday-to-Sunday holding it. */
        week: DateOnly,
    })
    .strict();

export const TimesheetExplanationSchema = z
    .object({
        /** Why it is returned or reopened (decision 270): shown to the person, never audited or notified. */
        explanation: Explanation,
    })
    .strict();

export const TimesheetWeekQuerySchema = z
    .object({
        week: DateOnly,
        userId: Id.optional(),
    })
    .strict();

export const TimesheetListQuerySchema = z
    .object({
        /** Waiting for a decision, oldest first; or decided in the last 12 weeks, newest first. */
        status: z.enum(['SUBMITTED', 'DECIDED']).default('SUBMITTED'),
        cursor: z.string().min(1).max(1024).optional(),
    })
    .strict();

export const TimeSettingsSchema = z
    .object({
        approvalRequired: z.boolean().optional(),
        /** A live workspace recipient list, or null for every holder of `time.approve` (decision 269). */
        approvalRecipientListId: Id.nullable().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'Name at least one setting to change.' });
