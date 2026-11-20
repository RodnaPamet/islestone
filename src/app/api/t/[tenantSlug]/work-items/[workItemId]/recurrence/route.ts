/**
 * An item's repeat (sub-phase 2.5d, owner decisions 67 to 72): read its place
 * in a series (`work_items.view`), set, change, put on hold or resume the
 * repeat set on it (`work_items.create`; the usecase also asserts
 * `work_items.edit`), and stop it (`work_items.edit`).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getWorkItemSeries, removeWorkItemRecurrence, setWorkItemRecurrence } from '@/app-layer/usecases/recurrence';
import { SetRecurrenceSchema } from '@/lib/schemas/recurrence';
import { parseJsonBody } from '@/lib/validation/route';

type Params = { tenantSlug: string; workItemId: string };

export const GET = withApiErrorHandling(
    requirePermission<Params>('work_items.view', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await getWorkItemSeries(ctx, params.workItemId));
    }),
);

export const PUT = withApiErrorHandling(
    requirePermission<Params>('work_items.create', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetRecurrenceSchema);
        return jsonResponse(await setWorkItemRecurrence(ctx, params.workItemId, input));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<Params>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await removeWorkItemRecurrence(ctx, params.workItemId));
    }),
);
