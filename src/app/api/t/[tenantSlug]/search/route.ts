/**
 * Workspace search (sub-phase 2.7b, docs/search.md).
 *
 * GET /api/t/[tenantSlug]/search?q=<query>[&limit=<n>]
 *
 * Returns a typed `SearchResponse` (`@/lib/search/types`): work items (by
 * title and key) and projects (by name and key prefix), ranked
 * highest-relevance-first, capped per type, with meta echoing the query the
 * API used, per-type counts and a truncation flag.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/search/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1): `getTenantCtx`
 * became a literal `requirePermission('projects.view', …)` with its rule in
 * `route-permissions.ts`, the query parameters are parsed by a Zod schema,
 * and `limit` is bounded by `MAX_PER_TYPE_LIMIT`. The query is never logged.
 * Read-tier rate-limited at the edge, as every tenant-scoped GET.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { searchWorkspace } from '@/app-layer/usecases/search';
import { SearchQuerySchema } from '@/lib/schemas/search';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('projects.view', async (req: NextRequest, _args, ctx) => {
        const { q, limit } = SearchQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
        return jsonResponse(await searchWorkspace(ctx, q ?? '', { perTypeLimit: limit }));
    }),
);
