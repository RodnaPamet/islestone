/**
 * The public intake submit (sub-phase 2.6b; owner decisions 86, 88 and 98):
 * one request through a form published for anyone with the link. Public at
 * the edge (`MACHINE_CALLER_PREFIXES`), so its only method's gate is
 * `acceptPublicIntakeRequest` (per-IP and per-form limits, cross-site
 * refusal, JSON only, a 64 KB capped body; then the signed token,
 * proof-of-work, trap, schema and daily caps in the usecase). POST only: the
 * prefix opens the path, not a method, so no other method may be exported
 * (tests/guards/machine-caller-paths-self-authenticate.test.ts).
 *
 * The wrapper's default mutation limit is off: the gate charges its own
 * per-form budgets, and a shared anonymous IP bucket would let one form's
 * traffic spend another's.
 */
import type { NextRequest } from 'next/server';

import { withApiErrorHandling } from '@/lib/errors/api';
import { acceptPublicIntakeRequest } from '@/lib/intake/public/http';

type Params = { params: Promise<{ publicId: string }> };

export async function POST(req: NextRequest, ctx: Params): Promise<Response> {
    return withApiErrorHandling(
        async (r: NextRequest, { params }: Params) => acceptPublicIntakeRequest(r, (await params).publicId),
        { rateLimit: false },
    )(req, ctx);
}
