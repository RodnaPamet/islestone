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
 *   - **Not searched:** descriptions and comments (encrypted; 2.7f, ADR
 *     0008), intake requests, templates (decision 124).
 */

import { assertCanReadWorkConfig } from '../policies/work-config.policies';
import { mayReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects, type ProjectVisibility } from '../policies/project-visibility';
import { ProjectRepository, type ProjectSearchRow } from '../repositories/ProjectRepository';
import { WorkItemRepository, type WorkItemSearchRow } from '../repositories/WorkItemRepository';
import { formatKey, parseKey } from '../domain/work-item-key';
import type { RequestContext } from '../types';
import { runInTenantReadContext, type PrismaTx } from '@/lib/db-context';
import { normaliseSearchQuery } from '@/lib/search/query';
import { capPerType, computeRankScore, sortHits } from '@/lib/search/rank';
import {
    DEFAULT_PER_TYPE_LIMIT,
    MAX_PER_TYPE_LIMIT,
    MIN_QUERY_LENGTH,
    SEARCH_TYPE_DEFAULTS,
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
    const { items, projects } = await runInTenantReadContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const keyHitId = searchItems ? await keyHitIdFor(db, ctx, v, query) : null;
        const [itemRows, projectRows] = await Promise.all([
            searchItems ? WorkItemRepository.searchTitles(db, ctx, v, query, { limit: dbLimit, keyHitId }) : Promise.resolve([]),
            ProjectRepository.searchNames(db, ctx, v, query, { limit: dbLimit }),
        ]);
        return { items: itemRows, projects: projectRows };
    });

    const hits: SearchHit[] = [
        ...items.map((row) => workItemHit(row, query, slug)),
        ...projects.map((row) => projectHit(row, query, slug)),
    ];
    // Rank, then cap: the strongest hits of each type survive.
    const { kept, perTypeCounts, truncated } = capPerType(sortHits(hits), limit);
    return { hits: kept, meta: { query, perTypeCounts, truncated, perTypeLimit: limit } };
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
