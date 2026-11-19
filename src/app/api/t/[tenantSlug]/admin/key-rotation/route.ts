/**
 * Master-key rotation for one workspace — admin API (sub-phase 1.5b).
 *
 *   POST  /api/t/:tenantSlug/admin/key-rotation
 *     Enqueues a `key-rotation` job for this workspace. Returns 202 with
 *     a BullMQ job id that the operator can use to poll state.
 *     Audit-logged (`KEY_ROTATION_INITIATED`).
 *
 *   GET   /api/t/:tenantSlug/admin/key-rotation?jobId=<id>
 *     Reports the current state of a previously-enqueued job.
 *     Status + progress payload (no key material).
 *
 * Gated by `admin.manage`. Wrapped in the default API wrapper, which also
 * applies the mutation rate limit — overridden to `API_KEY_CREATE_LIMIT`
 * (5/hr) because rotation is a high-privilege operation that should not be
 * hammered.
 *
 * The actual work runs in the BullMQ worker process; this endpoint only
 * enqueues and returns the handle (`startKeyRotation`).
 *
 * Copied from inflect-compliance
 * `src/app/api/t/[tenantSlug]/admin/key-rotation/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The enqueue, the audit entry and
 * the job lookup moved into `src/app-layer/usecases/key-rotation.ts`; the
 * `apiKeyId` the source put in the payload returns with API keys in 5.2.
 */

import type { NextRequest } from 'next/server';

import {
    getKeyRotationStatus,
    startKeyRotation,
} from '@/app-layer/usecases/key-rotation';
import { RotationJobStatusQuery } from '@/app-layer/schemas/key-rotation.schemas';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { badRequest } from '@/lib/errors/types';
import { requirePermission } from '@/lib/security/permission-middleware';
import { API_KEY_CREATE_LIMIT } from '@/lib/security/rate-limit-middleware';

// ─── POST — initiate rotation ──────────────────────────────────────

export const POST = withApiErrorHandling(
    requirePermission('admin.manage', async (_req: NextRequest, _routeArgs, ctx) => {
        const started = await startKeyRotation(ctx);
        return jsonResponse(started, { status: 202 });
    }),
    {
        // Much tighter than the default API_MUTATION_LIMIT — rotation
        // is a once-a-quarter operation at most; 5/hr is comfortably
        // above legitimate usage and well below abuse volume.
        rateLimit: {
            config: API_KEY_CREATE_LIMIT,
            scope: 'key-rotation-initiate',
        },
    },
);

// ─── GET — poll job status ─────────────────────────────────────────

export const GET = withApiErrorHandling(
    requirePermission('admin.manage', async (req: NextRequest, _routeArgs, ctx) => {
        const parsed = RotationJobStatusQuery.safeParse({
            jobId: req.nextUrl.searchParams.get('jobId') ?? undefined,
        });
        if (!parsed.success) {
            throw badRequest(parsed.error.issues[0]?.message ?? 'jobId required');
        }
        return jsonResponse(await getKeyRotationStatus(ctx, parsed.data));
    }),
    // GET is not a mutation; the wrapper's mutation rate limit does not apply.
);
