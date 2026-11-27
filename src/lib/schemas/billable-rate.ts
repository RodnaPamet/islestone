/**
 * Request schemas for billable rates, a project's billable default, Time
 * totals and the export (sub-phase 3.4d; docs/porting/maps/3.4.md, "Rates,
 * totals and export (3.4d)"). Every body is `.strict()`.
 */
import { z } from 'zod';

import { DateOnly } from '@/lib/schemas/work-item';
import { RATE_MINOR_MAX } from '@/lib/time/money';
import { TIME_EXPORT_FORMATS, TIME_TOTALS_GROUPS } from '@/lib/time/totals';

const Id = z.string().min(1).max(64);

export const SetBillableRateSchema = z
    .object({
        /** The day the rate starts to apply. */
        effectiveFrom: DateOnly,
        /** Whole minor units of the workspace's currency per hour; null: no rate at this level from this date. */
        hourlyRateMinor: z.number().int().min(0).max(RATE_MINOR_MAX).nullable(),
    })
    .strict();

export const ProjectBillableDefaultSchema = z
    .object({
        /** New time entries on the project are billable unless unticked (decision 271). */
        billableByDefault: z.boolean(),
    })
    .strict();

const filterShape = {
    from: DateOnly,
    to: DateOnly,
    projectId: Id.optional(),
    userId: Id.optional(),
    billable: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
};

export const TimeTotalsQuerySchema = z
    .object({ ...filterShape, groupBy: z.enum(TIME_TOTALS_GROUPS).default('project') })
    .strict();

export const TimeExportQuerySchema = z
    .object({ ...filterShape, format: z.enum(TIME_EXPORT_FORMATS) })
    .strict();
