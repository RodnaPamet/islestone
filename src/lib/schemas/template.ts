/**
 * Request schemas and the project-template content document (sub-phase
 * 2.5c; docs/porting/maps/2.5.md; owner decisions 71 and 73).
 *
 * - An item template: name, title, description, type, priority, labels,
 *   assignee, "due in N days", custom-field values (as on a create) and
 *   sub-items (titles).
 * - A project template's content is a versioned document
 *   (`ProjectTemplateContentSchema`, version 1), stored as one encrypted
 *   string: custom fields with options, milestones with `dueInDays`, item
 *   templates and starter items with sub-items, and (roadmap 3.1) the
 *   project's due date as `projectDueInDays`. Types and labels are named,
 *   not referenced by id, because they are matched against the workspace and
 *   the new project's team when the template is used. People are not carried.
 */
import { z } from 'zod';

import { CustomFieldValuesInputSchema } from '@/lib/schemas/custom-field';
import { EstimateMinutesSchema, EstimatePointsSchema, WORK_ITEM_PRIORITIES } from '@/lib/schemas/work-item';
import { CUSTOM_FIELD_TYPES } from '@/lib/work-items/custom-fields';

const Id = z.string().min(1).max(64);

export const TEMPLATE_LIMITS = {
    nameLength: 100,
    titleLength: 500,
    descriptionLength: 50_000,
    subItems: 50,
    dueInDaysMax: 3650,
    /** A project template's content. */
    fields: 50,
    options: 100,
    milestones: 50,
    itemTemplates: 50,
    items: 200,
    contentBytes: 256 * 1024,
} as const;

const Name = z.string().min(1).max(TEMPLATE_LIMITS.nameLength);
const Title = z.string().min(1).max(TEMPLATE_LIMITS.titleLength);
const Description = z.string().max(TEMPLATE_LIMITS.descriptionLength);
const DueInDays = z.number().int().min(0).max(TEMPLATE_LIMITS.dueInDaysMax);
const SubItem = z.object({ title: Title }).strict();
const SubItems = z.array(SubItem).max(TEMPLATE_LIMITS.subItems);
const Position = z
    .object({ afterId: Id.optional(), beforeId: Id.optional() })
    .strict()
    .refine((p) => (p.afterId === undefined) !== (p.beforeId === undefined), 'Give exactly one of afterId and beforeId.');

export const CreateWorkItemTemplateSchema = z
    .object({
        name: Name,
        title: Title,
        description: Description.nullish(),
        typeId: Id.nullish(),
        priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
        labelIds: z.array(Id).max(50).optional(),
        assigneeId: Id.nullish(),
        dueInDays: DueInDays.nullish(),
        /** The new item's estimate (3.4a), in the column of the project's team's unit. */
        estimatePoints: EstimatePointsSchema.nullish(),
        estimateMinutes: EstimateMinutesSchema.nullish(),
        customFields: CustomFieldValuesInputSchema.optional(),
        subItems: SubItems.optional(),
    })
    .strict();

export const UpdateWorkItemTemplateSchema = z
    .object({
        name: Name.optional(),
        title: Title.optional(),
        description: Description.nullable().optional(),
        typeId: Id.nullable().optional(),
        priority: z.enum(WORK_ITEM_PRIORITIES).optional(),
        labelIds: z.array(Id).max(50).optional(),
        assigneeId: Id.nullable().optional(),
        dueInDays: DueInDays.nullable().optional(),
        estimatePoints: EstimatePointsSchema.nullable().optional(),
        estimateMinutes: EstimateMinutesSchema.nullable().optional(),
        customFields: CustomFieldValuesInputSchema.optional(),
        subItems: SubItems.optional(),
        archived: z.boolean().optional(),
        position: Position.optional(),
    })
    .strict()
    .refine((b) => Object.keys(b).length > 0, 'Give something to change.');

// ─── Project templates ─────────────────────────────────────────────────────

const ContentItemBase = {
    title: Title,
    description: Description.nullable(),
    typeName: Name.nullable(),
    priority: z.enum(WORK_ITEM_PRIORITIES),
    labelNames: z.array(Name).max(50),
    dueInDays: DueInDays.nullable(),
    subItems: SubItems,
    /**
     * The item's estimate (3.4a, decision 258). Optional: content saved
     * before has none, and `version` stays 1. A use under a team that does
     * not estimate, or in the other unit, skips it as `estimate:unit`.
     */
    estimatePoints: EstimatePointsSchema.nullable().optional(),
    estimateMinutes: EstimateMinutesSchema.nullable().optional(),
};

export const ProjectTemplateContentSchema = z
    .object({
        version: z.literal(1),
        customFields: z
            .array(
                z
                    .object({
                        name: Name,
                        type: z.enum(CUSTOM_FIELD_TYPES),
                        options: z.array(z.object({ name: Name, color: z.string().max(32).nullable() }).strict()).max(TEMPLATE_LIMITS.options),
                    })
                    .strict(),
            )
            .max(TEMPLATE_LIMITS.fields),
        milestones: z.array(z.object({ name: Name, dueInDays: DueInDays.nullable() }).strict()).max(TEMPLATE_LIMITS.milestones),
        itemTemplates: z.array(z.object({ name: Name, ...ContentItemBase }).strict()).max(TEMPLATE_LIMITS.itemTemplates),
        items: z
            .array(z.object({ ...ContentItemBase, milestoneIndex: z.number().int().min(0).max(TEMPLATE_LIMITS.milestones - 1).nullable() }).strict())
            .max(TEMPLATE_LIMITS.items),
        /**
         * The project's custom-field rules (2.4b-b, owner decision 108), by
         * type name and field name. Optional: content saved before has none.
         */
        fieldSetEntries: z
            .array(z.object({ typeName: Name, fieldName: Name, requirement: z.enum(['REQUIRED', 'HIDDEN']) }).strict())
            .max(TEMPLATE_LIMITS.fields * 20)
            .optional(),
        /**
         * The project's due date as days from creation (roadmap 3.1, owner
         * decision 188). Optional: content saved before has none, and `null`
         * is a project without one.
         */
        projectDueInDays: DueInDays.nullable().optional(),
    })
    .strict()
    .superRefine((c, ctx) => {
        for (const [i, item] of c.items.entries()) {
            if (item.milestoneIndex !== null && item.milestoneIndex >= c.milestones.length) {
                ctx.addIssue({ code: 'custom', path: ['items', i, 'milestoneIndex'], message: 'Names a milestone the template does not hold.' });
            }
        }
    });

export type ProjectTemplateContent = z.infer<typeof ProjectTemplateContentSchema>;

export const SaveProjectAsTemplateSchema = z
    .object({
        fromProjectId: Id,
        name: Name,
        /** Also capture the project's open top-level items and their open sub-items. */
        includeItems: z.boolean().default(false),
    })
    .strict();

export const UpdateProjectTemplateSchema = z
    .object({
        name: Name.optional(),
        archived: z.boolean().optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.archived !== undefined, 'Give a name or the archived flag.');
