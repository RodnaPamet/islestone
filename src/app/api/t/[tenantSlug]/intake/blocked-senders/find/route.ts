/**
 * Find one address's blocks (sub-phase 2.6c): the address arrives in the
 * body, never in a URL, and is hashed before the lookup. Key `intake.manage`.
 */
import type { NextRequest } from 'next/server';

import { jsonResponse } from '@/lib/api-response';
import { withApiErrorHandling } from '@/lib/errors/api';
import { requirePermission } from '@/lib/security/permission-middleware';
import { listBlockedSenders } from '@/app-layer/usecases/intake-blocked-senders';
import { FindBlockedSenderSchema } from '@/lib/schemas/intake';
import { parseJsonBody } from '@/lib/validation/route';

export const POST = withApiErrorHandling(
    requirePermission<{ tenantSlug: string }>('intake.manage', async (req: NextRequest, _args, ctx) => {
        const { email } = await parseJsonBody(req, FindBlockedSenderSchema);
        return jsonResponse(await listBlockedSenders(ctx, { email }));
    }),
);
