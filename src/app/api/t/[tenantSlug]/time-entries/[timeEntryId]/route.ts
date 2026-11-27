/**
 * One's own time entry (sub-phase 3.4b; owner decisions 264, 267 and 277).
 *
 *   - PATCH: change its date, minutes, item, billable flag or description;
 *     `If-Match` optional (409 `VERSION_CONFLICT` with the current entry).
 *   - DELETE: remove it for good (decision 277; the browser sends it from the
 *     undo toast); a running timer deleted this way is discarded.
 *
 * Another person's entry is a 404 (decision 267). Key: `time.track`.
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { deleteTimeEntry, updateTimeEntry } from '@/app-layer/usecases/time-entry';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { UpdateTimeEntrySchema } from '@/lib/schemas/time-entry';
import { parseJsonBody } from '@/lib/validation/route';

export const PATCH = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timeEntryId: string }>('time.track', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, UpdateTimeEntrySchema);
        return jsonResponse(await updateTimeEntry(ctx, params.timeEntryId, input, expectedVersionFrom(req)));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; timeEntryId: string }>('time.track', async (_req: NextRequest, { params }, ctx) => {
        await deleteTimeEntry(ctx, params.timeEntryId);
        return jsonResponse({ deleted: true });
    }),
);
