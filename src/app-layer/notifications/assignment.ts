/**
 * In-app (bell) notification for a work item being assigned to someone.
 *
 * One function, `createAssignmentNotification`, that the caller drives with a
 * typed payload:
 *   - `db.notification.createMany({ skipDuplicates: true })` so a duplicate
 *     dedupeKey returns count=0 with NO exception (a raw `create` throws
 *     P2002, which poisons an interactive Postgres transaction);
 *   - dedupeKey shape `{tenantId}:{TYPE}:{entityId}:{userId}:{date}`, so the
 *     same user being assigned the same item twice in one day collapses to a
 *     single bell notification;
 *   - the workspace's in-app mute list is asked FIRST
 *     (`isInAppTypeEnabled`): a muted type writes no row, so it reaches
 *     neither the bell list, nor the badge, nor the SSE stream.
 *
 * Fire-and-forget — callers isolate the write in its own transaction so a
 * notification failure never rolls back the parent operation. Callers: the
 * work-item create, assign and bulk-assign usecases (sub-phase 2.2), and the
 * waiting-on write and create (`WORK_ITEM_WAITING_ON`, sub-phase 2.4b).
 *
 * Copied from inflect-compliance `src/app-layer/notifications/assignment.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: one kind,
 * `WORK_ITEM_ASSIGNED` (the control, risk, asset and review kinds are not
 * ported), the link supplied by the caller until 2.3 owns the route, the
 * in-app mute check added (inflect left this emitter off the mute list, a
 * reason that does not carry over to a new product), and the bell text is
 * `body`.
 */

import type { PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from '@/lib/notifications/notification-bus';
import { insertedNotificationIds } from './inserted-ids';
import { isInAppTypeEnabled } from './settings';

export interface AssignmentTarget {
    /** Workspace the item belongs to. */
    tenantId: string;
    /** Recipient — the new assignee (or, for `WORK_ITEM_WAITING_ON`, the person named). */
    assigneeUserId: string;
    /** Work item being assigned. */
    entityId: string;
    /** Display label for the notification body (the item's title). */
    entityLabel: string;
    /** Optional key for the body (e.g. `ISL-123`). */
    entityKey?: string | null;
    /**
     * The bell's link, `/t/<slug>/…`. Sub-phase 2.3 owns the work-item route
     * and its `workItemPath(slug, id)` helper; until then the caller passes
     * the link (build it with `tenantPageLink`).
     */
    linkUrl: string;
}

/**
 * `WORK_ITEM_WAITING_ON` (sub-phase 2.4b, owner decision 105): someone named
 * the recipient as the person the item waits on. Same writer, same dedupe
 * shape; the recipient is not made accountable (ADR 0003 §1).
 */
export type AssignmentNotificationKind = 'WORK_ITEM_ASSIGNED' | 'WORK_ITEM_WAITING_ON';

interface AssignmentCopy {
    title: string;
    body: (label: string) => string;
}

/**
 * The copy each kind writes. `in-app-types.ts` lists the bell types a
 * workspace may mute from these keys.
 */
export const ASSIGNMENT_COPY: Record<AssignmentNotificationKind, AssignmentCopy> = {
    WORK_ITEM_ASSIGNED: {
        title: 'You were assigned a work item',
        body: (label) => `${label} is now yours.`,
    },
    WORK_ITEM_WAITING_ON: {
        title: 'A work item is waiting on you',
        body: (label) => `${label} is waiting on you.`,
    },
};

/**
 * Build the idempotency key. Pure helper so tests can assert the
 * format directly.
 */
export function buildAssignmentDedupeKey(
    tenantId: string,
    kind: AssignmentNotificationKind,
    entityId: string,
    userId: string,
    now: Date = new Date(),
): string {
    // Day granularity in UTC — re-assigning the same user to the
    // same entity within one day shouldn't double-notify the bell.
    const ymd = now.toISOString().slice(0, 10);
    return `${tenantId}:${kind}:${entityId}:${userId}:${ymd}`;
}

export interface AssignmentNotificationOutcome {
    status: 'created' | 'duplicate' | 'muted';
}

export async function createAssignmentNotification(
    db: Pick<PrismaClient, 'notification' | 'tenantNotificationSettings'>,
    kind: AssignmentNotificationKind,
    target: AssignmentTarget,
    now: Date = new Date(),
): Promise<AssignmentNotificationOutcome> {
    // Above the write, not filtered after it: a muted row would still reach
    // the bell list, the badge and the SSE stream.
    if (!(await isInAppTypeEnabled(db, target.tenantId, kind))) {
        return { status: 'muted' };
    }

    const copy = ASSIGNMENT_COPY[kind];
    const label = target.entityKey
        ? `${target.entityKey} "${target.entityLabel}"`
        : `"${target.entityLabel}"`;

    const row = {
        tenantId: target.tenantId,
        userId: target.assigneeUserId,
        type: kind,
        title: copy.title,
        body: copy.body(label),
        linkUrl: target.linkUrl,
        dedupeKey: buildAssignmentDedupeKey(
            target.tenantId,
            kind,
            target.entityId,
            target.assigneeUserId,
            now,
        ),
    };

    const result = await db.notification.createMany({
        data: [row],
        skipDuplicates: true,
    });

    // Fan the fresh insert out to the SSE bus so subscribed bell clients see
    // the assignment the moment it lands, not on the next poll. Skip when
    // result.count === 0 — the dedupeKey collapsed a duplicate, and the
    // original was already pushed. The event carries the ROW's id (inflect
    // #5305), which marking it read needs.
    if (result.count > 0) {
        const written = (await insertedNotificationIds(db, target.tenantId, [row.dedupeKey])).get(row.dedupeKey);
        if (written) publishNotificationEvent(target.tenantId, target.assigneeUserId, {
            id: written.id,
            type: row.type,
            title: row.title,
            body: row.body,
            read: false,
            linkUrl: row.linkUrl,
            createdAt: written.createdAt.toISOString(),
        });
    }

    return { status: result.count > 0 ? 'created' : 'duplicate' };
}
