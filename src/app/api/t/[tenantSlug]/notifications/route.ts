/**
 * My notifications in this workspace. Without `view`, the bell's list (the
 * newest 50 not marked Done); with `view=unread|all|done`, one Inbox page,
 * cursor-paginated (sub-phase 2.7c; docs/pagination.md), optionally of one
 * `type`, with the unread count.
 *
 * No permission key: every member reads their own (`assertCanRead` in the
 * usecase; the repository adds the per-user predicate).
 *
 * Copied from inflect-compliance `src/app/api/t/[tenantSlug]/notifications/route.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (`import type`); the Inbox's
 * query is Islestone's.
 */
import type { NextRequest } from 'next/server';
import { getTenantCtx } from '@/app-layer/context';
import { listInbox, listMyNotifications } from '@/app-layer/usecases/notification';
import { withApiErrorHandling } from '@/lib/errors/api';
import { jsonResponse } from '@/lib/api-response';
import { InboxQuerySchema } from '@/lib/schemas/notifications';

export const GET = withApiErrorHandling(async (req: NextRequest, { params: paramsPromise }: { params: Promise<{ tenantSlug: string }> }) => {
    const params = await paramsPromise;
    const ctx = await getTenantCtx(params, req);
    const search = req.nextUrl.searchParams;
    if (!search.has('view')) return jsonResponse(await listMyNotifications(ctx));
    const query = InboxQuerySchema.parse(Object.fromEntries(search));
    return jsonResponse(await listInbox(ctx, query));
});
