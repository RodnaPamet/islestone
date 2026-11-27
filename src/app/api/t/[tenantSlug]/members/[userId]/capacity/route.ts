/**
 * A member's capacity (sub-phase 3.5a; owner decisions 284, 285 and 298).
 *
 *   - GET (`workload.view`): their rows, newest first, and the default.
 *   - PUT (`workload.manage`, a person): `{ effectiveFrom, weeklyMinutes,
 *     calendarTeamId }` from a Monday (400 `NOT_A_MONDAY`); replaces that
 *     Monday's row (`If-Match` its version) or adds one; audited
 *     `MEMBER_CAPACITY_SET`.
 *
 * Not under `/admin/`, which the edge refuses to non-admins. Written fresh
 * for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { getMemberCapacity, setMemberCapacity } from '@/app-layer/usecases/workload-capacity';
import { expectedVersionFrom } from '@/lib/http/if-match';
import { SetMemberCapacitySchema } from '@/lib/schemas/workload';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; userId: string }>('workload.view', async (_req: NextRequest, { params }, ctx) =>
        jsonResponse(await getMemberCapacity(ctx, params.userId)),
    ),
);

export const PUT = withApiErrorHandling(
    requirePermission<{ tenantSlug: string; userId: string }>('workload.manage', async (req: NextRequest, { params }, ctx) => {
        const input = await parseJsonBody(req, SetMemberCapacitySchema);
        return jsonResponse(await setMemberCapacity(ctx, params.userId, input, expectedVersionFrom(req)));
    }),
);
