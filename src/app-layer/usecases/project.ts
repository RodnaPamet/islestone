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
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

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
    return runInTenantContext(ctx, async (db) => ProjectRepository.list(db, ctx, await visibleProjects(ctx, db), opts));
}

export async function getProject(ctx: RequestContext, projectId: string) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const project = await ProjectRepository.getVisible(db, ctx, await visibleProjects(ctx, db), projectId);
        if (!project) throw notFound('Project not found');
        return project;
    });
}

export async function createProject(ctx: RequestContext, input: { teamId: string; name: string; keyPrefix: string; templateId?: string }) {
    assertCanCreateProject(ctx);
    const name = sanitizePlainText(input.name).trim();
    const keyPrefix = checkedPrefix(input.keyPrefix);
    return runInTenantContext(ctx, async (db) => {
        if (!(await TeamRepository.getById(db, ctx, input.teamId))) throw notFound('Team not found');
        await assertPrefixFree(db, ctx, keyPrefix);
        await ensureDefaultWorkItemTypes(db, ctx);
        const project = await ProjectRepository.create(db, ctx, { teamId: input.teamId, name, keyPrefix });
        // A project template (2.5c) is applied in this transaction: a failure
        // part-way leaves no project. What it named and the workspace does not
        // hold is reported in the response and in the PROJECT_CREATED entry.
        const fromTemplate = input.templateId ? await applyProjectTemplateInTx(db, ctx, { id: project.id, teamId: input.teamId, keyPrefix }, input.templateId) : null;
        await logEvent(db, ctx, {
            action: 'PROJECT_CREATED',
            entityType: 'Project',
            entityId: project.id,
            details: `Created project ${name} (${keyPrefix})`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'created', summary: 'PROJECT_CREATED' },
            metadata: { teamId: input.teamId, keyPrefix, ...(fromTemplate ? { projectTemplateId: fromTemplate.projectTemplateId, ...fromTemplate.counts, templateSkipped: fromTemplate.skipped } : {}) },
        });
        return fromTemplate ? { ...project, fromTemplate: { counts: fromTemplate.counts, skipped: fromTemplate.skipped } } : project;
    });
}

export async function updateProject(ctx: RequestContext, projectId: string, input: { name?: string; keyPrefix?: string; teamId?: string }) {
    assertCanEditProject(ctx);
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
        if (name === undefined && keyPrefix === undefined) return project;
        await ProjectRepository.lock(db, ctx, projectId);
        await ProjectRepository.update(db, ctx, projectId, { name, keyPrefix, previousPrefix: project.keyPrefix });
        await logEvent(db, ctx, {
            action: 'PROJECT_UPDATED',
            entityType: 'Project',
            entityId: projectId,
            details: `Updated project ${project.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'Project',
                operation: 'updated',
                changedFields: [...(name !== undefined ? ['name'] : []), ...(keyPrefix ? ['keyPrefix'] : [])],
            },
            metadata: keyPrefix ? { fromPrefix: project.keyPrefix, toPrefix: keyPrefix } : undefined,
        });
        return ProjectRepository.getVisible(db, ctx, v, projectId);
    });
}

export async function setProjectArchived(ctx: RequestContext, projectId: string, archived: boolean) {
    assertCanArchiveProject(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (Boolean(project.archivedAt) === archived) return project;
        await ProjectRepository.setArchived(db, ctx, projectId, archived ? new Date() : null);
        await logEvent(db, ctx, {
            action: archived ? 'PROJECT_ARCHIVED' : 'PROJECT_UNARCHIVED',
            entityType: 'Project',
            entityId: projectId,
            details: `${archived ? 'Archived' : 'Unarchived'} project ${project.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Project', operation: 'updated', changedFields: ['archivedAt'] },
        });
        return ProjectRepository.getVisible(db, ctx, v, projectId);
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
        return ProjectRepository.getVisible(db, ctx, v, projectId);
    });
}
