/**
 * Workspace-scoped global search contract.
 *
 * Single typed payload consumed by every surface that wants cross-entity
 * discovery: the command palette first. The API is responsible for ranking,
 * truncation and href construction, so every client renders the same hits
 * in the same order.
 *
 * Rewritten for Islestone from inflect-compliance `src/lib/search/types.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7): the hit types
 * are Islestone's (work items and projects, ADR 0006); the shapes and the
 * tunables are kept. The endpoint, `GET /api/t/<slug>/search`, shipped with
 * sub-phase 2.7b: work-item titles and keys and project names (ADR 0008 D1
 * item 1, docs/search.md); 2.7f adds descriptions and comments.
 *
 * This contract is not a permission-evaluation surface: hits carry no
 * "you can/cannot edit this"; that lives on the detail page.
 *
 * Adding a new entity type:
 *   1. Add the literal to `SearchHitType`.
 *   2. Add a search query in the search usecase (RLS-scoped, with a
 *      per-type limit).
 *   3. Add display metadata to `SEARCH_TYPE_DEFAULTS` for the icon +
 *      category label.
 *   4. The palette auto-renders it via the existing per-kind grouping;
 *      give it a heading in `commandPalette.entity*`.
 */

// ─── Entity types ──────────────────────────────────────────────────────

/**
 * Every entity kind that can appear in a search hit. Add a value
 * here AND a query branch in the usecase + display metadata in
 * `SEARCH_TYPE_DEFAULTS`; downstream code is type-checked.
 */
export type SearchHitType = 'workItem' | 'project';

// ─── Hit shape ─────────────────────────────────────────────────────────

/**
 * One row in the unified search response.
 *
 * `score` is the API's relevance ordering signal — higher is
 * better. The API also returns hits in score-DESC order, so a
 * dumb client can ignore the field entirely; it's exposed so
 * future surfaces can re-sort or threshold.
 *
 * Stable key is `${type}:${id}` — useful for React `key=` props
 * across mixed-type lists.
 */
export interface SearchHit {
    type: SearchHitType;
    /** Entity primary key (cuid). */
    id: string;
    /** Main label rendered on the row. */
    title: string;
    /** Optional secondary label (status / score / version). */
    subtitle: string | null;
    /** Optional right-aligned tag (status enum). */
    badge: string | null;
    /** Tenant-scoped detail page href the row should navigate to on select. */
    href: string;
    /** Bounded relevance score. Implementation-specific magnitude; only ordering is part of the contract. */
    score: number;
    /** Stable icon key the renderer maps to a Lucide glyph (UI primitive defines the map). */
    iconKey: 'work-item' | 'project';
    /** Plural display name for grouping headers ("Work items", "Projects"). */
    category: string;
}

// ─── Per-type metadata ─────────────────────────────────────────────────

/**
 * Single source of truth for icon + category label per type. Used
 * by both the API (when assembling hits) and clients that want to
 * render group headers without re-deriving the table.
 */
export const SEARCH_TYPE_DEFAULTS: Record<
    SearchHitType,
    { iconKey: SearchHit['iconKey']; category: string }
> = {
    workItem: { iconKey: 'work-item', category: 'Work items' },
    project: { iconKey: 'project', category: 'Projects' },
};

// ─── Top-level payload ─────────────────────────────────────────────────

export interface SearchResponseMeta {
    /** Echo of the trimmed query the API actually used. */
    query: string;
    /** Per-type result count after capping. */
    perTypeCounts: Record<SearchHitType, number>;
    /** True when ANY type hit its per-type cap (so client can show "+more"). */
    truncated: boolean;
    /** Per-type cap actually applied. */
    perTypeLimit: number;
}

export interface SearchResponse {
    hits: SearchHit[];
    meta: SearchResponseMeta;
}

// ─── Tunables ──────────────────────────────────────────────────────────

/**
 * Per-type cap. Five hits per kind keeps the palette readable and
 * keeps each underlying query fast. Bumping this requires verifying
 * the query plan still uses an index.
 */
export const DEFAULT_PER_TYPE_LIMIT = 5;

/**
 * The most hits per type one call may ask for (`limit`): the bounded page
 * size. Above it a member should use the list pages, whose `q` filter pages.
 */
export const MAX_PER_TYPE_LIMIT = 25;

/**
 * Minimum query length the API accepts. Below this, we return an
 * empty result set without hitting the DB. Mirrors the
 * client-side gate so behaviour is consistent.
 *
 * Set to 1 so single-character queries (`1`, `2`, etc.) can match
 * keys and numeric identifiers — a member searching for an item's
 * number should be able to find it.
 */
export const MIN_QUERY_LENGTH = 1;

/**
 * Maximum query length we'll accept. Defends against pathological
 * input that would still pass the trim guard (a 10MB string of
 * "a" characters). Anything longer is truncated.
 */
export const MAX_QUERY_LENGTH = 200;
