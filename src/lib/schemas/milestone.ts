/**
 * Request schemas for milestones (sub-phase 2.5b). The due date is date-only
 * (`YYYY-MM-DD`), like an item's.
 */
import { z } from 'zod';

import { DateOnly } from '@/lib/schemas/work-item';

const Id = z.string().min(1).max(64);

/** A milestone name's longest length, after sanitising. */
export const MILESTONE_NAME_MAX = 100;

const Name = z.string().min(1).max(MILESTONE_NAME_MAX);

export const CreateMilestoneSchema = z
    .object({
        name: Name,
        dueDate: DateOnly.nullish(),
    })
    .strict();

export const UpdateMilestoneSchema = z
    .object({
        name: Name.optional(),
        dueDate: DateOnly.nullable().optional(),
        position: z
            .object({ afterId: Id.optional(), beforeId: Id.optional() })
            .strict()
            .refine((p) => (p.afterId === undefined) !== (p.beforeId === undefined), 'Give exactly one of afterId and beforeId.')
            .optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.dueDate !== undefined || b.position !== undefined, 'Give a name, a due date or a position to change.');

export const SetWorkItemMilestoneSchema = z.object({ milestoneId: Id.nullable() }).strict();
