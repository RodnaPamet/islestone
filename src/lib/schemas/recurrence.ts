/**
 * Request schemas for repeats (sub-phase 2.5d, owner decisions 67 and 68).
 * Dates are date-only (`YYYY-MM-DD`).
 */
import { z } from 'zod';

import { RECURRENCE_LIMITS } from '@/app-layer/domain/recurrence';
import { DateOnly } from '@/lib/schemas/work-item';

export const RECURRENCE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;

export const SetRecurrenceSchema = z
    .object({
        frequency: z.enum(RECURRENCE_FREQUENCIES),
        interval: z.number().int().min(RECURRENCE_LIMITS.interval.min).max(RECURRENCE_LIMITS.interval.max).default(1),
        /** Weekly only: 0 (Sunday) to 6 (Saturday). */
        weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
        endsOn: DateOnly.nullish(),
        maxOccurrences: z.number().int().min(RECURRENCE_LIMITS.maxOccurrences.min).max(RECURRENCE_LIMITS.maxOccurrences.max).nullish(),
        leadDays: z.number().int().min(RECURRENCE_LIMITS.leadDays.min).max(RECURRENCE_LIMITS.leadDays.max).default(RECURRENCE_LIMITS.leadDays.default),
        /** `true` puts the repeat on hold; `false` (or absent) keeps it running, the caller its owner. */
        onHold: z.boolean().optional(),
    })
    .strict()
    .refine((b) => b.frequency === 'WEEKLY' || b.weekdays.length === 0, 'Weekdays are for a weekly repeat.')
    .refine((b) => !(b.endsOn && b.maxOccurrences), 'Give an end date or a number of times, not both.');

export type SetRecurrenceInput = z.infer<typeof SetRecurrenceSchema>;
