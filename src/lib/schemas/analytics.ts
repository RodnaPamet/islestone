/**
 * The analytics reads' query parameters (sub-phase 3.6a;
 * docs/porting/maps/3.6.md, "Reads, routes and keys"). The list's filters are
 * `WorkItemQuerySchema`'s; these are the window and each read's own choice.
 * The usecase checks the window's span (400 `ANALYTICS_RANGE`).
 */
import { z } from 'zod';

import { normalizeQ } from '@/lib/filters/query-helpers';

import { CalendarWindowSchema, WorkItemQuerySchema, customFieldConditionsOf } from './work-item';

/** `from` and `to`, date-only, inclusive. */
export const AnalyticsWindowSchema = CalendarWindowSchema;

export const ThroughputQuerySchema = z.object({ bin: z.enum(['day', 'week']).optional() });
export const DurationsQuerySchema = z.object({ measure: z.enum(['cycle', 'lead']).optional() });
export const FlowQuerySchema = z.object({
    burnUp: z.enum(['0', '1']).optional(),
    measure: z.enum(['items', 'points', 'hours']).optional(),
});

/**
 * The list's filters and the window from a request's query string, as the
 * calendar route reads them: the list's order, page size, cursor and Deleted
 * view do not apply.
 */
export function analyticsFiltersOf(searchParams: URLSearchParams) {
    const params = Object.fromEntries(searchParams);
    const window = AnalyticsWindowSchema.parse(params);
    const query = WorkItemQuerySchema.parse(params);
    const { order: _order, dir: _dir, limit: _limit, cursor: _cursor, deleted: _deleted, ...filters } = query;
    void _order;
    void _dir;
    void _limit;
    void _cursor;
    void _deleted;
    return {
        ...filters,
        ...window,
        customFields: customFieldConditionsOf(searchParams),
        q: normalizeQ(filters.q),
        includeArchived: filters.includeArchived === 'true' || filters.includeArchived === '1',
    };
}
