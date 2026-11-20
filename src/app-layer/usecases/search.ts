/**
 * Workspace search over work-item titles and keys and project names
 * (sub-phase 2.7b; docs/porting/maps/2.7.md, part 2; docs/search.md).
 *
 * Copied from inflect-compliance `src/app-layer/usecases/search.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and cut down: its
 * eight compliance queries and the global framework read are gone; two
 * queries remain, work items and projects, each a bounded, ranked raw read in
 * its repository (`WorkItemRepository.searchTitles`,
 * `ProjectRepository.searchNames`) over the indexes of migration
 * `20261203120000_search_titles`. Kept from the source: the one read
 * transaction, per-domain skipping, the `perTypeLimit * 3` headroom, rank
 * then cap, and the response shape.
 *
 * Design notes:
 *
 *   - **The gate.** The route takes `projects.view` and this usecase asserts
 *     the same predicate (`assertCanReadWorkConfig`). Work items are a
 *     second domain: a caller without `work_items.view` (a custom role) gets
 *     project hits only and a zero work-item count, never a refusal and
 *     never a withheld count (inflect's per-domain skipping).
 *   - **Visibility is the repository's predicate.** `visibleProjects(ctx)`
 *     goes to both reads; a deleted item, a deleted or archived project and
 *     a project outside a GUEST's grant (all of them until 8.4) never match.
 *   - **A typed key** (`ISL-12`, a retired prefix, or a key left by a move)
 *     resolves first, as `getWorkItemByKey` resolves it, and joins the
 *     title read as one more candidate, so it passes the same visibility
 *     and ranks first (its key is an exact code match).
 *   - **The query is never logged** and is always a bind parameter.
 *   - **Descriptions and comments** (sub-phase 2.7f, ADR 0008, decision
 *     124): their stored vectors are matched (`SearchVectorRepository.
 *     matchItems`, the same visibility and liveness), an item already found
 *     by its title keeps its title hit, and the rest rank below every title
 *     match (`computeContentScore`). The best `SNIPPET_HITS` of them carry a
 *     snippet of the matched text, decrypted and read under the same
 *     visibility in the same transaction; nothing is stored.
 *   - **Not searched:** intake requests, templates, project-template content
 *     and personal data (decision 124).
 */

import { assertCanReadWorkConfig } from '../policies/work-config.policies';
import { mayReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { ProjectRepository, type ProjectSearchRow } from '../repositories/ProjectRepository';
import { SearchVectorRepository, type SearchVectorMatch } from '../repositories/SearchVectorRepository';
import { WorkItemRepository, type WorkItemSearchRow } from '../repositories/WorkItemRepository';
import { formatKey, parseKey } from '../domain/work-item-key';
import type { RequestContext } from '../types';
import { runInTenantReadContext, type PrismaTx } from '@/lib/db-context';
import { normaliseSearchQuery } from '@/lib/search/query';
import { capPerType, computeContentScore, computeRankScore, sortHits } from '@/lib/search/rank';
import { buildSnippet } from '@/lib/search/snippet';
import {
    DEFAULT_PER_TYPE_LIMIT,
    MAX_PER_TYPE_LIMIT,
    MIN_QUERY_LENGTH,
    SEARCH_TYPE_DEFAULTS,
    SNIPPET_HITS,
    type SearchHit,
    type SearchResponse,
} from '@/lib/search/types';

export interface SearchWorkspaceOptions {
    /** Hits per type, 1 to `MAX_PER_TYPE_LIMIT` (default `DEFAULT_PER_TYPE_LIMIT`). */
    perTypeLimit?: number;
}

export async function searchWorkspace(
    ctx: RequestContext,
    rawQuery: string,
    options: SearchWorkspaceOptions = {},
): Promise<SearchResponse> {
    assertCanReadWorkConfig(ctx);
    const searchItems = mayReadWorkItems(ctx);

    const limit = clampPerTypeLimit(options.perTypeLimit);
    // The headroom lets ranking promote a strong match the database ordered
    // below a weaker one (its order is a candidate order, not the rank).
    const dbLimit = limit * 3;

    const query = normaliseSearchQuery(rawQuery);
    if (query.length < MIN_QUERY_LENGTH) return emptyResponse(query, limit);

    const slug = ctx.tenantSlug ?? '';
    return runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const keyHitId = searchItems ? await keyHitIdFor(db, ctx, v, query) : null;
        const [items, projects, contentMatches] = await Promise.all([
            searchItems ? WorkItemRepository.searchTitles(db, ctx, v, query, { limit: dbLimit, keyHitId }) : Promise.resolve([]),
            ProjectRepository.searchNames(db, ctx, v, query, { limit: dbLimit }),
            searchItems ? SearchVectorRepository.matchItems(db, ctx, v, query, dbLimit) : Promise.resolve([]),
        ]);

        const titled = new Set(items.map((row) => row.id));
        const contentOnly = contentMatches.filter((m) => !titled.has(m.workItemId));
        const contentRows = await contentItemRows(db, ctx, v, contentOnly);

        const hits: SearchHit[] = [
            ...items.map((row) => workItemHit(row, query, slug)),
            ...contentRows.map(({ row, match }) => contentHit(row, match, slug)),
            ...projects.map((row) => projectHit(row, query, slug)),
        ];
        // Rank, then cap: the strongest hits of each type survive.
        const { kept, perTypeCounts, truncated } = capPerType(sortHits(hits), limit);
        await attachSnippets(db, ctx, v, kept, contentOnly, query);
        return { hits: kept, meta: { query, perTypeCounts, truncated, perTypeLimit: limit } };
    });
}

/**
 * The key and title of each content-only match, in the match's order. Read
 * by id under the same visibility (`findSearchRows`); a row that vanished
 * between the two reads is dropped.
 */
async function contentItemRows(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, matches: readonly SearchVectorMatch[]) {
    if (matches.length === 0) return [];
    const rows = new Map((await WorkItemRepository.findSearchRows(db, ctx, v, matches.map((m) => m.workItemId))).map((r) => [r.id, r] as const));
    return matches.flatMap((match) => {
        const row = rows.get(match.workItemId);
        return row ? [{ row, match }] : [];
    });
}

/**
 * Snippets for the best `SNIPPET_HITS` description and comment hits that
 * survived the cap: one decrypting read of each kind, under the caller's
 * visibility. Every other hit keeps `snippet: null`.
 */
async function attachSnippets(
    db: PrismaTx,
    ctx: RequestContext,
    v: ProjectVisibility,
    hits: SearchHit[],
    matches: readonly SearchVectorMatch[],
    query: string,
): Promise<void> {
    const byItem = new Map(matches.map((m) => [m.workItemId, m] as const));
    const wanted = hits.filter((h) => h.type === 'workItem' && (h.matchedIn === 'description' || h.matchedIn === 'comment')).slice(0, SNIPPET_HITS);
    if (wanted.length === 0) return;
    const descriptionItemIds = wanted.filter((h) => h.matchedIn === 'description').map((h) => h.id);
    const commentIds = wanted.flatMap((h) => {
        const commentId = byItem.get(h.id)?.commentId;
        return h.matchedIn === 'comment' && commentId ? [commentId] : [];
    });
    const texts = await WorkItemRepository.searchSnippetSources(db, ctx, v, { descriptionItemIds, commentIds });
    for (const hit of wanted) {
        const commentId = byItem.get(hit.id)?.commentId ?? null;
        const text = hit.matchedIn === 'description' ? texts.descriptions.get(hit.id) : commentId ? texts.comments.get(commentId) : undefined;
        hit.snippet = text ? buildSnippet(text, query) : null;
    }
}

/** The per-type cap: a positive integer, at most `MAX_PER_TYPE_LIMIT`. */
export function clampPerTypeLimit(raw: number | undefined): number {
    if (raw === undefined || !Number.isFinite(raw) || raw < 1) return DEFAULT_PER_TYPE_LIMIT;
    return Math.min(Math.floor(raw), MAX_PER_TYPE_LIMIT);
}

/**
 * The item a typed key names, as `getWorkItemByKey` resolves it: the
 * project's current or retired prefix, then the number, then an alias left
 * by a move. Visibility is applied again by the title read.
 */
async function keyHitIdFor(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, query: string): Promise<string | null> {
    const parsed = parseKey(query);
    if (!parsed) return null;
    const prefix = await ProjectRepository.projectIdForPrefix(db, ctx, parsed.prefix);
    if (!prefix) return null;
    const live = await WorkItemRepository.findByNumber(db, ctx, v, prefix.projectId, parsed.number);
    if (live) return live.id;
    return (await WorkItemRepository.findAlias(db, ctx, prefix.projectId, parsed.number))?.workItemId ?? null;
}

/** `key` when the query is the code (a key, a prefix) or its start; `title` otherwise. */
function titleSource(query: string, code: string): 'title' | 'key' {
    const q = query.trim().toLowerCase();
    return q !== '' && code.toLowerCase().startsWith(q) ? 'key' : 'title';
}

function workItemHit(row: WorkItemSearchRow, query: string, slug: string): SearchHit {
    const key = formatKey(row.keyPrefix, row.number);
    return {
        type: 'workItem',
        id: row.id,
        title: row.title,
        subtitle: key,
        badge: null,
        href: `/t/${slug}/work-items/${encodeURIComponent(key)}`,
        score: computeRankScore(query, { type: 'workItem', title: row.title, code: key }),
        ...SEARCH_TYPE_DEFAULTS.workItem,
        matchedIn: titleSource(query, key),
        snippet: null,
    };
}

/** A work item found in its description or a comment (2.7f); the snippet is attached after the cap. */
function contentHit(row: WorkItemSearchRow, match: SearchVectorMatch, slug: string): SearchHit {
    const key = formatKey(row.keyPrefix, row.number);
    return {
        type: 'workItem',
        id: row.id,
        title: row.title,
        subtitle: key,
        badge: null,
        href: `/t/${slug}/work-items/${encodeURIComponent(key)}`,
        score: computeContentScore(match.rank),
        ...SEARCH_TYPE_DEFAULTS.workItem,
        matchedIn: match.commentId ? 'comment' : 'description',
        snippet: null,
    };
}

function projectHit(row: ProjectSearchRow, query: string, slug: string): SearchHit {
    return {
        type: 'project',
        id: row.id,
        title: row.name,
        subtitle: row.keyPrefix,
        badge: null,
        href: `/t/${slug}/projects/${encodeURIComponent(row.keyPrefix)}`,
        score: computeRankScore(query, { type: 'project', title: row.name, code: row.keyPrefix }),
        ...SEARCH_TYPE_DEFAULTS.project,
        matchedIn: titleSource(query, row.keyPrefix),
        snippet: null,
    };
}

function emptyResponse(query: string, limit: number): SearchResponse {
    return {
        hits: [],
        meta: { query, perTypeCounts: { workItem: 0, project: 0 }, truncated: false, perTypeLimit: limit },
    };
}

// Re-export the shape so route + clients have one import path.
export type { SearchHit, SearchResponse } from '@/lib/search/types';
