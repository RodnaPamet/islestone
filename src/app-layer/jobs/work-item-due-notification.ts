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
 * Review steps (sub-phase 2.8a; owner decision 161): the same run reminds the
 * pending reviewers of every OPEN step of an OPEN round due today
 * (`today`), on the next working day (`next`, decision 151) or before today
 * (`overdue`, once), as `WORK_ITEM_REVIEW_DUE`: ACTIVE members whose role
 * sees the project, live items in live, unarchived projects, in pages of 500
 * keyed on the reviewer row, deduplicated per window, step and person
 * (`createReviewNotificationBatch`). From roadmap 3.1a (decision 192) "today"
 * and "the next working day" are the item's team's working calendar's, else
 * the workspace's, in that calendar's zone; the run still fires at 08:00 in
 * `NOTIFICATIONS_TZ` (decision 191).
 *
 * Copied from inflect-compliance `src/app-layer/jobs/task-due-notification.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: renamed for work items, the
 * scan rewritten per workspace and paged (docs/porting/maps/2.1-2.2.md, risk
 * 7 and 9), date-only due dates.
 */
import { createReviewNotificationBatch, type ReviewDueWindow, type ReviewNotice, type ReviewNotificationTarget } from '../notifications/review';
import { createWorkItemDueNotifications, dateOnlyKey, todayInTz, type WorkItemDueTarget } from '../notifications/work-item-due';
import { resolveProjectVisibility } from '../policies/project-visibility';
import { ReviewRepository } from '../repositories/ReviewRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { formatKey } from '../domain/work-item-key';
import { epochDayToDate, todayIn, workingDaysAfter } from '../domain/schedule/calendar';
import { resolveWorkingCalendars } from '../usecases/working-calendar';
import { tenantWorkItemPath } from '@/lib/work-item-paths';
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
    /** Pending reviewer rows of open steps scanned (2.8a). */
    reviewersScanned: number;
    reviewRemindersCreated: number;
}

/** The review window a step's due day is on today (decision 161), or null. */
export function reviewDueWindow(dueOn: Date, today: Date, nextDay: Date): ReviewDueWindow | null {
    const key = dateOnlyKey(dueOn);
    if (key === dateOnlyKey(today)) return 'today';
    if (key === dateOnlyKey(nextDay)) return 'next';
    if (key < dateOnlyKey(today)) return 'overdue';
    return null;
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
        const result: WorkItemDueNotificationResult = { tenantsScanned: 0, itemsScanned: 0, notificationsCreated: 0, reviewersScanned: 0, reviewRemindersCreated: 0 };

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
            // Review steps due (2.8a), on each item's working calendar (3.1a).
            const calendars = await runInTenantJobContext({ tenantId: tenant.id, source: 'work-item-due-notification' }, (db) =>
                resolveWorkingCalendars(db, { tenantId: tenant.id }),
            );
            const windows = new Map<string, { today: Date; next: Date }>();
            const windowOfCalendar = (cal: ReturnType<typeof calendars.forTeam>) => {
                let w = windows.get(cal.id);
                if (!w) {
                    // A workspace that never saved a calendar counts in the run's zone.
                    const day = todayIn(cal.saved ? cal.timeZone : tz, now);
                    w = { today: epochDayToDate(day), next: epochDayToDate(workingDaysAfter(cal.compiled, day, 1)) };
                    windows.set(cal.id, w);
                }
                return w;
            };
            const reviewBound = new Date(Math.max(...calendars.all().map((c) => windowOfCalendar(c).next.getTime())));
            let afterReviewer: string | null = null;
            for (;;) {
                // guardrail-allow: n+1 — one bounded page per pass, written with one createMany and one read-back.
                const page = await runInTenantJobContext({ tenantId: tenant.id, source: 'work-item-due-notification' }, async (db) => {
                    const rows = await ReviewRepository.dueReviewCandidates(db, tenant.id, reviewBound, afterReviewer, DUE_SCAN_PAGE);
                    const entries: Array<{ userId: string; target: ReviewNotificationTarget; notice: ReviewNotice }> = [];
                    for (const r of rows) {
                        const m = r.user.tenantMemberships[0];
                        if (!m || m.status !== 'ACTIVE' || !r.step.dueOn) continue;
                        const sees = resolveProjectVisibility({ role: m.customRole?.baseRole ?? m.role, membershipRole: m.role });
                        if (sees.kind !== 'ALL' && !sees.projectIds.includes(r.workItem.projectId)) continue;
                        const w = windowOfCalendar(calendars.forTeam(r.workItem.teamId));
                        const window = reviewDueWindow(r.step.dueOn, w.today, w.next);
                        if (!window) continue;
                        entries.push({
                            userId: r.userId,
                            target: {
                                tenantId: tenant.id,
                                workItemId: r.workItem.id,
                                workItemKey: formatKey(r.workItem.project.keyPrefix, r.workItem.number),
                                workItemTitle: r.workItem.title,
                                linkUrl: tenantWorkItemPath(tenant.slug, r.workItem.id),
                            },
                            notice: { kind: 'due', stepId: r.stepId, stepName: r.step.name, window },
                        });
                    }
                    const written = await createReviewNotificationBatch(db, tenant.id, 'WORK_ITEM_REVIEW_DUE', entries);
                    return { rows, created: written.created };
                });
                result.reviewersScanned += page.rows.length;
                result.reviewRemindersCreated += page.created;
                const last = page.rows[page.rows.length - 1];
                if (page.rows.length < DUE_SCAN_PAGE || !last) break;
                afterReviewer = last.id;
            }
        }
        logger.info('work-item due reminders sent', { component: 'jobs', ...result });
        return result;
    });
}
