/**
 * Request schemas for the work-item API (sub-phase 2.2).
 *
 * Copied from inflect-compliance `src/lib/schemas/index.ts` lines 653–674,
 * 726–782, 789–793, 824–846 and 970 at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (the task schemas) and edited:
 * renamed for work items; the type, severity, source, control, finding,
 * reviewer, metadata and resolution fields cut; project, type, state,
 * priority (the new enum), parent, labels and position added; dates are
 * date-only (`YYYY-MM-DD`); plain `zod` until the public API's OpenAPI layer
 * (5.2). The expected version is never a body field: it comes from
 * `If-Match` (`expectedVersionFrom`).
 */
import { z } from 'zod';

import { DUE_FILTERS } from '@/app-layer/domain/work-item-due';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import { CustomFieldValuesInputSchema } from '@/lib/schemas/custom-field';
import { fieldIdOfFilterKey } from '@/lib/work-items/custom-fields';
import { isListOrder } from '@/lib/work-items/list-sorts';
import { badRequest } from '@/lib/errors/types';

export const WORK_ITEM_PRIORITIES = ['NONE', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const WORK_ITEM_RELATION_TYPES = ['BLOCKS', 'RELATES', 'DUPLICATES'] as const;
export const WORK_ITEM_LINK_TYPE_VALUES = ['URL', 'PULL_REQUEST', 'COMMIT', 'PAGE', 'CANVAS'] as const;

/** Most ids in one bulk action. */
export const BULK_MAX = 100;

const Id = z.string().min(1).max(64);
const Title = z.string().trim().min(1).max(500);
const Description = z.string().max(100_000);

/** A calendar date, `YYYY-MM-DD` (due and start dates are date-only, ADR 0002 §12). */
export const DateOnly = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in the form YYYY-MM-DD.')
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date.');

export const PositionSchema = z
    .object({ afterId: Id.optional(), beforeId: Id.optional() })
    .strict()
    .refine((p) => !(p.afterId && p.beforeId), 'Give either afterId or beforeId, not both.');

export const CreateWorkItemSchema = z
    .object({
        projectId: Id,
        /** Required unless `templateId` names a template that gives one. */
        typeId: Id.optional(),
        title: Title.optional(),
        description: Description.nullish(),
        stateId: Id.optional(),
        priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
        assigneeId: Id.nullish(),
        parentId: Id.nullish(),
        labelIds: z.array(Id).max(50).optional(),
        startDate: DateOnly.nullish(),
        dueDate: DateOnly.nullish(),
        position: PositionSchema.optional(),
        customFields: CustomFieldValuesInputSchema.optional(),
        /** A cycle of the project's team that is not completed (2.5a). */
        cycleId: Id.nullish(),
        /** A milestone of the project (2.5b). */
        milestoneId: Id.nullish(),
        /** An item template of the project (2.5c). */
        templateId: Id.optional(),
    })
    .strict()
    .refine((b) => b.templateId !== undefined || (b.typeId !== undefined && b.title !== undefined), 'Give a title and a type, or a template.');

export const UpdateWorkItemSchema = z
    .object({
        title: Title.optional(),
        description: Description.nullable().optional(),
        priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
        typeId: Id.optional(),
        startDate: DateOnly.nullable().optional(),
        dueDate: DateOnly.nullable().optional(),
    })
    .strict();

export const SetWorkItemStateSchema = z.object({ stateId: Id }).strict();

export const AssignWorkItemSchema = z.object({ assigneeId: Id.nullable() }).strict();

/** Put an item in a cycle of its team, or take it out (`null`; 2.5a). */
export const SetWorkItemCycleSchema = z.object({ cycleId: Id.nullable() }).strict();

export const AddCommentSchema = z.object({ body: z.string().trim().min(1).max(20_000) }).strict();

export const AddWorkItemLinkSchema = z
    .object({
        type: z.enum(WORK_ITEM_LINK_TYPE_VALUES),
        location: z.string().trim().min(1).max(2_000),
        title: z.string().max(500).nullish(),
    })
    .strict();

export const AddWorkItemRelationSchema = z.object({ type: z.enum(WORK_ITEM_RELATION_TYPES), toId: Id }).strict();

export const AddWorkItemLabelsSchema = z.object({ labelIds: z.array(Id).min(1).max(50) }).strict();

const BulkIds = z.array(Id).min(1).max(BULK_MAX);

export const BulkWorkItemAssignSchema = z.object({ workItemIds: BulkIds, assigneeId: Id.nullable() }).strict();

export const BulkWorkItemStateSchema = z
    .object({
        workItemIds: BulkIds,
        stateId: Id.optional(),
        stateCategory: z.enum(WORKFLOW_STATE_CATEGORIES).optional(),
    })
    .strict()
    .refine((b) => !b.stateId !== !b.stateCategory, 'Give either stateId or stateCategory.');

export const BulkWorkItemDueDateSchema = z.object({ workItemIds: BulkIds, dueDate: DateOnly.nullable() }).strict();

export const BulkWorkItemDeleteSchema = z.object({ workItemIds: BulkIds }).strict();

/**
 * The move route takes exactly one of `position` (reorder), `parentId`
 * (re-parent, `null` for the top level) or `projectId` (another project).
 * A board drop (sub-phase 2.3) sends `stateId`, optionally with a
 * `position` among the destination column's neighbours: the state change and
 * the reorder are one transaction.
 */
export const MoveWorkItemSchema = z
    .object({
        position: PositionSchema.optional(),
        parentId: Id.nullable().optional(),
        projectId: Id.optional(),
        stateId: Id.optional(),
    })
    .strict()
    .refine((b) => {
        const modes = (b.projectId !== undefined ? 1 : 0) + (b.parentId !== undefined ? 1 : 0) + (b.stateId !== undefined ? 1 : 0);
        return modes === 1 || (modes === 0 && b.position !== undefined);
    }, 'Give exactly one of parentId, projectId or stateId, or a position alone to reorder.');

/** The list query (`GET /work-items`). */
export const WorkItemQuerySchema = z.object({
    projectId: z.string().max(2000).optional(),
    teamId: z.string().max(2000).optional(),
    typeId: z.string().max(2000).optional(),
    stateId: z.string().max(2000).optional(),
    stateCategory: z.string().max(200).optional(),
    priority: z.string().max(200).optional(),
    labelId: z.string().max(2000).optional(),
    parentId: z.string().max(2000).optional(),
    assigneeId: z.string().max(2000).optional(),
    /** Creator user ids, comma-joinable, as `assigneeId`. */
    createdById: z.string().max(2000).optional(),
    /** Cycle ids (comma-joinable), `none`, or `current` (each team's current cycle; 2.5a). */
    cycleId: z.string().max(2000).optional(),
    /** Milestone ids (comma-joinable), or `none` (2.5b). */
    milestoneId: z.string().max(2000).optional(),
    /** Only `me`: the caller's watched items, resolved from the request context. */
    watching: z.enum(['me']).optional(),
    due: z.enum(DUE_FILTERS).optional(),
    q: z.string().max(200).optional(),
    includeArchived: z.enum(['true', 'false', '1', '0']).optional(),
    /** A named sort or `cf:<fieldId>` (2.4; checked by the usecase). */
    order: z
        .string()
        .max(70)
        .refine((o) => isListOrder(o), 'Unknown order.')
        .optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(1000).optional(),
    deleted: z.enum(['true', '1']).optional(),
});

export const PageQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().max(1000).optional(),
});

/**
 * The list query's custom-field conditions (2.4): every `cf.<fieldId>`
 * parameter, keyed by field id. The value (`<op>[:<operand>]`) is parsed
 * against the field's type by the usecase.
 */
export function customFieldConditionsOf(params: URLSearchParams): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of params) {
        if (!key.startsWith('cf.')) continue;
        const fieldId = fieldIdOfFilterKey(key);
        if (!fieldId || value.length > 2_000) throw badRequest(`Invalid field filter ${key}.`);
        out[fieldId] = value;
    }
    return out;
}
