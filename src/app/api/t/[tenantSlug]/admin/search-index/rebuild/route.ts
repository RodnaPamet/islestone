/**
 * Rebuild this workspace's search index on demand (sub-phase 2.7f; ADR 0008
 * D1, "Rebuild"; docs/search.md).
 *
 *   POST /api/t/:tenantSlug/admin/search-index/rebuild
 *     Audits `SEARCH_INDEX_REBUILD_REQUESTED` and enqueues a forced
 *     `search-index-rebuild` for this workspace, run by the worker as the
 *     caller (re-resolved when it runs). 202 with the job id.
 *
 * Gated by `admin.manage`: an admin's workspace setting, like the other work
 * configuration. The rate limit is `API_KEY_CREATE_LIMIT` (5/hr): a rebuild
 * rewrites every vector of the workspace.
 *
 * Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { requestSearchIndexRebuild } from '@/app-layer/usecases/search-index';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { API_KEY_CREATE_LIMIT } from '@/lib/security/rate-limit-middleware';

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        return jsonResponse(await requestSearchIndexRebuild(ctx), { status: 202 });
    }),
    { rateLimit: { config: API_KEY_CREATE_LIMIT, scope: 'search-index-rebuild' } },
);
