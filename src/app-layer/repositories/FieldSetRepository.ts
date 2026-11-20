/**
 * Field-set rules (sub-phase 2.4b-b; ADR 0002 §1 and §7). Every query filters
 * by `tenantId` (RLS also scopes it). One row per type and field, held by two
 * partial uniques in SQL, so a write deletes the old row and inserts the new
 * one in the caller's transaction.
 *
 * Written fresh for Islestone.
 */
import type { FieldRequirement, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { CONFIGURABLE_BUILT_IN_FIELDS } from '@/lib/work-items/field-sets';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId'>;

/** Rules on one read: every type's built-in fields, or a project's fields for every type. Far beyond a real workspace's. */
export const FIELD_SET_TAKE = 5_000;

export const fieldSetSelect = {
    typeId: true,
    projectId: true,
    builtInField: true,
    customFieldId: true,
    requirement: true,
} satisfies Prisma.WorkItemTypeFieldSelect;

export type FieldSetRecord = Prisma.WorkItemTypeFieldGetPayload<{ select: typeof fieldSetSelect }>;

export class FieldSetRepository {
    /** Every type's built-in rules (the views' configuration). */
    static async listBuiltIn(db: PrismaTx, ctx: Ctx) {
        return db.workItemTypeField.findMany({
            where: { tenantId: ctx.tenantId, builtInField: { not: null } },
            orderBy: [{ typeId: 'asc' }, { builtInField: 'asc' }],
            take: FIELD_SET_TAKE,
            select: fieldSetSelect,
        });
    }

    /** A project's custom-field rules for every type. */
    static async listForProject(db: PrismaTx, ctx: Ctx, projectId: string) {
        return db.workItemTypeField.findMany({
            where: { tenantId: ctx.tenantId, projectId },
            orderBy: [{ typeId: 'asc' }, { customFieldId: 'asc' }],
            take: FIELD_SET_TAKE,
            select: fieldSetSelect,
        });
    }

    /** The rules of one type in one project: its built-in rules and that project's custom-field rules. */
    static async listForTypeInProject(db: PrismaTx, ctx: Ctx, typeId: string, projectId: string) {
        return db.workItemTypeField.findMany({
            where: { tenantId: ctx.tenantId, typeId, OR: [{ projectId: null }, { projectId }] },
            orderBy: [{ builtInField: 'asc' }, { customFieldId: 'asc' }],
            take: CONFIGURABLE_BUILT_IN_FIELDS.length + 200,
            select: fieldSetSelect,
        });
    }

    /** The rules of the given types in one project (a batch of items, or a template's sub-items). */
    static async listForTypesInProject(db: PrismaTx, ctx: Ctx, typeIds: readonly string[], projectId: string) {
        if (typeIds.length === 0) return [];
        return db.workItemTypeField.findMany({
            where: { tenantId: ctx.tenantId, typeId: { in: [...typeIds] }, OR: [{ projectId: null }, { projectId }] },
            orderBy: [{ typeId: 'asc' }, { builtInField: 'asc' }, { customFieldId: 'asc' }],
            take: FIELD_SET_TAKE,
            select: fieldSetSelect,
        });
    }

    /** Set one built-in rule; `null` removes it (the field takes its default). */
    static async setBuiltIn(db: PrismaTx, ctx: Ctx, typeId: string, builtInField: string, requirement: FieldRequirement | null) {
        await db.workItemTypeField.deleteMany({ where: { tenantId: ctx.tenantId, typeId, builtInField } });
        if (requirement) {
            await db.workItemTypeField.create({ data: { tenantId: ctx.tenantId, typeId, builtInField, requirement }, select: { id: true } });
        }
    }

    /** Set one custom-field rule in its project; `null` removes it. */
    static async setCustom(db: PrismaTx, ctx: Ctx, typeId: string, projectId: string, customFieldId: string, requirement: FieldRequirement | null) {
        await db.workItemTypeField.deleteMany({ where: { tenantId: ctx.tenantId, typeId, customFieldId } });
        if (requirement) {
            await db.workItemTypeField.create({ data: { tenantId: ctx.tenantId, typeId, projectId, customFieldId, requirement }, select: { id: true } });
        }
    }

    /** Insert a project template's rules (2.4b-b), already resolved to ids. */
    static async createMany(
        db: PrismaTx,
        ctx: Ctx,
        rows: ReadonlyArray<{ typeId: string; projectId: string; customFieldId: string; requirement: FieldRequirement }>,
    ) {
        if (rows.length === 0) return 0;
        const result = await db.workItemTypeField.createMany({ data: rows.map((r) => ({ tenantId: ctx.tenantId, ...r })) });
        return result.count;
    }
}
