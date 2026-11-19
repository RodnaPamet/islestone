/**
 * GET /api/auth/ui-config
 *
 * Returns the small set of auth-related flags the login page needs to
 * decide which controls to render. Client fetches this on mount.
 *
 * Why a runtime endpoint rather than a `NEXT_PUBLIC_*` env var:
 * `NEXT_PUBLIC_*` values are inlined at `next build` time — toggling
 * one requires a rebuild + image push + rollout. A tiny server route
 * reads the server env, so an operator flips the flag with a restart
 * rather than a rebuild.
 *
 * No secrets leak here; the endpoint exposes only the flags the
 * browser would otherwise have to learn at build time.
 */

import { NextResponse } from 'next/server';
import { env } from '@/env';
import { withApiErrorHandling } from '@/lib/errors/api';

export const dynamic = 'force-dynamic';

// Epic E — wrapped for x-request-id + standardized error contract.
// Never throws in normal operation; the wrapper is here so a future
// runtime fault (env-loader regression, etc.) yields a consistent
// 5xx shape rather than a Next.js stack-trace HTML page.
export const GET = withApiErrorHandling(async () => {
    return NextResponse.json({
        // When set, the public login page hides the email/password
        // form even if the Credentials provider is registered server-
        // side. Keeps prod OAuth-only at the UI layer while leaving
        // the backend available for API / tests / future admin tooling.
        credentialsFormHidden:
            env.AUTH_CREDENTIALS_UI_HIDDEN === '1',
    });
});
