/**
 * Intake forms (sub-phase 2.6a; owner decisions 86, 92 and 93). Built in
 * Settings → Intake under `intake.manage`; read under `intake.view`; the
 * open forms a member may send a request through are read by anyone who sees
 * projects. Every form is for signed-in members in 2.6a: public access
 * (`IntakeFormAccess.PUBLIC`) arrives with 2.6b behind its deployment switch,
 * and nothing here can set it.
 *
 * - The definition is validated by `IntakeFormDefinitionSchema` and every
 *   piece of its text is sanitised before it is stored.
 * - A field may fill one of the project's live custom fields on accept, of a
 *   matching type (`FIELD_KIND_FILLS`).
 * - Edits are versioned: `If-Match` is required for a name or definition
 *   change (428 without), and a stale version is a 409 with the current form.
 * - Forms are archived, never deleted.
 *
 * Written fresh for Islestone.
 */
import { randomBytes } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { logEvent } from '../events/audit';
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import { IntakeRepository, type IntakeFormRow } from '../repositories/IntakeRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { assertCanManageIntake, assertCanReadIntake, assertCanSendInternalRequests, mayManageIntake } from '../policies/intake.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, ConflictError, badRequest, notFound } from '@/lib/errors/types';
import {
    FIELD_KIND_FILLS,
    INTAKE_LIMITS,
    IntakeFormDefinitionSchema,
    readDefinition,
    type IntakeFormDefinition,
} from '@/lib/intake/form-definition';
import type { IntakeFormData, IntakeFormSummary, OpenIntakeForm } from '@/lib/intake/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

function toSummary(f: IntakeFormRow): IntakeFormSummary {
    return {
        id: f.id,
        projectId: f.projectId,
        name: f.name,
        access: f.access,
        published: f.publishedAt !== null,
        archived: f.archivedAt !== null,
        definitionVersion: f.definitionVersion,
        version: f.version,
        updatedAt: f.updatedAt.toISOString(),
    };
}

function toData(f: IntakeFormRow): IntakeFormData {
    return { ...toSummary(f), definition: readDefinition(f.definitionJson) };
}

function formPreconditionRequired(): AppError {
    return new AppError('Send the version you edited in an If-Match header: a form change must name it.', 'PRECONDITION_REQUIRED', 428);
}

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/\s+/g, ' ').trim();
    if (!name) throw badRequest('A form needs a name.');
    if (name.length > INTAKE_LIMITS.formName) throw badRequest(`A form name has at most ${INTAKE_LIMITS.formName} characters.`);
    return name;
}

/**
 * Validate, sanitise and check a definition against the project: every text
 * sanitised (and re-validated, since sanitising may shorten or empty it), and
 * every mapped custom field a live field of the project of the type the field
 * kind fills.
 */
async function cleanDefinition(db: PrismaTx, ctx: RequestContext, projectId: string, raw: unknown): Promise<IntakeFormDefinition> {
    const parsed = IntakeFormDefinitionSchema.safeParse(raw);
    if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? 'The form definition is not valid.');
    const d = parsed.data;
    const sanitised = {
        intro: sanitizePlainText(d.intro),
        confirmation: sanitizePlainText(d.confirmation),
        fields: d.fields.map((f) => ({
            ...f,
            label: sanitizePlainText(f.label).trim(),
            ...(f.help !== undefined ? { help: sanitizePlainText(f.help).trim() } : {}),
            ...(f.options !== undefined ? { options: f.options.map((o) => sanitizePlainText(o).trim()) } : {}),
            customFieldId: f.customFieldId ?? null,
        })),
    };
    const again = IntakeFormDefinitionSchema.safeParse(sanitised);
    if (!again.success) throw badRequest(again.error.issues[0]?.message ?? 'The form definition is not valid.');
    const mapped = again.data.fields.filter((f) => f.customFieldId);
    if (mapped.length > 0) {
        const fields = new Map((await CustomFieldRepository.listFields(db, ctx, projectId)).map((f) => [f.id, f]));
        for (const f of mapped) {
            const target = fields.get(f.customFieldId!);
            if (!target) throw badRequest(`"${f.label}" fills a custom field that is not a live field of this project.`);
            if (FIELD_KIND_FILLS[f.kind] !== target.type) {
                throw badRequest(`"${f.label}" cannot fill ${target.name}: their types differ.`);
            }
        }
    }
    return again.data;
}

async function loadProjectForForms(db: PrismaTx, ctx: RequestContext, projectId: string) {
    const v = await visibleProjects(ctx, db);
    const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
    if (!project) throw notFound('Project not found');
    return project;
}

async function auditForm(db: PrismaTx, ctx: RequestContext, action: string, f: IntakeFormRow, operation: 'created' | 'updated', changedFields?: string[]) {
    await logEvent(db, ctx, {
        action,
        entityType: 'IntakeForm',
        entityId: f.id,
        details: `${operation === 'created' ? 'Created' : 'Changed'} intake form ${f.name}`,
        detailsJson: { category: 'entity_lifecycle', entityName: 'IntakeForm', operation, summary: action, ...(changedFields ? { changedFields } : {}) },
        metadata: { projectId: f.projectId, access: f.access, definitionVersion: f.definitionVersion },
    });
}

async function formConflict(db: PrismaTx, ctx: RequestContext, id: string): Promise<never> {
    const current = await IntakeRepository.getForm(db, ctx, id);
    if (!current) throw notFound('Form not found');
    throw new ConflictError('The form changed since you read it.', { reason: 'VERSION_CONFLICT', version: current.version, form: toData(current) });
}

// ─── Reads ────────────────────────────────────────────────────────────────

/** The forms of the visible projects (archived ones too, for Settings). */
export async function listIntakeForms(ctx: RequestContext, query: { projectId?: string; includeArchived?: boolean } = {}): Promise<IntakeFormData[]> {
    if (!mayManageIntake(ctx)) assertCanReadIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projectIds = query.projectId
            ? [(await ProjectRepository.getVisible(db, ctx, v, query.projectId))?.id].filter((x): x is string => !!x)
            : (await ProjectRepository.list(db, ctx, v, { includeArchived: true })).map((p) => p.id);
        if (projectIds.length === 0) return [];
        return (await IntakeRepository.listForms(db, ctx, { projectIds, includeArchived: query.includeArchived })).map(toData);
    });
}

export async function getIntakeForm(ctx: RequestContext, id: string): Promise<IntakeFormData> {
    if (!mayManageIntake(ctx)) assertCanReadIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const form = await IntakeRepository.getForm(db, ctx, id);
        if (!form) throw notFound('Form not found');
        await loadProjectForForms(db, ctx, form.projectId);
        return toData(form);
    });
}

/**
 * Whether a form takes requests from members now: published, not archived,
 * for members, in a visible, live, unarchived project whose intake is on.
 * One rule for the open list and the send.
 */
export function formIsOpen(form: Pick<IntakeFormRow, 'access' | 'publishedAt' | 'archivedAt'>, project: { archivedAt: Date | null } | null, intakeEnabled: boolean): boolean {
    return form.access === 'MEMBERS' && form.publishedAt !== null && form.archivedAt === null && project !== null && project.archivedAt === null && intakeEnabled;
}

/** The forms a member may send a request through now. */
export async function listOpenIntakeForms(ctx: RequestContext): Promise<OpenIntakeForm[]> {
    assertCanSendInternalRequests(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projects = await ProjectRepository.list(db, ctx, v);
        if (projects.length === 0) return [];
        const intakes = await IntakeRepository.listProjectIntakes(db, ctx, projects.map((p) => p.id));
        const on = new Set(intakes.filter((i) => i.enabled).map((i) => i.projectId));
        const byId = new Map(projects.map((p) => [p.id, p]));
        const forms = await IntakeRepository.listForms(db, ctx, { projectIds: [...on] });
        return forms
            .filter((f) => formIsOpen(f, byId.get(f.projectId) ?? null, on.has(f.projectId)))
            .map((f) => {
                const p = byId.get(f.projectId)!;
                return {
                    id: f.id,
                    projectId: f.projectId,
                    projectName: p.name,
                    projectKeyPrefix: p.keyPrefix,
                    name: f.name,
                    definition: readDefinition(f.definitionJson),
                    definitionVersion: f.definitionVersion,
                };
            });
    });
}

/** One open form, for its page; a form that is not open is a 404. */
export async function getOpenIntakeForm(ctx: RequestContext, id: string): Promise<OpenIntakeForm> {
    const all = await listOpenIntakeForms(ctx);
    const form = all.find((f) => f.id === id);
    if (!form) throw notFound('Form not found');
    return form;
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface CreateIntakeFormInput {
    projectId: string;
    name: string;
    definition: unknown;
    published?: boolean;
}

export async function createIntakeForm(ctx: RequestContext, input: CreateIntakeFormInput): Promise<IntakeFormData> {
    assertCanManageIntake(ctx);
    const name = cleanName(input.name);
    return runInTenantContext(ctx, async (db) => {
        const project = await loadProjectForForms(db, ctx, input.projectId);
        if (project.archivedAt) throw badRequest(`${project.name} is archived and takes no new forms.`);
        if (await IntakeRepository.formNameTaken(db, ctx, project.id, name)) {
            throw new ConflictError(`The project already has a form named ${name}.`, { reason: 'FORM_NAME_TAKEN' });
        }
        const definition = await cleanDefinition(db, ctx, project.id, input.definition);
        const form = await IntakeRepository.createForm(db, ctx, {
            projectId: project.id,
            name,
            publicId: randomBytes(16).toString('base64url'),
            definitionJson: definition as unknown as Prisma.InputJsonValue,
            createdByUserId: ctx.userId,
            publishedAt: input.published === false ? null : new Date(),
        });
        await auditForm(db, ctx, 'INTAKE_FORM_CREATED', form, 'created');
        return toData(form);
    });
}

export interface UpdateIntakeFormInput {
    name?: string;
    definition?: unknown;
    published?: boolean;
    archived?: boolean;
}

/**
 * Rename, redefine, publish or unpublish, archive or restore a form. A name
 * or definition change needs `If-Match`; publishing and archiving take it
 * when sent.
 */
export async function updateIntakeForm(ctx: RequestContext, id: string, input: UpdateIntakeFormInput, expectedVersion?: number): Promise<IntakeFormData> {
    assertCanManageIntake(ctx);
    if ((input.name !== undefined || input.definition !== undefined) && expectedVersion === undefined) throw formPreconditionRequired();
    const name = input.name !== undefined ? cleanName(input.name) : undefined;
    return runInTenantContext(ctx, async (db) => {
        const form = await IntakeRepository.getForm(db, ctx, id);
        if (!form) throw notFound('Form not found');
        const project = await loadProjectForForms(db, ctx, form.projectId);
        const version = expectedVersion ?? form.version;
        if (version !== form.version) return formConflict(db, ctx, id);

        const data: Parameters<typeof IntakeRepository.updateFormVersioned>[4] = {};
        const changed: string[] = [];
        if (name !== undefined && name !== form.name) {
            if (await IntakeRepository.formNameTaken(db, ctx, form.projectId, name, form.id)) {
                throw new ConflictError(`The project already has a form named ${name}.`, { reason: 'FORM_NAME_TAKEN' });
            }
            data.name = name;
            changed.push('name');
        }
        if (input.definition !== undefined) {
            const definition = await cleanDefinition(db, ctx, form.projectId, input.definition);
            if (JSON.stringify(definition) !== JSON.stringify(readDefinition(form.definitionJson))) {
                data.definitionJson = definition as unknown as Prisma.InputJsonValue;
                data.bumpDefinition = true;
                changed.push('definition');
            }
        }
        if (input.published !== undefined && input.published !== (form.publishedAt !== null)) {
            data.publishedAt = input.published ? new Date() : null;
            changed.push('published');
        }
        if (input.archived !== undefined && input.archived !== (form.archivedAt !== null)) {
            if (!input.archived && project.archivedAt) throw badRequest(`${project.name} is archived; its forms stay archived.`);
            data.archivedAt = input.archived ? new Date() : null;
            changed.push('archived');
        }
        if (changed.length === 0) return toData(form);
        if ((await IntakeRepository.updateFormVersioned(db, ctx, id, version, data)) === 0) return formConflict(db, ctx, id);
        const after = (await IntakeRepository.getForm(db, ctx, id))!;
        const action = changed.includes('archived')
            ? after.archivedAt
                ? 'INTAKE_FORM_ARCHIVED'
                : 'INTAKE_FORM_RESTORED'
            : changed.length === 1 && changed[0] === 'published'
              ? after.publishedAt
                  ? 'INTAKE_FORM_PUBLISHED'
                  : 'INTAKE_FORM_UNPUBLISHED'
              : 'INTAKE_FORM_UPDATED';
        await auditForm(db, ctx, action, after, 'updated', changed);
        return toData(after);
    });
}
