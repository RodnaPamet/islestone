/**
 * Milestones (sub-phase 2.5b; docs/porting/maps/2.5.md; owner decisions 62
 * and 72; ADR 0006 "Milestone").
 *
 * - A milestone belongs to one project: a name (unique in the project), an
 *   optional due date (date-only) and a place in the project's order
 *   (`sortKey`, a fractional index computed under the project's row lock).
 * - Reads take `projects.view`, writes `projects.edit` (decision 72); an
 *   archived project's milestones are read-only, like its items.
 * - Progress is derived, never stored: scope is the live, visible items not
 *   cancelled, done the ones in a Done state. "Late" is a due date before
 *   today (in `NOTIFICATIONS_TZ`) with open items left.
 * - Aiming an item at a milestone is a single-field change (ADR 0002 §9):
 *   `If-Match` optional, the version increases. The milestone must be one of
 *   the item's own project (400; the composite FK refuses another project's).
 * - Deleting a milestone takes it off every item first (deleted ones too,
 *   each audited, versions increased), then deletes it.
 * - The cycle rollover never touches milestones.
 *
 * Every write is audited (`logEvent`, with the transaction client). Written
 * fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { logEvent } from '../events/audit';
import { assertFieldWrite } from './field-set';
import { MilestoneRepository, type MilestoneRow } from '../repositories/MilestoneRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanManageMilestones, assertCanReadMilestones, mayReadMilestones } from '../policies/milestone.policies';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { keyBetween } from '../domain/fractional-index';
import { dayKey, fromDayKey } from '../domain/cycle';
import { todayInTz } from '../notifications/work-item-due';
import { getWorkItem } from './work-item';
import { assertProjectWritable, emitWatcherActivity, keyOf, loadWritableItem, notificationsTz, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { MILESTONE_NAME_MAX } from '@/lib/schemas/milestone';
import type { MilestoneData, MilestoneProgress, ViewMilestone } from '@/lib/work-items/types';

/** The most items one milestone delete clears (far above a real milestone). */
export const MILESTONE_CLEAR_CAP = 5_000;

function today(): Date {
    return todayInTz(new Date(), notificationsTz());
}

export function toViewMilestone(m: MilestoneRow): ViewMilestone {
    return { id: m.id, projectId: m.projectId, name: m.name, dueDate: m.dueDate ? dayKey(m.dueDate) : null };
}

/** Group-by rows (milestone × category) into scope and done per milestone. */
export function progressOf(rows: ReadonlyArray<{ milestoneId: string | null; stateCategory: WorkflowStateCategory; _count: { _all: number } }>) {
    const out = new Map<string, MilestoneProgress>();
    for (const r of rows) {
        if (!r.milestoneId || r.stateCategory === 'CANCELLED') continue;
        const p = out.get(r.milestoneId) ?? { scope: 0, done: 0 };
        p.scope += r._count._all;
        if (r.stateCategory === 'DONE') p.done += r._count._all;
        out.set(r.milestoneId, p);
    }
    return out;
}

/** A due date before `on` with open (scoped, not done) items left. */
export function isLate(dueDate: Date | null, progress: MilestoneProgress, on: Date): boolean {
    return dueDate !== null && dueDate.getTime() < on.getTime() && progress.scope > progress.done;
}

async function milestoneDataList(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, rows: readonly MilestoneRow[]): Promise<MilestoneData[]> {
    const on = today();
    const progress = progressOf(await WorkItemRepository.countsByMilestone(db, ctx, v, rows.map((m) => m.id)));
    return rows.map((m) => {
        const p = progress.get(m.id) ?? { scope: 0, done: 0 };
        return { ...toViewMilestone(m), progress: p, late: isLate(m.dueDate, p, on) };
    });
}

/** The visible projects' milestones the views name (pickers, filters, lanes); `[]` without `projects.view`. */
export async function viewMilestonesInTx(db: PrismaTx, ctx: RequestContext, projectIds: readonly string[]): Promise<ViewMilestone[]> {
    if (!mayReadMilestones(ctx)) return [];
    return (await MilestoneRepository.listForProjects(db, ctx, projectIds)).map(toViewMilestone);
}

async function loadProject(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, projectId: string) {
    const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
    if (!project) throw notFound('Project not found');
    return project;
}

/** A milestone of the project, or a 404 (another project's milestone is not this project's). */
async function loadMilestone(db: PrismaTx, ctx: RequestContext, projectId: string, milestoneId: string) {
    const m = await MilestoneRepository.getById(db, ctx, milestoneId);
    if (!m || m.projectId !== projectId) throw notFound('Milestone not found');
    return m;
}

function cleanName(raw: string): string {
    const name = sanitizePlainText(raw).replace(/[\r\n\t]+/g, ' ').trim();
    if (!name) throw badRequest('A milestone needs a name.');
    if (name.length > MILESTONE_NAME_MAX) throw badRequest(`A milestone name is at most ${MILESTONE_NAME_MAX} characters.`);
    return name;
}

function nameTaken(name: string): never {
    throw new ConflictError(`This project already has a milestone named ${name}.`, { reason: 'MILESTONE_NAME_TAKEN' });
}

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listMilestones(ctx: RequestContext, projectId: string): Promise<MilestoneData[]> {
    assertCanReadMilestones(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        return milestoneDataList(db, ctx, v, await MilestoneRepository.listForProject(db, ctx, project.id));
    });
}

export async function getMilestone(ctx: RequestContext, projectId: string, milestoneId: string): Promise<MilestoneData> {
    assertCanReadMilestones(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        const m = await loadMilestone(db, ctx, project.id, milestoneId);
        return (await milestoneDataList(db, ctx, v, [m]))[0]!;
    });
}

// ─── Writes ───────────────────────────────────────────────────────────────

export interface CreateMilestoneInput {
    name: string;
    dueDate?: string | null;
}

export async function createMilestone(ctx: RequestContext, projectId: string, input: CreateMilestoneInput): Promise<MilestoneData> {
    assertCanManageMilestones(ctx);
    const name = cleanName(input.name);
    const dueDate = input.dueDate ? fromDayKey(input.dueDate) : null;
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        // The project row lock serialises milestone creates (the name and the order).
        await ProjectRepository.lock(db, ctx, project.id);
        if (await MilestoneRepository.nameTaken(db, ctx, project.id, name)) nameTaken(name);
        const sortKey = keyBetween(await MilestoneRepository.lastSortKey(db, ctx, project.id), null);
        const m = await MilestoneRepository.create(db, ctx, { projectId: project.id, name, dueDate, sortKey });
        await logEvent(db, ctx, {
            action: 'MILESTONE_CREATED',
            entityType: 'Milestone',
            entityId: m.id,
            details: `Created milestone ${name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Milestone', operation: 'created', summary: 'MILESTONE_CREATED' },
            metadata: { projectId: project.id, dueDate: input.dueDate ?? null },
        });
        return { ...toViewMilestone(m), progress: { scope: 0, done: 0 }, late: false };
    });
}

export interface UpdateMilestoneInput {
    name?: string;
    dueDate?: string | null;
    position?: { afterId?: string; beforeId?: string };
}

/** Rename, re-date (or clear the date) and reorder by neighbour. */
export async function updateMilestone(ctx: RequestContext, projectId: string, milestoneId: string, input: UpdateMilestoneInput): Promise<MilestoneData> {
    assertCanManageMilestones(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        await ProjectRepository.lock(db, ctx, project.id);
        const m = await loadMilestone(db, ctx, project.id, milestoneId);
        const data: { name?: string; dueDate?: Date | null; sortKey?: string } = {};
        const changedFields: string[] = [];
        if (input.name !== undefined) {
            const name = cleanName(input.name);
            if (name !== m.name) {
                if (await MilestoneRepository.nameTaken(db, ctx, project.id, name, m.id)) nameTaken(name);
                data.name = name;
                changedFields.push('name');
            }
        }
        if (input.dueDate !== undefined) {
            const dueDate = input.dueDate ? fromDayKey(input.dueDate) : null;
            if ((dueDate?.getTime() ?? null) !== (m.dueDate?.getTime() ?? null)) {
                data.dueDate = dueDate;
                changedFields.push('dueDate');
            }
        }
        if (input.position) {
            const anchorId = (input.position.afterId ?? input.position.beforeId)!;
            if (anchorId === m.id) throw badRequest('A milestone cannot be placed next to itself.');
            const anchor = await MilestoneRepository.getById(db, ctx, anchorId);
            if (!anchor || anchor.projectId !== project.id) throw badRequest('The position names a milestone that is not in this project.');
            const side = input.position.afterId ? 'after' : 'before';
            const neighbour = await MilestoneRepository.neighbour(db, ctx, project.id, anchor, side, m.id);
            data.sortKey = side === 'after' ? keyBetween(anchor.sortKey, neighbour?.sortKey ?? null) : keyBetween(neighbour?.sortKey ?? null, anchor.sortKey);
            changedFields.push('sortKey');
        }
        if (changedFields.length > 0) {
            await MilestoneRepository.update(db, ctx, m.id, data);
            await logEvent(db, ctx, {
                action: 'MILESTONE_UPDATED',
                entityType: 'Milestone',
                entityId: m.id,
                details: `Changed milestone ${data.name ?? m.name} in ${project.keyPrefix}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'Milestone', operation: 'updated', changedFields },
                metadata: {
                    projectId: project.id,
                    changedFields,
                    ...(data.dueDate !== undefined ? { fromDueDate: m.dueDate ? dayKey(m.dueDate) : null, toDueDate: data.dueDate ? dayKey(data.dueDate) : null } : {}),
                },
            });
        }
        return (await milestoneDataList(db, ctx, v, [(await MilestoneRepository.getById(db, ctx, m.id))!]))[0]!;
    });
}

/**
 * Delete a milestone. Its items leave it first (their versions increase,
 * each audited), deleted items included, or the foreign key would refuse
 * the delete.
 */
export async function deleteMilestone(ctx: RequestContext, projectId: string, milestoneId: string): Promise<{ deleted: true; clearedItems: number }> {
    assertCanManageMilestones(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await loadProject(db, ctx, v, projectId);
        assertProjectWritable(project);
        await ProjectRepository.lock(db, ctx, project.id);
        const m = await loadMilestone(db, ctx, project.id, milestoneId);
        const rows = await WorkItemRepository.idsInMilestoneIncludingDeleted(db, ctx, m.id, MILESTONE_CLEAR_CAP + 1);
        if (rows.length > MILESTONE_CLEAR_CAP) {
            throw new ConflictError('This milestone holds too many work items to delete in one step. Move some to another milestone first.', {
                reason: 'MILESTONE_TOO_LARGE',
            });
        }
        // Locked in id order before the write (decision 173).
        const locked = await WorkItemRepository.lockForWrite(db, ctx, rows.map((r) => r.id));
        const cleared = await WorkItemRepository.clearMilestoneIncludingDeleted(db, ctx, locked, m.id);
        for (const r of rows) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_MILESTONE_CHANGED',
                entityType: 'WorkItem',
                entityId: r.id,
                details: `Took ${keyOf(r)} off milestone ${m.name}`,
                detailsJson: { category: 'custom', event: 'milestone_changed', fromMilestoneId: m.id, toMilestoneId: null, reason: 'milestone_deleted' },
                metadata: { fromMilestoneId: m.id, toMilestoneId: null, reason: 'milestone_deleted' },
            });
        }
        await MilestoneRepository.delete(db, ctx, m.id);
        await logEvent(db, ctx, {
            action: 'MILESTONE_DELETED',
            entityType: 'Milestone',
            entityId: m.id,
            details: `Deleted milestone ${m.name} in ${project.keyPrefix}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Milestone', operation: 'deleted', summary: 'MILESTONE_DELETED' },
            metadata: { projectId: project.id, clearedItems: cleared },
        });
        return { deleted: true as const, clearedItems: cleared };
    });
}

// ─── An item's milestone ──────────────────────────────────────────────────

/** A milestone an item of `projectId` may be aimed at: one of that project (400 otherwise). */
export async function assertMilestoneOfProject(db: PrismaTx, ctx: RequestContext, milestoneId: string, projectId: string): Promise<MilestoneRow> {
    const m = await MilestoneRepository.getById(db, ctx, milestoneId);
    if (!m) throw notFound('Milestone not found');
    if (m.projectId !== projectId) throw badRequest(`The milestone ${m.name} belongs to another project.`);
    return m;
}

/**
 * Aim an item at a milestone of its own project, or clear it (`null`). A
 * single-field change: `If-Match` optional, the version increases.
 */
export async function setWorkItemMilestone(ctx: RequestContext, id: string, input: { milestoneId: string | null }, expectedVersion?: number) {
    assertCanEditWorkItems(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        if (item.milestoneId === input.milestoneId) return { changed: false as const };
        await assertFieldWrite(db, ctx, item, { milestoneId: input.milestoneId });
        const to = input.milestoneId ? await assertMilestoneOfProject(db, ctx, input.milestoneId, item.projectId) : null;
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, { milestoneId: to?.id ?? null });
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_MILESTONE_CHANGED',
            entityType: 'WorkItem',
            entityId: id,
            details: to ? `Aimed ${keyOf(item)} at milestone ${to.name}` : `Took ${keyOf(item)} off its milestone`,
            detailsJson: { category: 'custom', event: 'milestone_changed', fromMilestoneId: item.milestoneId, toMilestoneId: to?.id ?? null },
            metadata: { fromMilestoneId: item.milestoneId, toMilestoneId: to?.id ?? null },
        });
        return { changed: true as const, detail: to ? `milestone ${to.name}` : 'milestone cleared' };
    });
    const after = await getWorkItem(ctx, id);
    if (result.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'updated', discriminator: `v${after.version}`, detail: result.detail }]);
    }
    return after;
}
