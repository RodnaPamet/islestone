/**
 * Drain this workspace's email outbox now.
 *
 * Gated `admin.manage` at the route, so a refusal writes an AUTHZ_DENIED row.
 *
 * Copied from inflect-compliance
 * `src/app/api/t/[tenantSlug]/notification-settings/run-job/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with one job: the daily evidence
 * sweep is not ported, and the drain moved into the usecase.
 */
import type { NextRequest } from 'next/server';
import { z } from 'zod';

import { drainWorkspaceOutbox } from '@/app-layer/usecases/notification-settings';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';

const RunJobSchema = z.object({
    jobType: z.enum(['processOutbox']),
});

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const { jobType } = RunJobSchema.parse(await req.json());
        const stats = await drainWorkspaceOutbox(ctx);
        return jsonResponse({ success: true, jobType, stats, message: 'Outbox processed successfully' });
    }),
);
