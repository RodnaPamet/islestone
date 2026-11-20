/**
 * The inbound email webhook's gate (sub-phase 2.6c; owner decisions 98 and
 * 122): `POST /api/intake/email/resend`, a `MACHINE_CALLER_PREFIXES` entry,
 * public at the edge, so this function is all that stands in front of it
 * (`tests/guards/machine-caller-paths-self-authenticate.test.ts` holds the
 * route's POST to it):
 *
 * 1. inbound email closed on the deployment: 200 and nothing read;
 * 2. a per-IP abuse bound;
 * 3. the body read through a capped stream (`WEBHOOK_MAX_BYTES`, 413 past it),
 *    never parsed before it is verified;
 * 4. the Svix signature over the raw bytes (`verifySvixSignature`), refused
 *    outside five minutes (401);
 * 5. then the usecase, which resolves the address and records the delivery,
 *    and answers the same 200 whatever it found. Nothing is fetched here.
 *
 * Server-only. Written fresh for Islestone.
 */
import type { NextRequest } from 'next/server';

import { receiveInboundEmailEvent } from '@/app-layer/usecases/intake-email';
import { env } from '@/env';
import { jsonResponse } from '@/lib/api-response';
import { AppError, badRequest } from '@/lib/errors/types';
import { isInboundEmailOpen } from '@/lib/intake/email/switch';
import { verifySvixSignature } from '@/lib/intake/email/svix';
import { readCappedBody } from '@/lib/intake/public/capped-body';
import { logger } from '@/lib/observability/logger';
import { INTAKE_EMAIL_WEBHOOK_LIMIT } from '@/lib/security/rate-limit';
import { enforceRateLimit, isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';

/** The `email.received` event is metadata only: a generous cap. */
export const WEBHOOK_MAX_BYTES = 256 * 1024;

const RECEIVED = { received: true } as const;

export async function acceptResendWebhook(req: NextRequest): Promise<Response> {
    if (!isInboundEmailOpen()) return jsonResponse(RECEIVED);
    if (!isRateLimitBypassed()) {
        const blocked = enforceRateLimit(req, { scope: 'intake-email-webhook', config: INTAKE_EMAIL_WEBHOOK_LIMIT }).response;
        if (blocked) return blocked;
    }
    const rawBody = await readCappedBody(req, WEBHOOK_MAX_BYTES);
    const check = verifySvixSignature({
        secret: env.RESEND_WEBHOOK_SECRET,
        id: req.headers.get('svix-id'),
        timestamp: req.headers.get('svix-timestamp'),
        signature: req.headers.get('svix-signature'),
        rawBody,
    });
    if (!check.ok) {
        logger.warn('intake email webhook refused', { component: 'intake-email', reason: check.reason });
        throw new AppError('The webhook signature is not valid.', 'WEBHOOK_SIGNATURE_REFUSED', 401);
    }
    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        throw badRequest('The webhook body must be JSON.');
    }
    const outcome = await receiveInboundEmailEvent({ svixId: req.headers.get('svix-id')!, payload });
    logger.info('intake email webhook', { component: 'intake-email', outcome });
    return jsonResponse(RECEIVED);
}
