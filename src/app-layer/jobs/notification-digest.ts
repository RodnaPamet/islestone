/**
 * Daily job: the notification digest (sub-phase 2.7c; owner decision 133).
 *
 * At 08:10 in `NOTIFICATIONS_TZ` (after the 08:00 due bells), for each LIVE
 * workspace (a soft-deleted one keeps its memberships, so the workspaces are
 * resolved here with `deletedAt: null`, `tests/guards/cross-tenant-recipient-liveness.test.ts`),
 * for each ACTIVE member whose preferences send something DAILY
 * (`resolveDelivery` under the workspace's ceiling): one `NOTIFICATION_DIGEST`
 * email with
 *
 *   - their open work items due soon (overdue, today, or within
 *     `DUE_SOON_DAYS`), assigned to them or waiting on them, when their
 *     `WORK_ITEM_DUE` email is DAILY; and
 *   - the unread notifications still in their Inbox, created in the last 24
 *     hours, of the other types they receive daily.
 *
 * It replaces 1.6's due digest (`DUE_DIGEST`, never written). Everything is
 * re-checked when the digest is built, never trusted from the row: the member
 * is ACTIVE; each item is live, in a live and unarchived project, and visible
 * to the member's role (`resolveProjectVisibility`: a GUEST sees none until
 * 8.4); an intake notification goes only to a member who still holds
 * `intake.view`; a notification whose item is gone is dropped. The email
 * carries titles, keys, due dates and the bell rows' stored copy, never a
 * description or a comment (they are encrypted at rest).
 *
 * Idempotent: `enqueueEmail` dedupes per workspace, type, address and day, so
 * a retry or a re-run the same day mails nobody twice. Members are read in
 * pages of `DIGEST_MEMBER_PAGE`, each page's notifications and items in one
 * read each, so the work per page is bounded and there is no read per member.
 *
 * Written fresh for Islestone.
 */
import type { NotificationType, Prisma } from '@prisma/client';

import { initiatorAuthority } from '../context-system';
import { DUE_SOON_DAYS } from '../domain/work-item-due';
import { formatKey } from '../domain/work-item-key';
import { enqueueEmail } from '../notifications/enqueue';
import { getTenantNotificationSettings } from '../notifications/settings';
import { dateOnlyKey, dayKeyInTz, todayInTz, MS_PER_DAY } from '../notifications/work-item-due';
import type { DigestDueGroup } from '../notifications/templates';
import { resolveProjectVisibility } from '../policies/project-visibility';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { env } from '@/env';
import { runInTenantJobContext, type PrismaTx } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { PREFERENCE_TYPES, resolveDelivery, type PreferenceCeiling, type PreferenceType } from '@/lib/notifications/preferences';
import { logger } from '@/lib/observability/logger';
import { runJob } from '@/lib/observability/job-runner';
import { tenantWorkItemPath } from '@/lib/work-item-paths';

/** Members per page. */
export const DIGEST_MEMBER_PAGE = 200;
/** Lines per section of one digest; the rest are counted ("and N more"). */
export const DIGEST_SECTION_CAP = 50;
/** The window of notifications a digest covers. */
export const DIGEST_WINDOW_MS = MS_PER_DAY;
/** A sweep over every workspace; bounded far above any deployment. */
const TENANT_SWEEP_TAKE = 100_000;

/** The notification types whose bell rows are about a work item. */
const WORK_ITEM_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(['WORK_ITEM_ASSIGNED', 'WORK_ITEM_WAITING_ON', 'WORK_ITEM_WATCH_UPDATE', 'WORK_ITEM_DUE']);
/** The intake types, read only by a member who holds `intake.view`. */
const INTAKE_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>(['INTAKE_REQUEST_RECEIVED', 'INTAKE_REQUEST_WOKEN']);

export interface NotificationDigestOptions {
    tenantId?: string;
    now?: Date;
    tz?: string;
}

export interface NotificationDigestResult {
    tenantsScanned: number;
    failedTenants: number;
    membersScanned: number;
    digestsEnqueued: number;
}

/** The live workspaces: every one, or the one named. A soft-deleted workspace is never visited. */
async function liveTenants(tenantId: string | undefined): Promise<Array<{ id: string; slug: string }>> {
    return runWithoutRls({ reason: 'cross-tenant-sweep' }, (db) =>
        db.tenant.findMany({
            where: { deletedAt: null, ...(tenantId ? { id: tenantId } : {}) },
            orderBy: { id: 'asc' },
            take: TENANT_SWEEP_TAKE,
            select: { id: true, slug: true },
        }),
    );
}

/** One page of ACTIVE members, with what the digest needs to resolve and address them. */
async function memberPage(db: PrismaTx, tenantId: string, afterUserId: string | null) {
    return db.tenantMembership.findMany({
        where: { tenantId, status: 'ACTIVE', ...(afterUserId ? { userId: { gt: afterUserId } } : {}) },
        orderBy: { userId: 'asc' },
        take: DIGEST_MEMBER_PAGE,
        select: {
            userId: true,
            role: true,
            customRole: { select: { baseRole: true, grantsJson: true } },
            user: { select: { name: true, email: true } },
        },
    });
}

/** When a due date falls, from today: overdue, today, or soon. */
export function dueGroup(dueDate: Date, today: Date): DigestDueGroup {
    const days = Math.round((Date.parse(`${dateOnlyKey(dueDate)}T00:00:00Z`) - today.getTime()) / MS_PER_DAY);
    if (days < 0) return 'OVERDUE';
    if (days === 0) return 'TODAY';
    return 'SOON';
}

interface MemberPlan {
    userId: string;
    name: string;
    email: string;
    dueDaily: boolean;
    rowTypes: ReadonlySet<NotificationType>;
    visibility: ReturnType<typeof resolveProjectVisibility>;
    intakeView: boolean;
}

function canSeeProject(plan: MemberPlan, projectId: string): boolean {
    return plan.visibility.kind === 'ALL' || plan.visibility.projectIds.includes(projectId);
}

/** Build and enqueue one page's digests, inside the workspace's context. */
async function digestPage(
    db: PrismaTx,
    tenant: { id: string; slug: string },
    members: Awaited<ReturnType<typeof memberPage>>,
    ceiling: PreferenceCeiling,
    clock: { now: Date; today: Date; dayKey: string },
): Promise<number> {
    const ids = members.map((m) => m.userId);
    const prefs = await db.notificationPreference.findMany({
        where: { tenantId: tenant.id, userId: { in: ids } },
        take: ids.length * PREFERENCE_TYPES.length,
        select: { userId: true, type: true, inApp: true, emailDelivery: true },
    });
    const stored = new Map(prefs.map((p) => [`${p.userId}:${p.type}`, p]));

    const plans: MemberPlan[] = [];
    for (const m of members) {
        if (!m.user.email) continue;
        const daily = PREFERENCE_TYPES.filter(
            (type: PreferenceType) => resolveDelivery(type, stored.get(`${m.userId}:${type}`) ?? null, ceiling).email === 'DAILY',
        );
        if (daily.length === 0) continue;
        const authority = initiatorAuthority(m);
        plans.push({
            userId: m.userId,
            name: m.user.name || m.user.email,
            email: m.user.email,
            dueDaily: daily.includes('WORK_ITEM_DUE'),
            // The due section replaces the due bells: they are never listed twice.
            rowTypes: new Set(daily.filter((t) => t !== 'WORK_ITEM_DUE')),
            visibility: resolveProjectVisibility({ role: authority.role, membershipRole: m.role }),
            intakeView: authority.appPermissions.intake?.view === true,
        });
    }
    if (plans.length === 0) return 0;

    const rowUsers = plans.filter((p) => p.rowTypes.size > 0).map((p) => p.userId);
    const rowTypes = [...new Set(plans.flatMap((p) => [...p.rowTypes]))];
    const rows =
        rowUsers.length === 0
            ? []
            : await db.notification.findMany({
                  where: {
                      tenantId: tenant.id,
                      userId: { in: rowUsers },
                      read: false,
                      archivedAt: null,
                      type: { in: rowTypes },
                      createdAt: { gte: new Date(clock.now.getTime() - DIGEST_WINDOW_MS), lt: clock.now },
                  } satisfies Prisma.NotificationWhereInput,
                  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                  take: rowUsers.length * (DIGEST_SECTION_CAP + 1),
                  select: { userId: true, type: true, title: true, body: true, linkUrl: true, workItemId: true },
              });
    const rowItems = new Map(
        (await WorkItemRepository.liveForDigest(db, tenant.id, [...new Set(rows.map((r) => r.workItemId).filter((x): x is string => !!x))])).map((i) => [i.id, i.projectId]),
    );

    const dueUsers = plans.filter((p) => p.dueDaily).map((p) => p.userId);
    const dueOnOrBefore = new Date(clock.today.getTime() + DUE_SOON_DAYS * MS_PER_DAY);
    const dueItems = await WorkItemRepository.digestDueItems(db, tenant.id, dueUsers, dueOnOrBefore, dueUsers.length * (DIGEST_SECTION_CAP + 1));

    let enqueued = 0;
    for (const plan of plans) {
        const notifications = rows.filter((r) => {
            if (r.userId !== plan.userId || !plan.rowTypes.has(r.type)) return false;
            if (WORK_ITEM_TYPES.has(r.type)) {
                const projectId = r.workItemId ? rowItems.get(r.workItemId) : undefined;
                return projectId !== undefined && canSeeProject(plan, projectId);
            }
            if (INTAKE_TYPES.has(r.type)) return plan.intakeView;
            return false;
        });
        const due = plan.dueDaily
            ? dueItems.filter((i) => (i.assigneeId === plan.userId || i.waitingOnUserId === plan.userId) && canSeeProject(plan, i.projectId))
            : [];
        if (notifications.length === 0 && due.length === 0) continue;

        // guardrail-allow: n+1 — one outbox insert per member with a digest (deduplicated per address and day).
        const written = await enqueueEmail(db, {
            tenantId: tenant.id,
            type: 'NOTIFICATION_DIGEST',
            toEmail: plan.email,
            entityId: `digest:${clock.dayKey}`,
            payload: {
                recipientName: plan.name,
                tenantSlug: tenant.slug,
                due: due.slice(0, DIGEST_SECTION_CAP).map((i) => ({
                    key: formatKey(i.project.keyPrefix, i.number),
                    title: i.title,
                    dueDate: dateOnlyKey(i.dueDate!),
                    group: dueGroup(i.dueDate!, clock.today),
                    waitingOnYou: i.waitingOnUserId === plan.userId && i.assigneeId !== plan.userId,
                    linkPath: tenantWorkItemPath(tenant.slug, i.id),
                })),
                moreDue: Math.max(0, due.length - DIGEST_SECTION_CAP),
                notifications: notifications.slice(0, DIGEST_SECTION_CAP).map((n) => ({ title: n.title, body: n.body, linkPath: n.linkUrl })),
                moreNotifications: Math.max(0, notifications.length - DIGEST_SECTION_CAP),
            },
        });
        if (written) enqueued += 1;
    }
    return enqueued;
}

export async function processNotificationDigest(options: NotificationDigestOptions = {}): Promise<NotificationDigestResult> {
    return runJob('notification-digest', async () => {
        const now = options.now ?? new Date();
        const tz = options.tz ?? ((env.NOTIFICATIONS_TZ as string | undefined) || 'UTC');
        const clock = { now, today: todayInTz(now, tz), dayKey: dayKeyInTz(now, tz) };
        const result: NotificationDigestResult = { tenantsScanned: 0, failedTenants: 0, membersScanned: 0, digestsEnqueued: 0 };

        for (const tenant of await liveTenants(options.tenantId)) {
            try {
                let after: string | null = null;
                for (;;) {
                    // guardrail-allow: n+1 — one bounded page of members per pass, its reads batched.
                    const page = await runInTenantJobContext({ tenantId: tenant.id, source: 'notification-digest' }, async (db) => {
                        const settings = await getTenantNotificationSettings(db, tenant.id);
                        // Email switched off for the workspace: nobody is mailed, nothing is read.
                        if (!settings.enabled) return { count: 0, enqueued: 0, last: null };
                        const members = await memberPage(db, tenant.id, after);
                        const enqueued = await digestPage(
                            db,
                            tenant,
                            members,
                            { emailEnabled: settings.enabled, mutedInAppTypes: settings.mutedInAppTypes },
                            clock,
                        );
                        return { count: members.length, enqueued, last: members[members.length - 1]?.userId ?? null };
                    });
                    result.membersScanned += page.count;
                    result.digestsEnqueued += page.enqueued;
                    if (page.count < DIGEST_MEMBER_PAGE || !page.last) break;
                    after = page.last;
                }
                result.tenantsScanned += 1;
            } catch (err) {
                // One workspace's failure never stops the others; a retry is deduplicated.
                result.failedTenants += 1;
                logger.error('notification digest failed for a workspace', {
                    component: 'jobs',
                    tenantId: tenant.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        logger.info('notification digests enqueued', { component: 'jobs', ...result, day: clock.dayKey });
        return result;
    });
}
