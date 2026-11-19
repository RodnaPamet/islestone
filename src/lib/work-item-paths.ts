/**
 * The one helper that names a work item's page path (`/work-items/<id>`,
 * under `/t/<slug>`). Sub-phase 2.3 builds the page; every bell, mail and
 * Activity link already goes through here, so the route is written in one
 * place. Client-safe.
 */
export function workItemPath(workItemId: string): string {
    return `/work-items/${encodeURIComponent(workItemId)}`;
}

/** `/t/<slug>/work-items/<id>`. */
export function tenantWorkItemPath(tenantSlug: string, workItemId: string): string {
    return `/t/${tenantSlug}${workItemPath(workItemId)}`;
}

/** A member's My Work page, `/t/<slug>/my-work` (sub-phase 1.7). */
export function tenantMyWorkPath(tenantSlug: string): string {
    return `/t/${tenantSlug}/my-work`;
}
