/**
 * Nightly job: repeats (sub-phase 2.5d, owner decisions 68 to 70).
 *
 * Runs at 00:30 in `NOTIFICATIONS_TZ`. The workspaces to visit (a running
 * repeat with a next date) are found under
 * `runWithoutRls({ reason: 'cross-tenant-sweep' })`, deleted workspaces
 * skipped. In each, the workspace system user READS the due rules and writes
 * only holds; every occurrence is made as the rule's owner, re-resolved
 * (`runWorkspaceRecurrences`): a job doing what a person asked, never a
 * fallback to the system user.
 *
 * Idempotent at the data layer: each occurrence is claimed on its stamped
 * date and backed by the occurrence unique, so a re-run the same night makes
 * nothing twice.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { runWorkspaceRecurrences, type RecurrenceRunResult } from '../usecases/recurrence-run';
import { todayInTz } from '../notifications/work-item-due';
import { env } from '@/env';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export interface WorkItemRecurrenceOptions {
    tenantId?: string;
    now?: Date;
    tz?: string;
}

export interface WorkItemRecurrenceJobResult extends RecurrenceRunResult {
    tenants: number;
    failedTenants: number;
}

/** A sweep over every workspace; bounded far above any deployment. */
const TENANT_SWEEP_TAKE = 100_000;

async function tenantsToVisit(tenantId: string | undefined): Promise<Array<{ id: string; slug: string }>> {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, async (db) => {
        const rows = await db.workItemRecurrence.findMany({
            where: { ...(tenantId ? { tenantId } : {}), heldAt: null, nextOccurrenceOn: { not: null }, tenant: { deletedAt: null } },
            distinct: ['tenantId'],
            take: TENANT_SWEEP_TAKE,
            select: { tenantId: true },
        });
        if (rows.length === 0) return [];
        return db.tenant.findMany({
            where: { id: { in: rows.map((r) => r.tenantId) }, deletedAt: null },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        });
    });
}

export async function processWorkItemRecurrence(options: WorkItemRecurrenceOptions = {}): Promise<WorkItemRecurrenceJobResult> {
    return runJob('work-item-recurrence', async () => {
        const now = options.now ?? new Date();
        const tz = options.tz ?? ((env.NOTIFICATIONS_TZ as string | undefined) || 'UTC');
        const today = todayInTz(now, tz);
        const result: WorkItemRecurrenceJobResult = { tenants: 0, failedTenants: 0, rules: 0, created: 0, held: 0, raced: 0, skippedOccurrences: 0, failed: 0 };
        for (const tenant of await tenantsToVisit(options.tenantId)) {
            try {
                const sys = await buildTenantSystemJobContext({ tenantId: tenant.id, tenantSlug: tenant.slug, job: 'work-item-recurrence' });
                const r = await runWorkspaceRecurrences(sys, today);
                result.tenants += 1;
                result.rules += r.rules;
                result.created += r.created;
                result.held += r.held;
                result.raced += r.raced;
                result.failed += r.failed;
                result.skippedOccurrences += r.skippedOccurrences;
            } catch (err) {
                // One workspace's failure never stops the others; the next run retries it.
                result.failedTenants += 1;
                logger.error('repeats failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('repeats finished', { component: 'jobs', ...result, today: today.toISOString().slice(0, 10) });
        return result;
    });
}
