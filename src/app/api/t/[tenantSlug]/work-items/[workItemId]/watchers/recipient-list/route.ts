/**
 * Add a recipient list to a work item's watchers (sub-phase 2.7e; owner
 * decision 139): the people the list resolves to now (active, able to see
 * the item) become ordinary watchers, each free to stop watching. Key
 * `work_items.edit`, the key adding another member as a watcher takes.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addRecipientListAsWatchers } from '@/app-layer/usecases/recipient-list';
import { AddRecipientListWatchersSchema } from '@/lib/schemas/recipient-list';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; workItemId: string }>('work_items.edit', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, AddRecipientListWatchersSchema);
        return jsonResponse(await addRecipientListAsWatchers(ctx, params.workItemId, input.listId));
    }),
);
