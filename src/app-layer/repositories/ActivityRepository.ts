/**
 * The audit-trail half of a work item's Activity (ADR 0006 "Activity": a read
 * model, no table). Moved out of inflect-compliance's `getTaskActivity`
 * (`usecases/task.ts` line 1867 at 5528464fc54a8681956f3b9ce23ca9c075f0420e),
 * which read `db.auditLog` from the usecase with `take: 50`; this is a keyset
 * page over `(createdAt, id)` descending, backed by the
 * `[tenantId, entityId, createdAt]` index.
 *
 * Only the usecase-written entries (`WORK_ITEM_*`) are activity; the audit
 * extension's per-statement rows (`CREATE`, `UPDATEMANY`, …) are not.
 * Comments come from their own table and are merged by the usecase.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { buildKeysetWhere, keysetOrderBy, type CursorPayload, type KeysetOrder } from '@/lib/pagination';
import type { RequestContext } from '../types';

export const ACTIVITY_ORDER: KeysetOrder = { column: 'createdAt', direction: 'desc', kind: 'date' };

export class ActivityRepository {
    static async listForWorkItem(
        db: PrismaTx,
        ctx: RequestContext,
        workItemId: string,
        page: { limit: number; cursor?: CursorPayload },
    ) {
        return db.auditLog.findMany({
            where: {
                tenantId: ctx.tenantId,
                entity: 'WorkItem',
                entityId: workItemId,
                action: { startsWith: 'WORK_ITEM_' },
                ...(page.cursor ? (buildKeysetWhere(ACTIVITY_ORDER, page.cursor) as Prisma.AuditLogWhereInput) : {}),
            },
            orderBy: keysetOrderBy(ACTIVITY_ORDER) as Prisma.AuditLogOrderByWithRelationInput[],
            take: page.limit + 1,
            select: { id: true, action: true, userId: true, actorType: true, detailsJson: true, createdAt: true },
        });
    }
}
