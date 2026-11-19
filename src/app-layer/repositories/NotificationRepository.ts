/**
 * The bell's repository: a member's own notifications in the open workspace.
 * RLS scopes every query to the workspace; the `userId` predicate here is the
 * per-user scope (tests/integration/notification-per-user-scope.test.ts).
 *
 * Copied from inflect-compliance `src/app-layer/repositories/NotificationRepository.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (`import type`).
 */
import type { PrismaTx } from '@/lib/db-context';
import type { RequestContext } from '../types';

export class NotificationRepository {
    static async listMine(db: PrismaTx, ctx: RequestContext) {
        return db.notification.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
    }

    static async markAsRead(db: PrismaTx, ctx: RequestContext, id: string) {
        return db.notification.updateMany({
            where: { id, tenantId: ctx.tenantId, userId: ctx.userId },
            data: { read: true },
        });
    }
}
