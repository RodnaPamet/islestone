/** Unblock a sender (sub-phase 2.6c). Key `intake.manage`. */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { unblockSender } from '@/app-layer/usecases/intake-blocked-senders';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; blockedId: string }>('intake.manage', async (_req: NextRequest, { params }, ctx) => {
        await unblockSender(ctx, params.blockedId);
        return jsonResponse({ ok: true });
    }),
);
