/**
 * Links for in-app (bell) notifications about a tenant's pages.
 *
 * Every tenant page lives under `/t/<slug>/…`, and the bell renders a stored
 * `Notification.linkUrl` as-is. A sender that stores a bare `/<page>/<id>`
 * therefore sends its reader to a 404 (inflect #4128). The senders
 * (`assignment.ts`, `watcher.ts`) share that rule through these two helpers,
 * so the prefix is written in one place.
 *
 * `RequestContext.tenantSlug` is OPTIONAL (a system or job context usually has
 * none), so the slug is looked up rather than the link dropped for every
 * unattended run. When no slug can be found at all, the link is `null`: a bell
 * row that navigates nowhere is better than one that 404s.
 *
 * Copied from inflect-compliance `src/app-layer/notifications/tenant-link.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (comments only).
 */
import type { PrismaTx } from '@/lib/db-context';

/**
 * The tenant's slug for building a page link: `ctx.tenantSlug` when the
 * context carries one, otherwise a lookup by `ctx.tenantId`.
 */
export async function resolveTenantSlugForLinks(
    db: PrismaTx,
    ctx: { tenantId: string; tenantSlug?: string | null },
): Promise<string | null> {
    if (ctx.tenantSlug) return ctx.tenantSlug;
    const tenant = await db.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { slug: true },
    });
    return tenant?.slug ?? null;
}

/**
 * `/t/<slug><path>` for a tenant page path such as `/work-items/<id>`, or `null`
 * when the slug is unknown.
 */
export function tenantPageLink(tenantSlug: string | null | undefined, path: string): string | null {
    if (!tenantSlug) return null;
    return `/t/${tenantSlug}${path.startsWith('/') ? path : `/${path}`}`;
}
