/**
 * The two public intake routes' gates (sub-phase 2.6b; owner decisions 88 and
 * 98). Each route is a `MACHINE_CALLER_PREFIXES` entry (`src/lib/auth/guard.ts`),
 * public at the edge, so its handler authenticates nothing and must bound
 * everything itself; `tests/guards/machine-caller-paths-self-authenticate.test.ts`
 * holds each route's POST to its gate here:
 *
 * - `acceptPublicIntakeRequest` (`POST /api/intake/forms/<publicId>`): the
 *   per-IP and per-form limits (5 a minute, 30 an hour, beside the edge's
 *   read tier on the same path), a cross-site refusal, `application/json`
 *   only, a 64 KB body read through a capped stream, then the usecase (signed
 *   token, proof-of-work, trap, schema, daily caps).
 * - `confirmRequesterAddress` (`POST /api/intake/confirm`): 10 a minute per IP,
 *   the same refusals, a 4 KB body, then the usecase.
 *
 * Neither reads a session: a signed-in member who opens a public link is
 * anyone else, so no session crosses into the workspace a link resolves to.
 * The cross-site check stops another site from spending a form's budget
 * (there is no session to ride, so classic CSRF does not apply); a
 * cross-origin `fetch` with `application/json` also needs a CORS preflight,
 * which the middleware refuses for an unlisted origin.
 *
 * Written fresh for Islestone; the `Sec-Fetch-Site` refusal follows
 * inflect-compliance's admin-session guard at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (pattern only).
 */
import type { NextRequest } from 'next/server';

import { confirmIntakeRequesterAddress, publicFormNotFound, submitPublicIntakeRequest } from '@/app-layer/usecases/intake-public';
import { jsonResponse } from '@/lib/api-response';
import { AppError, badRequest } from '@/lib/errors/types';
import { isPublicIntakeOpen } from '@/lib/intake/public-switch';
import { readCappedJson } from '@/lib/intake/public/capped-body';
import { enforceRateLimit, isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';
import { INTAKE_CONFIRM_LIMIT, INTAKE_PUBLIC_SUBMIT_HOURLY_LIMIT, INTAKE_PUBLIC_SUBMIT_LIMIT, type RateLimitConfig } from '@/lib/security/rate-limit';

/** The public submit's body cap. */
export const PUBLIC_SUBMIT_MAX_BYTES = 64 * 1024;
/** The confirmation's body cap (a token and nothing else). */
export const CONFIRM_MAX_BYTES = 4 * 1024;

/** A rate-limit scope may carry the form's public id only when it has a public id's shape. */
const PUBLIC_ID_SHAPE = /^[A-Za-z0-9_-]{22}$/;

function limited(req: NextRequest, scope: string, config: RateLimitConfig): Response | null {
    if (isRateLimitBypassed()) return null;
    return enforceRateLimit(req, { scope, config }).response ?? null;
}

/** Hygiene shared by both routes: no cross-site post, JSON only. */
function refuseUnlessSameSiteJson(req: NextRequest): void {
    if (req.headers.get('sec-fetch-site') === 'cross-site') {
        throw new AppError('Requests from other sites are refused.', 'CROSS_SITE_REFUSED', 403);
    }
    const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') throw new AppError('Send the request as application/json.', 'UNSUPPORTED_MEDIA_TYPE', 415);
}

/** `POST /api/intake/forms/<publicId>`: one request through a public form. */
export async function acceptPublicIntakeRequest(req: NextRequest, publicId: string): Promise<Response> {
    // Closed, the route is the same 404 as an unknown form, before any work.
    if (!isPublicIntakeOpen()) throw publicFormNotFound();
    const formKey = PUBLIC_ID_SHAPE.test(publicId) ? publicId : 'invalid';
    const blocked =
        limited(req, `intake-public:${formKey}`, INTAKE_PUBLIC_SUBMIT_LIMIT) ??
        limited(req, `intake-public-hour:${formKey}`, INTAKE_PUBLIC_SUBMIT_HOURLY_LIMIT);
    if (blocked) return blocked;
    refuseUnlessSameSiteJson(req);
    const body = await readCappedJson(req, PUBLIC_SUBMIT_MAX_BYTES);
    const receipt = await submitPublicIntakeRequest(publicId, body);
    return jsonResponse(receipt, { status: 201 });
}

/** `POST /api/intake/confirm`: the requester confirms their address. */
export async function confirmRequesterAddress(req: NextRequest): Promise<Response> {
    if (!isPublicIntakeOpen()) throw publicFormNotFound();
    const blocked = limited(req, 'intake-confirm', INTAKE_CONFIRM_LIMIT);
    if (blocked) return blocked;
    refuseUnlessSameSiteJson(req);
    const body = await readCappedJson(req, CONFIRM_MAX_BYTES);
    const token = typeof body === 'object' && body !== null ? (body as { token?: unknown }).token : undefined;
    if (typeof token !== 'string') throw badRequest('The request is not valid.');
    return jsonResponse(await confirmIntakeRequesterAddress(token));
}
