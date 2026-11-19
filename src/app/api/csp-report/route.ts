/**
 * Legacy CSP report endpoint — an alias of `/api/security/csp-report`.
 *
 * inflect-compliance keeps this path because browsers held cached CSP headers
 * pointing at it. Islestone's policy has never named it, but it is ported
 * with the sink (owner decision, 2026-11-19), so a report sent here lands in
 * the same buffer under the same limits.
 *
 * Copied from inflect-compliance `src/app/api/csp-report/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, changed in one respect: inflect
 * forwarded the body with `fetch(new URL('/api/security/csp-report',
 * request.url))`, an outbound request to a host taken from the request's own
 * `Host` header, which a caller chooses. Here the alias calls the sink's
 * handler in-process instead, so no request leaves the server and the sink's
 * rate limit and size cap apply unchanged. POST only: the operator GET lives
 * on the canonical path.
 */
import type { NextResponse } from 'next/server';

import { POST as cspReportSink } from '../security/csp-report/route';

export async function POST(request: Request): Promise<NextResponse> {
    return cspReportSink(request);
}
