/**
 * The calendar view (roadmap 3.3a): the list's filters, the items due in a
 * window of at most 62 days (at most 2,000; above it a 422
 * `CALENDAR_TOO_LARGE` carries the count, never a cut-off grid), the cycles,
 * milestones and project due dates around them, and the scope's working
 * calendar.
 *
 * Read-gated on `work_items.view`; project visibility narrows every read in
 * the repositories, and the usecase names cycles or milestones the caller may
 * not read as omitted. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemCalendar } from '@/app-layer/usecases/work-item-calendar';
import { CalendarWindowSchema, WorkItemQuerySchema, customFieldConditionsOf } from '@/lib/schemas/work-item';
import { normalizeQ } from '@/lib/filters/query-helpers';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.view', async (req: NextRequest, _args, ctx) => {
        const params = Object.fromEntries(req.nextUrl.searchParams);
        const window = CalendarWindowSchema.parse(params);
        const query = WorkItemQuerySchema.parse(params);
        // The list's order, page size and cursor do not apply: the calendar reads the whole window.
        const { order: _order, dir: _dir, limit: _limit, cursor: _cursor, deleted: _deleted, ...filters } = query;
        void _order;
        void _dir;
        void _limit;
        void _cursor;
        void _deleted;
        return jsonResponse(
            await getWorkItemCalendar(ctx, {
                ...filters,
                ...window,
                customFields: customFieldConditionsOf(req.nextUrl.searchParams),
                q: normalizeQ(filters.q),
                includeArchived: filters.includeArchived === 'true' || filters.includeArchived === '1',
            }),
        );
    }),
);
