/**
 * Blocked senders (sub-phase 2.6c; ADR 0006 "Blocked sender"): the
 * workspace's and the visible projects' blocks, and blocking an address on a
 * project or the workspace. Key `intake.manage` (decision 92).
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { blockSender, listBlockedSenders } from '@/app-layer/usecases/intake-blocked-senders';
import { BlockSenderSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const GET = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.manage', async (_req: NextRequest, _args, ctx) => {
        return jsonResponse(await listBlockedSenders(ctx));
    }),
);

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.manage', async (req: NextRequest, _args, ctx) => {
        const input = await parseJsonBody(req, BlockSenderSchema);
        const out = await blockSender(ctx, input);
        return jsonResponse(out.row, { status: out.created ? 201 : 200 });
    }),
);
