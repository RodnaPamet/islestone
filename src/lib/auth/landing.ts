/**
 * Where a signed-in person lands in a workspace. One definition, so the seven
 * places that send someone into a workspace (the sign-in destination, the
 * invite acceptance and result pages, the workspace picker, the MFA
 * challenge's default `next`) cannot drift apart. inflect-compliance spelled
 * `/t/<slug>/dashboard` in each of them.
 *
 * It is My Work, `/t/<slug>/my-work` (ADR 0006; sub-phase 1.7, which built
 * the app shell; 1.4 landed on the workspace root). No imports, so client
 * components and the edge can use it.
 */
export function tenantLandingPath(slug: string): string {
    return `/t/${encodeURIComponent(slug)}/my-work`;
}
