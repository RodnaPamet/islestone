/**
 * Settings → Workload's members table (sub-phase 3.5a; docs/porting/maps/
 * 3.5.md, "The page"; owner decisions 284 and 298): every active member with
 * the capacity in force this week and the next change, and the workspace's
 * teams for the calendar picker, under `workload.manage` (the table is where
 * capacity is changed).
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listWorkloadMembers } from '@/app-layer/usecases/workload-capacity';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('workload.manage', async (_req: NextRequest, _args, ctx) => jsonResponse(await listWorkloadMembers(ctx))),
);
