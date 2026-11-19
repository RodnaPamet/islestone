/**
 * Where a signed-in person lands in a workspace. One definition, so the seven
 * places that send someone into a workspace (the sign-in destination, the
 * invite acceptance and result pages, the workspace picker, the MFA
 * challenge's default `next`) cannot drift apart. inflect-compliance spelled
 * `/t/<slug>/dashboard` in each of them.
 *
 * Sub-phase 1.4 lands on the workspace root, `/t/<slug>`, a placeholder page;
 * sub-phase 1.7 builds the app shell and points this at My Work. No imports,
 * so client components and the edge can use it.
 */
export function tenantLandingPath(slug: string): string {
    return `/t/${encodeURIComponent(slug)}`;
}
