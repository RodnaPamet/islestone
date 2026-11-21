/**
 * The timeline (roadmap 3.1b): the list's filters, at most 5,000 items, the
 * blocks relations that touch them, their working calendars and deadlines,
 * and the scheduling engine's answer, computed on the server on every read
 * (ADR 0010, decisions 196 and 197). Above 5,000 items a 422
 * `TIMELINE_TOO_LARGE` carries the count; never a cut-off list.
 *
 * Read-gated on `work_items.view`; project visibility narrows every read in
 * the repositories. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemTimeline } from '@/app-layer/usecases/work-item-timeline';
import { WorkItemQuerySchema, customFieldConditionsOf } from '@/lib/schemas/work-item';
import { normalizeQ } from '@/lib/filters/query-helpers';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _args, ctx) => {
        const query = WorkItemQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        // The list's order, page size and cursor do not apply: the timeline reads the whole scope.
        const { order: _order, dir: _dir, limit: _limit, cursor: _cursor, deleted: _deleted, ...filters } = query;
        void _order;
        void _dir;
        void _limit;
        void _cursor;
        void _deleted;
        return jsonResponse(
            await getWorkItemTimeline(ctx, {
                ...filters,
                customFields: customFieldConditionsOf(req.nextUrl.searchParams),
                q: normalizeQ(filters.q),
                includeArchived: filters.includeArchived === 'true' || filters.includeArchived === '1',
            }),
        );
    }),
);
