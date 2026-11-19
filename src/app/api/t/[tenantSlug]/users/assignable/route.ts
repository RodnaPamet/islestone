/**
 * GET /api/t/[tenantSlug]/users/assignable — the workspace's ACTIVE members in
 * a minimal shape (id, name, email, image) for the work-item pickers
 * (assignee, watchers).
 *
 * Distinct from `/admin/members`, which is admin-gated and exposes session
 * counts and invite or deactivated rows. Every member who reads work items may
 * read this roster.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/users/assignable/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3): the reviewer
 * `audience` query is cut, and the route is a literal `requirePermission`
 * with a rule, as every work route is.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listAssignableUsers } from '@/app-layer/usecases/tenant-admin';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('work_items.view', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listAssignableUsers(ctx));
    }),
);
