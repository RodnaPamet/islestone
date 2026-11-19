/**
 * `/api/t/:slug/notifications/stream` — the live channel for the bell while
 * a workspace is open (inflect #4643).
 *
 * The bell lists the OPEN workspace's notifications. Its live channel must
 * subscribe the same workspace, so there is no session-wide stream (inflect's
 * flat `/api/notifications/stream` is not ported: it subscribed the session's
 * first workspace and would push that workspace's notifications into another
 * workspace's bell).
 *
 * Why SSE rather than a WebSocket: the bell only ever RECEIVES, an
 * `EventSource` reconnects by itself, and a plain HTTP response passes every
 * proxy a WebSocket upgrade might not. Known limits (ADR 0005 findings): the
 * stream authenticates at connect only, and the bus is per process; the
 * bell's polling covers a notification published on another instance.
 *
 * `getTenantCtx` refuses a caller who is not a member of `:slug`, and the
 * subscription is keyed on that workspace and the caller, so a stream only
 * ever carries the caller's own notifications in the workspace named.
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notifications/stream/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (docblock; `import type`).
 */
import type { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { assertCanRead } from '@/app-layer/policies/common';
import { notificationStreamResponse } from '@/lib/notifications/notification-sse';

// Node, not Edge, and never cached: a long-lived stream on the same process
// as the bus publishers.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
    const ctx = await getTenantCtx(await params, req);
    assertCanRead(ctx);
    return notificationStreamResponse(ctx, req.signal);
}
