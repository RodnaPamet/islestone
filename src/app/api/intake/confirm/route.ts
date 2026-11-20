/**
 * A public form's requester confirms their address (sub-phase 2.6b; owner
 * decisions 89 and 98): the POST behind the emailed link's page, never a GET
 * (mail scanners follow links). Public at the edge
 * (`MACHINE_CALLER_PREFIXES`), so its only method's gate is
 * `confirmRequesterAddress` (a per-IP limit, cross-site refusal, JSON only, a
 * 4 KB capped body; then the usecase). POST only
 * (tests/guards/machine-caller-paths-self-authenticate.test.ts).
 */
import type { NextRequest } from 'next/server';

import { withApiErrorHandling } from '@/lib/errors/api';
import { confirmRequesterAddress } from '@/lib/intake/public/http';

export async function POST(req: NextRequest): Promise<Response> {
    return withApiErrorHandling(async (r: NextRequest) => confirmRequesterAddress(r), { rateLimit: false })(req, undefined);
}
