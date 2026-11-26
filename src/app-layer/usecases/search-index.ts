/**
 * Rebuilding a workspace's search vectors (sub-phase 2.7f; ADR 0008 D1,
 * "Rebuild"; docs/search.md).
 *
 * `rebuildSearchIndex` reads every source whose vector is missing or built at
 * an older revision (`SEARCH_VECTOR_REVISION`), or every source when forced,
 * through the decrypting client, and rewrites its row with
 * `SearchVectorRepository.replaceForSource`, the seam every write uses. It is
 * the backfill on first deploy and the rebuild after a change to the
 * configuration, its dictionary or `searchableText` (a revision bump, never a
 * data migration). It walks each kind of source in id order, one page of
 * `REBUILD_PAGE_SIZE` sources at a time, each in its own transaction, and
 * rewrites the page's stale ones: a page reads only its own rows (issue #79),
 * so a run is linear in the workspace, and a source that yields no vector (a
 * description of mention tokens only) is passed, not re-read for ever. A run
 * writes at most `MAX_PAGES` pages' worth of sources of each kind; the next
 * night continues where the revision says.
 *
 * `requestSearchIndexRebuild` is an admin's on-demand forced rebuild of their
 * own workspace (`admin.manage`), audited, run by the job as that admin,
 * re-resolved when it runs.
 *
 * Written fresh for Islestone.
 */
import { assertCanManageWorkConfig } from '../policies/work-config.policies';
import { logEvent } from '../events/audit';
import { REBUILD_PAGE_SIZE, SearchVectorRepository } from '../repositories/SearchVectorRepository';
import type { RequestContext } from '../types';
import { enqueue } from '../jobs/queue';
import { runInTenantContext } from '@/lib/db-context';
import { SEARCH_VECTOR_REVISION } from '@/lib/search/configuration';

/** Pages' worth of sources of each kind one run writes per workspace (500 sources a page). */
export const MAX_PAGES = 200;

/** The most sources of each kind one run writes per workspace. */
const MAX_WRITES = MAX_PAGES * REBUILD_PAGE_SIZE;

export interface SearchIndexRebuildResult {
    descriptions: number;
    comments: number;
    /** Vectors of deleted comments removed. */
    removed: number;
    /** False when a kind stopped at its write cap (the next run continues). */
    complete: boolean;
}

export async function rebuildSearchIndex(ctx: RequestContext, opts: { force?: boolean } = {}): Promise<SearchIndexRebuildResult> {
    const force = opts.force === true;
    const result: SearchIndexRebuildResult = { descriptions: 0, comments: 0, removed: 0, complete: true };

    let cursor: string | null = null;
    for (;;) {
        if (result.descriptions >= MAX_WRITES) {
            result.complete = false;
            break;
        }
        // guardrail-allow: n+1 — one transaction per bounded page of the keyset walk.
        const step: { written: number; next: string | null } = await runInTenantContext(ctx, async (db) => {
            const page = await SearchVectorRepository.staleDescriptionPage(db, ctx, cursor, { force });
            const texts = await SearchVectorRepository.descriptionTexts(db, ctx, page.ids);
            for (const id of page.ids) {
                // guardrail-allow: n+1 — one write per source of a bounded page (REBUILD_PAGE_SIZE).
                await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: id, commentId: null }, texts.get(id) ?? null);
            }
            return { written: page.ids.length, next: page.next };
        });
        result.descriptions += step.written;
        cursor = step.next;
        if (cursor === null) break;
    }

    cursor = null;
    for (;;) {
        if (result.comments >= MAX_WRITES) {
            result.complete = false;
            break;
        }
        // guardrail-allow: n+1 — one transaction per bounded page of the keyset walk.
        const step: { written: number; next: string | null } = await runInTenantContext(ctx, async (db) => {
            const page = await SearchVectorRepository.staleCommentPage(db, ctx, cursor, { force });
            const rows = await SearchVectorRepository.commentTexts(db, ctx, page.ids);
            for (const row of rows) {
                // guardrail-allow: n+1 — one write per source of a bounded page (REBUILD_PAGE_SIZE).
                await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: row.workItemId, commentId: row.id }, row.body);
            }
            return { written: rows.length, next: page.next };
        });
        result.comments += step.written;
        cursor = step.next;
        if (cursor === null) break;
    }

    result.removed = await runInTenantContext(ctx, (db) => SearchVectorRepository.removeDeletedCommentRows(db, ctx));

    if (result.descriptions + result.comments + result.removed > 0 || force) {
        // Counts only: never a word of the text.
        await runInTenantContext(ctx, (db) =>
            logEvent(db, ctx, {
                action: 'SEARCH_INDEX_REBUILT',
                entityType: 'SearchVector',
                entityId: ctx.tenantId,
                details: `Rebuilt ${result.descriptions} description and ${result.comments} comment search vector(s)`,
                detailsJson: {
                    category: 'custom',
                    event: 'search_index_rebuilt',
                    revision: SEARCH_VECTOR_REVISION,
                    force,
                    descriptions: result.descriptions,
                    comments: result.comments,
                    removed: result.removed,
                    complete: result.complete,
                },
            }),
        );
    }
    return result;
}

/**
 * An admin asks for a forced rebuild of their workspace (`POST
 * /api/t/:slug/admin/search-index/rebuild`, `admin.manage`). Audited here;
 * the job re-resolves the admin when it runs and refuses if they are gone.
 */
export async function requestSearchIndexRebuild(ctx: RequestContext): Promise<{ queued: true; jobId: string | null }> {
    assertCanManageWorkConfig(ctx);
    await runInTenantContext(ctx, (db) =>
        logEvent(db, ctx, {
            action: 'SEARCH_INDEX_REBUILD_REQUESTED',
            entityType: 'SearchVector',
            entityId: ctx.tenantId,
            details: 'Requested a rebuild of the workspace\'s search index',
            detailsJson: { category: 'custom', event: 'search_index_rebuild_requested', revision: SEARCH_VECTOR_REVISION },
        }),
    );
    const job = await enqueue('search-index-rebuild', { tenantId: ctx.tenantId, force: true, requestedByUserId: ctx.userId });
    return { queued: true, jobId: job.id ?? null };
}
