/**
 * The `search-index-rebuild` job (sub-phase 2.7f; ADR 0008 D1, "Rebuild";
 * docs/search.md).
 *
 * Nightly (02:40 in `NOTIFICATIONS_TZ`): every live workspace with a work item
 * is rebuilt as its system user (`rebuildSearchIndex`): the sources whose
 * vector is missing or older than `SEARCH_VECTOR_REVISION`. It acts for
 * nobody, and writes only the derivative rows.
 *
 * On demand (`requestSearchIndexRebuild`, an admin's POST): one workspace,
 * every source (`force`), AS the admin who asked, re-resolved when it runs:
 * an admin who left or lost `admin.manage` is a refusal, never a fallback to
 * the system user (`NonRetryableJobError`).
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext, resolveMemberContext } from '../context-system';
import { mayManageWorkConfig } from '../policies/work-config.policies';
import { rebuildSearchIndex } from '../usecases/search-index';
import { NonRetryableJobError } from './non-retryable';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

const TENANT_SWEEP_TAKE = 100_000;

export interface SearchIndexRebuildOptions {
    tenantId?: string;
    force?: boolean;
    requestedByUserId?: string;
}

export interface SearchIndexRebuildJobResult {
    tenants: number;
    failedTenants: number;
    descriptions: number;
    comments: number;
    removed: number;
}

/** The live workspaces that hold a work item (one, when named). */
async function tenantsToRebuild(tenantId: string | undefined) {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
        const rows = await db.workItem.findMany({
            where: { ...(tenantId ? { tenantId } : {}), tenant: { deletedAt: null } },
            distinct: ['tenantId'],
            take: TENANT_SWEEP_TAKE,
            select: { tenantId: true },
        });
        const ids = rows.map((r) => r.tenantId);
        if (ids.length === 0) return [];
        return db.tenant.findMany({
            where: { id: { in: ids }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        });
    });
}

export async function processSearchIndexRebuild(options: SearchIndexRebuildOptions = {}): Promise<SearchIndexRebuildJobResult> {
    return runJob('search-index-rebuild', async () => {
        const result: SearchIndexRebuildJobResult = { tenants: 0, failedTenants: 0, descriptions: 0, comments: 0, removed: 0 };

        if (options.requestedByUserId) {
            // An admin's request: one workspace, as them, or nothing.
            if (!options.tenantId) throw new NonRetryableJobError('search-index-rebuild: a requested rebuild names its workspace', 'terminal');
            const ctx = await resolveMemberContext({ tenantId: options.tenantId, userId: options.requestedByUserId, job: 'search-index-rebuild' });
            if (!ctx || !mayManageWorkConfig(ctx)) {
                logger.warn('search index rebuild refused: the admin who asked no longer resolves', { component: 'jobs', tenantId: options.tenantId });
                throw new NonRetryableJobError('search-index-rebuild: the requesting admin is no longer an active member holding admin.manage', 'terminal');
            }
            const r = await rebuildSearchIndex(ctx, { force: options.force === true });
            return { ...result, tenants: 1, descriptions: r.descriptions, comments: r.comments, removed: r.removed };
        }

        for (const tenant of await tenantsToRebuild(options.tenantId)) {
            try {
                const ctx = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'search-index-rebuild' });
                // guardrail-allow: n+1 — one workspace at a time, each in its own bounded transactions.
                const r = await rebuildSearchIndex(ctx, { force: options.force === true });
                result.tenants += 1;
                result.descriptions += r.descriptions;
                result.comments += r.comments;
                result.removed += r.removed;
            } catch (err) {
                result.failedTenants += 1;
                logger.error('search index rebuild failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('search index rebuild finished', { component: 'jobs', ...result });
        return result;
    });
}
