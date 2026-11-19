/**
 * The Deleted view: the restore surface, capped at 200 rows (`truncated`
 * marks more). Keyed on `work_items.delete`, the key restore takes.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listDeletedWorkItems } from '@/app-layer/usecases/work-item';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.delete', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listDeletedWorkItems(ctx));
    }),
);
