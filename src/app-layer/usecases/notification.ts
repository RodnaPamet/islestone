/**
 * The bell's and the Inbox's usecases: a member's own notifications.
 *
 * Every role reads and changes its own rows (`assertCanRead`); the repository
 * adds the per-user predicate, so a row that is not the caller's is never read
 * and a write naming one is a silent no-op, as the bell's mark-read always was.
 *
 * Copied from inflect-compliance `src/app-layer/usecases/notification.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (`import type`). Sub-phase 2.7c
 * adds the Inbox: its three views (owner decision 134), read and unread, Done
 * and back, and the bulk writes.
 */
import type { RequestContext } from '../types';
import { NotificationRepository, INBOX_ORDER } from '../repositories/NotificationRepository';
import { assertCanRead } from '../policies/common';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest } from '@/lib/errors/types';
import type { InboxPageData, NotificationRowData } from '@/lib/notifications/inbox';
import { clampLimit, computeKeysetPage, decodeCursor, InvalidCursorError, type CursorPayload } from '@/lib/pagination';
import type { InboxQuery, NotificationBulk, NotificationChange } from '@/lib/schemas/notifications';

type Row = Awaited<ReturnType<typeof NotificationRepository.listMine>>[number];

function toDto(r: Row): NotificationRowData {
    return {
        id: r.id,
        type: r.type,
        title: r.title,
        body: r.body,
        read: r.read,
        readAt: r.readAt?.toISOString() ?? null,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        linkUrl: r.linkUrl,
        workItemId: r.workItemId,
        createdAt: r.createdAt.toISOString(),
    };
}

/** The bell: the newest rows still in the Inbox. */
export async function listMyNotifications(ctx: RequestContext): Promise<NotificationRowData[]> {
    assertCanRead(ctx); // Every user can read their own
    const rows = await runInTenantContext(ctx, (db) => NotificationRepository.listMine(db, ctx));
    return rows.map(toDto);
}

/** One Inbox page in a view, with the unread count. */
export async function listInbox(ctx: RequestContext, query: InboxQuery): Promise<InboxPageData> {
    assertCanRead(ctx);
    const limit = clampLimit(query.limit);
    let cursor: CursorPayload | undefined;
    if (query.cursor) {
        try {
            cursor = decodeCursor(query.cursor, INBOX_ORDER);
        } catch (err) {
            if (err instanceof InvalidCursorError) throw badRequest('Invalid cursor.');
            throw err;
        }
    }
    const [rows, unreadCount] = await runInTenantContext(ctx, (db) =>
        Promise.all([
            NotificationRepository.listPage(db, ctx, { view: query.view, type: query.type, cursor, limit }),
            NotificationRepository.countUnread(db, ctx),
        ]),
    );
    const page = computeKeysetPage(rows, limit, INBOX_ORDER);
    return { items: page.items.map(toDto), pageInfo: page.pageInfo, unreadCount };
}

/** Mark one read (the bell's `PUT`, kept for its callers). */
export async function markNotificationRead(ctx: RequestContext, id: string) {
    assertCanRead(ctx); // Every user can write (mark read) their own
    return runInTenantContext(ctx, async (db) => {
        await NotificationRepository.markAsRead(db, ctx, id);
        return { success: true };
    });
}

/** Read or unread, Done or back in the Inbox; another member's row changes nothing. */
export async function updateMyNotification(ctx: RequestContext, id: string, change: NotificationChange): Promise<{ updated: number }> {
    assertCanRead(ctx);
    const r = await runInTenantContext(ctx, (db) => NotificationRepository.updateOne(db, ctx, id, change));
    return { updated: r.count };
}

/** "Mark all read", or the same change on several named rows. */
export async function bulkUpdateMyNotifications(ctx: RequestContext, input: NotificationBulk): Promise<{ updated: number }> {
    assertCanRead(ctx);
    const r = await runInTenantContext(ctx, (db) =>
        input.action === 'mark-all-read'
            ? NotificationRepository.markAllRead(db, ctx)
            : NotificationRepository.updateMany(db, ctx, input.ids, { read: input.read, done: input.done }),
    );
    return { updated: r.count };
}
