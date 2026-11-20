/**
 * Request schemas for custom fields and their values (sub-phase 2.4).
 * Names are sanitised and trimmed again in the usecase; a value is parsed per
 * type by `parseCustomFieldValue` (`src/app-layer/domain/custom-field.ts`),
 * so the body schema only bounds its shape.
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPES } from '@/lib/work-items/custom-fields';

const Id = z.string().min(1).max(64);
const Name = z.string().trim().min(1).max(CUSTOM_FIELD_LIMITS.nameLength);
const Color = z
    .string()
    .regex(/^(#[0-9A-Fa-f]{6}|[a-z][a-z0-9-]{0,31})$/, 'Use #RRGGBB or a token name.')
    .nullish();

export const CustomFieldOptionInputSchema = z.object({ name: Name, color: Color }).strict();

export const CreateCustomFieldSchema = z
    .object({
        name: Name,
        type: z.enum(CUSTOM_FIELD_TYPES),
        options: z.array(CustomFieldOptionInputSchema).max(CUSTOM_FIELD_LIMITS.optionsPerField).optional(),
    })
    .strict();

export const UpdateCustomFieldSchema = z
    .object({
        name: Name.optional(),
        archived: z.boolean().optional(),
        position: z
            .object({ afterId: Id.optional(), beforeId: Id.optional() })
            .strict()
            .refine((p) => !!p.afterId !== !!p.beforeId, 'Give either afterId or beforeId.')
            .optional(),
    })
    .strict()
    .refine((b) => b.name !== undefined || b.archived !== undefined || b.position !== undefined, 'Nothing to change.');

export const UpdateCustomFieldOptionSchema = z
    .object({ name: Name.optional(), color: Color, archived: z.boolean().optional() })
    .strict()
    .refine((b) => b.name !== undefined || b.color !== undefined || b.archived !== undefined, 'Nothing to change.');

/** A value of any type; `null` clears. Bounded here, parsed per type in the domain. */
export const CustomFieldValueSchema = z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string().max(2_000),
    z.array(Id).max(CUSTOM_FIELD_LIMITS.optionsPerField),
]);

export const SetCustomFieldValueSchema = z.object({ value: CustomFieldValueSchema }).strict();

/** `customFields` on a create: field id → value. */
export const CustomFieldValuesInputSchema = z
    .record(Id, CustomFieldValueSchema)
    .refine((r) => Object.keys(r).length <= CUSTOM_FIELD_LIMITS.fieldsPerProject, 'Too many fields.');

export const ListCustomFieldsQuerySchema = z.object({ includeArchived: z.enum(['true', 'false', '1', '0']).optional() });
