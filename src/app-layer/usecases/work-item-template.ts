/**
 * Item templates (sub-phase 2.5c; docs/porting/maps/2.5.md; owner decisions
 * 71 and 73).
 *
 * - A template belongs to one project: a name (unique in the project) and
 *   what a new item starts from: title, description (ENCRYPTED, sanitised
 *   before it is stored), type, priority, labels, assignee, "due in N days",
 *   custom-field values and sub-items.
 * - Read under `projects.view`, managed under `projects.edit`; an archived
 *   project's templates are read-only.
 * - Everything is checked against the project at save, and again at use by
 *   `templateToCreateInput` (the ONE projection from a template to an item):
 *   what no longer fits is skipped and named. A create with `templateId`
 *   (`createWorkItem`) is the only path from a template to an item, and its
 *   `WORK_ITEM_CREATED` entry records the template.
 *
 * Every write is audited. Written fresh for Islestone.
 */
import { Prisma } from '@prisma/client';

import { logEvent } from '../events/audit';
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import { LabelRepository } from '../repositories/LabelRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemTemplateRepository, type WorkItemTemplateData as TemplateColumns, type WorkItemTemplateRow } from '../repositories/TemplateRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import { assertCanManageItemTemplates, assertCanReadItemTemplates } from '../policies/template.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { keyBetween } from '../domain/fractional-index';
import type { TemplateItemSource, TemplateUseContext } from '../domain/work-item-template';
import { todayInTz } from '../notifications/work-item-due';
import { checkCustomFieldValues } from './custom-field';
import { assertLabelsUsable } from './work-item';
import { assertProjectWritable, notificationsTz } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { TEMPLATE_LIMITS } from '@/lib/schemas/template';
import type { WorkItemPriority, WorkItemTemplateData } from '@/lib/work-items/types';

function asRecord(v: Prisma.JsonValue | null): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asSubItems(v: Prisma.JsonValue | null): Array<{ title: string }> {
    if (!Array.isArray(v)) return [];
    return v.flatMap((s) => (s && typeof s === 'object' && !Array.isArray(s) && typeof s.title === 'string' ? [{ title: s.title }] : []));
}

export function toWorkItemTemplateData(row: WorkItemTemplateRow): WorkItemTemplateData {
    return {
        id: row.id,
        projectId: row.projectId,
        name: row.name,
        title: row.title,
        description: row.description,
        typeId: row.typeId,
        priority: row.priority,
        labelIds: row.labels.map((l) => l.labelId),
        assigneeId: row.assigneeId,
        dueInDays: row.dueInDays,
        customFields: asRecord(row.customFieldValuesJson),
        subItems: asSubItems(row.subItemsJson),
        archived: row.archivedAt !== null,
    };
}

/** What a template says a new item should be (for `templateToCreateInput`). */
export function templateSource(row: WorkItemTemplateRow): TemplateItemSource {
    const data = toWorkItemTemplateData(row);
    return {
        templateId: row.id,
        title: data.title,
        description: data.description,
        typeId: data.typeId,
        priority: data.priority,
        labelIds: data.labelIds,
        assigneeId: data.assigneeId,
        dueInDays: data.dueInDays,
        customFields: data.customFields,
        subItems: data.subItems,
    };
}

/** The project as a template is used against it: usable labels, active members, live fields and options. */
export async function templateUseContextInTx(
    db: PrismaTx,
    ctx: RequestContext,
    project: { id: string; teamId: string },
    peopleNamed: readonly string[],
): Promise<TemplateUseContext> {
    const [labels, fields, active] = await Promise.all([
        LabelRepository.list(db, ctx, { teamId: project.teamId }),
        CustomFieldRepository.listFields(db, ctx, project.id),
        MembershipRepository.listActiveUserIds(db, ctx, [...new Set(peopleNamed)]),
    ]);
    return {
        today: todayInTz(new Date(), notificationsTz()),
        usableLabelIds: new Set(labels.map((l) => l.id)),
        activeMemberIds: active,
        liveFields: new Map(fields.map((f) => [f.id, { type: f.type, liveOptionIds: new Set(f.options.filter((o) => !o.archivedAt).map((o) => o.id)) }])),
    };
}

/** The people a template names (its assignee and person-field values), to check they are still members. */
export function peopleNamedBy(source: TemplateItemSource): string[] {
    const out = source.assigneeId ? [source.assigneeId] : [];
    for (const v of Object.values(source.customFields)) if (typeof v === 'string') out.push(v);
    return out;
}

/** A live template of the project, or a 404; an archived one is a 409. */
export async function loadUsableTemplate(db: PrismaTx, ctx: RequestContext, projectId: string, templateId: string): Promise<WorkItemTemplateRow> {
    const row = await WorkItemTemplateRepository.getById(db, ctx, templateId);
    if (!row || row.projectId !== projectId) throw notFound('Template not found');
    if (row.archivedAt) throw new ConflictError(`The template ${row.name} is archived.`, { reason: 'TEMPLATE_ARCHIVED' });
    return row;
}

async function loadProject(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectId: string) {
    const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
    if (!project) throw notFound('Project not found');
    return project;
}

async function loadTemplate(db: PrismaTx, ctx: RequestContext, projectId: string, id: string) {
    const row = await WorkItemTemplateRepository.getById(db, ctx, id);
    if (!row || row.projectId !== projectId) throw notFound('Template not found');
    return row;
}

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest('A template needs a name.');
    if (name.length > TEMPLATE_LIMITS.nameLength) throw badRequest(`A template name is at most ${TEMPLATE_LIMITS.nameLength} characters.`);
    return name;
}

function cleanTitle(raw: string): string {
    const title = sanitizePlainText(raw).trim();
    if (!title) throw badRequest('A template needs a title for its items.');
    return title;
}

function cleanSubItems(raw: ReadonlyArray<{ title: string }>): Array<{ title: string }> {
    return raw.map((s) => ({ title: cleanTitle(s.title) }));
}

function nameTaken(name: string): never {
    throw new ConflictError(`This project already has a template named ${name}.`, { reason: 'TEMPLATE_NAME_TAKEN' });
}

export interface ItemTemplateInput {
    name?: string;
    title?: string;
    description?: string | null;
    typeId?: string | null;
    priority?: WorkItemPriority;
    labelIds?: string[];
    assigneeId?: string | null;
    dueInDays?: number | null;
    customFields?: Readonly<Record<string, unknown>>;
    subItems?: Array<{ title: string }>;
}

/** Check and clean what a save names, against the project as it is now. */
async function checkedColumns(
    db: PrismaTx,
    ctx: RequestContext,
    project: { id: string; teamId: string },
    input: ItemTemplateInput,
): Promise<{ data: Partial<TemplateColumns>; labelIds?: string[] }> {
    const data: Partial<TemplateColumns> = {};
    if (input.name !== undefined) data.name = cleanName(input.name);
    if (input.title !== undefined) data.title = cleanTitle(input.title);
    if (input.description !== undefined) data.description = input.description ? sanitizePlainText(input.description) : null;
    if (input.typeId !== undefined) {
        if (input.typeId) {
            const type = await WorkItemTypeRepository.getById(db, ctx, input.typeId);
            if (!type) throw notFound('Work item type not found');
            if (type.archivedAt) throw badRequest(`The type ${type.name} is archived.`);
        }
        data.typeId = input.typeId;
    }
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.assigneeId !== undefined) {
        if (input.assigneeId) {
            const active = await MembershipRepository.listActiveUserIds(db, ctx, [input.assigneeId]);
            if (!active.has(input.assigneeId)) throw badRequest('The assignee must be an active member of this workspace.');
        }
        data.assigneeId = input.assigneeId;
    }
    if (input.dueInDays !== undefined) data.dueInDays = input.dueInDays;
    if (input.customFields !== undefined) {
        const values = await checkCustomFieldValues(db, ctx, project.id, input.customFields);
        data.customFieldValuesJson = Object.keys(values).length > 0 ? (values as Prisma.InputJsonValue) : Prisma.DbNull;
    }
    if (input.subItems !== undefined) {
        const subs = cleanSubItems(input.subItems);
        data.subItemsJson = subs.length > 0 ? subs : Prisma.DbNull;
    }
    let labelIds: string[] | undefined;
    if (input.labelIds !== undefined) {
        labelIds = [...new Set(input.labelIds)];
        if (labelIds.length > 0) await assertLabelsUsable(db, ctx, labelIds, project.teamId);
    }
    return { data, labelIds };
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listWorkItemTemplates(ctx: RequestContext, projectId: string, opts: { includeArchived?: boolean } = {}): Promise<WorkItemTemplateData[]> {
    assertCanReadItemTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadProject(db, ctx, await visibleProjects(ctx, db), projectId);
        return (await WorkItemTemplateRepository.list(db, ctx, project.id, opts)).map(toWorkItemTemplateData);
    });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export async function createWorkItemTemplate(
    ctx: RequestContext,
    projectId: string,
    input: ItemTemplateInput & { name: string; title: string },
): Promise<WorkItemTemplateData> {
    assertCanManageItemTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadProject(db, ctx, await visibleProjects(ctx, db), projectId);
        assertProjectWritable(project);
        // The project row lock serialises template creates (the name and the order).
        await ProjectRepository.lock(db, ctx, project.id);
        const { data, labelIds } = await checkedColumns(db, ctx, project, input);
        if (await WorkItemTemplateRepository.nameTaken(db, ctx, project.id, data.name!)) nameTaken(data.name!);
        const sortKey = keyBetween(await WorkItemTemplateRepository.lastSortKey(db, ctx, project.id), null);
        const row = await WorkItemTemplateRepository.create(db, ctx, {
            name: data.name!,
            title: data.title!,
            description: data.description ?? null,
            typeId: data.typeId ?? null,
            priority: data.priority ?? 'NONE',
            assigneeId: data.assigneeId ?? null,
            dueInDays: data.dueInDays ?? null,
            customFieldValuesJson: data.customFieldValuesJson ?? Prisma.DbNull,
            subItemsJson: data.subItemsJson ?? Prisma.DbNull,
            projectId: project.id,
            sortKey,
            labelIds: labelIds ?? [],
        });
        await logEvent(db, ctx, {
            action: 'ITEM_TEMPLATE_CREATED',
            entityType: 'WorkItemTemplate',
            entityId: row.id,
            details: `Created item template ${row.name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTemplate', operation: 'created', summary: 'ITEM_TEMPLATE_CREATED' },
            metadata: { projectId: project.id },
        });
        return toWorkItemTemplateData(row);
    });
}

export async function updateWorkItemTemplate(
    ctx: RequestContext,
    projectId: string,
    templateId: string,
    input: ItemTemplateInput & { archived?: boolean; position?: { afterId?: string; beforeId?: string } },
): Promise<WorkItemTemplateData> {
    assertCanManageItemTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadProject(db, ctx, await visibleProjects(ctx, db), projectId);
        assertProjectWritable(project);
        await ProjectRepository.lock(db, ctx, project.id);
        const row = await loadTemplate(db, ctx, project.id, templateId);
        const { data, labelIds } = await checkedColumns(db, ctx, project, input);
        if (data.name !== undefined && data.name !== row.name && (await WorkItemTemplateRepository.nameTaken(db, ctx, project.id, data.name, row.id))) {
            nameTaken(data.name);
        }
        const extra: { sortKey?: string; archivedAt?: Date | null } = {};
        if (input.archived !== undefined && input.archived !== (row.archivedAt !== null)) extra.archivedAt = input.archived ? new Date() : null;
        if (input.position) {
            const anchorId = (input.position.afterId ?? input.position.beforeId)!;
            if (anchorId === row.id) throw badRequest('A template cannot be placed next to itself.');
            const anchor = await WorkItemTemplateRepository.getById(db, ctx, anchorId);
            if (!anchor || anchor.projectId !== project.id) throw badRequest('The position names a template that is not in this project.');
            const side = input.position.afterId ? 'after' : 'before';
            const neighbour = await WorkItemTemplateRepository.neighbour(db, ctx, project.id, anchor, side, row.id);
            extra.sortKey = side === 'after' ? keyBetween(anchor.sortKey, neighbour?.sortKey ?? null) : keyBetween(neighbour?.sortKey ?? null, anchor.sortKey);
        }
        const changedFields = [...Object.keys(data), ...Object.keys(extra), ...(labelIds !== undefined ? ['labelIds'] : [])];
        if (changedFields.length > 0) {
            await WorkItemTemplateRepository.update(db, ctx, row.id, { ...data, ...extra }, labelIds);
            const action =
                changedFields.length === 1 && extra.archivedAt !== undefined
                    ? extra.archivedAt
                        ? 'ITEM_TEMPLATE_ARCHIVED'
                        : 'ITEM_TEMPLATE_RESTORED'
                    : 'ITEM_TEMPLATE_UPDATED';
            await logEvent(db, ctx, {
                action,
                entityType: 'WorkItemTemplate',
                entityId: row.id,
                // Field names only, never the description's text.
                details: `Changed item template ${data.name ?? row.name} in ${project.keyPrefix}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTemplate', operation: 'updated', changedFields },
                metadata: { projectId: project.id, changedFields },
            });
        }
        return toWorkItemTemplateData((await WorkItemTemplateRepository.getById(db, ctx, row.id))!);
    });
}

export async function deleteWorkItemTemplate(ctx: RequestContext, projectId: string, templateId: string): Promise<{ deleted: true }> {
    assertCanManageItemTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadProject(db, ctx, await visibleProjects(ctx, db), projectId);
        assertProjectWritable(project);
        const row = await loadTemplate(db, ctx, project.id, templateId);
        await WorkItemTemplateRepository.delete(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: 'ITEM_TEMPLATE_DELETED',
            entityType: 'WorkItemTemplate',
            entityId: row.id,
            details: `Deleted item template ${row.name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTemplate', operation: 'deleted', summary: 'ITEM_TEMPLATE_DELETED' },
            metadata: { projectId: project.id },
        });
        return { deleted: true as const };
    });
}
