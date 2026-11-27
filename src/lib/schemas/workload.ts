/**
 * Request schemas for capacity, time off and the Workload page (sub-phase
 * 3.5a; docs/porting/maps/3.5.md, "Keys and who sees what"; ADR 0013). Every
 * body is `.strict()`; dates are date-only (`YYYY-MM-DD`); minutes whole. A
 * time-off type is one of three closed codes (`TimeOffTypeSchema`), so there is
 * no free text to sanitise.
 */
import { z } from 'zod';

import { DateOnly } from '@/lib/schemas/work-item';
import { TIME_OFF_TYPES, WORKLOAD_LIMITS } from '@/lib/workload/time-off';

const Id = z.string().min(1).max(64);
const WeeklyMinutes = z.number().int().min(0).max(WORKLOAD_LIMITS.weeklyMinutesMax);

export const TimeOffTypeSchema = z.enum(TIME_OFF_TYPES);

export const WorkloadSettingsSchema = z.object({ defaultWeeklyMinutes: WeeklyMinutes }).strict();

export const SetMemberCapacitySchema = z
    .object({
        /** A Monday (400 `NOT_A_MONDAY` in the usecase). */
        effectiveFrom: DateOnly,
        weeklyMinutes: WeeklyMinutes,
        /** The team whose working calendar counts (decision 285); NULL: the workspace's. */
        calendarTeamId: Id.nullable(),
    })
    .strict();

export const TimeOffQuerySchema = z
    .object({
        from: DateOnly,
        to: DateOnly,
        /** Another member's dates; one's own when absent. */
        userId: Id.optional(),
    })
    .strict();

const TimeOffDayInput = z
    .object({
        day: DateOnly,
        /** NULL: the whole day. */
        minutes: z.number().int().min(1).max(WORKLOAD_LIMITS.timeOffMinutesMax).nullable(),
        type: TimeOffTypeSchema,
        /** The version read; absent for a date that holds no time off yet. */
        version: z.number().int().min(1).optional(),
    })
    .strict();

export const SetTimeOffDaysSchema = z
    .object({
        userId: Id.optional(),
        days: z.array(TimeOffDayInput).min(1).max(WORKLOAD_LIMITS.timeOffDaysPerWrite),
    })
    .strict();

export const RemoveTimeOffDaysSchema = z
    .object({
        userId: Id.optional(),
        days: z.array(z.object({ day: DateOnly, version: z.number().int().min(1) }).strict()).min(1).max(WORKLOAD_LIMITS.timeOffDaysPerWrite),
    })
    .strict();

export const WorkloadQuerySchema = z
    .object({
        /** A Monday, not before the current week; the current week when absent. */
        from: DateOnly.optional(),
        weeks: z.coerce.number().int().min(1).max(WORKLOAD_LIMITS.weeksMax).optional(),
        /** One person or several, comma-separated (`me` for the caller); at most `peopleFilterMax`. */
        userId: z
            .string()
            .min(1)
            .max(WORKLOAD_LIMITS.peopleFilterMax * 65)
            .refine((v) => v.split(',').length <= WORKLOAD_LIMITS.peopleFilterMax && v.split(',').every((id) => id.length >= 1 && id.length <= 64), 'At most 50 people.')
            .optional(),
        /** People with counted work in this project in the window (3.5b); their cells show its share. */
        projectId: Id.optional(),
        /** People with counted work in this team's projects in the window (3.5b). */
        teamId: Id.optional(),
        /** The people a workspace recipient list resolves to (3.5b). */
        recipientListId: Id.optional(),
        /** Only people over capacity in some week of the window (3.5b). */
        over: z.enum(['true', 'false']).optional(),
    })
    .strict();

/** `GET /workload/cell` (3.5b): one person's week (`me` the caller, `unassigned` the work assigned to nobody). */
export const WorkloadCellQuerySchema = z
    .object({
        userId: Id,
        /** The week's Monday, not before the current week. */
        week: DateOnly,
    })
    .strict();
