/**
 * Resend's inbound email webhook (sub-phase 2.6c; owner decisions 98, 120 and
 * 122): an `email.received` event, signed the Svix way. Public at the edge
 * (`MACHINE_CALLER_PREFIXES` `/api/intake/email`), so its only method's gate
 * is `acceptResendWebhook` (the switch, a per-IP bound, a capped body, the
 * signature, then the usecase, which records the delivery and enqueues the
 * fetch). POST only (tests/guards/machine-caller-paths-self-authenticate.test.ts).
 * The wrapper's mutation limit is off: the gate has its own.
 */
import type { NextRequest } from 'next/server';

import { withApiErrorHandling } from '@/lib/errors/api';
import { acceptResendWebhook } from '@/lib/intake/email/http';

export async function POST(req: NextRequest): Promise<Response> {
    return withApiErrorHandling(async (r: NextRequest) => acceptResendWebhook(r), { rateLimit: false })(req, undefined);
}
