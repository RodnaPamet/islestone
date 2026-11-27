/**
 * Remove a future capacity change (sub-phase 3.5a; owner decision 284): only a
 * row whose Monday is after the current week (409 `CAPACITY_IN_EFFECT`);
 * `If-Match` optional; sent from the undo toast; audited
 * `MEMBER_CAPACITY_REMOVED`. Key: `workload.manage`, a person.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { removeMemberCapacity } from '@/app-layer/usecases/workload-capacity';
import { expectedVersionFrom } from '@/lib/http/if-match';

export const DELETE = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; userId: string; capacityId: string }>('workload.manage', async (req: NextRequest, { params }, ctx) => {
        await removeMemberCapacity(ctx, params.userId, params.capacityId, expectedVersionFrom(req));
        return jsonResponse({ deleted: true });
    }),
);
