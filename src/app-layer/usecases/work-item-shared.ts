/**
 * What every work-item usecase shares: the response shape, the write gate
 * (the live, visible item in a writable project), the 404-versus-409 re-read
 * after a versioned write, and the post-commit notification emitters.
 *
 * The emitters keep inflect-compliance's posture
 * (`src/app-layer/usecases/task.ts` lines 1388–1592 at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e): they run AFTER the item's
 * transaction commits, each in a short transaction of its own, and swallow
 * their errors, so a notification failure never surfaces to (or rolls back)
 * the work-item operation. Each returns early without `ctx.tenantSlug`
 * (inflect's rule), which every HTTP context carries.
 */
import { createHash } from 'node:crypto';

import type { WorkflowStateCategory } from '@prisma/client';

import { createAssignmentNotification } from '../notifications/assignment';
import { createWatcherNotifications, type WatcherActivityKind } from '../notifications/watcher';
import { createWorkItemDueNotification } from '../notifications/work-item-due';
import { enqueueEmail } from '../notifications/enqueue';
import { MembershipRepository } from '../repositories/MembershipRepository';
import {
    WorkItemRepository,
    WorkItemWatcherRepository,
    type WorkItemGateRow,
    type WorkItemListRow,
} from '../repositories/WorkItemRepository';
import type { ProjectVisibility } from '../policies/project-visibility';
import { formatKey } from '../domain/work-item-key';
import type { RequestContext } from '../types';
import { env } from '@/env';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { AppError, ConflictError, notFound } from '@/lib/errors/types';
import { logger } from '@/lib/observability/logger';
import { tenantMyWorkPath, tenantWorkItemPath } from '@/lib/work-item-paths';

/** `YYYY-MM-DD` of a date-only column, or null. */
export function dateOnly(d: Date | null | undefined): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
}

/** `YYYY-MM-DD` → the date-only value Prisma writes (UTC midnight). */
export function parseDateOnly(s: string | null | undefined): Date | null {
    return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

/**
 * An item's custom-field values as the API returns them (sub-phase 2.4):
 * field id → a string (text, URL), a number, a `YYYY-MM-DD` date, `true`, an
 * option id (select), option ids (multi-select) or a user id (person).
 */
export function customFieldsOf(values: WorkItemListRow['customFieldValues'] | undefined): Record<string, string | number | boolean | string[]> {
    const out: Record<string, string | number | boolean | string[]> = {};
    for (const v of values ?? []) {
        switch (v.fieldType) {
            case 'TEXT':
            case 'URL':
                if (v.textValue !== null) out[v.fieldId] = v.textValue;
                break;
            case 'NUMBER':
                if (v.numberValue !== null) out[v.fieldId] = Number(v.numberValue);
                break;
            case 'DATE':
                if (v.dateValue) out[v.fieldId] = dateOnly(v.dateValue)!;
                break;
            case 'CHECKBOX':
                out[v.fieldId] = true;
                break;
            case 'SELECT':
                if (v.optionId) out[v.fieldId] = v.optionId;
                break;
            case 'MULTI_SELECT': {
                const held = out[v.fieldId];
                if (v.optionId) out[v.fieldId] = Array.isArray(held) ? [...held, v.optionId] : [v.optionId];
                break;
            }
            case 'PERSON':
                if (v.userId) out[v.fieldId] = v.userId;
                break;
        }
    }
    return out;
}

/** The list and response shape of a work item. */
export function toWorkItemDto(row: WorkItemListRow) {
    const { project, labels, startDate, dueDate, customFieldValues, priorityRank: _rank, ...rest } = row;
    void _rank;
    return {
        ...rest,
        key: formatKey(project.keyPrefix, row.number),
        labelIds: labels.map((l) => l.labelId),
        startDate: dateOnly(startDate),
        dueDate: dateOnly(dueDate),
        customFields: customFieldsOf(customFieldValues),
    };
}

export type WorkItemDto = ReturnType<typeof toWorkItemDto>;

/** The reminder zone, falling back to UTC when unset. */
export function notificationsTz(): string {
    return (env.NOTIFICATIONS_TZ as string | undefined) || 'UTC';
}

/**
 * The write gate: the live item, visible to the caller, in a project that is
 * not archived. A missing, deleted or invisible item (or one in a deleted
 * project) is a 404; an archived project's item is a 409.
 */
export async function loadWritableItem(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<WorkItemGateRow> {
    const item = await WorkItemRepository.findVisible(db, ctx, v, id);
    if (!item) throw notFound('Work item not found');
    assertProjectWritable(item.project);
    return item;
}

export function assertProjectWritable(project: { archivedAt: Date | null }) {
    if (project.archivedAt) {
        throw new ConflictError('The project is archived; unarchive it to change its work items.', { reason: 'PROJECT_ARCHIVED' });
    }
}

/** A visible item for a read, or a 404. */
export async function loadVisibleItem(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<WorkItemGateRow> {
    const item = await WorkItemRepository.findVisible(db, ctx, v, id);
    if (!item) throw notFound('Work item not found');
    return item;
}

/** 428: a title or description write must carry the version it was based on (ADR 0002 §9). */
export function preconditionRequired(): AppError {
    return new AppError(
        'Send the version you edited in an If-Match header: a title or description change must name it.',
        'PRECONDITION_REQUIRED',
        428,
    );
}

/**
 * After a versioned `updateMany` matched nothing: no live visible row is a
 * 404; a row with another version is a 409 carrying the current version and
 * row, so the client can retry when none of its fields changed underneath it.
 */
export async function throwWriteConflict(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, id: string): Promise<never> {
    const current = await WorkItemRepository.getById(db, ctx, v, id);
    if (!current) throw notFound('Work item not found');
    throw new ConflictError('The work item changed since you read it.', {
        reason: 'VERSION_CONFLICT',
        version: current.version,
        item: toWorkItemDto(current),
    });
}

/** The item's key from a gate row. */
export function keyOf(item: { number: number; project: { keyPrefix: string } }): string {
    return formatKey(item.project.keyPrefix, item.number);
}

// ─── Notifications (post-commit, fire-and-forget) ─────────────────────────

export interface AssignedItemForMail {
    id: string;
    title: string;
    key: string;
    typeName: string | null;
}

/**
 * Enqueue the assignment email INSIDE the caller's transaction (the outbox
 * row commits with the assignment). One item is the ordinary mail; two or
 * more from one bulk action are one digest (inflect-compliance #4278). Never
 * throws: `enqueueEmail` is `createMany({ skipDuplicates })`, which cannot
 * poison the transaction, and a missing address skips the mail.
 */
export async function enqueueAssignedEmail(
    db: PrismaTx,
    ctx: RequestContext,
    assigneeUserId: string,
    items: readonly AssignedItemForMail[],
): Promise<void> {
    if (items.length === 0 || !ctx.tenantSlug) return;
    const contacts = await MembershipRepository.contactsOf(db, [assigneeUserId, ctx.userId]);
    const assignee = contacts.find((c) => c.id === assigneeUserId);
    if (!assignee?.email) return;
    const assigner = assigneeUserId === ctx.userId ? undefined : contacts.find((c) => c.id === ctx.userId)?.name ?? undefined;
    const assigneeName = assignee.name || assignee.email;
    if (items.length === 1) {
        const item = items[0]!;
        await enqueueEmail(db, {
            tenantId: ctx.tenantId,
            type: 'WORK_ITEM_ASSIGNED',
            toEmail: assignee.email,
            entityId: item.id,
            requestId: ctx.requestId,
            payload: {
                workItemTitle: item.title,
                workItemKey: item.key,
                workItemTypeName: item.typeName,
                assigneeName,
                assignerName: assigner,
                linkPath: tenantWorkItemPath(ctx.tenantSlug, item.id),
            },
        });
        return;
    }
    const digestKey = createHash('sha256').update(items.map((i) => i.id).sort().join(',')).digest('hex').slice(0, 32);
    await enqueueEmail(db, {
        tenantId: ctx.tenantId,
        type: 'WORK_ITEM_ASSIGNED',
        toEmail: assignee.email,
        entityId: `bulk:${digestKey}`,
        requestId: ctx.requestId,
        payload: {
            items: items.map((i) => ({ workItemTitle: i.title, workItemKey: i.key, workItemTypeName: i.typeName })),
            assigneeName,
            assignerName: assigner,
            linkPath: tenantMyWorkPath(ctx.tenantSlug),
        },
    });
}

/** The assignment bell for each item, after the commit. */
export async function emitAssignedBells(
    ctx: RequestContext,
    assigneeUserId: string,
    items: ReadonlyArray<{ id: string; title: string; key: string }>,
): Promise<void> {
    if (items.length === 0 || !ctx.tenantSlug) return;
    const tenantSlug = ctx.tenantSlug;
    try {
        await runInTenantContext(ctx, async (db) => {
            for (const item of items) {
                await createAssignmentNotification(db, 'WORK_ITEM_ASSIGNED', {
                    tenantId: ctx.tenantId,
                    assigneeUserId,
                    entityId: item.id,
                    entityLabel: item.title,
                    entityKey: item.key,
                    linkUrl: tenantWorkItemPath(tenantSlug, item.id),
                });
            }
        });
    } catch (err) {
        logger.warn('failed to create work-item-assigned notification', {
            component: 'notifications',
            workItemIds: items.map((i) => i.id),
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/** The due reminder, when an assigned item's due date is on a window today. */
export async function emitDueBell(
    ctx: RequestContext,
    item: { id: string; title: string; key: string; dueDate: Date | null; assigneeId: string | null; stateCategory: WorkflowStateCategory },
): Promise<void> {
    if (!ctx.tenantSlug || !item.dueDate || !item.assigneeId) return;
    if (item.stateCategory === 'DONE' || item.stateCategory === 'CANCELLED') return;
    const tenantSlug = ctx.tenantSlug;
    try {
        await runInTenantContext(ctx, (db) =>
            createWorkItemDueNotification(
                db,
                {
                    id: item.id,
                    tenantId: ctx.tenantId,
                    tenantSlug,
                    title: item.title,
                    key: item.key,
                    dueDate: item.dueDate!,
                    assigneeUserId: item.assigneeId!,
                },
                new Date(),
                notificationsTz(),
            ),
        );
    } catch (err) {
        logger.warn('failed to create work-item-due notification', {
            component: 'notifications',
            workItemId: item.id,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export interface WatcherEvent {
    workItemId: string;
    kind: WatcherActivityKind;
    discriminator: string;
    detail: string;
}

/**
 * Fan activity out to the items' WATCHERS, after the commit, excluding the
 * actor (nobody is notified of their own action). The items and watchers
 * are read in one query each (`listForFanOut`, `listByWorkItemIds`): live
 * items in live, unarchived projects, ACTIVE watchers only.
 */
export async function emitWatcherActivity(ctx: RequestContext, events: readonly WatcherEvent[]): Promise<void> {
    if (events.length === 0 || !ctx.tenantSlug) return;
    const tenantSlug = ctx.tenantSlug;
    try {
        await runInTenantContext(ctx, async (db) => {
            const ids = [...new Set(events.map((e) => e.workItemId))];
            const items = new Map((await WorkItemRepository.listForFanOut(db, ctx, ids)).map((i) => [i.id, i]));
            const watchers = await WorkItemWatcherRepository.listByWorkItemIds(db, ctx, ids);
            for (const e of events) {
                const item = items.get(e.workItemId);
                if (!item) continue;
                const recipients = watchers.filter((w) => w.workItemId === e.workItemId && w.userId !== ctx.userId).map((w) => w.userId);
                await createWatcherNotifications(db, recipients, {
                    tenantId: ctx.tenantId,
                    workItemId: item.id,
                    workItemKey: formatKey(item.project.keyPrefix, item.number),
                    workItemTitle: item.title,
                    linkUrl: tenantWorkItemPath(tenantSlug, item.id),
                    kind: e.kind,
                    discriminator: e.discriminator,
                    detail: e.detail,
                });
            }
        });
    } catch (err) {
        logger.warn('failed to fan work-item activity out to watchers', {
            component: 'notifications',
            workItemIds: events.map((e) => e.workItemId),
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
