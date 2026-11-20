/**
 * Page/subpage segregation: the source of truth for which workspace routes
 * are top-level destinations.
 *
 * Every workspace route under `src/app/t/[tenantSlug]/(app)/` is classified as
 * either:
 *
 *   - MAIN     — a top-level sidebar destination. NO back affordance.
 *   - SUBPAGE  — every other route. MUST mount a back affordance.
 *
 * When a new page lands under `(app)`, it MUST be added here:
 * `tests/guards/page-segregation-coverage.test.ts` lists the route tree from
 * git and fails CI if a `page.tsx` exists that this file does not classify.
 *
 * Routes are stored without the `/t/[tenantSlug]` prefix — written as the
 * member sees them in the address bar (e.g. `/projects`,
 * `/projects/[projectId]`). Dynamic segments use the Next.js `[param]` form
 * verbatim so the file is grep-able against the route tree.
 *
 * Copied from inflect-compliance `src/lib/nav/page-segregation.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7): the functions
 * are kept; the route lists are Islestone's (the shell's five pages; the
 * subpages arrive with projects and work items in Phase 2).
 */

export type RouteClass = 'main' | 'subpage' | 'unknown';

/**
 * MAIN pages on which `<BackAffordance noFallback />` is intentionally
 * mounted: top-level destinations routinely deep-linked from other
 * sections. The affordance in `noFallback` mode returns null when there is
 * no in-tab referrer. None yet.
 */
export const REFERRER_ONLY_BACK_MAIN_PAGES: readonly string[] = [] as const;

/**
 * Subpages that intentionally DO NOT render `<BackAffordance>`: redirect
 * shims (no UI to attach it to) and gating steps a back link would let a
 * member bypass. Add an entry HERE with a comment naming the reason. None
 * yet.
 */
export const BACK_AFFORDANCE_EXEMPT_SUBPAGES: readonly string[] = [] as const;

/**
 * Subpages that still need `<BackAffordance>` mounted in their page tree: a
 * temporary waiver that must only shrink. Empty, and expected to stay so.
 */
export const BACK_AFFORDANCE_COHORT_TODO: readonly string[] = [] as const;

/**
 * Top-level sidebar destinations. These pages are reached from the primary
 * navigation (`NAV_PATHS` in `@/components/layout/nav-config`); they have no
 * parent within the workspace. The back affordance is forbidden here.
 */
export const MAIN_PAGES: readonly string[] = ['/my-work', '/inbox', '/work-items', '/views', '/projects', '/cycles', '/intake', '/forms', '/settings'] as const;

/**
 * Every other workspace route. The back affordance is required here (unless
 * listed in `BACK_AFFORDANCE_EXEMPT_SUBPAGES`).
 *
 * Dynamic segments are written as `[param]` and matched literally — the
 * `classifyRoute` helper normalises a runtime pathname to the same form
 * before lookup.
 */
export const SUBPAGES: readonly string[] = [
    '/work-items/[workItemKey]',
    '/projects/[projectKey]',
    // Sub-phase 2.5a: one cycle.
    '/cycles/[cycleId]',
    // Sub-phase 2.5b: a project's milestones, and one milestone.
    '/projects/[projectKey]/milestones',
    '/projects/[projectKey]/milestones/[milestoneId]',
    // Sub-phase 2.6a: a project's intake, one internal form, Settings → Intake.
    '/projects/[projectKey]/intake',
    '/forms/[formId]',
    '/settings/intake',
    // Decision 55: the Settings sections.
    '/settings/teams',
    '/settings/teams/[teamId]',
    '/settings/work-item-types',
    // Sub-phase 2.4b-b: a type's fields.
    '/settings/work-item-types/[typeId]',
    '/settings/labels',
    '/settings/projects',
    // Sub-phase 2.5c.
    '/settings/project-templates',
    // Sub-phase 2.7c: the member's notification preferences, and the
    // workspace's notification settings.
    '/inbox/preferences',
    '/settings/notifications',
] as const;

/**
 * Normalise a runtime pathname (with the tenant prefix and concrete dynamic
 * segment values) to the canonical form used in `MAIN_PAGES` / `SUBPAGES`.
 *
 *   /t/acme/projects/abc-123  →  /projects/[projectId]
 *   /t/acme/my-work           →  /my-work
 *
 * Returns the stripped path on a match, `null` if it doesn't fit the
 * tenant-scoped shape.
 */
export function normalizePathname(pathname: string): string | null {
    const stripped = pathname.replace(/^\/t\/[^/]+/, '');
    if (!stripped.startsWith('/')) return null;

    // Longest first; among patterns of one length, the one with FEWER
    // `[param]` segments first, so a literal route (`/projects/archived`)
    // wins over a dynamic sibling that also matches it
    // (`/projects/[projectId]`). Declaration order used to decide, and
    // resolved the literal to the dynamic page (#5316).
    const dynamicSegments = (p: string): number =>
        p.split('/').filter((seg) => seg.startsWith('[') && seg.endsWith(']')).length;
    const sorted = [...MAIN_PAGES, ...SUBPAGES].sort(
        (a, b) =>
            b.split('/').length - a.split('/').length ||
            dynamicSegments(a) - dynamicSegments(b),
    );

    for (const pattern of sorted) {
        if (matchesPattern(stripped, pattern)) return pattern;
    }
    return null;
}

function matchesPattern(pathname: string, pattern: string): boolean {
    const pathSegs = pathname.split('/').filter(Boolean);
    const patternSegs = pattern.split('/').filter(Boolean);
    if (pathSegs.length !== patternSegs.length) return false;
    for (let i = 0; i < patternSegs.length; i++) {
        const p = patternSegs[i];
        if (!p) return false;
        if (p.startsWith('[') && p.endsWith(']')) continue;
        if (p !== pathSegs[i]) return false;
    }
    return true;
}

/**
 * Classify a runtime pathname. Returns:
 *   - 'main'     — the route is in `MAIN_PAGES` (no back affordance)
 *   - 'subpage'  — the route is in `SUBPAGES` (back affordance required)
 *   - 'unknown'  — the route is outside the tenant scope or not classified
 */
export function classifyRoute(pathname: string): RouteClass {
    const normalized = normalizePathname(pathname);
    if (!normalized) return 'unknown';
    if ((MAIN_PAGES as readonly string[]).includes(normalized)) return 'main';
    if ((SUBPAGES as readonly string[]).includes(normalized)) return 'subpage';
    return 'unknown';
}
