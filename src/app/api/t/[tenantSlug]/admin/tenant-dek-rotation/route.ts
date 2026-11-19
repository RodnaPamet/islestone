/**
 * Per-workspace DEK rotation — admin API (sub-phase 1.5b).
 *
 *   POST  /api/t/:tenantSlug/admin/tenant-dek-rotation
 *     Generates a fresh DEK, atomically swaps `Tenant.encryptedDek`
 *     into `Tenant.previousEncryptedDek`, and enqueues a
 *     `tenant-dek-rotation` BullMQ job that re-encrypts every v2
 *     ciphertext under the new DEK then clears the previous slot.
 *     Returns 202 with the BullMQ job id so the operator can poll.
 *     Audit-logged (`TENANT_DEK_ROTATED`). 409 while an earlier
 *     rotation's sweep is still in flight.
 *
 *   GET   /api/t/:tenantSlug/admin/tenant-dek-rotation?jobId=<id>
 *     Reports the current state of a previously-enqueued sweep job.
 *
 * Distinct from `/admin/key-rotation`:
 *   - `/admin/key-rotation` rotates onto a new **master KEK** (the
 *     operator stages the new env; workspace DEKs are re-wrapped and
 *     v1 ciphertexts re-encrypted under the new master). Gated by
 *     `admin.manage`.
 *   - This route rotates the **per-workspace DEK** for a single
 *     workspace — the response to a suspected compromise of it. Gated by
 *     `admin.tenant_lifecycle` (OWNER-only) per the role model in
 *     `src/lib/permissions.ts`.
 *
 * Tight rate limit (`API_KEY_CREATE_LIMIT` — 5/hr) because rotation
 * is a high-privilege, expensive operation. Legitimate use cases
 * (responding to a leak) need at most one rotation per workspace.
 *
 * Copied from inflect-compliance
 * `src/app/api/t/[tenantSlug]/admin/tenant-dek-rotation/route.ts` and
 * `admin/_lib/rotate-dek-handlers.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The shared handler module existed
 * for the source's alias route (`/admin/rotate-dek`), which Islestone does not
 * have, so the handlers are inline and their logic is in
 * `src/app-layer/usecases/key-rotation.ts`.
 */

import type { NextRequest } from 'next/server';

import {
    getTenantDekRotationStatus,
    startTenantDekRotation,
} from '@/app-layer/usecases/key-rotation';
import { RotationJobStatusQuery } from '@/app-layer/schemas/key-rotation.schemas';
import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { badRequest } from '@/lib/errors/types';
import { requirePermission } from '@/lib/security/permission-middleware';
import { API_KEY_CREATE_LIMIT } from '@/lib/security/rate-limit-middleware';

export const POST = withApiErrorHandling(
    requirePermission('admin.tenant_lifecycle', async (_req: NextRequest, _routeArgs, ctx) => {
        const started = await startTenantDekRotation(ctx);
        return jsonResponse(started, { status: 202 });
    }),
    {
        rateLimit: {
            config: API_KEY_CREATE_LIMIT,
            scope: 'tenant-dek-rotation-initiate',
        },
    },
);

export const GET = withApiErrorHandling(
    requirePermission('admin.tenant_lifecycle', async (req: NextRequest, _routeArgs, ctx) => {
        const parsed = RotationJobStatusQuery.safeParse({
            jobId: req.nextUrl.searchParams.get('jobId') ?? undefined,
        });
        if (!parsed.success) {
            throw badRequest(parsed.error.issues[0]?.message ?? 'jobId required');
        }
        return jsonResponse(await getTenantDekRotationStatus(ctx, parsed.data));
    }),
);
