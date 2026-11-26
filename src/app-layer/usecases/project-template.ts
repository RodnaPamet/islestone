/**
 * Project templates (sub-phase 2.5c; docs/porting/maps/2.5.md; owner
 * decisions 71 and 73).
 *
 * - A project template belongs to the workspace: a name (unique in it) and
 *   its content, one versioned document (`ProjectTemplateContentSchema`)
 *   ENCRYPTED as a whole under the workspace key, sanitised field by field
 *   before it is serialised.
 * - Made from an existing project ("Save as template", `admin.manage`): its
 *   live fields and options, its milestones (due dates turned into offsets
 *   from today), its live item templates and, if asked, its open items with
 *   their open sub-items. People are not carried: a template names no member.
 * - Renamed, archived and deleted under `admin.manage`; listed and used under
 *   `projects.create`. Its content is not edited in the browser (decision 71):
 *   save a project again.
 * - Used by `createProject` in its own transaction (`applyProjectTemplateInTx`):
 *   the fields, milestones (dates counted from creation), item templates and
 *   starter items with their sub-items, and (roadmap 3.1, decision 188) the
 *   project's due date counted from creation unless the request names one. No team and no workflow is created;
 *   types and labels are matched by name, and a name that matches nothing is
 *   reported, never created and never silently dropped. Starter items go
 *   through `templateToCreateInput`, the one projection from a template.
 *
 * Every write is audited. Written fresh for Islestone.
 */
import { Prisma, type WorkItemPriority } from '@prisma/client';

import { logEvent } from '../events/audit';
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import { FieldSetRepository } from '../repositories/FieldSetRepository';
import { loadFieldSets } from './field-set';
import { LabelRepository } from '../repositories/LabelRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { ProjectTemplateRepository, WorkItemTemplateRepository } from '../repositories/TemplateRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import { assertCanManageProjectTemplates, assertCanUseProjectTemplates, mayManageProjectTemplates } from '../policies/template.policies';
import { visibleProjects } from '../policies/project-visibility';
import { addDays, daysBetween } from '../domain/cycle';
import { keyBetween } from '../domain/fractional-index';
import { templateToCreateInput } from '../domain/work-item-template';
import { todayInTz } from '../notifications/work-item-due';
import { insertTemplateItemInTx } from './work-item';
import { notificationsTz } from './work-item-shared';
import { toWorkItemTemplateData } from './work-item-template';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { ProjectTemplateContentSchema, TEMPLATE_LIMITS, type ProjectTemplateContent } from '@/lib/schemas/template';
import type { ProjectTemplateSummary } from '@/lib/work-items/types';
import { todayClock } from '@/lib/clock';

function today(): Date {
    return todayInTz(todayClock(notificationsTz()), notificationsTz());
}

function clean(raw: string): string {
    return sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
}

function cleanName(raw: string): string {
    const name = clean(raw);
    if (!name) throw badRequest('A template needs a name.');
    if (name.length > TEMPLATE_LIMITS.nameLength) throw badRequest(`A template name is at most ${TEMPLATE_LIMITS.nameLength} characters.`);
    return name;
}

function cleanText(raw: string | null): string | null {
    if (raw === null) return null;
    const text = sanitizePlainText(raw);
    return text.trim() ? text : null;
}

/** Sanitise every string of a content document, field by field, before it is serialised. */
export function sanitizedContent(content: ProjectTemplateContent): ProjectTemplateContent {
    const item = <T extends { title: string; description: string | null; typeName: string | null; labelNames: string[]; subItems: Array<{ title: string }> }>(i: T): T => ({
        ...i,
        title: clean(i.title) || 'Untitled',
        description: cleanText(i.description),
        typeName: i.typeName ? clean(i.typeName) || null : null,
        labelNames: i.labelNames.map(clean).filter(Boolean),
        subItems: i.subItems.map((s) => ({ title: clean(s.title) || 'Untitled' })),
    });
    return {
        version: 1,
        customFields: content.customFields.map((f) => ({ ...f, name: clean(f.name), options: f.options.map((o) => ({ name: clean(o.name), color: o.color })) })),
        milestones: content.milestones.map((m) => ({ ...m, name: clean(m.name) })),
        itemTemplates: content.itemTemplates.map((t) => ({ ...item(t), name: clean(t.name) })),
        items: content.items.map(item),
        ...(content.fieldSetEntries
            ? { fieldSetEntries: content.fieldSetEntries.map((r) => ({ typeName: clean(r.typeName), fieldName: clean(r.fieldName), requirement: r.requirement })).filter((r) => r.typeName && r.fieldName) }
            : {}),
        ...(content.projectDueInDays !== undefined ? { projectDueInDays: content.projectDueInDays } : {}),
    };
}

/** The stored content, parsed and checked; a document that no longer parses is a 409. */
function parseContent(json: string): ProjectTemplateContent {
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        throw new ConflictError('This template cannot be read.', { reason: 'TEMPLATE_CONTENT_INVALID' });
    }
    const parsed = ProjectTemplateContentSchema.safeParse(raw);
    if (!parsed.success) throw new ConflictError('This template cannot be read.', { reason: 'TEMPLATE_CONTENT_INVALID' });
    return parsed.data;
}

function countsOf(content: ProjectTemplateContent) {
    return {
        customFields: content.customFields.length,
        milestones: content.milestones.length,
        itemTemplates: content.itemTemplates.length,
        items: content.items.length,
    };
}

// ─── Reads ────────────────────────────────────────────────────────────────

/** The workspace's project templates (names; with counts for a viewer who manages them). */
export async function listProjectTemplates(ctx: RequestContext, opts: { includeArchived?: boolean } = {}): Promise<ProjectTemplateSummary[]> {
    assertCanUseProjectTemplates(ctx);
    const manage = mayManageProjectTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        if (!manage) {
            return (await ProjectTemplateRepository.list(db, ctx)).map((r) => ({ id: r.id, name: r.name, archived: false, createdAt: r.createdAt.toISOString() }));
        }
        return (await ProjectTemplateRepository.listWithContent(db, ctx, { includeArchived: opts.includeArchived })).map((r) => {
            const summary: ProjectTemplateSummary = { id: r.id, name: r.name, archived: r.archivedAt !== null, createdAt: r.createdAt.toISOString() };
            try {
                summary.counts = countsOf(parseContent(r.contentJson));
            } catch {
                // An unreadable document is listed without counts; using it is refused.
            }
            return summary;
        });
    });
}

// ─── Save as template ─────────────────────────────────────────────────────

/** Build a content document from a project as it is (live fields, milestones, item templates, open items). */
async function captureProject(
    db: PrismaTx,
    ctx: RequestContext,
    projectId: string,
    includeItems: boolean,
    projectDueDate: Date | null,
): Promise<ProjectTemplateContent> {
    const v = await visibleProjects(ctx, db);
    const on = today();
    const [fields, milestones, itemTemplates, types, labels, rules] = await Promise.all([
        CustomFieldRepository.listFields(db, ctx, projectId),
        MilestoneRepository.listForProject(db, ctx, projectId),
        WorkItemTemplateRepository.list(db, ctx, projectId),
        WorkItemTypeRepository.list(db, ctx, { includeArchived: true }),
        LabelRepository.list(db, ctx),
        FieldSetRepository.listForProject(db, ctx, projectId),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const labelName = new Map(labels.map((l) => [l.id, l.name]));
    const offset = (d: Date | null) => (d ? Math.max(0, Math.min(TEMPLATE_LIMITS.dueInDaysMax, daysBetween(on, d))) : null);
    const milestoneIndex = new Map(milestones.slice(0, TEMPLATE_LIMITS.milestones).map((m, i) => [m.id, i]));
    const names = (ids: readonly string[]) => ids.flatMap((id) => (labelName.has(id) ? [labelName.get(id)!] : []));

    let items: ProjectTemplateContent['items'] = [];
    if (includeItems) {
        const top = await WorkItemRepository.openItemsForTemplate(db, ctx, v, projectId, null, TEMPLATE_LIMITS.items);
        const subs = top.length
            ? await WorkItemRepository.openItemsForTemplate(db, ctx, v, projectId, top.map((t) => t.id), TEMPLATE_LIMITS.items * TEMPLATE_LIMITS.subItems)
            : [];
        items = top.map((t) => ({
            title: t.title,
            description: t.description,
            typeName: typeName.get(t.typeId) ?? null,
            priority: t.priority,
            labelNames: names(t.labels.map((l) => l.labelId)),
            dueInDays: offset(t.dueDate),
            milestoneIndex: t.milestoneId !== null ? (milestoneIndex.get(t.milestoneId) ?? null) : null,
            subItems: subs.filter((s) => s.parentId === t.id).slice(0, TEMPLATE_LIMITS.subItems).map((s) => ({ title: s.title })),
        }));
    }

    return sanitizedContent({
        version: 1,
        customFields: fields.slice(0, TEMPLATE_LIMITS.fields).map((f) => ({
            name: f.name,
            type: f.type,
            options: f.options.filter((o) => !o.archivedAt).slice(0, TEMPLATE_LIMITS.options).map((o) => ({ name: o.name, color: o.color })),
        })),
        milestones: milestones.slice(0, TEMPLATE_LIMITS.milestones).map((m) => ({ name: m.name, dueInDays: offset(m.dueDate) })),
        itemTemplates: itemTemplates.slice(0, TEMPLATE_LIMITS.itemTemplates).map((row) => {
            const t = toWorkItemTemplateData(row);
            return {
                name: t.name,
                title: t.title,
                description: t.description,
                typeName: t.typeId ? (typeName.get(t.typeId) ?? null) : null,
                priority: t.priority,
                labelNames: names(t.labelIds),
                dueInDays: t.dueInDays,
                subItems: t.subItems.slice(0, TEMPLATE_LIMITS.subItems),
            };
        }),
        items,
        // The project's due date as an offset from today (3.1, decision 188).
        projectDueInDays: offset(projectDueDate),
        // The project's custom-field rules (2.4b-b), for the live fields the template carries.
        fieldSetEntries: rules.flatMap((r) => {
            const fieldName = fields.find((f) => f.id === r.customFieldId)?.name;
            const typeNameOf = typeName.get(r.typeId);
            return fieldName && typeNameOf && r.requirement !== 'OPTIONAL' ? [{ typeName: typeNameOf, fieldName, requirement: r.requirement }] : [];
        }),
    });
}

export async function saveProjectAsTemplate(
    ctx: RequestContext,
    input: { fromProjectId: string; name: string; includeItems?: boolean },
): Promise<ProjectTemplateSummary> {
    assertCanManageProjectTemplates(ctx);
    const name = cleanName(input.name);
    return runInTenantContext(ctx, async (db) => {
        const project = await ProjectRepository.getVisible(db, ctx, await visibleProjects(ctx, db), input.fromProjectId);
        if (!project) throw notFound('Project not found');
        if (await ProjectTemplateRepository.nameTaken(db, ctx, name)) {
            throw new ConflictError(`There is already a project template named ${name}.`, { reason: 'TEMPLATE_NAME_TAKEN' });
        }
        const content = ProjectTemplateContentSchema.parse(await captureProject(db, ctx, project.id, input.includeItems ?? false, project.dueDate));
        const contentJson = JSON.stringify(content);
        if (Buffer.byteLength(contentJson, 'utf8') > TEMPLATE_LIMITS.contentBytes) {
            throw new ConflictError('This project holds too much to save as a template. Save it without its items.', { reason: 'TEMPLATE_TOO_LARGE' });
        }
        const sortKey = keyBetween(await ProjectTemplateRepository.lastSortKey(db, ctx), null);
        const row = await ProjectTemplateRepository.create(db, ctx, { name, contentJson, sortKey });
        const counts = countsOf(content);
        await logEvent(db, ctx, {
            action: 'PROJECT_TEMPLATE_CREATED',
            entityType: 'ProjectTemplate',
            entityId: row.id,
            details: `Saved project ${project.keyPrefix} as the template ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectTemplate', operation: 'created', summary: 'PROJECT_TEMPLATE_CREATED' },
            metadata: { fromProjectId: project.id, includeItems: input.includeItems ?? false, ...counts },
        });
        return { id: row.id, name: row.name, archived: false, createdAt: row.createdAt.toISOString(), counts };
    });
}

export async function updateProjectTemplate(ctx: RequestContext, id: string, input: { name?: string; archived?: boolean }): Promise<ProjectTemplateSummary> {
    assertCanManageProjectTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await ProjectTemplateRepository.getById(db, ctx, id);
        if (!row) throw notFound('Template not found');
        const data: { name?: string; archivedAt?: Date | null } = {};
        if (input.name !== undefined) {
            const name = cleanName(input.name);
            if (name !== row.name) {
                if (await ProjectTemplateRepository.nameTaken(db, ctx, name, row.id)) {
                    throw new ConflictError(`There is already a project template named ${name}.`, { reason: 'TEMPLATE_NAME_TAKEN' });
                }
                data.name = name;
            }
        }
        if (input.archived !== undefined && input.archived !== (row.archivedAt !== null)) data.archivedAt = input.archived ? new Date() : null;
        const changedFields = Object.keys(data);
        if (changedFields.length > 0) {
            await ProjectTemplateRepository.update(db, ctx, row.id, data);
            await logEvent(db, ctx, {
                action: changedFields.length === 1 && data.archivedAt !== undefined ? (data.archivedAt ? 'PROJECT_TEMPLATE_ARCHIVED' : 'PROJECT_TEMPLATE_RESTORED') : 'PROJECT_TEMPLATE_UPDATED',
                entityType: 'ProjectTemplate',
                entityId: row.id,
                details: `Changed project template ${data.name ?? row.name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectTemplate', operation: 'updated', changedFields },
                metadata: { changedFields },
            });
        }
        const after = (await ProjectTemplateRepository.getById(db, ctx, row.id))!;
        return { id: after.id, name: after.name, archived: after.archivedAt !== null, createdAt: after.createdAt.toISOString() };
    });
}

export async function deleteProjectTemplate(ctx: RequestContext, id: string): Promise<{ deleted: true }> {
    assertCanManageProjectTemplates(ctx);
    return runInTenantContext(ctx, async (db) => {
        const row = await ProjectTemplateRepository.getById(db, ctx, id);
        if (!row) throw notFound('Template not found');
        await ProjectTemplateRepository.delete(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: 'PROJECT_TEMPLATE_DELETED',
            entityType: 'ProjectTemplate',
            entityId: row.id,
            details: `Deleted project template ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectTemplate', operation: 'deleted', summary: 'PROJECT_TEMPLATE_DELETED' },
        });
        return { deleted: true as const };
    });
}

// ─── Use (inside createProject's transaction) ──────────────────────────────

export interface AppliedTemplate {
    projectTemplateId: string;
    counts: { customFields: number; milestones: number; itemTemplates: number; items: number };
    /** What the content named that the workspace does not hold (`type:<name>`, `label:<name>`, `field:<name>`, …). */
    skipped: string[];
    /** The project's due date the template gave it (3.1, decision 188); absent when it gave none or the request named one. */
    projectDueDate?: Date;
}

/**
 * Apply a project template to the project just created, in the create's
 * transaction: a failure part-way leaves no project. The caller holds
 * `projects.create`, which is what using a template takes.
 */
export async function applyProjectTemplateInTx(
    db: PrismaTx,
    ctx: RequestContext,
    project: { id: string; teamId: string; keyPrefix: string; dueDateNamed?: boolean },
    templateId: string,
): Promise<AppliedTemplate> {
    assertCanUseProjectTemplates(ctx);
    const template = await ProjectTemplateRepository.getById(db, ctx, templateId);
    if (!template) throw notFound('Template not found');
    if (template.archivedAt) throw new ConflictError(`The template ${template.name} is archived.`, { reason: 'TEMPLATE_ARCHIVED' });
    const content = parseContent(template.contentJson);
    const on = today();
    const skipped: string[] = [];
    const audit = (action: string, entityType: string, entityId: string, details: string) =>
        logEvent(db, ctx, {
            action,
            entityType,
            entityId,
            details,
            detailsJson: { category: 'entity_lifecycle', entityName: entityType, operation: 'created', summary: action },
            metadata: { projectId: project.id, projectTemplateId: template.id },
        });

    const [types, labels] = await Promise.all([WorkItemTypeRepository.list(db, ctx), LabelRepository.list(db, ctx, { teamId: project.teamId })]);
    const typeByName = new Map(types.map((t) => [t.name, t.id]));
    // A team's own label wins over a workspace label of the same name.
    const labelByName = new Map<string, string>();
    for (const l of labels) if (l.teamId === null) labelByName.set(l.name, l.id);
    for (const l of labels) if (l.teamId !== null) labelByName.set(l.name, l.id);
    const fallbackTypeId = types[0]?.id;
    if (!fallbackTypeId) throw new ConflictError('The workspace has no live work item type.', { reason: 'NO_WORK_ITEM_TYPE' });
    const typeOf = (name: string | null): string => {
        if (name && typeByName.has(name)) return typeByName.get(name)!;
        if (name) skipped.push(`type:${name}`);
        return fallbackTypeId;
    };
    const labelsOf = (names: readonly string[]): string[] => {
        const out: string[] = [];
        for (const n of names) {
            const id = labelByName.get(n);
            if (id) out.push(id);
            else skipped.push(`label:${n}`);
        }
        return [...new Set(out)];
    };
    const counts = { customFields: 0, milestones: 0, itemTemplates: 0, items: 0 };

    // Custom fields and their options.
    const fieldIdByName = new Map<string, string>();
    let fieldKey: string | null = null;
    const fieldNames = new Set<string>();
    for (const f of content.customFields) {
        if (!f.name || fieldNames.has(f.name)) {
            skipped.push(`field:${f.name}`);
            continue;
        }
        fieldNames.add(f.name);
        fieldKey = keyBetween(fieldKey, null);
        let optionKey: string | null = null;
        const seen = new Set<string>();
        const options = f.options.flatMap((o) => {
            if (!o.name || seen.has(o.name)) return [];
            seen.add(o.name);
            optionKey = keyBetween(optionKey, null);
            return [{ name: o.name, color: o.color, sortKey: optionKey }];
        });
        // guardrail-allow: n+1 — a template's fields, at most TEMPLATE_LIMITS.fields (50).
        const field = await CustomFieldRepository.createField(db, ctx, { projectId: project.id, name: f.name, type: f.type, sortKey: fieldKey, options });
        await audit('CUSTOM_FIELD_CREATED', 'CustomField', field.id, `Created field ${f.name} in ${project.keyPrefix} from a template`);
        fieldIdByName.set(f.name, field.id);
        counts.customFields++;
    }

    // The fields' rules per type (2.4b-b, decision 108), by name; a type or
    // field the workspace no longer has is skipped and named.
    const entryRows: Array<{ typeId: string; projectId: string; customFieldId: string; requirement: 'REQUIRED' | 'HIDDEN' }> = [];
    const entrySeen = new Set<string>();
    for (const r of content.fieldSetEntries ?? []) {
        const typeId = typeByName.get(r.typeName);
        const customFieldId = fieldIdByName.get(r.fieldName);
        if (!typeId || !customFieldId) {
            skipped.push(`fieldRule:${r.typeName}/${r.fieldName}`);
            continue;
        }
        if (entrySeen.has(`${typeId}:${customFieldId}`)) continue;
        entrySeen.add(`${typeId}:${customFieldId}`);
        entryRows.push({ typeId, projectId: project.id, customFieldId, requirement: r.requirement });
    }
    if (entryRows.length > 0) {
        await FieldSetRepository.createMany(db, ctx, entryRows);
        await audit('WORK_ITEM_TYPE_FIELD_SET', 'Project', project.id, `Set ${entryRows.length} field rule(s) in ${project.keyPrefix} from a template`);
    }

    // The project's due date, dated from today (3.1, decision 188), unless the request named one.
    let projectDueDate: Date | undefined;
    if (!project.dueDateNamed && content.projectDueInDays !== undefined && content.projectDueInDays !== null) {
        projectDueDate = addDays(on, content.projectDueInDays);
        await ProjectRepository.setDueDateAtCreate(db, ctx, project.id, projectDueDate);
    }

    // Milestones, dated from today.
    let milestoneKey: string | null = null;
    const milestoneIds: Array<string | null> = [];
    const milestoneByName = new Map<string, string>();
    for (const m of content.milestones) {
        const existing = milestoneByName.get(m.name);
        if (existing || !m.name) {
            if (!existing) skipped.push(`milestone:${m.name}`);
            milestoneIds.push(existing ?? null);
            continue;
        }
        milestoneKey = keyBetween(milestoneKey, null);
        const dueDate = m.dueInDays !== null ? addDays(on, m.dueInDays) : null;
        // guardrail-allow: n+1 — a template's milestones, at most TEMPLATE_LIMITS.milestones (50).
        const row = await MilestoneRepository.create(db, ctx, { projectId: project.id, name: m.name, dueDate, sortKey: milestoneKey });
        await audit('MILESTONE_CREATED', 'Milestone', row.id, `Created milestone ${m.name} in ${project.keyPrefix} from a template`);
        milestoneByName.set(m.name, row.id);
        milestoneIds.push(row.id);
        counts.milestones++;
    }

    // Item templates.
    let templateKey: string | null = null;
    const templateNames = new Set<string>();
    for (const t of content.itemTemplates) {
        if (!t.name || templateNames.has(t.name)) {
            skipped.push(`itemTemplate:${t.name}`);
            continue;
        }
        templateNames.add(t.name);
        templateKey = keyBetween(templateKey, null);
        // guardrail-allow: n+1 — a template's item templates, at most TEMPLATE_LIMITS.itemTemplates (50).
        const row = await WorkItemTemplateRepository.create(db, ctx, {
            projectId: project.id,
            name: t.name,
            title: t.title,
            description: t.description,
            typeId: t.typeName ? typeOf(t.typeName) : null,
            priority: t.priority as WorkItemPriority,
            assigneeId: null,
            dueInDays: t.dueInDays,
            customFieldValuesJson: Prisma.DbNull,
            subItemsJson: t.subItems.length ? t.subItems : Prisma.DbNull,
            sortKey: templateKey,
            labelIds: labelsOf(t.labelNames),
        });
        await audit('ITEM_TEMPLATE_CREATED', 'WorkItemTemplate', row.id, `Created item template ${t.name} in ${project.keyPrefix} from a template`);
        counts.itemTemplates++;
    }

    // Starter items and their sub-items, through the one projection, each
    // checked against its type's field set like any create (decision 111).
    const starterSets = await loadFieldSets(db, ctx, content.items.map((i) => typeOf(i.typeName)), project.id);
    const use = { today: on, usableLabelIds: new Set(labelByName.values()), activeMemberIds: new Set<string>(), liveFields: new Map() };
    for (const item of content.items) {
        const typeId = typeOf(item.typeName);
        const projected = templateToCreateInput(
            {
                templateId: null,
                title: item.title,
                description: item.description,
                typeId,
                priority: item.priority as WorkItemPriority,
                labelIds: labelsOf(item.labelNames),
                assigneeId: null,
                dueInDays: item.dueInDays,
                milestoneId: item.milestoneIndex !== null ? (milestoneIds[item.milestoneIndex] ?? null) : null,
                customFields: {},
                subItems: item.subItems,
            },
            {},
            use,
        );
        // guardrail-allow: n+1 — a template's starter items, at most TEMPLATE_LIMITS.items (200), each numbered in order.
        const { row, skipped: starterSkipped } = await insertTemplateItemInTx(db, ctx, project, {
            parentId: null,
            typeId,
            title: projected.title,
            description: projected.description,
            priority: projected.priority,
            labelIds: projected.labelIds,
            dueDate: projected.dueDate,
            milestoneId: projected.milestoneId,
            templateId: null,
            projectTemplateId: template.id,
        }, starterSets.get(typeId));
        skipped.push(...starterSkipped);
        counts.items++;
        for (const sub of projected.subItems) {
            // guardrail-allow: n+1 — a starter item's sub-items, at most TEMPLATE_LIMITS.subItems (50).
            await insertTemplateItemInTx(db, ctx, project, {
                parentId: row.id,
                typeId,
                title: sub.title,
                milestoneId: projected.milestoneId,
                templateId: null,
                projectTemplateId: template.id,
            }, starterSets.get(typeId));
            counts.items++;
        }
    }
    return { projectTemplateId: template.id, counts, skipped: [...new Set(skipped)], ...(projectDueDate ? { projectDueDate } : {}) };
}
