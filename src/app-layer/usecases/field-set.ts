/**
 * Field sets (sub-phase 2.4b-b; ADR 0002 §1 and §7; owner decisions 101 and
 * 108 to 112): the rules, who changes them, and the checks every write path
 * asks.
 *
 *   - **Rules.** A built-in field's rule belongs to the type across the
 *     workspace, changed under `admin.manage` (decision 112, as types are);
 *     a custom field's rule belongs to the type within the field's project,
 *     changed under `projects.edit` (as the field's definition). Both are
 *     read under `projects.view`.
 *   - **Checks** (decisions 109 and 111), the same for every caller: a create
 *     leaves no required field empty (an open item; a closed one is never
 *     refused) and names no hidden one; a write that empties a required
 *     field of an open item is refused; a type change is checked against the
 *     new type's whole set; a write that sets a hidden field is refused.
 *     Values a template or a repeat's source brings into a hidden field are
 *     skipped and named, never sent. Refusals are 400s naming the fields:
 *     `FIELD_SET_UNMET` and `FIELD_HIDDEN`. Existing items are not rewritten.
 *
 * The evaluation is `src/lib/work-items/field-sets.ts`, which the forms use
 * too. Written fresh for Islestone.
 */
import type { FieldRequirement } from '@prisma/client';

import { logEvent } from '../events/audit';
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import { FieldSetRepository, type FieldSetRecord } from '../repositories/FieldSetRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import {
    assertCanManageCustomFields,
    assertCanManageWorkConfig,
    assertCanReadWorkConfig,
} from '../policies/work-config.policies';
import { visibleProjects } from '../policies/project-visibility';
import { assertProjectWritable } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, badRequest, notFound } from '@/lib/errors/types';
import {
    allowedRequirements,
    CONFIGURABLE_BUILT_IN_FIELDS,
    defaultRequirement,
    fieldLabel,
    fieldSetGaps,
    hiddenFieldsSet,
    isBuiltInField,
    isClosedCategory,
    namesField,
    resolveFieldSet,
    type BuiltInField,
    type FieldKey,
    type FieldRequirementValue,
    type FieldSetEntry,
    type FieldValues,
    type ResolvedFieldSet,
} from '@/lib/work-items/field-sets';

export const FIELD_SET_UNMET = 'FIELD_SET_UNMET' as const;
export const FIELD_HIDDEN = 'FIELD_HIDDEN' as const;

function toEntry(r: FieldSetRecord): FieldSetEntry {
    return { typeId: r.typeId, projectId: r.projectId, builtInField: r.builtInField, customFieldId: r.customFieldId, requirement: r.requirement };
}

// ─── The checks ───────────────────────────────────────────────────────────

/** A type's field set in a project, with the live custom fields' names for messages. */
export interface LoadedFieldSet {
    set: ResolvedFieldSet;
    names: ReadonlyMap<string, string>;
}

/**
 * Field sets for several types in one project, read once (a create and its
 * template's sub-items, a project template's starter items).
 */
export async function loadFieldSets(db: PrismaTx, ctx: RequestContext, typeIds: readonly string[], projectId: string): Promise<Map<string, LoadedFieldSet>> {
    const unique = [...new Set(typeIds)];
    const [rules, fields] = await Promise.all([
        FieldSetRepository.listForTypesInProject(db, ctx, unique, projectId),
        CustomFieldRepository.listFields(db, ctx, projectId),
    ]);
    const rows = rules.map(toEntry);
    const live = fields.map((f) => f.id);
    const names = new Map(fields.map((f) => [f.id, f.name]));
    return new Map(unique.map((typeId) => [typeId, { set: resolveFieldSet(rows, typeId, { projectId, liveCustomFieldIds: live }), names }]));
}

export async function loadFieldSet(db: PrismaTx, ctx: RequestContext, typeId: string, projectId: string): Promise<LoadedFieldSet> {
    return (await loadFieldSets(db, ctx, [typeId], projectId)).get(typeId)!;
}

function listNames(keys: readonly FieldKey[], names: ReadonlyMap<string, string>): string {
    return keys.map((k) => fieldLabel(k, names)).join(', ');
}

/** 400 `FIELD_SET_UNMET`: the required fields left empty, by name and key. */
export function fieldSetUnmet(keys: readonly FieldKey[], names: ReadonlyMap<string, string>, subject = 'This work item'): AppError {
    return badRequest(`${subject} needs these fields: ${listNames(keys, names)}.`, { reason: FIELD_SET_UNMET, fields: keys });
}

/** 400 `FIELD_HIDDEN`: the hidden fields a write tried to set. */
export function fieldHidden(keys: readonly FieldKey[], names: ReadonlyMap<string, string>): AppError {
    return badRequest(`These fields are hidden for this type: ${listNames(keys, names)}.`, { reason: FIELD_HIDDEN, fields: keys });
}

/** Is this error a field-set refusal (a repeat holds on one, decision 111)? */
export function isFieldSetRefusal(err: unknown): boolean {
    if (!(err instanceof AppError)) return false;
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    return reason === FIELD_SET_UNMET || reason === FIELD_HIDDEN;
}

/** Drop `key` from `values` (a hidden value a template brought). */
function withoutField(values: FieldValues, key: FieldKey): FieldValues {
    if (key.startsWith('cf:')) {
        const { [key.slice(3)]: _gone, ...rest } = values.customFields ?? {};
        void _gone;
        return { ...values, customFields: rest };
    }
    const out: FieldValues = { ...values };
    switch (key as BuiltInField) {
        case 'description':
            out.description = null;
            break;
        case 'assignee':
            out.assigneeId = null;
            break;
        case 'waitingOn':
            out.waitingOnUserId = null;
            break;
        case 'priority':
            out.priority = 'NONE';
            break;
        case 'labels':
            out.labelIds = [];
            break;
        case 'startDate':
            out.startDate = null;
            break;
        case 'dueDate':
            out.dueDate = null;
            break;
        case 'cycle':
            out.cycleId = null;
            break;
        case 'milestone':
            out.milestoneId = null;
            break;
        case 'answer':
            out.answerCommentId = null;
            break;
        case 'goal':
            out.goalId = null;
            break;
    }
    return out;
}

/**
 * A create's check (decision 111): `values` is the whole new item. Hidden
 * values in `projected` keys (a template's or a repeat source's) are dropped
 * and named `hidden:<key>`; a hidden value the request named is refused. Then,
 * for an open item, every required field must be filled.
 */
export function checkCreate(
    loaded: LoadedFieldSet,
    values: FieldValues,
    opts: { open: boolean; projected?: (key: FieldKey) => boolean; subject?: string },
): { values: FieldValues; skipped: string[] } {
    let out = values;
    const skipped: string[] = [];
    const refused: FieldKey[] = [];
    for (const key of hiddenFieldsSet(loaded.set, values)) {
        if (opts.projected?.(key)) {
            out = withoutField(out, key);
            skipped.push(`hidden:${key}`);
        } else {
            refused.push(key);
        }
    }
    if (refused.length > 0) throw fieldHidden(refused, loaded.names);
    if (opts.open) {
        const gaps = fieldSetGaps(loaded.set, out);
        if (gaps.length > 0) throw fieldSetUnmet(gaps, loaded.names, opts.subject);
    }
    return { values: out, skipped };
}

/**
 * A write to an existing item (decision 109): `named` are the fields it
 * sets. A hidden field set to a value is refused; a required field it
 * empties on an open item is refused. Nothing else about the item is judged.
 */
export function checkWrite(loaded: LoadedFieldSet, named: FieldValues, opts: { open: boolean; subject?: string }): void {
    const hidden = hiddenFieldsSet(loaded.set, named);
    if (hidden.length > 0) throw fieldHidden(hidden, loaded.names);
    if (!opts.open) return;
    const keys = [...CONFIGURABLE_BUILT_IN_FIELDS, ...Object.keys(named.customFields ?? {}).map((id) => `cf:${id}` as const)].filter((k) => namesField(k, named));
    const gaps = fieldSetGaps(loaded.set, named, keys);
    if (gaps.length > 0) throw fieldSetUnmet(gaps, loaded.names, opts.subject);
}

/**
 * A type change on an open item: the item as it will be (its values with the
 * write applied) must fill every required field of the new type.
 */
export function checkTypeChange(loaded: LoadedFieldSet, after: FieldValues, opts: { open: boolean }): void {
    if (!opts.open) return;
    const gaps = fieldSetGaps(loaded.set, after);
    if (gaps.length > 0) throw fieldSetUnmet(gaps, loaded.names, 'With this type, the work item');
}

/** One single-field write on an existing item, checked against its own type's set. */
export async function assertFieldWrite(
    db: PrismaTx,
    ctx: RequestContext,
    item: { typeId: string; projectId: string; stateCategory: string },
    named: FieldValues,
): Promise<void> {
    checkWrite(await loadFieldSet(db, ctx, item.typeId, item.projectId), named, { open: !isClosedCategory(item.stateCategory) });
}

// ─── The rules ────────────────────────────────────────────────────────────

export interface TypeFields {
    typeId: string;
    fields: Array<{ field: BuiltInField; requirement: FieldRequirementValue; allowed: readonly FieldRequirementValue[] }>;
}

/** A type's built-in rules, every configurable field listed with its requirement (`projects.view`). */
export async function listTypeFields(ctx: RequestContext, typeId: string): Promise<TypeFields> {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        if (!(await WorkItemTypeRepository.getById(db, ctx, typeId))) throw notFound('Work item type not found');
        const rules = (await FieldSetRepository.listBuiltIn(db, ctx)).filter((r) => r.typeId === typeId).map(toEntry);
        const set = resolveFieldSet(rules, typeId);
        return {
            typeId,
            fields: CONFIGURABLE_BUILT_IN_FIELDS.map((field) => ({ field, requirement: set.builtIn[field], allowed: allowedRequirements(field) })),
        };
    });
}

function assertAllowed(field: BuiltInField | 'custom', requirement: FieldRequirementValue) {
    if (!allowedRequirements(field).includes(requirement)) {
        throw badRequest('The answer is shown or hidden, never required.', { reason: 'FIELD_REQUIREMENT_NOT_ALLOWED' });
    }
}

/** Set one built-in rule of a type (`admin.manage`, decision 112). The default removes the row. */
export async function setTypeField(ctx: RequestContext, typeId: string, input: { field: string; requirement: FieldRequirementValue }): Promise<TypeFields> {
    assertCanManageWorkConfig(ctx);
    if (!isBuiltInField(input.field)) throw badRequest('Unknown field.');
    const field = input.field;
    assertAllowed(field, input.requirement);
    await runInTenantContext(ctx, async (db) => {
        const type = await WorkItemTypeRepository.getById(db, ctx, typeId);
        if (!type) throw notFound('Work item type not found');
        const stored = input.requirement === defaultRequirement(field) ? null : (input.requirement as FieldRequirement);
        await FieldSetRepository.setBuiltIn(db, ctx, typeId, field, stored);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_FIELD_SET',
            entityType: 'WorkItemType',
            entityId: typeId,
            details: `Set ${field} to ${input.requirement} for the type ${type.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTypeField', operation: 'updated', changedFields: ['requirement'] },
            metadata: { field, requirement: input.requirement },
        });
    });
    return listTypeFields(ctx, typeId);
}

/** A project's custom-field rules for every type (`projects.view`). */
export async function listProjectTypeFields(ctx: RequestContext, projectId: string): Promise<FieldSetEntry[]> {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        if (!(await ProjectRepository.getVisible(db, ctx, v, projectId))) throw notFound('Project not found');
        return (await FieldSetRepository.listForProject(db, ctx, projectId)).map(toEntry);
    });
}

/** Set one custom field's rule for a type in its project (`projects.edit`, decision 112). OPTIONAL removes the row. */
export async function setProjectTypeField(
    ctx: RequestContext,
    projectId: string,
    input: { typeId: string; customFieldId: string; requirement: FieldRequirementValue },
): Promise<FieldSetEntry[]> {
    assertCanManageCustomFields(ctx);
    assertAllowed('custom', input.requirement);
    await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        assertProjectWritable(project);
        const type = await WorkItemTypeRepository.getById(db, ctx, input.typeId);
        if (!type) throw notFound('Work item type not found');
        const field = await CustomFieldRepository.getField(db, ctx, input.customFieldId);
        if (!field || field.projectId !== project.id) throw notFound('Field not found');
        if (field.archivedAt) throw badRequest(`The field ${field.name} is archived.`);
        const stored = input.requirement === 'OPTIONAL' ? null : (input.requirement as FieldRequirement);
        await FieldSetRepository.setCustom(db, ctx, type.id, project.id, field.id, stored);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_FIELD_SET',
            entityType: 'WorkItemType',
            entityId: type.id,
            details: `Set the field ${field.name} to ${input.requirement} for the type ${type.name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTypeField', operation: 'updated', changedFields: ['requirement'] },
            metadata: { projectId: project.id, customFieldId: field.id, requirement: input.requirement },
        });
    });
    return listProjectTypeFields(ctx, projectId);
}

/** Every type's built-in rules, plus a project's custom-field rules when given (the views' configuration). */
export async function fieldSetEntriesForViewsInTx(db: PrismaTx, ctx: RequestContext, projectId?: string): Promise<FieldSetEntry[]> {
    const [builtIn, custom] = await Promise.all([
        FieldSetRepository.listBuiltIn(db, ctx),
        projectId ? FieldSetRepository.listForProject(db, ctx, projectId) : Promise.resolve([]),
    ]);
    return [...builtIn, ...custom].map(toEntry);
}

