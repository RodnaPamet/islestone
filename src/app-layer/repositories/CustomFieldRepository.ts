/**
 * Custom fields, their options and their values (sub-phase 2.4, ADR 0002 §7).
 *
 * Every query filters `tenantId`. Field reads take the project id the caller
 * already resolved under project visibility (`ProjectRepository.getVisible`);
 * value writes take an item the caller already loaded through the work-item
 * write gate (`loadWritableItem`). Kaneo's option rules
 * (`apps/api/src/custom-field/` at fb890b4974e6dd6c232f1de6a6b70a591dfca0a3;
 * pattern only, no code copied) shape `optionInUse`.
 *
 * Written fresh for Islestone.
 */
import type { CustomFieldType, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { CUSTOM_FIELD_LIMITS } from '@/lib/work-items/custom-fields';
import type { RequestContext } from '../types';

/** Values cleared per statement when a member leaves. */
export const PERSON_VALUE_BATCH = 500;

const optionSelect = {
    id: true,
    fieldId: true,
    name: true,
    color: true,
    sortKey: true,
    archivedAt: true,
} satisfies Prisma.CustomFieldOptionSelect;

export const customFieldSelect = {
    id: true,
    projectId: true,
    name: true,
    type: true,
    sortKey: true,
    archivedAt: true,
    options: {
        select: optionSelect,
        orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
        take: CUSTOM_FIELD_LIMITS.optionsPerField,
    },
} satisfies Prisma.CustomFieldSelect;

export type CustomFieldRow = Prisma.CustomFieldGetPayload<{ select: typeof customFieldSelect }>;

/** The typed columns of one value row. */
export interface CustomFieldValueData {
    textValue?: string;
    numberValue?: string;
    dateValue?: Date;
    boolValue?: boolean;
    optionId?: string;
    userId?: string;
}

export class CustomFieldRepository {
    // ── Fields ───────────────────────────────────────────────────────

    /** A project's fields, in order (archived ones only when asked). */
    static async listFields(db: PrismaTx, ctx: RequestContext, projectId: string, opts: { includeArchived?: boolean } = {}) {
        return db.customField.findMany({
            where: { tenantId: ctx.tenantId, projectId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ sortKey: 'asc' }, { id: 'asc' }],
            take: CUSTOM_FIELD_LIMITS.fieldsPerProject,
            select: customFieldSelect,
        });
    }

    /** A field and its options, archived or not. */
    static async getField(db: PrismaTx, ctx: RequestContext, fieldId: string) {
        return db.customField.findFirst({ where: { id: fieldId, tenantId: ctx.tenantId }, select: customFieldSelect });
    }

    /** The fields among `ids` (the list's filters and sort name them by id). */
    static async getFields(db: PrismaTx, ctx: RequestContext, ids: readonly string[]) {
        if (ids.length === 0) return [];
        return db.customField.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
            take: ids.length,
            select: { id: true, projectId: true, type: true, archivedAt: true },
        });
    }

    /** Every field of a project counts towards the cap, archived ones too. */
    static async countFields(db: PrismaTx, ctx: RequestContext, projectId: string) {
        return db.customField.count({ where: { tenantId: ctx.tenantId, projectId } });
    }

    static async fieldNameTaken(db: PrismaTx, ctx: RequestContext, projectId: string, name: string, exceptId?: string) {
        const row = await db.customField.findFirst({
            where: { tenantId: ctx.tenantId, projectId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return row !== null;
    }

    static async lastFieldSortKey(db: PrismaTx, ctx: RequestContext, projectId: string) {
        const row = await db.customField.findFirst({
            where: { tenantId: ctx.tenantId, projectId },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return row?.sortKey ?? null;
    }

    /** The sort keys of the given fields of a project (reorder neighbours). */
    static async fieldSortKeys(db: PrismaTx, ctx: RequestContext, projectId: string, ids: readonly string[]) {
        return db.customField.findMany({
            where: { tenantId: ctx.tenantId, projectId, id: { in: [...ids] } },
            take: ids.length,
            select: { id: true, sortKey: true },
        });
    }

    /** The field placed right after or before `anchor` in its project, skipping `exceptId`. */
    static async fieldNeighbour(
        db: PrismaTx,
        ctx: RequestContext,
        projectId: string,
        anchor: { id: string; sortKey: string },
        side: 'after' | 'before',
        exceptId: string,
    ) {
        const op = side === 'after' ? 'gt' : 'lt';
        return db.customField.findFirst({
            where: {
                tenantId: ctx.tenantId,
                projectId,
                NOT: { id: exceptId },
                OR: [{ sortKey: { [op]: anchor.sortKey } }, { sortKey: anchor.sortKey, id: { [op]: anchor.id } }],
            },
            orderBy: side === 'after' ? [{ sortKey: 'asc' }, { id: 'asc' }] : [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { id: true, sortKey: true },
        });
    }

    static async createField(
        db: PrismaTx,
        ctx: RequestContext,
        data: { projectId: string; name: string; type: CustomFieldType; sortKey: string; options: ReadonlyArray<{ name: string; color: string | null; sortKey: string }> },
    ) {
        const field = await db.customField.create({
            data: { tenantId: ctx.tenantId, projectId: data.projectId, name: data.name, type: data.type, sortKey: data.sortKey },
            select: { id: true },
        });
        if (data.options.length > 0) {
            await db.customFieldOption.createMany({ data: data.options.map((o) => ({ tenantId: ctx.tenantId, fieldId: field.id, ...o })) });
        }
        return (await db.customField.findFirst({ where: { id: field.id, tenantId: ctx.tenantId }, select: customFieldSelect }))!;
    }

    static async updateField(
        db: PrismaTx,
        ctx: RequestContext,
        fieldId: string,
        data: { name?: string; sortKey?: string; archivedAt?: Date | null },
    ) {
        await db.customField.updateMany({ where: { id: fieldId, tenantId: ctx.tenantId }, data });
    }

    // ── Options ──────────────────────────────────────────────────────

    static async countOptions(db: PrismaTx, ctx: RequestContext, fieldId: string) {
        return db.customFieldOption.count({ where: { tenantId: ctx.tenantId, fieldId } });
    }

    static async optionNameTaken(db: PrismaTx, ctx: RequestContext, fieldId: string, name: string, exceptId?: string) {
        const row = await db.customFieldOption.findFirst({
            where: { tenantId: ctx.tenantId, fieldId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return row !== null;
    }

    static async lastOptionSortKey(db: PrismaTx, ctx: RequestContext, fieldId: string) {
        const row = await db.customFieldOption.findFirst({
            where: { tenantId: ctx.tenantId, fieldId },
            orderBy: [{ sortKey: 'desc' }, { id: 'desc' }],
            select: { sortKey: true },
        });
        return row?.sortKey ?? null;
    }

    static async getOption(db: PrismaTx, ctx: RequestContext, fieldId: string, optionId: string) {
        return db.customFieldOption.findFirst({ where: { id: optionId, fieldId, tenantId: ctx.tenantId }, select: optionSelect });
    }

    static async createOption(db: PrismaTx, ctx: RequestContext, data: { fieldId: string; name: string; color: string | null; sortKey: string }) {
        return db.customFieldOption.create({ data: { tenantId: ctx.tenantId, ...data }, select: optionSelect });
    }

    static async updateOption(
        db: PrismaTx,
        ctx: RequestContext,
        optionId: string,
        data: { name?: string; color?: string | null; archivedAt?: Date | null },
    ) {
        await db.customFieldOption.updateMany({ where: { id: optionId, tenantId: ctx.tenantId }, data });
    }

    /** Does any value (on any item, deleted ones included) hold the option? */
    static async optionInUse(db: PrismaTx, ctx: RequestContext, optionId: string) {
        const row = await db.customFieldValue.findFirst({ where: { tenantId: ctx.tenantId, optionId }, select: { id: true } });
        return row !== null;
    }

    static async deleteOption(db: PrismaTx, ctx: RequestContext, optionId: string) {
        const result = await db.customFieldOption.deleteMany({ where: { id: optionId, tenantId: ctx.tenantId } });
        return result.count;
    }

    // ── Values ───────────────────────────────────────────────────────

    /** The option ids an item holds for one field (archived options may stay held). */
    static async heldOptionIds(db: PrismaTx, ctx: RequestContext, workItemId: string, fieldId: string) {
        const rows = await db.customFieldValue.findMany({
            where: { tenantId: ctx.tenantId, workItemId, fieldId, optionId: { not: null } },
            take: CUSTOM_FIELD_LIMITS.optionsPerField,
            select: { optionId: true },
        });
        return new Set(rows.map((r) => r.optionId!));
    }

    /**
     * Replace an item's value for one field: delete its rows, then insert the
     * new ones. The caller has bumped the item's version in the same
     * transaction (ADR 0002 §9).
     */
    static async replaceValues(
        db: PrismaTx,
        ctx: RequestContext,
        item: { id: string; projectId: string },
        field: { id: string; type: CustomFieldType },
        rows: readonly CustomFieldValueData[],
    ) {
        await db.customFieldValue.deleteMany({ where: { tenantId: ctx.tenantId, workItemId: item.id, fieldId: field.id } });
        if (rows.length === 0) return;
        await db.customFieldValue.createMany({
            data: rows.map((r) => ({
                tenantId: ctx.tenantId,
                projectId: item.projectId,
                workItemId: item.id,
                fieldId: field.id,
                fieldType: field.type,
                ...r,
            })),
        });
    }

    /** Remove every value of the given items (a move to another project). */
    static async deleteValuesOfItems(db: PrismaTx, ctx: RequestContext, workItemIds: readonly string[]) {
        if (workItemIds.length === 0) return 0;
        const result = await db.customFieldValue.deleteMany({ where: { tenantId: ctx.tenantId, workItemId: { in: [...workItemIds] } } });
        return result.count;
    }

    /** A batch of the items holding `userId` as a person value. */
    static async itemsWithPerson(db: PrismaTx, ctx: RequestContext, userId: string) {
        const rows = await db.customFieldValue.findMany({
            where: { tenantId: ctx.tenantId, userId },
            take: PERSON_VALUE_BATCH,
            select: { id: true, workItemId: true },
        });
        return rows;
    }

    static async deleteValues(db: PrismaTx, ctx: RequestContext, ids: readonly string[]) {
        if (ids.length === 0) return 0;
        const result = await db.customFieldValue.deleteMany({ where: { tenantId: ctx.tenantId, id: { in: [...ids] } } });
        return result.count;
    }
}
