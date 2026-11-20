/**
 * Daily job: in-app due-date reminders for work items (`WORK_ITEM_DUE`).
 * Owner decision, 2026-11-18 ("In 2.2"): reminders land with the work-item
 * engine; this is in-app only, and email digests are a separate job (2.7).
 *
 * Runs at 08:00 in `NOTIFICATIONS_TZ`. Two scope modes: no `tenantId` sweeps
 * every live workspace; a `tenantId` re-runs one. For each workspace it
 * scans, INSIDE that workspace's context (the worker connects as `app_user`,
 * so a global scan would read nothing), the open items due today, tomorrow
 * or in seven days that have an ACTIVE assignee or an ACTIVE member they wait
 * on (owner decision 137: both are reminded, one reminder when they are the
 * same person, unassigned items included), in pages of 500 keyed on `(dueDate, id)`, and
 * writes each page's reminders with ONE `createMany({ skipDuplicates })` and
 * ONE id read-back (`createWorkItemDueNotifications`). The source wrote and
 * read back per item; at H2's 100,000 items that is the N+1 the query-shape
 * guard exists for. Items in a deleted or archived project, closed items
 * (DONE or CANCELLED) and items with neither an ACTIVE assignee nor an
 * ACTIVE member they wait on are skipped; an inactive one of the two is
 * never reminded. A deleted workspace is never scanned.
 *
 * Idempotent: the dedupe key (`…:WORK_ITEM_DUE:{window}:{item}:{user}:{day}`)
 * absorbs a re-run and the usecases' post-commit reminder on the same day.
 *
 * Copied from inflect-compliance `src/app-layer/jobs/task-due-notification.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: renamed for work items, the
 * scan rewritten per workspace and paged (docs/porting/maps/2.1-2.2.md, risk
 * 7 and 9), date-only due dates.
 */
import { createWorkItemDueNotifications, todayInTz, type WorkItemDueTarget } from '../notifications/work-item-due';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { formatKey } from '../domain/work-item-key';
import { env } from '@/env';
import { runInTenantJobContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';

export const DUE_SCAN_PAGE = 500;

export interface WorkItemDueNotificationOptions {
    tenantId?: string;
    now?: Date;
    tz?: string;
}

export interface WorkItemDueNotificationResult {
    tenantsScanned: number;
    itemsScanned: number;
    notificationsCreated: number;
}

/** The live workspaces to scan: every one, or the one named. */
async function liveTenants(tenantId: string | undefined): Promise<Array<{ id: string; slug: string }>> {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, (db) =>
        db.tenant.findMany({
            where: { deletedAt: null, ...(tenantId ? { id: tenantId } : {}) },
            orderBy: { id: 'asc' },
            // A sweep over every workspace; bounded far above any deployment.
            take: 100_000,
            select: { id: true, slug: true },
        }),
    );
}

export async function processWorkItemDueNotifications(options: WorkItemDueNotificationOptions = {}): Promise<WorkItemDueNotificationResult> {
    return runJob('work-item-due-notification', async () => {
        const now = options.now ?? new Date();
        const tz = options.tz ?? ((env.NOTIFICATIONS_TZ as string | undefined) || 'UTC');
        const today = todayInTz(now, tz);
        const dueDates = [0, 1, 7].map((d) => new Date(today.getTime() + d * 86_400_000));
        const result: WorkItemDueNotificationResult = { tenantsScanned: 0, itemsScanned: 0, notificationsCreated: 0 };

        for (const tenant of await liveTenants(options.tenantId)) {
            result.tenantsScanned += 1;
            let after: { dueDate: Date; id: string } | null = null;
            for (;;) {
                // guardrail-allow: n+1 — one bounded page per pass, written with one createMany and one read-back.
                const page = await runInTenantJobContext({ tenantId: tenant.id, source: 'work-item-due-notification' }, async (db) => {
                    const rows = await WorkItemRepository.dueCandidates(db, tenant.id, dueDates, after, DUE_SCAN_PAGE);
                    const targets: WorkItemDueTarget[] = rows.map((r) => ({
                        id: r.id,
                        tenantId: tenant.id,
                        tenantSlug: tenant.slug,
                        title: r.title,
                        key: formatKey(r.project.keyPrefix, r.number),
                        dueDate: r.dueDate!,
                        // Only ACTIVE members are reminded; either may be absent (decision 137).
                        assigneeUserId: r.assignee?.status === 'ACTIVE' ? r.assigneeId : null,
                        waitingOnUserId: r.waitingOn?.status === 'ACTIVE' ? r.waitingOnUserId : null,
                    }));
                    const written = await createWorkItemDueNotifications(db, tenant.id, targets, now, tz);
                    return { rows, created: written.created };
                });
                result.itemsScanned += page.rows.length;
                result.notificationsCreated += page.created;
                const last = page.rows[page.rows.length - 1];
                if (page.rows.length < DUE_SCAN_PAGE || !last) break;
                after = { dueDate: last.dueDate!, id: last.id };
            }
        }
        logger.info('work-item due reminders sent', { component: 'jobs', ...result });
        return result;
    });
}
