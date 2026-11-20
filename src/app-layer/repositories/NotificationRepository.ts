/**
 * The bell's and the Inbox's repository: a member's own notifications in the
 * open workspace. RLS scopes every query to the workspace; the `userId`
 * predicate here is the per-user scope
 * (tests/integration/notification-per-user-scope.test.ts): another member's
 * row is never read, and a write naming one changes nothing.
 *
 * Copied from inflect-compliance `src/app-layer/repositories/NotificationRepository.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (`import type`). Sub-phase 2.7c
 * adds the Inbox's views (Unread, All, Done; owner decision 134), its
 * read/unread and Done writes, the bulk writes and the purge (decision 135).
 */
import type { NotificationType, Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { buildKeysetWhere, keysetOrderBy, type CursorPayload, type KeysetOrder } from '@/lib/pagination';
import type { InboxView } from '@/lib/notifications/inbox';
import type { RequestContext } from '../types';

/** The Inbox's order: newest first, `id` breaking ties (docs/pagination.md). */
export const INBOX_ORDER: KeysetOrder<'createdAt'> = { column: 'createdAt', direction: 'desc', kind: 'date' };

/** The bell's list: the newest rows still in the Inbox. */
export const BELL_LIST_LIMIT = 50;

/** At most this many rows per bulk write by id. */
export const BULK_IDS_MAX = 200;

/** The columns a list returns. */
const LIST_SELECT = {
    id: true,
    type: true,
    title: true,
    body: true,
    read: true,
    readAt: true,
    archivedAt: true,
    linkUrl: true,
    workItemId: true,
    createdAt: true,
} as const satisfies Prisma.NotificationSelect;

function viewWhere(view: InboxView): Prisma.NotificationWhereInput {
    if (view === 'done') return { archivedAt: { not: null } };
    if (view === 'unread') return { archivedAt: null, read: false };
    return { archivedAt: null };
}

export class NotificationRepository {
    /** The bell: the newest rows not marked Done. */
    static async listMine(db: PrismaTx, ctx: RequestContext) {
        return db.notification.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId, archivedAt: null },
            orderBy: { createdAt: 'desc' },
            take: BELL_LIST_LIMIT,
            select: LIST_SELECT,
        });
    }

    /** One Inbox page: `limit + 1` rows after the cursor, newest first. */
    static async listPage(
        db: PrismaTx,
        ctx: RequestContext,
        opts: { view: InboxView; type?: NotificationType; cursor?: CursorPayload; limit: number },
    ) {
        return db.notification.findMany({
            where: {
                tenantId: ctx.tenantId,
                userId: ctx.userId,
                ...viewWhere(opts.view),
                ...(opts.type ? { type: opts.type } : {}),
                ...(opts.cursor ? buildKeysetWhere(INBOX_ORDER, opts.cursor) : {}),
            },
            orderBy: keysetOrderBy(INBOX_ORDER),
            take: opts.limit + 1,
            select: LIST_SELECT,
        });
    }

    /** The unread count the Inbox's tab shows (rows not Done). */
    static async countUnread(db: PrismaTx, ctx: RequestContext): Promise<number> {
        return db.notification.count({ where: { tenantId: ctx.tenantId, userId: ctx.userId, archivedAt: null, read: false } });
    }

    /** Mark one read (the bell's `PUT`). */
    static async markAsRead(db: PrismaTx, ctx: RequestContext, id: string, now: Date = new Date()) {
        return db.notification.updateMany({
            where: { id, tenantId: ctx.tenantId, userId: ctx.userId, read: false },
            data: { read: true, readAt: now },
        });
    }

    /**
     * Change one row: read or unread, Done or back in the Inbox. Marking Done
     * also marks it read (the badge counts only what is still to look at).
     */
    static async updateOne(
        db: PrismaTx,
        ctx: RequestContext,
        id: string,
        change: { read?: boolean; done?: boolean },
        now: Date = new Date(),
    ) {
        return db.notification.updateMany({
            where: { id, tenantId: ctx.tenantId, userId: ctx.userId },
            data: changeData(change, now),
        });
    }

    /** The same change on several of the member's rows (at most `BULK_IDS_MAX`). */
    static async updateMany(
        db: PrismaTx,
        ctx: RequestContext,
        ids: readonly string[],
        change: { read?: boolean; done?: boolean },
        now: Date = new Date(),
    ) {
        if (ids.length === 0) return { count: 0 };
        return db.notification.updateMany({
            where: { id: { in: [...ids] }, tenantId: ctx.tenantId, userId: ctx.userId },
            data: changeData(change, now),
        });
    }

    /** "Mark all read": every unread row still in the Inbox. */
    static async markAllRead(db: PrismaTx, ctx: RequestContext, now: Date = new Date()) {
        return db.notification.updateMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId, archivedAt: null, read: false },
            data: { read: true, readAt: now },
        });
    }

    /**
     * Retention (owner decision 135): the ids of up to `take` rows past their
     * window in this workspace: Done more than `doneBefore` ago, or read (and
     * not Done) more than `readBefore` ago, counting from `createdAt` for a
     * row read before `readAt` existed. Unread rows still in the Inbox are
     * never selected.
     */
    static async purgeableIds(db: PrismaTx, tenantId: string, cut: { doneBefore: Date; readBefore: Date }, take: number) {
        const rows = await db.notification.findMany({
            where: {
                tenantId,
                OR: [
                    { archivedAt: { lt: cut.doneBefore } },
                    { archivedAt: null, read: true, readAt: { lt: cut.readBefore } },
                    { archivedAt: null, read: true, readAt: null, createdAt: { lt: cut.readBefore } },
                ],
            },
            take,
            select: { id: true },
        });
        return rows.map((r) => r.id);
    }

    static async deleteByIds(db: PrismaTx, tenantId: string, ids: readonly string[]): Promise<number> {
        if (ids.length === 0) return 0;
        const r = await db.notification.deleteMany({ where: { tenantId, id: { in: [...ids] } } });
        return r.count;
    }
}

function changeData(change: { read?: boolean; done?: boolean }, now: Date): Prisma.NotificationUpdateManyMutationInput {
    const data: Prisma.NotificationUpdateManyMutationInput = {};
    if (change.read === true) Object.assign(data, { read: true, readAt: now });
    if (change.read === false) Object.assign(data, { read: false, readAt: null });
    if (change.done === true) Object.assign(data, { archivedAt: now, ...(change.read === false ? {} : { read: true, readAt: now }) });
    if (change.done === false) data.archivedAt = null;
    return data;
}
