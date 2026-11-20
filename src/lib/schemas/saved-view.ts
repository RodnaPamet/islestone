/**
 * Request schemas for saved views (sub-phase 2.4, ADR 0006 "View"), and the
 * shape of `SavedView.configJson`, validated on every write.
 *
 * Caps follow the filter presets inflect-compliance ships
 * (`src/lib/filters/filter-presets.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: 64-character names) and Teable's
 * safety limits (bd8cfc054f521f6f9019f62dec2f9fcb1273ecec, MIT); pattern
 * only, no code copied.
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

import { BUILT_IN_LANES, isListOrder } from '@/lib/work-items/list-sorts';

const Id = z.string().min(1).max(64);
const Name = z.string().trim().min(1).max(64);

/** A filter key the list reads: a built-in facet or `cf.<fieldId>`. */
const FilterKey = z.string().regex(/^(stateCategory|stateId|priority|typeId|labelId|assigneeId|projectId|cycleId|milestoneId|waitingOnId|reviewerId|due|cf\.[A-Za-z0-9_-]{1,64})$/, 'Unknown filter.');

export const SavedViewConfigSchema = z
    .object({
        /** The filter system's state: key → selected values. */
        filters: z
            .record(FilterKey, z.array(z.string().min(1).max(64)).max(100))
            .refine((r) => Object.keys(r).length <= 30, 'At most 30 filters.')
            .default({}),
        /** The search text. */
        q: z.string().max(200).optional(),
        sort: z
            .string()
            .max(70)
            .refine((s) => isListOrder(s), 'Unknown sort.')
            .default('manual'),
        direction: z.enum(['asc', 'desc']).optional(),
        /** The board's swimlanes. */
        laneBy: z
            .string()
            .max(70)
            .refine((s) => (BUILT_IN_LANES as readonly string[]).includes(s) || /^cf:[A-Za-z0-9_-]{1,64}$/.test(s), 'Unknown grouping.')
            .default('none'),
        /** The list's visible column ids, in order. */
        columns: z.array(z.string().min(1).max(70)).max(60).optional(),
    })
    .strict();

export type SavedViewConfig = z.infer<typeof SavedViewConfigSchema>;

/** Layouts accepted now: TIMELINE and CALENDAR arrive with 3.1 and 3.3. */
export const SAVED_VIEW_LAYOUTS = ['LIST', 'BOARD'] as const;

export const CreateSavedViewSchema = z
    .object({
        name: Name,
        visibility: z.enum(['PERSONAL', 'SHARED']).default('PERSONAL'),
        projectId: Id.nullish(),
        layout: z.enum(SAVED_VIEW_LAYOUTS).default('LIST'),
        config: SavedViewConfigSchema,
    })
    .strict();

export const UpdateSavedViewSchema = z
    .object({
        name: Name.optional(),
        visibility: z.enum(['PERSONAL', 'SHARED']).optional(),
        layout: z.enum(SAVED_VIEW_LAYOUTS).optional(),
        config: SavedViewConfigSchema.optional(),
    })
    .strict()
    .refine((b) => Object.values(b).some((v) => v !== undefined), 'Nothing to change.');

export const ListSavedViewsQuerySchema = z.object({
    projectId: Id.optional(),
    scope: z.enum(['workspace', 'all']).optional(),
});
