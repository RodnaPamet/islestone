/**
 * Custom fields (sub-phase 2.4; ADR 0002 §7, §9; docs/porting/maps/2.4.md):
 * a project's field definitions and options, and an item's values.
 *
 *   - Definitions take `projects.edit` (`assertCanManageCustomFields`) and
 *     read under `projects.view`; the project must be visible, and writable
 *     for a change. A field's type never changes (the value's composite FK
 *     holds it); a field is archived, never deleted, and keeps its values.
 *   - An option in use is archived, not deleted: a delete is refused while a
 *     value holds it (`OPTION_IN_USE`; Kaneo's rule, pattern only). An
 *     archived option stays valid where it is held and in filters, and is
 *     not newly picked.
 *   - A value write is a single-field change (ADR 0002 §9): one versioned
 *     `updateMany` bumps the item's version (`If-Match` optional; a stale one
 *     is a 409 with the current row), then the value rows are replaced, in one
 *     transaction. The audit entry names the field, never the value.
 *   - TEXT and URL values are plaintext by ADR 0002 §7 (filterable); they are
 *     sanitised before they are stored.
 *
 * Written fresh for Islestone.
 */
import type { CustomFieldType } from '@prisma/client';

import { logEvent } from '../events/audit';
import { assertFieldWrite } from './field-set';
import { CustomFieldRepository, type CustomFieldRow, type CustomFieldValueData } from '../repositories/CustomFieldRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { assertCanManageCustomFields, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { parseCustomFieldCondition, parseCustomFieldValue, type CustomFieldCondition, type ParsedCustomFieldValue } from '../domain/custom-field';
import { keyBetween } from '../domain/fractional-index';
import { getWorkItem } from './work-item';
import { assertProjectWritable, keyOf, loadWritableItem, parseDateOnly, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText, sanitizeUrlText } from '@/lib/security/sanitize';
import { CUSTOM_FIELD_LIMITS, CUSTOM_FIELD_TYPE_SPECS } from '@/lib/work-items/custom-fields';

/** A field as the API returns it. */
export function toCustomFieldDto(field: CustomFieldRow) {
    return {
        id: field.id,
        projectId: field.projectId,
        name: field.name,
        type: field.type,
        sortKey: field.sortKey,
        archived: field.archivedAt !== null,
        options: field.options.map((o) => ({ id: o.id, name: o.name, color: o.color, sortKey: o.sortKey, archived: o.archivedAt !== null })),
    };
}

export type CustomFieldDto = ReturnType<typeof toCustomFieldDto>;

function cleanName(raw: string, what: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest(`A ${what} needs a name.`);
    if (name.length > CUSTOM_FIELD_LIMITS.nameLength) throw badRequest(`A ${what} name is at most ${CUSTOM_FIELD_LIMITS.nameLength} characters.`);
    return name;
}

async function loadProject(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectId: string) {
    const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
    if (!project) throw notFound('Project not found');
    return project;
}

/** A field of the project, or a 404 (another project's field is not this project's). */
async function loadField(db: PrismaTx, ctx: RequestContext, projectId: string, fieldId: string) {
    const field = await CustomFieldRepository.getField(db, ctx, fieldId);
    if (!field || field.projectId !== projectId) throw notFound('Field not found');
    return field;
}

// ─── Definitions ──────────────────────────────────────────────────────────

export async function listCustomFields(ctx: RequestContext, projectId: string, opts: { includeArchived?: boolean } = {}) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        await loadProject(db, ctx, v, projectId);
        return (await CustomFieldRepository.listFields(db, ctx, projectId, opts)).map(toCustomFieldDto);
    });
}

export interface CreateCustomFieldInput {
    name: string;
    type: CustomFieldType;
    options?: ReadonlyArray<{ name: string; color?: string | null }>;
}

function cleanOptions(raw: CreateCustomFieldInput['options']): Array<{ name: string; color: string | null }> {
    const seen = new Set<string>();
    const out: Array<{ name: string; color: string | null }> = [];
    for (const o of raw ?? []) {
        const name = cleanName(o.name, 'option');
        if (seen.has(name)) throw badRequest(`The option ${name} is listed twice.`);
        seen.add(name);
        out.push({ name, color: o.color ?? null });
    }
    return out;
}

export async function createCustomField(ctx: RequestContext, projectId: string, input: CreateCustomFieldInput): Promise<CustomFieldDto> {
    assertCanManageCustomFields(ctx);
    const name = cleanName(input.name, 'field');
    const spec = CUSTOM_FIELD_TYPE_SPECS[input.type];
    const options = cleanOptions(input.options);
    if (!spec.hasOptions && options.length > 0) throw badRequest(`A ${input.type} field has no options.`);
    if (spec.hasOptions && options.length === 0) throw badRequest('A select field needs at least one option.');
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        // The project row lock serialises field creates (the cap and the order).
        await ProjectRepository.lock(db, ctx, project.id);
        if ((await CustomFieldRepository.countFields(db, ctx, project.id)) >= CUSTOM_FIELD_LIMITS.fieldsPerProject) {
            throw new ConflictError(`A project has at most ${CUSTOM_FIELD_LIMITS.fieldsPerProject} fields.`, { reason: 'FIELD_LIMIT' });
        }
        if (await CustomFieldRepository.fieldNameTaken(db, ctx, project.id, name)) {
            throw new ConflictError(`This project already has a field named ${name}.`, { reason: 'FIELD_NAME_TAKEN' });
        }
        const sortKey = keyBetween(await CustomFieldRepository.lastFieldSortKey(db, ctx, project.id), null);
        let last: string | null = null;
        const optionRows = options.map((o) => {
            last = keyBetween(last, null);
            return { ...o, sortKey: last };
        });
        const field = await CustomFieldRepository.createField(db, ctx, { projectId: project.id, name, type: input.type, sortKey, options: optionRows });
        await logEvent(db, ctx, {
            action: 'CUSTOM_FIELD_CREATED',
            entityType: 'CustomField',
            entityId: field.id,
            details: `Created field ${name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'CustomField', operation: 'created' },
            metadata: { projectId: project.id, type: input.type, optionCount: optionRows.length },
        });
        return toCustomFieldDto(field);
    });
}

export interface UpdateCustomFieldInput {
    name?: string;
    archived?: boolean;
    position?: { afterId?: string; beforeId?: string };
}

export async function updateCustomField(ctx: RequestContext, projectId: string, fieldId: string, input: UpdateCustomFieldInput): Promise<CustomFieldDto> {
    assertCanManageCustomFields(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        await ProjectRepository.lock(db, ctx, project.id);
        const field = await loadField(db, ctx, project.id, fieldId);
        const data: { name?: string; sortKey?: string; archivedAt?: Date | null } = {};
        const changedFields: string[] = [];
        if (input.name !== undefined) {
            const name = cleanName(input.name, 'field');
            if (name !== field.name) {
                if (await CustomFieldRepository.fieldNameTaken(db, ctx, project.id, name, field.id)) {
                    throw new ConflictError(`This project already has a field named ${name}.`, { reason: 'FIELD_NAME_TAKEN' });
                }
                data.name = name;
                changedFields.push('name');
            }
        }
        if (input.archived !== undefined && input.archived !== (field.archivedAt !== null)) {
            data.archivedAt = input.archived ? new Date() : null;
            changedFields.push('archivedAt');
        }
        if (input.position) {
            const anchorId = (input.position.afterId ?? input.position.beforeId)!;
            if (anchorId === field.id) throw badRequest('A field cannot be placed next to itself.');
            const [anchor] = await CustomFieldRepository.fieldSortKeys(db, ctx, project.id, [anchorId]);
            if (!anchor) throw badRequest('The position names a field that is not in this project.');
            const side = input.position.afterId ? 'after' : 'before';
            const neighbour = await CustomFieldRepository.fieldNeighbour(db, ctx, project.id, anchor, side, field.id);
            data.sortKey =
                side === 'after'
                    ? keyBetween(anchor.sortKey, neighbour && neighbour.sortKey > anchor.sortKey ? neighbour.sortKey : null)
                    : keyBetween(neighbour && neighbour.sortKey < anchor.sortKey ? neighbour.sortKey : null, anchor.sortKey);
            changedFields.push('sortKey');
        }
        if (changedFields.length > 0) {
            await CustomFieldRepository.updateField(db, ctx, field.id, data);
            const action = data.archivedAt !== undefined && changedFields.length === 1
                ? (data.archivedAt ? 'CUSTOM_FIELD_ARCHIVED' : 'CUSTOM_FIELD_RESTORED')
                : 'CUSTOM_FIELD_UPDATED';
            await logEvent(db, ctx, {
                action,
                entityType: 'CustomField',
                entityId: field.id,
                details: `Changed field ${field.name} in ${project.keyPrefix}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'CustomField', operation: 'updated', changedFields },
                metadata: { projectId: project.id },
            });
        }
        return toCustomFieldDto((await CustomFieldRepository.getField(db, ctx, field.id))!);
    });
}

export async function addCustomFieldOption(
    ctx: RequestContext,
    projectId: string,
    fieldId: string,
    input: { name: string; color?: string | null },
): Promise<CustomFieldDto> {
    assertCanManageCustomFields(ctx);
    const name = cleanName(input.name, 'option');
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        await ProjectRepository.lock(db, ctx, project.id);
        const field = await loadField(db, ctx, project.id, fieldId);
        if (!CUSTOM_FIELD_TYPE_SPECS[field.type].hasOptions) throw badRequest(`A ${field.type} field has no options.`);
        if ((await CustomFieldRepository.countOptions(db, ctx, field.id)) >= CUSTOM_FIELD_LIMITS.optionsPerField) {
            throw new ConflictError(`A field has at most ${CUSTOM_FIELD_LIMITS.optionsPerField} options.`, { reason: 'OPTION_LIMIT' });
        }
        if (await CustomFieldRepository.optionNameTaken(db, ctx, field.id, name)) {
            throw new ConflictError(`This field already has an option named ${name}.`, { reason: 'OPTION_NAME_TAKEN' });
        }
        const sortKey = keyBetween(await CustomFieldRepository.lastOptionSortKey(db, ctx, field.id), null);
        const option = await CustomFieldRepository.createOption(db, ctx, { fieldId: field.id, name, color: input.color ?? null, sortKey });
        await logEvent(db, ctx, {
            action: 'CUSTOM_FIELD_OPTION_CREATED',
            entityType: 'CustomFieldOption',
            entityId: option.id,
            details: `Added option ${name} to field ${field.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'CustomFieldOption', operation: 'created' },
            metadata: { projectId: project.id, fieldId: field.id },
        });
        return toCustomFieldDto((await CustomFieldRepository.getField(db, ctx, field.id))!);
    });
}

export async function updateCustomFieldOption(
    ctx: RequestContext,
    projectId: string,
    fieldId: string,
    optionId: string,
    input: { name?: string; color?: string | null; archived?: boolean },
): Promise<CustomFieldDto> {
    assertCanManageCustomFields(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        const field = await loadField(db, ctx, project.id, fieldId);
        const option = await CustomFieldRepository.getOption(db, ctx, field.id, optionId);
        if (!option) throw notFound('Option not found');
        const data: { name?: string; color?: string | null; archivedAt?: Date | null } = {};
        if (input.name !== undefined) {
            const name = cleanName(input.name, 'option');
            if (name !== option.name) {
                if (await CustomFieldRepository.optionNameTaken(db, ctx, field.id, name, option.id)) {
                    throw new ConflictError(`This field already has an option named ${name}.`, { reason: 'OPTION_NAME_TAKEN' });
                }
                data.name = name;
            }
        }
        if (input.color !== undefined) data.color = input.color;
        if (input.archived !== undefined && input.archived !== (option.archivedAt !== null)) data.archivedAt = input.archived ? new Date() : null;
        const changedFields = Object.keys(data);
        if (changedFields.length > 0) {
            await CustomFieldRepository.updateOption(db, ctx, option.id, data);
            await logEvent(db, ctx, {
                action: 'CUSTOM_FIELD_OPTION_UPDATED',
                entityType: 'CustomFieldOption',
                entityId: option.id,
                details: `Changed option ${option.name} of field ${field.name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'CustomFieldOption', operation: 'updated', changedFields },
                metadata: { projectId: project.id, fieldId: field.id },
            });
        }
        return toCustomFieldDto((await CustomFieldRepository.getField(db, ctx, field.id))!);
    });
}

/** Delete an option no value holds; one in use is archived instead (409 `OPTION_IN_USE`). */
export async function deleteCustomFieldOption(ctx: RequestContext, projectId: string, fieldId: string, optionId: string) {
    assertCanManageCustomFields(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        const field = await loadField(db, ctx, project.id, fieldId);
        const option = await CustomFieldRepository.getOption(db, ctx, field.id, optionId);
        if (!option) throw notFound('Option not found');
        if (await CustomFieldRepository.optionInUse(db, ctx, option.id)) {
            throw new ConflictError(`Work items hold ${option.name}: archive it instead, or pick another option on them first.`, {
                reason: 'OPTION_IN_USE',
            });
        }
        await CustomFieldRepository.deleteOption(db, ctx, option.id);
        await logEvent(db, ctx, {
            action: 'CUSTOM_FIELD_OPTION_DELETED',
            entityType: 'CustomFieldOption',
            entityId: option.id,
            details: `Deleted option ${option.name} of field ${field.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'CustomFieldOption', operation: 'deleted' },
            metadata: { projectId: project.id, fieldId: field.id },
        });
        return { deleted: true };
    });
}

// ─── Values ───────────────────────────────────────────────────────────────

/**
 * The rows a parsed value stores, checked against the database: an option of
 * THIS field, live unless the item already holds it; a person who is an
 * ACTIVE member. Text is sanitised here, before it is stored.
 */
async function valueRows(
    db: PrismaTx,
    ctx: RequestContext,
    field: CustomFieldRow,
    parsed: ParsedCustomFieldValue,
    held: ReadonlySet<string>,
): Promise<CustomFieldValueData[]> {
    switch (parsed.kind) {
        case 'clear':
            return [];
        case 'text':
            return [{ textValue: parsed.value }];
        case 'number':
            return [{ numberValue: parsed.value }];
        case 'date':
            return [{ dateValue: parseDateOnly(parsed.value)! }];
        case 'checked':
            return [{ boolValue: true }];
        case 'options': {
            const byId = new Map(field.options.map((o) => [o.id, o]));
            for (const id of parsed.optionIds) {
                const option = byId.get(id);
                if (!option) throw badRequest(`The option ${id} is not an option of ${field.name}.`);
                if (option.archivedAt && !held.has(id)) throw badRequest(`The option ${option.name} is archived and cannot be picked.`);
            }
            return parsed.optionIds.map((optionId) => ({ optionId }));
        }
        case 'person': {
            const active = await MembershipRepository.listActiveUserIds(db, ctx, [parsed.userId]);
            if (!active.has(parsed.userId)) throw badRequest(`${field.name} must name an active member of this workspace.`);
            return [{ userId: parsed.userId }];
        }
    }
}

/** Sanitise free text before parsing (TEXT: plain text; URL: the URL form). */
function sanitizedRaw(type: CustomFieldType, raw: unknown): unknown {
    if (typeof raw !== 'string') return raw;
    if (type === 'TEXT') return sanitizePlainText(raw);
    if (type === 'URL') return sanitizeUrlText(raw);
    return raw;
}

/**
 * Check a template's `customFields` against the project as it is (sub-phase
 * 2.5c): every field live, every value parsing and naming a live option or an
 * active member. Returns the values with their text sanitised, ready to store.
 */
export async function checkCustomFieldValues(
    db: PrismaTx,
    ctx: RequestContext,
    projectId: string,
    raw: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
    const fieldIds = Object.keys(raw);
    if (fieldIds.length === 0) return {};
    const fields = await CustomFieldRepository.listFields(db, ctx, projectId);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: Record<string, unknown> = {};
    for (const fieldId of fieldIds) {
        const field = byId.get(fieldId);
        if (!field) throw badRequest(`${fieldId} is not a live field of this project.`);
        const value = sanitizedRaw(field.type, raw[fieldId]);
        const parsed = parseCustomFieldValue(field.type, value);
        // guardrail-allow: n+1 — one check per field of the template, bounded by the project's field cap (50).
        const rows = await valueRows(db, ctx, field, parsed, new Set());
        if (rows.length > 0) out[fieldId] = value;
    }
    return out;
}

/**
 * Write the create's `customFields` for a new item, in the create's
 * transaction (the version is still 1: the values are part of the item as
 * created). Every field must be a live field of the item's project.
 */
export async function writeInitialCustomFieldValues(
    db: PrismaTx,
    ctx: RequestContext,
    item: { id: string; projectId: string },
    raw: Readonly<Record<string, unknown>>,
): Promise<string[]> {
    const fieldIds = Object.keys(raw);
    if (fieldIds.length === 0) return [];
    const fields = await CustomFieldRepository.listFields(db, ctx, item.projectId);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const written: string[] = [];
    for (const fieldId of fieldIds) {
        const field = byId.get(fieldId);
        if (!field) throw badRequest(`${fieldId} is not a live field of this project.`);
        const parsed = parseCustomFieldValue(field.type, sanitizedRaw(field.type, raw[fieldId]));
        const rows = await valueRows(db, ctx, field, parsed, new Set());
        // guardrail-allow: n+1 — one replace per field of the create, bounded by the project's field cap (50).
        await CustomFieldRepository.replaceValues(db, ctx, item, field, rows);
        if (rows.length > 0) written.push(field.id);
    }
    return written;
}

/**
 * Set (or clear, with `null`) one field's value on an item. A single-field
 * change (ADR 0002 §9): `If-Match` optional, the version increases.
 */
export async function setWorkItemCustomFieldValue(
    ctx: RequestContext,
    workItemId: string,
    fieldId: string,
    rawValue: unknown,
    expectedVersion?: number,
) {
    assertCanEditWorkItems(ctx);
    await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, workItemId);
        const field = await CustomFieldRepository.getField(db, ctx, fieldId);
        if (!field || field.projectId !== item.projectId) throw notFound('Field not found');
        if (field.archivedAt) throw new ConflictError(`${field.name} is archived and takes no values.`, { reason: 'FIELD_ARCHIVED' });
        const parsed = parseCustomFieldValue(field.type, sanitizedRaw(field.type, rawValue));
        const held = CUSTOM_FIELD_TYPE_SPECS[field.type].hasOptions ? await CustomFieldRepository.heldOptionIds(db, ctx, item.id, field.id) : new Set<string>();
        const rows = await valueRows(db, ctx, field, parsed, held);
        // The type's field set (2.4b-b): a hidden field takes no value, a required one is not cleared on an open item.
        await assertFieldWrite(db, ctx, item, { customFields: { [field.id]: rows.length > 0 ? 'set' : null } });
        // The version first: its WHERE is the version check (ADR 0002 §9).
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, item.id, expectedVersion, {});
        if (count === 0) await throwWriteConflict(db, ctx, v, item.id);
        await CustomFieldRepository.replaceValues(db, ctx, item, field, rows);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_CUSTOM_FIELD_SET',
            entityType: 'WorkItem',
            entityId: item.id,
            details: rows.length ? `Set ${field.name} on ${keyOf(item)}` : `Cleared ${field.name} on ${keyOf(item)}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'WorkItem',
                operation: 'updated',
                changedFields: [`customField:${field.id}`],
            },
            metadata: { fieldId: field.id, fieldName: field.name, fieldType: field.type, cleared: rows.length === 0 },
        });
    });
    return getWorkItem(ctx, workItemId);
}

/**
 * Before a member's membership goes (`removeTenantMember`): clear every
 * person value naming them and bump those items' versions, so the NO ACTION
 * foreign key does not refuse the delete and no view keeps a stale person.
 * A bounded drain, in the caller's transaction.
 */
export async function clearPersonValuesInTx(db: PrismaTx, ctx: RequestContext, userId: string): Promise<number> {
    let cleared = 0;
    for (;;) {
        // guardrail-allow: n+1 — a batched drain: each pass reads one bounded batch and deletes it.
        const batch = await CustomFieldRepository.itemsWithPerson(db, ctx, userId);
        if (batch.length === 0) break;
        // The batch's items locked (member removal locks them all first, so
        // this is a no-op there; decision 173), then the values go.
        const locked = await WorkItemRepository.lockForWrite(db, ctx, batch.map((b) => b.workItemId));
        await CustomFieldRepository.deleteValues(db, ctx, batch.map((b) => b.id));
        await WorkItemRepository.bumpVersion(db, ctx, { kind: 'ALL' }, locked);
        cleared += batch.length;
    }
    return cleared;
}

// ─── The list's custom-field conditions and sort ──────────────────────────

/**
 * Resolve the list query's `cf.<fieldId>` conditions and a `cf:<fieldId>`
 * sort against the fields themselves: an unknown field is a 400 (never
 * "matches nothing"), an operator the type does not take is a 400, and a
 * field that cannot be sorted is a 400. Archived fields still filter (a saved
 * view keeps working); they are not offered in the views.
 */
export async function resolveListCustomFields(
    db: PrismaTx,
    ctx: RequestContext,
    raw: Readonly<Record<string, string>>,
    sortFieldId: string | null,
): Promise<{
    conditions: Array<{ field: { id: string; type: CustomFieldType }; condition: CustomFieldCondition }>;
    sortField: { id: string; type: CustomFieldType } | null;
}> {
    const ids = [...new Set([...Object.keys(raw), ...(sortFieldId ? [sortFieldId] : [])])];
    if (Object.keys(raw).length > CUSTOM_FIELD_LIMITS.conditionsPerQuery) {
        throw badRequest(`At most ${CUSTOM_FIELD_LIMITS.conditionsPerQuery} field filters in one query.`);
    }
    if (ids.length === 0) return { conditions: [], sortField: null };
    const fields = new Map((await CustomFieldRepository.getFields(db, ctx, ids)).map((f) => [f.id, f]));
    const conditions = Object.entries(raw).map(([fieldId, value]) => {
        const field = fields.get(fieldId);
        if (!field) throw badRequest(`Unknown field ${fieldId}.`);
        return { field: { id: field.id, type: field.type }, condition: parseCustomFieldCondition(field.type, value, ctx.userId) };
    });
    let sortField: { id: string; type: CustomFieldType } | null = null;
    if (sortFieldId) {
        const field = fields.get(sortFieldId);
        if (!field) throw badRequest(`Unknown field ${sortFieldId}.`);
        if (!CUSTOM_FIELD_TYPE_SPECS[field.type].sortable) throw badRequest(`A ${field.type} field cannot be sorted.`);
        sortField = { id: field.id, type: field.type };
    }
    return { conditions, sortField };
}
