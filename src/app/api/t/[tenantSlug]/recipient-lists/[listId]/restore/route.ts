/**
 * Restore an archived workspace recipient list (sub-phase 2.7e; `admin.manage`,
 * decision 141).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { restoreRecipientList } from '@/app-layer/usecases/recipient-list';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; listId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await restoreRecipientList(ctx, null, params.listId));
    }),
);
