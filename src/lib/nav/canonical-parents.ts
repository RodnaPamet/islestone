/**
 * Canonical parent resolver.
 *
 * Copied from inflect-compliance `src/lib/nav/canonical-parents.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7); the resolver is
 * kept and the map, which named the compliance routes, starts empty.
 *
 * Maps each route in `SUBPAGES` to the page the back affordance
 * should fall back to when no in-tab referrer is available (cold load,
 * fresh tab, deep link, history-cleared session).
 *
 * Convention: the canonical parent is the route one structural step up
 * from the subpage in the IA — NOT necessarily the URL parent. A nested
 * subpage like `/projects/[projectId]/items/[itemId]` falls back to
 * `/projects/[projectId]` (its parent entity), not `/projects`, because the
 * member's mental-model parent is the project page.
 *
 * Patterns are written in the `[param]` form. The resolver normalises a
 * runtime pathname via `normalizePathname` (RQ4-1) before lookup.
 *
 * Labels are CONTEXTUAL — they name the destination ("Back to Projects").
 * Labels are static English; localisation threading is a follow-up — the
 * strings are short and consistent so the upgrade is mechanical.
 */
import { normalizePathname } from './page-segregation';

export interface CanonicalParent {
    /** Pattern relative to `/t/[tenantSlug]` — joined at render time. */
    href: string;
    /** Trailing portion of the affordance label: "Back to <label>". */
    label: string;
}

/**
 * Subpage pattern → canonical parent. Phase 2 brought the first subpages
 * (a project's page and a work item's page, sub-phase 2.3); each new one
 * gets its parent here, and `tests/guards/back-affordance-no-cycles.test.ts` walks
 * the map.
 */
const PARENT_MAP: Record<string, CanonicalParent> = {
    // Sub-phase 2.3. A work item's page falls back to the workspace list (its
    // project is in the URL only by key, so the list is the stable parent).
    '/work-items/[workItemKey]': { href: '/work-items', label: 'Work items' },
    '/projects/[projectKey]': { href: '/projects', label: 'Projects' },
    // Sub-phase 2.5a.
    '/cycles/[cycleId]': { href: '/cycles', label: 'Cycles' },
    // Sub-phase 2.5b. A project's milestones fall back to the project; one
    // milestone to its project's milestones.
    '/projects/[projectKey]/milestones': { href: '/projects/[projectKey]', label: 'Project' },
    '/projects/[projectKey]/milestones/[milestoneId]': { href: '/projects/[projectKey]/milestones', label: 'Milestones' },
    // Decision 55. Each Settings section falls back to Settings; a team's
    // workflow to the teams list.
    '/settings/teams': { href: '/settings', label: 'Settings' },
    '/settings/teams/[teamId]': { href: '/settings/teams', label: 'Teams' },
    '/settings/work-item-types': { href: '/settings', label: 'Settings' },
    '/settings/labels': { href: '/settings', label: 'Settings' },
    '/settings/projects': { href: '/settings', label: 'Settings' },
};

/**
 * Resolve the canonical parent for a runtime pathname. Returns `null` for
 * a route that is not a known subpage (i.e. main pages and unknown routes).
 *
 * `tenantSlug` is used to expand `/t/[tenantSlug]` into the returned href.
 * Dynamic-segment values in the SUBPAGE's pattern (`[projectId]`, etc.)
 * are inherited from the input pathname when the parent references the
 * SAME segment — so `/t/acme/projects/p1/items/i1` → `/t/acme/projects/p1`,
 * NOT `/t/acme/projects/[projectId]`.
 */
/**
 * PARENT_MAP must stay acyclic (`back-affordance-no-cycles` walks it). The
 * hop cap keeps this function total if a loop is ever introduced, rather
 * than hanging.
 */
const MAX_PARENT_HOPS = 8;

/**
 * True when `referrer` sits BELOW `pathname` in the IA, so following it would
 * make "back" descend.
 *
 * WHY THIS EXISTS. `BackAffordance` prefers the referrer — the page you came
 * from — over the declared parent. Two guards already reject a referrer that
 * is the current page, or a SIBLING of it. Neither rejects a CHILD, so
 * clicking into a sub-page and pressing back returned you to the sub-page:
 *
 *   on /projects/P/settings : referrer /projects/P           -> ascends, fine
 *   on /projects/P          : referrer /projects/P/settings  -> DESCENDS
 *
 * and because the back click itself writes the referrer (NavigationTracker
 * stores the OUTGOING path), the two pages then bounce off each other.
 *
 * TWO CLAUSES, BOTH LOAD-BEARING (inflect-compliance measured both over its
 * route tree):
 *   1. URL containment.
 *   2. IA containment — walk canonical parents up from the referrer looking
 *      for the current page. Catches a page that descends through a
 *      cross-link whose parent is NOT a URL prefix.
 */
export function referrerIsDescendant(
    referrer: string,
    pathname: string,
    tenantSlug: string,
): boolean {
    if (referrer === pathname) return false;
    // 1 — URL containment. The trailing slash stops /projects/web-app
    // from counting as a child of /projects/web.
    if (referrer.startsWith(`${pathname}/`)) return true;
    // 2 — IA containment.
    let cursor = referrer;
    for (let hops = 0; hops < MAX_PARENT_HOPS; hops++) {
        const parent = resolveCanonicalParent(cursor, tenantSlug);
        if (!parent) return false;
        if (parent.href === pathname) return true;
        if (parent.href === cursor) return false;
        cursor = parent.href;
    }
    return false;
}

export function resolveCanonicalParent(
    pathname: string,
    tenantSlug: string,
): CanonicalParent | null {
    const pattern = normalizePathname(pathname);
    if (!pattern) return null;
    const parent = PARENT_MAP[pattern];
    if (!parent) return null;

    const expandedHref = expandDynamicSegments(parent.href, pattern, pathname);
    return {
        href: `/t/${tenantSlug}${expandedHref}`,
        label: parent.label,
    };
}

/**
 * Substitute `[param]` placeholders in the parent's href with the concrete
 * values from the child's pathname. Only segments that appear in BOTH the
 * child pattern and the parent href are substituted.
 */
function expandDynamicSegments(
    parentHref: string,
    childPattern: string,
    childPathname: string,
): string {
    const childPath = childPathname.replace(/^\/t\/[^/]+/, '');
    const childPatSegs = childPattern.split('/').filter(Boolean);
    const childPathSegs = childPath.split('/').filter(Boolean);
    const dynamicValues = new Map<string, string>();
    for (let i = 0; i < childPatSegs.length; i++) {
        const seg = childPatSegs[i];
        const value = childPathSegs[i];
        if (seg && seg.startsWith('[') && seg.endsWith(']') && value) {
            dynamicValues.set(seg, value);
        }
    }
    return parentHref
        .split('/')
        .map((seg) => dynamicValues.get(seg) ?? seg)
        .join('/');
}

export const CANONICAL_PARENT_MAP_INTERNAL = PARENT_MAP;
