/**
 * Request schemas for cycles and cycle schedules (sub-phase 2.5a). Dates are
 * date-only (`YYYY-MM-DD`), like due dates.
 */
import { z } from 'zod';

import { CYCLE_LENGTH_WEEKS, CYCLE_UPCOMING_COUNT } from '@/app-layer/domain/cycle';
import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);
const Name = z.string().max(100);

export const CYCLE_STATUSES = ['upcoming', 'current', 'ended', 'completed'] as const;

export const CycleQuerySchema = z
    .object({
        teamId: Id.optional(),
        status: z.enum(CYCLE_STATUSES).optional(),
    })
    .strict();

export const CreateCycleSchema = z
    .object({
        teamId: Id,
        name: Name.nullish(),
        startsOn: DateOnly,
        endsOn: DateOnly,
    })
    .strict();

export const UpdateCycleSchema = z
    .object({
        name: Name.nullable().optional(),
        startsOn: DateOnly.optional(),
        endsOn: DateOnly.optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.startsOn !== undefined || b.endsOn !== undefined, 'Give a name or a date to change.');

export const SetCycleScheduleSchema = z
    .object({
        enabled: z.boolean(),
        lengthWeeks: z.number().int().min(CYCLE_LENGTH_WEEKS.min).max(CYCLE_LENGTH_WEEKS.max),
        firstStartsOn: DateOnly,
        upcomingCount: z.number().int().min(CYCLE_UPCOMING_COUNT.min).max(CYCLE_UPCOMING_COUNT.max),
        rollover: z.enum(['NEXT_CYCLE', 'NO_CYCLE']),
    })
    .strict();
