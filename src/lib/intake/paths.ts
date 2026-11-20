/**
 * The intake pages' paths (sub-phase 2.6a), under `/t/<slug>`. Client-safe.
 *
 * Written fresh for Islestone.
 */

/** The workspace's Intake page, optionally opened on one request. */
export function intakePath(requestId?: string): string {
    return requestId ? `/intake?request=${encodeURIComponent(requestId)}` : '/intake';
}

/** `/t/<slug>/intake?request=<id>`: the link a bell carries. */
export function tenantIntakeRequestPath(tenantSlug: string, requestId: string): string {
    return `/t/${tenantSlug}${intakePath(requestId)}`;
}

/** A project's Intake page. */
export function projectIntakePath(keyPrefix: string): string {
    return `/projects/${encodeURIComponent(keyPrefix)}/intake`;
}

/** The page a member sends a request through one internal form on. */
export function intakeFormPath(formId: string): string {
    return `/forms/${encodeURIComponent(formId)}`;
}

/**
 * A public form's page (sub-phase 2.6b), at the site root, outside `/t/`:
 * the link carries the form's random public id and nothing about the
 * workspace.
 */
export function publicIntakeFormPath(publicId: string): string {
    return `/f/${encodeURIComponent(publicId)}`;
}
