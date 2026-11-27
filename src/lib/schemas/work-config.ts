/**
 * Request schemas for teams, workflow states, projects, work item types and
 * labels (sub-phase 2.1). Written fresh for Islestone.
 */
import { z } from 'zod';

import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import { COLOR_PATTERN, WORK_ITEM_TYPE_ICONS } from '@/app-layer/domain/work-item-type-icons';

import { ESTIMATE_UNITS } from '@/lib/work-items/estimate';
import { CONFIGURABLE_BUILT_IN_FIELDS, FIELD_REQUIREMENTS } from '@/lib/work-items/field-sets';

import { PositionSchema } from './work-item';

const Id = z.string().min(1).max(64);
const Name = z.string().trim().min(1).max(100);
const Color = z.string().regex(COLOR_PATTERN, 'A colour is a token name or #RRGGBB.');

export const CreateTeamSchema = z.object({ name: Name }).strict();
export const RenameTeamSchema = z.object({ name: Name }).strict();
/**
 * `PATCH /teams/:teamId`: rename it, set its estimate unit (3.4a, decision
 * 257; `null` stops estimating), or both. Changing the unit moves no value.
 */
export const UpdateTeamSchema = z
    .object({ name: Name.optional(), estimateUnit: z.enum(ESTIMATE_UNITS).nullable().optional() })
    .strict()
    .refine((b) => b.name !== undefined || b.estimateUnit !== undefined, 'Give a name or an estimate unit.');

export const CreateWorkflowStateSchema = z
    .object({
        name: Name,
        category: z.enum(WORKFLOW_STATE_CATEGORIES),
        isDefault: z.boolean().optional(),
        position: PositionSchema.optional(),
    })
    .strict();

/** `category` is refused by name: a state's category never changes (ADR 0002 §3). */
export const UpdateWorkflowStateSchema = z
    .object({
        name: Name.optional(),
        isDefault: z.literal(true).optional(),
        archived: z.boolean().optional(),
        position: PositionSchema.optional(),
    })
    .strict();

export const DeleteWorkflowStateSchema = z.object({ moveToStateId: Id.optional() }).strict();

/** A project's due date (roadmap 3.1, decision 188): `YYYY-MM-DD`, or `null` for none. */
const ProjectDueDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date is YYYY-MM-DD.').nullable();

export const CreateProjectSchema = z
    .object({ teamId: Id, name: Name, keyPrefix: z.string().trim().min(2).max(10), templateId: Id.optional(), dueDate: ProjectDueDate.optional(), initiativeId: Id.nullish() })
    .strict();

export const UpdateProjectSchema = z
    .object({ name: Name.optional(), keyPrefix: z.string().trim().min(2).max(10).optional(), teamId: Id.optional(), dueDate: ProjectDueDate.optional() })
    .strict();

export const ArchiveProjectSchema = z.object({ archived: z.boolean() }).strict();

export const CreateWorkItemTypeSchema = z
    .object({ name: Name, icon: z.enum(WORK_ITEM_TYPE_ICONS).nullish(), color: Color.nullish() })
    .strict();

/** "Add the Question type" (2.4b-c): another name when Question is taken. */
export const AddQuestionTypeSchema = z.object({ name: Name.optional() }).strict();

export const UpdateWorkItemTypeSchema = z
    .object({
        name: Name.optional(),
        icon: z.enum(WORK_ITEM_TYPE_ICONS).nullable().optional(),
        color: Color.nullable().optional(),
        archived: z.boolean().optional(),
        position: PositionSchema.optional(),
    })
    .strict();

export const CreateLabelSchema = z.object({ name: Name, teamId: Id.nullish(), color: Color.nullish() }).strict();
export const UpdateLabelSchema = z.object({ name: Name.optional(), color: Color.nullable().optional() }).strict();

// ─── Field sets (sub-phase 2.4b-b) ──────────────────────────────────────────

/** One built-in field's rule for a type (`admin.manage`). */
export const SetTypeFieldSchema = z
    .object({
        field: z.enum(CONFIGURABLE_BUILT_IN_FIELDS),
        requirement: z.enum(FIELD_REQUIREMENTS),
    })
    .strict();

/** One custom field's rule for a type in its project (`projects.edit`). */
export const SetProjectTypeFieldSchema = z
    .object({
        typeId: Id,
        customFieldId: Id,
        requirement: z.enum(FIELD_REQUIREMENTS),
    })
    .strict();
