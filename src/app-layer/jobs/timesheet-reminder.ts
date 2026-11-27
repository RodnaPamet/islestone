/**
 * Weekly job: the Monday reminder to submit last week (sub-phase 3.4c;
 * docs/porting/maps/3.4.md, "Jobs"; owner decision 276).
 *
 * The live workspaces with "Timesheets need approval" on are found under
 * `runWithoutRls({ reason: 'cross-tenant-sweep' })` (a soft-deleted
 * workspace is never visited: its memberships outlive it), and each is then
 * reminded INSIDE its own context, as its system user
 * (`remindWorkspaceToSubmit`). "Last week" is the week before the one holding
 * today in `NOTIFICATIONS_TZ`, through the clock seam.
 *
 * Written fresh for Islestone.
 */
import { buildTenantSystemJobContext } from '../context-system';
import { dayKeyInTz } from '../notifications/work-item-due';
import { remindWorkspaceToSubmit } from '../usecases/timesheet-reminder';
import { env } from '@/env';
import { todayClock } from '@/lib/clock';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';
import { addDays, weekStartOf } from '@/lib/time/week';

export interface TimesheetReminderOptions {
    tenantId?: string;
    now?: Date;
}

export interface TimesheetReminderResult {
    tenants: number;
    failedTenants: number;
    reminded: number;
    weekStart: string;
}

/** The workspaces visited, at most (a sweep bounded far above any deployment). */
const TENANT_SWEEP_TAKE = 100_000;

export async function processTimesheetReminder(options: TimesheetReminderOptions = {}): Promise<TimesheetReminderResult> {
    return runJob('timesheet-reminder', async () => {
        const zone = (env.NOTIFICATIONS_TZ as string | undefined) || 'UTC';
        const today = dayKeyInTz(todayClock(zone, options.now ?? new Date()), zone);
        const weekStart = addDays(weekStartOf(today), -7);
        const tenants = await runWithoutRls({ reason: 'cross-tenant-sweep' }, (db) =>
            db.tenantTimeSettings.findMany({
                where: { approvalRequired: true, tenant: { deletedAt: null }, ...(options.tenantId ? { tenantId: options.tenantId } : {}) },
                orderBy: { tenantId: 'asc' },
                take: TENANT_SWEEP_TAKE,
                select: { tenantId: true, tenant: { select: { slug: true } } },
            }),
        );
        const result: TimesheetReminderResult = { tenants: 0, failedTenants: 0, reminded: 0, weekStart };
        for (const t of tenants) {
            try {
                // guardrail-allow: n+1 — one workspace per pass, each in its own context.
                const ctx = await buildTenantSystemJobContext({ tenantId: t.tenantId, job: 'timesheet-reminder' });
                const r = await remindWorkspaceToSubmit(ctx, { tenantSlug: t.tenant.slug, weekStart });
                result.tenants += 1;
                result.reminded += r.reminded;
            } catch (err) {
                // One workspace's failure never stops the others; a retry is deduplicated.
                result.failedTenants += 1;
                logger.error('timesheet reminder failed for a workspace', {
                    component: 'jobs',
                    tenantId: t.tenantId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('timesheet reminders written', { component: 'jobs', ...result });
        return result;
    });
}
