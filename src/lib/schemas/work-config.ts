/**
 * Request schemas for teams, workflow states, projects, work item types and
 * labels (sub-phase 2.1). Written fresh for Islestone.
 */
import { z } from 'zod';

import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import { COLOR_PATTERN, WORK_ITEM_TYPE_ICONS } from '@/app-layer/domain/work-item-type-icons';

import { PositionSchema } from './work-item';

const Id = z.string().min(1).max(64);
const Name = z.string().trim().min(1).max(100);
const Color = z.string().regex(COLOR_PATTERN, 'A colour is a token name or #RRGGBB.');

export const CreateTeamSchema = z.object({ name: Name }).strict();
export const RenameTeamSchema = z.object({ name: Name }).strict();

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

export const CreateProjectSchema = z
    .object({ teamId: Id, name: Name, keyPrefix: z.string().trim().min(2).max(10), templateId: Id.optional() })
    .strict();

export const UpdateProjectSchema = z
    .object({ name: Name.optional(), keyPrefix: z.string().trim().min(2).max(10).optional(), teamId: Id.optional() })
    .strict();

export const ArchiveProjectSchema = z.object({ archived: z.boolean() }).strict();

export const CreateWorkItemTypeSchema = z
    .object({ name: Name, icon: z.enum(WORK_ITEM_TYPE_ICONS).nullish(), color: Color.nullish() })
    .strict();

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
