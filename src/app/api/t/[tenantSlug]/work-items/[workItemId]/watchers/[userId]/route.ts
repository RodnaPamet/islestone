/**
 * Add or remove ANOTHER member as a watcher (`work_items.edit`). Naming
 * yourself is a 400: use `watchers` itself.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addWatcher, removeWatcher } from '@/app-layer/usecases/work-item-collab';
import { badRequest } from '@/lib/errors/types';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; userId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        if (params.userId === ctx.userId) throw badRequest('To watch an item yourself, use the watchers route.');
        return jsonResponse(await addWatcher(ctx, params.workItemId, params.userId));
    }),
);

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string; userId: string }>('work_items.edit', async (_req: NextRequest, { params }, ctx) => {
        if (params.userId === ctx.userId) throw badRequest('To stop watching an item yourself, use the watchers route.');
        return jsonResponse(await removeWatcher(ctx, params.workItemId, params.userId));
    }),
);
