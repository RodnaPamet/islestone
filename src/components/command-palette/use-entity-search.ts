'use client';

/* TODO(swr-migration): this file has fetch-on-mount + setState
 * patterns flagged by react-hooks/set-state-in-effect. Each call site
 * carries an inline disable directive; collectively they should
 * migrate to useTenantSWR (Epic 69 shape) so the rule can lift. */

/**
 * Command Palette entity search.
 *
 * One call to the workspace search API, `GET /api/t/<slug>/search?q=`, which
 * owns ranking, per-type caps and the result shape (`@/lib/search/types`).
 *
 * ON SINCE SUB-PHASE 2.7b, which shipped the route (work-item titles and
 * keys, project names; docs/search.md). `ENTITY_SEARCH_AVAILABLE` stays as
 * the switch: set false, the hook reports `unavailable` without fetching and
 * the palette hides its entity surface.
 *
 * Characteristics:
 *   - Debounces input (≈180 ms).
 *   - Cancels in-flight requests via AbortController on every
 *     keystroke, so a slow network can't paint stale results.
 *   - Stays inert when the palette opens outside a workspace route
 *     (`/login`, `/tenants`).
 */

import { useEffect, useRef, useState } from 'react';
import type { SearchHit, SearchHitType, SearchResponse } from '@/lib/search/types';

// ─── Public types — kept identical to the original hook ───────────────

export type EntityKind = SearchHitType;

export interface EntitySearchResult {
    id: string;
    kind: EntityKind;
    primary: string;
    secondary?: string;
    badge?: string;
    href: string;
    /** Found in a work item's description or a comment, not its title (2.7f). */
    matchedIn?: 'description' | 'comment';
    /** A window of the matched text, for a description or comment match. */
    snippet?: string;
}

export interface EntitySearchState {
    loading: boolean;
    results: EntitySearchResult[];
    disabled: boolean;
    /**
     * Entity search is not offered in this build (`ENTITY_SEARCH_AVAILABLE`).
     * Distinct from `disabled`, which means "outside a workspace": the
     * palette hides its entity surface rather than asking anyone to sign in.
     */
    unavailable: boolean;
    /**
     * The last search did not answer: a non-2xx (a 500, a read-tier 429) or
     * a network failure. Distinct from an empty answer, so the palette never
     * reports "no results" for a search that never ran (#5309). An abort is
     * neither — a newer query superseded it.
     */
    failed: boolean;
    /**
     * More descriptions and comments matched than the search ranks (owner
     * decision 250, `meta.contentMatchesBounded`): the palette says it is
     * showing recent matches.
     */
    contentMatchesBounded: boolean;
}

// ─── Tunables ─────────────────────────────────────────────────────────

/**
 * Whether the palette offers entity search: true since sub-phase 2.7b
 * shipped `GET /api/t/<slug>/search`; see the file header.
 */
export const ENTITY_SEARCH_AVAILABLE = true;

const DEBOUNCE_MS = 180;
const MIN_QUERY_LENGTH = 2;

// ─── Adapter — typed `SearchHit` → palette-shaped row ─────────────────

function adaptHit(h: SearchHit): EntitySearchResult {
    return {
        id: h.id,
        kind: h.type,
        primary: h.title,
        secondary: h.subtitle ?? undefined,
        badge: h.badge ?? undefined,
        href: h.href,
        ...(h.matchedIn === 'description' || h.matchedIn === 'comment' ? { matchedIn: h.matchedIn } : {}),
        ...(h.snippet ? { snippet: h.snippet } : {}),
    };
}

// ─── Pathname → tenant slug ────────────────────────────────────────────

/**
 * Derive the current tenant slug from a pathname. Returns `null`
 * on any non-tenant route, making the search hook inert there.
 */
export function tenantSlugFromPathname(pathname: string | null): string | null {
    if (!pathname) return null;
    const match = pathname.match(/^\/t\/([^/?#]+)/);
    return match?.[1] ?? null;
}

// ─── Hook ──────────────────────────────────────────────────────────────

export function useEntitySearch(
    query: string,
    tenantSlug: string | null,
): EntitySearchState {
    const [state, setState] = useState<EntitySearchState>({
        loading: false,
        results: [],
        disabled: tenantSlug === null,
        unavailable: !ENTITY_SEARCH_AVAILABLE,
        failed: false,
        contentMatchesBounded: false,
    });
    // Track requests so a stale debounce doesn't overwrite a fresh
    // result even if AbortController fires after the new request
    // returns. Belt-and-braces alongside the abort signal.
    const seqRef = useRef(0);

    useEffect(() => {
        const unavailable = !ENTITY_SEARCH_AVAILABLE;
        if (tenantSlug === null) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setState({ loading: false, results: [], disabled: true, unavailable, failed: false, contentMatchesBounded: false });
            return;
        }
        const trimmed = query.trim();
        if (unavailable || trimmed.length < MIN_QUERY_LENGTH) {
            setState({ loading: false, results: [], disabled: false, unavailable, failed: false, contentMatchesBounded: false });
            return;
        }

        const seq = ++seqRef.current;
        const controller = new AbortController();
        const { signal } = controller;
        const timer = setTimeout(async () => {
            setState((prev) => ({ ...prev, loading: true, disabled: false }));
            const url = `/api/t/${encodeURIComponent(tenantSlug)}/search?q=${encodeURIComponent(trimmed)}`;
            let payload: SearchResponse | null = null;
            let failed = false;
            try {
                const res = await fetch(url, { signal, credentials: 'same-origin' });
                if (res.ok) payload = (await res.json()) as SearchResponse;
                else failed = true;
            } catch {
                // Network failure, or an abort — which the check below drops.
                failed = true;
            }
            if (signal.aborted || seq !== seqRef.current) return;

            const hits = payload?.hits ?? [];
            setState({
                loading: false,
                disabled: false,
                unavailable: false,
                results: hits.map(adaptHit),
                failed,
                contentMatchesBounded: payload?.meta?.contentMatchesBounded === true,
            });
        }, DEBOUNCE_MS);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, tenantSlug]);

    return state;
}

// Exported for tests so they can assert against the same bounds.
export const __SEARCH_TUNING__ = {
    DEBOUNCE_MS,
    MIN_QUERY_LENGTH,
};
