/**
 * Queueing calendar sync runs and teardowns (roadmap 3.3b; decision 233:
 * Islestone's changes reach a member's calendar within about a minute).
 *
 * `enqueueCalendarSync` runs AFTER a commit that changes what a person's
 * calendar should show (an item's due date, title, project, assignee, state
 * category, deletion; a milestone's name, due date or deletion; a project's
 * archive or deletion). It names the members whose calendars may change when
 * the caller knows them (an item's assignee before and after), else the whole
 * workspace. It never throws and never touches Redis when sync is closed, the
 * named people are nobody, or no named member has a connection: the only cost
 * on a write path is one read, and none for an unassigned item.
 *
 * Job ids are colon-free and bucketed (a minute for a run, 15 minutes for a
 * teardown), so a burst of writes queues one run per connection.
 *
 * Written fresh for Islestone.
 */
import { CalendarSyncRepository } from '../repositories/CalendarSyncRepository';
import type { RequestContext } from '../types';
import { isCalendarSyncOpen } from '@/lib/calendar-sync/switch';
import { runInTenantReadContext } from '@/lib/db-context';
import { logger } from '@/lib/observability/logger';

/** At most this many connections are queued by one workspace-wide change; the dispatcher covers the rest within 15 minutes. */
export const WORKSPACE_ENQUEUE_CAP = 500;

export function syncJobId(connectionId: string, now: number = Date.now()): string {
    return `calendar-sync-${connectionId}-${Math.floor(now / 60_000)}`;
}

export function teardownJobId(connectionId: string, now: number = Date.now()): string {
    return `calendar-teardown-${connectionId}-${Math.floor(now / 900_000)}`;
}

export async function enqueueConnectionSync(tenantId: string, connectionIds: readonly string[], now: number = Date.now()): Promise<void> {
    if (connectionIds.length === 0) return;
    try {
        const { enqueue } = await import('../jobs/queue');
        for (const connectionId of connectionIds) {
            await enqueue('calendar-sync-connection', { tenantId, connectionId }, { jobId: syncJobId(connectionId, now) });
        }
    } catch (err) {
        // Never fails the caller's committed write: the dispatcher queues it again within 15 minutes.
        logger.warn('a calendar job could not be queued; the dispatcher will queue it', { component: 'calendar-sync', job: 'calendar-sync-connection', err: err instanceof Error ? err : new Error(String(err)) });
    }
}

export async function enqueueTeardowns(tenantId: string, connectionIds: readonly string[], now: number = Date.now()): Promise<void> {
    if (connectionIds.length === 0) return;
    try {
        const { enqueue } = await import('../jobs/queue');
        for (const connectionId of connectionIds) {
            await enqueue('calendar-teardown', { tenantId, connectionId }, { jobId: teardownJobId(connectionId, now) });
        }
    } catch (err) {
        // Never fails the caller's committed write: the dispatcher queues it again within 15 minutes.
        logger.warn('a calendar job could not be queued; the dispatcher will queue it', { component: 'calendar-sync', job: 'calendar-teardown', err: err instanceof Error ? err : new Error(String(err)) });
    }
}

/**
 * Queue a run for the CONNECTED connections of `userIds` (null: of every
 * member of the workspace, at most `WORKSPACE_ENQUEUE_CAP`). Failures are
 * logged, never thrown: the dispatcher's next quarter hour catches up.
 */
export async function enqueueCalendarSync(ctx: RequestContext, scope: { userIds: ReadonlyArray<string | null | undefined> } | 'workspace'): Promise<void> {
    if (!isCalendarSyncOpen()) return;
    try {
        const userIds = scope === 'workspace' ? null : [...new Set(scope.userIds.filter((u): u is string => typeof u === 'string' && u.length > 0))];
        if (userIds && userIds.length === 0) return;
        const rows = await runInTenantReadContext(ctx, (db) =>
            userIds ? CalendarSyncRepository.connectedOfUsers(db, ctx, userIds) : CalendarSyncRepository.connectionIdsInState(db, ctx, ['CONNECTED'], WORKSPACE_ENQUEUE_CAP),
        );
        await enqueueConnectionSync(ctx.tenantId, rows.map((r) => r.id));
    } catch (err) {
        logger.warn('calendar sync could not be queued after a change; the dispatcher will catch up', {
            component: 'calendar-sync',
            err: err instanceof Error ? err : new Error(String(err)),
        });
    }
}

/** Queue a run for the connections of the named items' assignees (a change to those items). Never throws. */
export async function enqueueCalendarSyncForItems(ctx: RequestContext, workItemIds: readonly string[]): Promise<void> {
    if (!isCalendarSyncOpen() || workItemIds.length === 0) return;
    try {
        const rows = await runInTenantReadContext(ctx, (db) => CalendarSyncRepository.connectedOfAssignees(db, ctx, workItemIds.slice(0, WORKSPACE_ENQUEUE_CAP)));
        await enqueueConnectionSync(ctx.tenantId, rows.map((r) => r.id));
    } catch (err) {
        logger.warn('calendar sync could not be queued after a change; the dispatcher will catch up', {
            component: 'calendar-sync',
            err: err instanceof Error ? err : new Error(String(err)),
        });
    }
}
