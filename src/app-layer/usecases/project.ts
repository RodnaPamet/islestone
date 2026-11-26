/**
 * Projects (sub-phase 2.1, ADR 0002 §4 and §8).
 *
 *   - A project's key prefix is unique in the workspace and never reused:
 *     every prefix it has had stays in `ProjectKeyPrefix`, so old keys keep
 *     resolving.
 *   - A project belongs to one team for life in 2.1 (`PROJECT_TEAM_FIXED`).
 *   - Deleting a project sets its `deletedAt` and nothing on its items: the
 *     visibility predicate hides them everywhere (list, get, key lookup,
 *     metrics, activity, relations, sub-items, the due job, the fan-out), and
 *     every write to them is a 404. A restore brings every item back as it was.
 *   - Archiving keeps the items readable but out of the default list and the
 *     metrics, and refuses writes with `PROJECT_ARCHIVED` (409).
 *   - The purge job hard-deletes a project past the window with its items.
 *   - A project's due date (roadmap 3.1, decision 188, ADR 0002 §16) is
 *     optional and date-only: a deadline for the schedule and nothing else.
 *     It moves no item or milestone, is never refused against their dates,
 *     and rings nothing. Set on create (`projects.create`) and on edit
 *     (`projects.edit`); audited by naming the field. Returned as
 *     `YYYY-MM-DD`.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import {
    assertCanArchiveProject,
    assertCanCreateProject,
    assertCanEditProject,
    assertCanReadWorkConfig,
} from '../policies/work-config.policies';
import { visibleProjects } from '../policies/project-visibility';
import { isValidKeyPrefix, normaliseKeyPrefix } from '../domain/work-item-key';
import { ensureDefaultWorkItemTypes } from './work-item-type';
import { applyProjectTemplateInTx } from './project-template';
import { lockLinkableInitiative } from './initiative';
import { assertCanNameGoals } from '../policies/goal.policies';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { fromEpochDay, toEpochDay } from '../domain/schedule/calendar';

/** A project as the API returns it: the due date as `YYYY-MM-DD` (never through a time zone). */
function toProjectDto<T extends { dueDate: Date | null }>(row: T): Omit<T, 'dueDate'> & { dueDate: string | null } {
    return { ...row, dueDate: row.dueDate ? fromEpochDay(toEpochDay(row.dueDate)) : null };
}

/** A request's `YYYY-MM-DD` as the date-only column's value; a non-date is a 400. */
function parseProjectDueDate(raw: string | null): Date | null {
    if (raw === null) return null;
    try {
        return new Date(toEpochDay(raw) * 86_400_000);
    } catch {
        throw badRequest(`${raw} is not a date.`, { reason: 'DUE_DATE_INVALID' });
    }
}

function checkedPrefix(raw: string): string {
    const prefix = normaliseKeyPrefix(raw);
    if (!isValidKeyPrefix(prefix)) {
        throw badRequest('A key prefix is 2 to 10 letters or digits, starting with a letter.');
    }
    return prefix;
}

async function assertPrefixFree(db: PrismaTx, ctx: RequestContext, prefix: string) {
    if (await ProjectRepository.prefixTaken(db, ctx, prefix)) {
        throw new ConflictError(`The key prefix ${prefix} is or was used in this workspace; prefixes are never reused.`, {
            reason: 'KEY_PREFIX_TAKEN',
        });
    }
}

export async function listProjects(ctx: RequestContext, opts: { teamId?: string; includeArchived?: boolean } = {}) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => (await ProjectRepository.list(db, ctx, await visibleProjects(ctx, db), opts)).map(toProjectDto));
}

export async function getProject(ctx: RequestContext, projectId: string) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await ProjectRepository.getVisible(db, ctx, await visibleProjects(ctx, db), projectId);
        if (!project) throw notFound('Project not found');
        return toProjectDto(project);
    });
}

/**
 * A project template applies fields, milestones, item templates and up to
 * hundreds of starter items in the create's one transaction; the default
 * interactive-transaction timeout (5 s) is for single writes.
 */
const TEMPLATE_TX = { timeout: 60_000 };

export async function createProject(
    ctx: RequestContext,
    input: { teamId: string; name: string; keyPrefix: string; templateId?: string; dueDate?: string | null; initiativeId?: string | null },
) {
    assertCanCreateProject(ctx);
    // Naming an initiative also asks to read goals (3.2a, decision 213).
    if (input.initiativeId) assertCanNameGoals(ctx);
    const name = sanitizePlainText(input.name).trim();
    const keyPrefix = checkedPrefix(input.keyPrefix);
    const dueDate = input.dueDate !== undefined ? parseProjectDueDate(input.dueDate) : undefined;
    return runInTenantContext(ctx, async (db) => {
        if (!(await TeamRepository.getById(db, ctx, input.teamId))) throw notFound('Team not found');
        await assertPrefixFree(db, ctx, keyPrefix);
        await ensureDefaultWorkItemTypes(db, ctx);
        // A live, unarchived initiative, read FOR KEY SHARE (3.2a); project templates carry none.
        const initiative = input.initiativeId ? await lockLinkableInitiative(db, ctx, input.initiativeId) : null;
        const created = await ProjectRepository.create(db, ctx, { teamId: input.teamId, name, keyPrefix, dueDate, initiativeId: initiative?.id ?? null });
        // A project template (2.5c) is applied in this transaction: a failure
        // part-way leaves no project. What it named and the workspace does not
        // hold is reported in the response and in the PROJECT_CREATED entry.
        // Its due-date offset (decision 188) applies unless the request names a due date.
        const fromTemplate = input.templateId
            ? await applyProjectTemplateInTx(db, ctx, { id: created.id, teamId: input.teamId, keyPrefix, dueDateNamed: dueDate !== undefined }, input.templateId)
            : null;
        const project = toProjectDto(fromTemplate?.projectDueDate !== undefined ? { ...created, dueDate: fromTemplate.projectDueDate } : created);
        await logEvent(db, ctx, {
            action: 'PROJECT_CREATED',
            entityType: 'Project',
            entityId: project.id,
            details: `Created project ${name} (${keyPrefix})`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Project',
                operation: 'created',
                summary: 'PROJECT_CREATED',
                ...(project.dueDate || initiative ? { changedFields: [...(project.dueDate ? ['dueDate'] : []), ...(initiative ? ['initiativeId'] : [])] } : {}),
            },
            metadata: {
                teamId: input.teamId,
                keyPrefix,
                ...(initiative ? { initiativeId: initiative.id } : {}),
                ...(fromTemplate ? { projectTemplateId: fromTemplate.projectTemplateId, ...fromTemplate.counts, templateSkipped: fromTemplate.skipped } : {}),
            },
        });
        return fromTemplate ? { ...project, fromTemplate: { counts: fromTemplate.counts, skipped: fromTemplate.skipped } } : project;
    }, input.templateId ? TEMPLATE_TX : undefined);
}

export async function updateProject(ctx: RequestContext, projectId: string, input: { name?: string; keyPrefix?: string; teamId?: string; dueDate?: string | null }) {
    assertCanEditProject(ctx);
    const requestedDue = input.dueDate !== undefined ? parseProjectDueDate(input.dueDate) : undefined;
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (input.teamId !== undefined && input.teamId !== project.teamId) {
            throw new ConflictError('A project stays with its team.', { reason: 'PROJECT_TEAM_FIXED' });
        }
        const name = input.name !== undefined ? sanitizePlainText(input.name).trim() : undefined;
        let keyPrefix: string | undefined;
        if (input.keyPrefix !== undefined) {
            const next = checkedPrefix(input.keyPrefix);
            if (next !== project.keyPrefix) {
                await assertPrefixFree(db, ctx, next);
                keyPrefix = next;
            }
        }
        const dueDate = requestedDue !== undefined && (requestedDue?.getTime() ?? null) !== (project.dueDate?.getTime() ?? null) ? requestedDue : undefined;
        if (name === undefined && keyPrefix === undefined && dueDate === undefined) return toProjectDto(project);
        await ProjectRepository.lock(db, ctx, projectId);
        await ProjectRepository.update(db, ctx, projectId, { name, keyPrefix, previousPrefix: project.keyPrefix, dueDate });
        await logEvent(db, ctx, {
            action: 'PROJECT_UPDATED',
            entityType: 'Project',
            entityId: projectId,
            details: `Updated project ${project.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Project',
                operation: 'updated',
                changedFields: [...(name !== undefined ? ['name'] : []), ...(keyPrefix ? ['keyPrefix'] : []), ...(dueDate !== undefined ? ['dueDate'] : [])],
            },
            metadata: keyPrefix ? { fromPrefix: project.keyPrefix, toPrefix: keyPrefix } : undefined,
        });
        return toProjectDto((await ProjectRepository.getVisible(db, ctx, v, projectId))!);
    });
}

export async function setProjectArchived(ctx: RequestContext, projectId: string, archived: boolean) {
    assertCanArchiveProject(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (Boolean(project.archivedAt) === archived) return toProjectDto(project);
        await ProjectRepository.setArchived(db, ctx, projectId, archived ? new Date() : null);
        await logEvent(db, ctx, {
            action: archived ? 'PROJECT_ARCHIVED' : 'PROJECT_UNARCHIVED',
            entityType: 'Project',
            entityId: projectId,
            details: `${archived ? 'Archived' : 'Unarchived'} project ${project.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'updated', changedFields: ['archivedAt'] },
        });
        return toProjectDto((await ProjectRepository.getVisible(db, ctx, v, projectId))!);
    });
}

export async function deleteProject(ctx: RequestContext, projectId: string) {
    assertCanArchiveProject(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await ProjectRepository.getVisible(db, ctx, await visibleProjects(ctx, db), projectId);
        if (!project) throw notFound('Project not found');
        await ProjectRepository.softDelete(db, ctx, projectId);
        await logEvent(db, ctx, {
            action: 'PROJECT_DELETED',
            entityType: 'Project',
            entityId: projectId,
            details: `Deleted project ${project.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'deleted' },
        });
        return { deleted: true };
    });
}

export async function restoreProject(ctx: RequestContext, projectId: string) {
    assertCanArchiveProject(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getAny(db, ctx, projectId);
        // A guest restores nothing it could not see once restored.
        if (!project || !project.deletedAt || (v.kind === 'GRANTED' && !v.projectIds.includes(projectId))) {
            throw notFound('Deleted project not found');
        }
        await ProjectRepository.restore(db, ctx, projectId);
        await logEvent(db, ctx, {
            action: 'PROJECT_RESTORED',
            entityType: 'Project',
            entityId: projectId,
            details: `Restored project ${project.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'restored' },
        });
        return toProjectDto((await ProjectRepository.getVisible(db, ctx, v, projectId))!);
    });
}
