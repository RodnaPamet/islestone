/**
 * One connection's run, the teardown and the dispatcher (roadmap 3.3b; ADR
 * 0011 §1 to §3 and §8; docs/porting/maps/3.3.md, "The push", "Disconnecting
 * and teardown" and "Jobs"; owner decisions 226 to 229, 233 and 239).
 *
 * THE RUN. The member is re-resolved when it runs (`resolveMemberContext`; a
 * member who left or is no longer active gets the teardown, never a system
 * context), and one function, `generateDesiredEvents`, produces what their
 * calendar should hold under THEIR permissions: their open items assigned to
 * them due from 30 days ago to a year ahead (at most 1,000), and the dated
 * milestones in the same window of the live, visible, unarchived projects
 * where they have an open assigned item (at most 200), each carrying exactly a
 * title, a due date and one absolute `appLink` (decision 229). The pure diff
 * (`reconcileSyncedEvents`) is applied through the provider's writer.
 *
 * THE ORDER OF WRITES. An insert is recorded BEFORE it is sent (no remote id),
 * then confirmed; so a crash after the provider created the event leaves a row
 * that the next run looks up and adopts, never a second event. A remote delete
 * that fails keeps its row (PENDING_DELETE) for the next run. A failure of the
 * CONNECTION (a refused token, a throttle) stops the run: a refusal is terminal
 * (REVOKED, the token destroyed, audited once as the system user, no retry), a
 * throttle is not.
 *
 * THE TEARDOWN (decision 239): every recorded event deleted remotely first,
 * then the Islestone calendar only if it is empty, then the token destroyed
 * with the connection, after its rows. A token the provider refuses cannot
 * delete anything: the teardown then finishes locally, and the member's copy
 * tells them to remove the Islestone calendar themselves. It writes nothing
 * else in Islestone and never calls Google's revoke endpoint (decision 236).
 *
 * Adapted from inflect-compliance `calendar-reconcile-sweep.ts`,
 * `calendar-consent-health.ts`, `calendar-push-generate.ts` and
 * `jobs/calendar-push.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e
 * (BUSL-1.1): real writers instead of interfaces nothing implemented, one run
 * per connection, rows keyed by item or milestone, and the teardown.
 */
import type { CalendarProvider } from '@prisma/client';

import { NonRetryableJobError } from '../jobs/non-retryable';
import { buildTenantSystemJobContext, resolveMemberContext } from '../context-system';
import { reconcileSyncedEvents, teardownActions, type DesiredSyncedEvent, type RecordedSyncedEvent, type SyncAction } from '../domain/calendar-sync';
import { formatKey } from '../domain/work-item-key';
import { logEvent } from '../events/audit';
import { IntegrationAuthError, IntegrationRateLimitedError } from '../integrations/http-errors';
import { parseCalendarToken, resolveCalendarAccessToken, type CalendarToken } from '../integrations/providers/calendar/token';
import { googleWriter, graphWriter, type CalendarWriter } from '../integrations/providers/calendar/writer';
import { appLink } from '../notifications/app-link';
import { mayConnectCalendar } from '../policies/calendar-sync.policies';
import { visibleProjects } from '../policies/project-visibility';
import { CalendarSyncRepository, type SyncedEventRow } from '../repositories/CalendarSyncRepository';
import { MilestoneRepository } from '../repositories/MilestoneRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import type { RequestContext } from '../types';
import { enqueueConnectionSync, enqueueTeardowns } from './calendar-sync-enqueue';
import { microsoftConsentGranted } from './calendar-sync-settings';
import { isCalendarSyncOpen, isProviderConfigured } from '@/lib/calendar-sync/switch';
import { CALENDAR_SYNC_FUTURE_DAYS, CALENDAR_SYNC_ITEM_LIMIT, CALENDAR_SYNC_MILESTONE_LIMIT, CALENDAR_SYNC_PAST_DAYS } from '@/lib/calendar-sync/types';
import { runInTenantContext, runInTenantReadContext } from '@/lib/db-context';
import { runWithoutRls } from '@/lib/db/rls-middleware';
import { hasPermission } from '@/lib/security/permission-key';
import { recordCalendarSyncOutcome, type CalendarSyncOutcome } from '@/lib/observability/business-metrics';
import { logger } from '@/lib/observability/logger';
import { env } from '@/env';
import { todayClock } from '@/lib/clock';
import { todayInTz } from '../notifications/work-item-due';

const DAY_MS = 86_400_000;
/** The most connections one quarter hour's dispatch queues (the map's bound). */
export const DISPATCH_CAP = 5_000;
/** The most projects whose milestones one member's calendar reads. */
const PROJECTS_TAKE = 1_000;

/** The push window (decision 226): from 30 days ago to a year ahead, today in `NOTIFICATIONS_TZ`, date-only. */
export function syncWindow(now: Date = new Date()): { from: Date; to: Date } {
    const today = todayInTz(todayClock(env.NOTIFICATIONS_TZ, now), env.NOTIFICATIONS_TZ);
    return { from: new Date(today.getTime() - CALENDAR_SYNC_PAST_DAYS * DAY_MS), to: new Date(today.getTime() + CALENDAR_SYNC_FUTURE_DAYS * DAY_MS) };
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What the member's calendar should hold, under their own permissions: the
 * one generation path (no second query decides what leaves Islestone). A
 * member without `work_items.view` gets nothing; one without `projects.view`
 * gets no milestones.
 */
export async function generateDesiredEvents(member: RequestContext, slug: string, now: Date = new Date()): Promise<{ events: DesiredSyncedEvent[]; itemsInWindow: number }> {
    if (!mayConnectCalendar(member)) return { events: [], itemsInWindow: 0 };
    const v = await visibleProjects(member);
    const window = syncWindow(now);
    return runInTenantReadContext(member, async (db) => {
        const items = await WorkItemRepository.listAssignedForCalendarSync(db, member, v, member.userId, { ...window, take: CALENDAR_SYNC_ITEM_LIMIT + 1 });
        const itemsInWindow = items.length > CALENDAR_SYNC_ITEM_LIMIT ? await WorkItemRepository.countAssignedForCalendarSync(db, member, v, member.userId, window) : items.length;
        const events: DesiredSyncedEvent[] = items.slice(0, CALENDAR_SYNC_ITEM_LIMIT).map((i) => ({
            kind: 'WORK_ITEM',
            sourceId: i.id,
            title: i.title,
            dueDate: dayOf(i.dueDate!),
            link: appLink(`/t/${slug}/work-items/${formatKey(i.project.keyPrefix, i.number)}`),
        }));
        if (hasPermission(member.appPermissions, 'projects.view')) {
            const projectIds = await WorkItemRepository.projectsWithOpenAssigned(db, member, v, member.userId, PROJECTS_TAKE);
            const milestones = await MilestoneRepository.datedInWindow(db, member, projectIds, window.from, window.to, CALENDAR_SYNC_MILESTONE_LIMIT);
            const keys = await CalendarSyncRepository.projectKeys(db, member, [...new Set(milestones.map((m) => m.projectId))]);
            for (const m of milestones) {
                const key = keys.get(m.projectId);
                if (!key || !m.dueDate) continue;
                events.push({ kind: 'MILESTONE', sourceId: m.id, title: m.name, dueDate: dayOf(m.dueDate), link: appLink(`/t/${slug}/projects/${key}/milestones/${m.id}`) });
            }
        }
        return { events, itemsInWindow };
    });
}

function recorded(rows: readonly SyncedEventRow[]): RecordedSyncedEvent[] {
    return rows.map((r) => ({
        kind: r.kind,
        sourceId: (r.kind === 'WORK_ITEM' ? r.workItemId : r.milestoneId) ?? '',
        remoteEventId: r.remoteEventId,
        contentHash: r.contentHash,
        pushedDueDate: dayOf(r.pushedDueDate),
        state: r.state,
    }));
}

export function writerFor(provider: CalendarProvider, accessToken: string): CalendarWriter {
    return provider === 'GOOGLE' ? googleWriter(accessToken) : graphWriter(accessToken);
}

function isConnectionLevel(err: unknown): boolean {
    return err instanceof IntegrationAuthError || err instanceof IntegrationRateLimitedError;
}

export interface ApplyCounts {
    inserted: number;
    patched: number;
    deleted: number;
    pushFailures: number;
    deleteFailures: number;
}

/**
 * Apply the diff's actions one at a time. One event's failure is recorded on
 * its row and the rest go on; a connection's failure propagates.
 */
export async function applySyncActions(
    sys: RequestContext,
    connection: { id: string; calendarId: string },
    writer: CalendarWriter,
    actions: readonly SyncAction[],
): Promise<ApplyCounts> {
    const counts: ApplyCounts = { inserted: 0, patched: 0, deleted: 0, pushFailures: 0, deleteFailures: 0 };
    const at = (kind: 'WORK_ITEM' | 'MILESTONE', sourceId: string) => ({ connectionId: connection.id, kind, sourceId });
    for (const action of actions) {
        try {
            if (action.kind === 'insert') {
                const where = at(action.event.kind, action.event.sourceId);
                const pushedDueDate = new Date(`${action.event.dueDate}T00:00:00.000Z`);
                // guardrail-allow: n+1 — one row per pushed event, written around its own provider call (bounded by the run's 1,200 events).
                await runInTenantContext(sys, (db) =>
                    CalendarSyncRepository.recordUnconfirmed(db, sys, { ...where, clientEventId: action.clientEventId, pushedDueDate, contentHash: action.contentHash }),
                );
                let remote: { remoteEventId: string; remoteVersion: string | null } | null = null;
                if (action.lookupFirst) {
                    const found = await writer.find(connection.calendarId, action.clientEventId);
                    if (found) {
                        const patched = await writer.patch(connection.calendarId, found.remoteEventId, action.clientEventId, action.event, { restore: found.cancelled });
                        if (patched !== 'gone') remote = { remoteEventId: found.remoteEventId, remoteVersion: patched.remoteVersion };
                    }
                }
                remote ??= await writer.insert(connection.calendarId, action.clientEventId, action.event);
                // Confirmed at once: every step between the provider's write and this one widens the window a crash leaves unconfirmed.
                await runInTenantContext(sys, (db) =>
                    CalendarSyncRepository.markPushed(db, sys, where, { ...remote!, pushedDueDate, contentHash: action.contentHash, at: new Date() }),
                );
                counts.inserted += 1;
            } else if (action.kind === 'patch') {
                const where = at(action.event.kind, action.event.sourceId);
                const pushedDueDate = new Date(`${action.event.dueDate}T00:00:00.000Z`);
                const patched = await writer.patch(connection.calendarId, action.remoteEventId, action.clientEventId, action.event);
                const remote = patched === 'gone' ? await writer.insert(connection.calendarId, action.clientEventId, action.event) : { remoteEventId: action.remoteEventId, remoteVersion: patched.remoteVersion };
                await runInTenantContext(sys, (db) => CalendarSyncRepository.markPushed(db, sys, where, { ...remote, pushedDueDate, contentHash: action.contentHash, at: new Date() }));
                counts.patched += 1;
            } else {
                const where = at(action.sourceKind, action.sourceId);
                let remoteEventId = action.remoteEventId;
                if (!remoteEventId) remoteEventId = (await writer.find(connection.calendarId, action.clientEventId))?.remoteEventId ?? '';
                if (remoteEventId) await writer.remove(connection.calendarId, remoteEventId);
                // ONLY NOW: the row is the one record that the event existed.
                await runInTenantContext(sys, (db) => CalendarSyncRepository.drop(db, sys, where));
                counts.deleted += 1;
            }
        } catch (err) {
            if (isConnectionLevel(err)) throw err;
            if (action.kind === 'delete') {
                await runInTenantContext(sys, (db) => CalendarSyncRepository.markState(db, sys, at(action.sourceKind, action.sourceId), 'PENDING_DELETE', 'PROVIDER_ERROR'));
                counts.deleteFailures += 1;
            } else {
                await runInTenantContext(sys, (db) => CalendarSyncRepository.markState(db, sys, at(action.event.kind, action.event.sourceId), 'FAILED', 'PROVIDER_ERROR'));
                counts.pushFailures += 1;
            }
            logger.warn('a calendar event could not be written', {
                component: 'calendar-sync',
                tenantId: sys.tenantId,
                action: action.kind,
                status: (err as { status?: unknown })?.status ?? null,
            });
        }
    }
    return counts;
}

/** Record a refused token: REVOKED, the token destroyed, audited once as the system user. */
async function markRevoked(sys: RequestContext, connection: { id: string; provider: CalendarProvider }, err: IntegrationAuthError): Promise<void> {
    const reason = err.status === 400 ? 'GRANT_INVALID' : 'ACCESS_WITHDRAWN';
    await runInTenantContext(sys, async (db) => {
        const changed = await CalendarSyncRepository.markRevoked(db, sys, connection.id, reason);
        if (changed === 0) return;
        await CalendarSyncRepository.markAllPendingDelete(db, sys, connection.id);
        await logEvent(db, sys, {
            action: 'CALENDAR_CONNECTION_REVOKED',
            entityType: 'CalendarConnection',
            entityId: connection.id,
            details: 'The calendar provider refused the connection; its token was destroyed',
            detailsJson: { category: 'status_change', entityName: 'CalendarConnection', fromStatus: 'CONNECTED', toStatus: 'REVOKED', reason },
            metadata: { provider: connection.provider, httpStatus: err.status },
        });
    });
}

export interface CalendarSyncResult {
    outcome: CalendarSyncOutcome;
    counts?: ApplyCounts;
    itemsInWindow?: number;
}

/** Move a connection to DISCONNECTING and queue its teardown (a member gone, the switch off, the consent withdrawn). */
async function startTeardown(sys: RequestContext, connectionId: string): Promise<void> {
    await runInTenantContext(sys, (db) => CalendarSyncRepository.markDisconnecting(db, sys, [connectionId]));
    await enqueueTeardowns(sys.tenantId, [connectionId]);
}

/** One connection's run (`calendar-sync-connection`). */
export async function runCalendarSync(input: { tenantId: string; connectionId: string }, opts: { now?: Date } = {}): Promise<CalendarSyncResult> {
    if (!isCalendarSyncOpen()) return { outcome: 'nothing' };
    const now = opts.now ?? new Date();
    const sys = await buildTenantSystemJobContext({ tenantId: input.tenantId, job: 'calendar-sync-connection' });
    const state = await runInTenantReadContext(sys, async (db) => {
        const [connection, settings, tenant] = await Promise.all([
            CalendarSyncRepository.connection(db, sys, input.connectionId),
            CalendarSyncRepository.settings(db, sys),
            db.tenant.findUnique({ where: { id: input.tenantId }, select: { slug: true, deletedAt: true } }),
        ]);
        return { connection, settings, tenant };
    });
    const connection = state.connection;
    if (!connection || connection.state !== 'CONNECTED' || !state.tenant || state.tenant.deletedAt) return { outcome: 'nothing' };

    // The workspace's switch, the provider's app and Microsoft's consent: any
    // one gone, and the connection is torn down.
    const allowed = (state.settings?.syncEnabled ?? false)
        && isProviderConfigured(connection.provider)
        && (connection.provider === 'GOOGLE' || microsoftConsentGranted(state.settings));
    const member = allowed ? await resolveMemberContext({ tenantId: input.tenantId, userId: connection.userId, job: 'calendar-sync-connection', discriminator: connection.id }) : null;
    if (!member) {
        // A member who left or is no longer active, or sync no longer allowed:
        // the teardown, never a run under a system context.
        await startTeardown(sys, connection.id);
        return { outcome: 'nothing' };
    }

    const token = parseCalendarToken(await runInTenantReadContext(sys, (db) => CalendarSyncRepository.tokenOf(db, sys, connection.id)));
    if (!token || !connection.externalCalendarId) {
        recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'failed' });
        return { outcome: 'failed' };
    }

    try {
        const accessToken = await resolveCalendarAccessToken(token, {
            provider: connection.provider,
            microsoftDirectoryId: state.settings?.microsoftExternalTenantId ?? null,
            now: now.getTime(),
            persist: (rotated: CalendarToken) => runInTenantContext(sys, (db) => CalendarSyncRepository.setToken(db, sys, connection.id, JSON.stringify(rotated))).then(() => undefined),
        });
        const generated = await generateDesiredEvents({ ...member, actorType: 'JOB' }, state.tenant.slug, now);
        const rows = await runInTenantReadContext(sys, (db) => CalendarSyncRepository.syncedEvents(db, sys, connection.id));
        const actions = reconcileSyncedEvents({ identity: { tenantId: input.tenantId, connectionId: connection.id }, desired: generated.events, existing: recorded(rows) });
        const counts = await applySyncActions(sys, { id: connection.id, calendarId: connection.externalCalendarId }, writerFor(connection.provider, accessToken), actions);
        await runInTenantContext(sys, (db) => CalendarSyncRepository.touchSynced(db, sys, connection.id, now));
        const outcome: CalendarSyncOutcome = counts.pushFailures + counts.deleteFailures > 0 ? 'failed' : actions.length > 0 ? 'pushed' : 'nothing';
        recordCalendarSyncOutcome({ provider: connection.provider, outcome });
        return { outcome, counts, itemsInWindow: generated.itemsInWindow };
    } catch (err) {
        if (err instanceof IntegrationAuthError) {
            await markRevoked(sys, connection, err);
            recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'revoked' });
            logger.warn('calendar connection revoked by the provider; it will not run again until reconnected', { component: 'calendar-sync', tenantId: input.tenantId, provider: connection.provider, httpStatus: err.status });
            throw new NonRetryableJobError('The calendar provider refused the connection.', 'terminal');
        }
        if (err instanceof IntegrationRateLimitedError) {
            recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'throttled' });
            logger.warn('calendar sync throttled by the provider', { component: 'calendar-sync', tenantId: input.tenantId, provider: connection.provider });
            return { outcome: 'throttled' };
        }
        recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'failed' });
        throw err;
    }
}

/** A connection's teardown (`calendar-teardown`, decision 239). */
export async function runCalendarTeardown(input: { tenantId: string; connectionId: string }, opts: { now?: Date } = {}): Promise<{ outcome: 'torn_down' | 'pending' | 'nothing'; deleted: number; remaining: number }> {
    const now = opts.now ?? new Date();
    const sys = await buildTenantSystemJobContext({ tenantId: input.tenantId, job: 'calendar-teardown' });
    const state = await runInTenantReadContext(sys, async (db) => {
        const [connection, settings, token] = await Promise.all([
            CalendarSyncRepository.connection(db, sys, input.connectionId),
            CalendarSyncRepository.settings(db, sys),
            CalendarSyncRepository.tokenOf(db, sys, input.connectionId),
        ]);
        return { connection, settings, token: parseCalendarToken(token) };
    });
    const connection = state.connection;
    if (!connection || connection.state !== 'DISCONNECTING') return { outcome: 'nothing', deleted: 0, remaining: 0 };
    const rows = await runInTenantReadContext(sys, (db) => CalendarSyncRepository.syncedEvents(db, sys, connection.id));

    let deleted = 0;
    let reachable = Boolean(state.token && connection.externalCalendarId && isProviderConfigured(connection.provider));
    if (reachable) {
        try {
            const accessToken = await resolveCalendarAccessToken(state.token!, {
                provider: connection.provider,
                microsoftDirectoryId: state.settings?.microsoftExternalTenantId ?? null,
                now: now.getTime(),
                persist: (rotated) => runInTenantContext(sys, (db) => CalendarSyncRepository.setToken(db, sys, connection.id, JSON.stringify(rotated), true)).then(() => undefined),
            });
            const writer = writerFor(connection.provider, accessToken);
            const counts = await applySyncActions(sys, { id: connection.id, calendarId: connection.externalCalendarId! }, writer, teardownActions({ tenantId: input.tenantId, connectionId: connection.id }, recorded(rows)));
            deleted = counts.deleted;
            if (counts.deleteFailures > 0) {
                // Rows kept (PENDING_DELETE); the queue, then the dispatcher, try again.
                recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'failed' });
                throw new Error(`${counts.deleteFailures} calendar event(s) could not be removed yet.`);
            }
            await writer.deleteCalendarIfEmpty(connection.externalCalendarId!);
        } catch (err) {
            if (err instanceof IntegrationRateLimitedError) {
                recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'throttled' });
                return { outcome: 'pending', deleted, remaining: rows.length - deleted };
            }
            if (!(err instanceof IntegrationAuthError)) throw err;
            // The provider refused the token: nothing more can be removed remotely.
            reachable = false;
        }
    }
    // Then the token, with the connection, after its rows (the key refuses the reverse).
    const remaining = await runInTenantContext(sys, async (db) => {
        // The rows nothing can reach any more (a refused token): their events stay in the member's calendar.
        const left = await CalendarSyncRepository.dropAll(db, sys, connection.id);
        await CalendarSyncRepository.deleteConnection(db, sys, connection.id);
        return left;
    });
    recordCalendarSyncOutcome({ provider: connection.provider, outcome: 'torn_down' });
    logger.info('calendar connection torn down', { component: 'calendar-sync', tenantId: input.tenantId, provider: connection.provider, deleted, unreachable: reachable ? 0 : remaining });
    return { outcome: 'torn_down', deleted, remaining: 0 };
}

/**
 * Every 15 minutes (`calendar-sync-dispatch`): one run per CONNECTED
 * connection of a live workspace, and one teardown per connection being
 * disconnected, at most `DISPATCH_CAP` of each; job ids bucketed per minute
 * and quarter hour.
 */
export async function dispatchCalendarSync(opts: { tenantId?: string; now?: Date } = {}): Promise<{ runs: number; teardowns: number }> {
    if (!isCalendarSyncOpen()) return { runs: 0, teardowns: 0 };
    const now = (opts.now ?? new Date()).getTime();
    const rows = await runWithoutRls({ reason: 'cross-tenant-sweep' }, (db) =>
        Promise.all([
            db.calendarConnection.findMany({
                where: { state: 'CONNECTED', tenant: { deletedAt: null }, ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
                orderBy: { id: 'asc' },
                take: DISPATCH_CAP,
                select: { id: true, tenantId: true },
            }),
            db.calendarConnection.findMany({
                where: { state: 'DISCONNECTING', ...(opts.tenantId ? { tenantId: opts.tenantId } : {}) },
                orderBy: { id: 'asc' },
                take: DISPATCH_CAP,
                select: { id: true, tenantId: true },
            }),
        ]),
    );
    const [runs, teardowns] = rows;
    for (const tenantId of [...new Set(runs.map((r) => r.tenantId))]) {
        await enqueueConnectionSync(tenantId, runs.filter((r) => r.tenantId === tenantId).map((r) => r.id), now);
    }
    for (const tenantId of [...new Set(teardowns.map((r) => r.tenantId))]) {
        await enqueueTeardowns(tenantId, teardowns.filter((r) => r.tenantId === tenantId).map((r) => r.id), now);
    }
    return { runs: runs.length, teardowns: teardowns.length };
}
