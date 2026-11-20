/**
 * Archive a workspace recipient list (sub-phase 2.7e; `admin.manage`; decision 141:
 * archived, never deleted). An archived list resolves to nobody until restored.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { archiveRecipientList } from '@/app-layer/usecases/recipient-list';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; listId: string }>('admin.manage', async (_req: NextRequest, { params }, ctx) => {
        return jsonResponse(await archiveRecipientList(ctx, null, params.listId));
    }),
);
