/**
 * Add holidays to the workspace's working calendar (roadmap 3.1a; decision
 * 190): entered by hand, or "Copy last year's"; a date already there is
 * skipped. Key: `admin.manage`.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { addWorkspaceHolidays } from '@/app-layer/usecases/working-calendar';
import { AddHolidaysSchema } from '@/lib/schemas/working-calendar';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('admin.manage', async (req: NextRequest, _route, ctx) => {
        const input = await parseJsonBody(req, AddHolidaysSchema);
        return jsonResponse(await addWorkspaceHolidays(ctx, input), { status: 201 });
    }),
);
