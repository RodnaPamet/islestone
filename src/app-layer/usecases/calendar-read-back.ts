/**
 * The calendar read-back (roadmap 3.3c; ADR 0011 §1 and §4; docs/porting/maps/3.3.md,
 * "The read-back"; owner decisions 225, 227, 230, 231, 232 and 235).
 *
 * Run inside one connection's run (`runCalendarSync`), BEFORE the push, so a
 * change Islestone will not take is put back in the same run, and so the push
 * never overwrites a day a member moved before it was read.
 *
 * WHO. The member re-resolved when the run happens. A member who holds no
 * `work_items.edit` (a Viewer, or a member whose custom role took it away) has
 * a read-only feed (decision 235): nothing is read BACK from it. No change is
 * applied, nobody is notified, no inbound metric is counted; the calendar is
 * still listed, only so that a moved event "simply returns at the next push"
 * (the push rewrites only what it knows changed) and a deleted one is not
 * pushed again (decision 232 concerns the event, not the item). Recorded in
 * the 3.3 map, "Rules no decision names (3.3c, as built)".
 *
 * WHAT. Only the Islestone calendar, only the events Islestone recorded
 * (matched by remote id; anything else in the calendar is ignored), and only
 * three facts of each: deleted, its version, its last day (decision 231). A
 * version equal to the one Islestone stored after its own write is never a
 * change. A day still equal to the pushed day means something else changed
 * (a title, the link, attendees): not read (decision 225).
 *
 * A MOVED DAY on an item event is applied as the member, through the detail's
 * own versioned due-date edit (`updateWorkItem` with `via: 'calendar'`): every
 * check an edit has (`work_items.edit`, the field set, `START_AFTER_DUE`,
 * `PROJECT_ARCHIVED`, `ITEM_CLOSED`, the version), audited `WORK_ITEM_UPDATED`
 * naming `dueDate` with `via` and the provider, the due bell and the watcher
 * fan-out as for any edit. ONLY while the item's due date still equals the
 * row's `pushedDueDate` (decision 230): otherwise Islestone's newer date wins.
 *
 * NOT APPLIED (a stale change, a refused edit, every moved milestone event,
 * decision 227): the row is marked to be pushed again, so the push of this
 * very run puts Islestone's date back, and the member gets one in-app
 * `CALENDAR_CHANGE_NOT_APPLIED` per event and changed day (decision 230).
 *
 * DELETED (decision 232): an event deleted in the calendar leaves the item or
 * milestone untouched; its row moves to REMOVED_IN_CALENDAR and is not pushed
 * again until its due date changes or the member asks to resync. The whole
 * Islestone calendar deleted: the connection moves to CALENDAR_REMOVED and its
 * rows go; the member is offered "Recreate" or "Disconnect".
 *
 * Written fresh for Islestone (inflect-compliance never read a calendar back).
 */
import type { CalendarProvider, CalendarSyncedEventKind } from '@prisma/client';

import { decideReadBack, type ReadBackDecision, type RemoteEvent } from '../domain/calendar-read-back';
import { logEvent } from '../events/audit';
import { CalendarGoneError } from '../integrations/http-errors';
import { googleReader, graphReader, type CalendarReader, type ReadBackListing } from '../integrations/providers/calendar/reader';
import { createCalendarChangeNotAppliedNotification, type CalendarChangeRefusal } from '../notifications/calendar-change';
import { calendarFeedIsReadOnly } from '../policies/calendar-sync.policies';
import { CalendarSyncRepository, type SyncedEventRow } from '../repositories/CalendarSyncRepository';
import type { RequestContext } from '../types';
import { getWorkItem, updateWorkItem } from './work-item';
import { runInTenantContext, runInTenantReadContext } from '@/lib/db-context';
import { AppError } from '@/lib/errors/types';
import { recordCalendarSyncInbound } from '@/lib/observability/business-metrics';
import { logger } from '@/lib/observability/logger';
import { tenantWorkItemPath } from '@/lib/work-item-paths';

/** The most recorded events a run asks for one by one (Graph's absent events). */
export const READ_BACK_LOOKUP_CAP = 50;

export interface ReadBackCounts {
    applied: number;
    refused: number;
    stale: number;
    milestoneReverted: number;
    removed: number;
    /** A read-only feed's moved events, put back without a word (decision 235). */
    reverted: number;
}

export type ReadBackResult =
    | { outcome: 'skipped'; reason: 'NOTHING_RECORDED' }
    | { outcome: 'read'; counts: ReadBackCounts }
    | { outcome: 'calendar_removed' };

export function readerFor(provider: CalendarProvider, accessToken: string): CalendarReader {
    return provider === 'GOOGLE' ? googleReader(accessToken) : graphReader(accessToken);
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

type Where = { connectionId: string; kind: CalendarSyncedEventKind; sourceId: string };
const whereOf = (connectionId: string, row: SyncedEventRow): Where => ({
    connectionId,
    kind: row.kind,
    sourceId: (row.kind === 'WORK_ITEM' ? row.workItemId : row.milestoneId) ?? '',
});

/**
 * The connection's calendar is gone (decision 232): CALENDAR_REMOVED, the rows
 * dropped (their events went with the calendar), audited once as the system
 * user. The token stays for "Recreate".
 */
export async function markCalendarRemoved(sys: RequestContext, connection: { id: string; provider: CalendarProvider }): Promise<void> {
    await runInTenantContext(sys, async (db) => {
        const changed = await CalendarSyncRepository.markCalendarRemoved(db, sys, connection.id);
        if (changed === 0) return;
        const dropped = await CalendarSyncRepository.dropAll(db, sys, connection.id);
        await logEvent(db, sys, {
            action: 'CALENDAR_REMOVED_AT_PROVIDER',
            entityType: 'CalendarConnection',
            entityId: connection.id,
            details: 'The Islestone calendar was deleted at the provider; nothing is pushed until the member recreates it or disconnects',
            detailsJson: { category: 'status_change', entityName: 'CalendarConnection', fromStatus: 'CONNECTED', toStatus: 'CALENDAR_REMOVED' },
            metadata: { provider: connection.provider, droppedEvents: dropped },
        });
    });
    logger.info('calendar removed at the provider', { component: 'calendar-sync', tenantId: sys.tenantId, provider: connection.provider });
}

interface Refusal {
    reason: CalendarChangeRefusal;
    label: string;
    linkUrl: string;
    workItemId: string | null;
}

export function readBackRefusalOf(err: unknown): CalendarChangeRefusal | 'VERSION_CONFLICT' | 'GONE' | null {
    if (!(err instanceof AppError)) return null;
    const reason = (err.details as { reason?: unknown } | undefined)?.reason;
    if (err.status === 404) return 'GONE';
    if (err.status === 403) return 'NO_EDIT';
    if (reason === 'VERSION_CONFLICT') return 'VERSION_CONFLICT';
    if (reason === 'PROJECT_ARCHIVED' || reason === 'ITEM_CLOSED' || reason === 'FIELD_HIDDEN' || reason === 'START_AFTER_DUE') return reason;
    // A field set the date cannot satisfy: refused like an edit the member may not make.
    if (reason === 'FIELD_SET_UNMET') return 'FIELD_HIDDEN';
    return null;
}

type Applied = { kind: 'applied' } | { kind: 'gone' } | { kind: 'refused'; refusal: Refusal };

/**
 * Apply one moved day on an item event as the member (decision 225), or say
 * why not. A version conflict is read once more: still the pushed day, the
 * edit is tried again; moved meanwhile, it is stale.
 */
async function applyMovedDay(member: RequestContext, slug: string, workItemId: string, pushedDueDate: string, movedTo: string, provider: CalendarProvider): Promise<Applied> {
    let current: Awaited<ReturnType<typeof getWorkItem>>;
    try {
        current = await getWorkItem(member, workItemId);
    } catch (err) {
        const r = readBackRefusalOf(err);
        if (r === 'GONE') return { kind: 'gone' };
        if (r === 'NO_EDIT') return { kind: 'refused', refusal: { reason: 'NO_EDIT', label: 'a work item', linkUrl: tenantWorkItemPath(slug, workItemId), workItemId } };
        throw err;
    }
    const refused = (reason: CalendarChangeRefusal): Applied => ({
        kind: 'refused',
        refusal: { reason, label: current.key, linkUrl: tenantWorkItemPath(slug, workItemId), workItemId },
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        // Decision 230: only while Islestone's date is still the one it pushed.
        if (current.dueDate !== pushedDueDate) return refused('STALE');
        try {
            await updateWorkItem(member, workItemId, { dueDate: movedTo }, current.version, { via: 'calendar', provider });
            return { kind: 'applied' };
        } catch (err) {
            const r = readBackRefusalOf(err);
            if (r === 'GONE') return { kind: 'gone' };
            if (r === 'VERSION_CONFLICT') {
                if (attempt === 1) return refused('STALE');
                current = await getWorkItem(member, workItemId);
                continue;
            }
            if (r) return refused(r);
            throw err;
        }
    }
    return refused('STALE');
}

/** Read the member's calendar back, before the push. */
export async function readBackCalendar(input: {
    sys: RequestContext;
    member: RequestContext;
    slug: string;
    connection: { id: string; provider: CalendarProvider; calendarId: string; syncCursor: string | null };
    accessToken: string;
    window: { from: string; to: string };
    /** A seam for tests: the provider's reader. */
    reader?: CalendarReader;
}): Promise<ReadBackResult> {
    const { sys, member, connection } = input;
    // Decision 235: from a read-only feed nothing is read back (no change applied, nobody notified).
    const readOnly = calendarFeedIsReadOnly(member);
    const rows = (await runInTenantReadContext(sys, (db) => CalendarSyncRepository.syncedEvents(db, sys, connection.id))).filter((r) => r.remoteEventId);
    if (rows.length === 0) return { outcome: 'skipped', reason: 'NOTHING_RECORDED' };

    const reader = input.reader ?? readerFor(connection.provider, input.accessToken);
    let listing: ReadBackListing | 'calendar_gone';
    try {
        listing = await reader.read(connection.calendarId, { cursor: connection.syncCursor, window: input.window });
    } catch (err) {
        if (!(err instanceof CalendarGoneError)) throw err;
        listing = 'calendar_gone';
    }
    if (listing === 'calendar_gone') {
        await markCalendarRemoved(sys, connection);
        return { outcome: 'calendar_removed' };
    }

    const byRemote = new Map(rows.map((r) => [r.remoteEventId, r]));
    const seen = new Map<string, RemoteEvent>();
    for (const event of listing.events) if (byRemote.has(event.remoteEventId)) seen.set(event.remoteEventId, event);
    if (listing.absentMeansChanged) {
        // Graph: a recorded event the window does not hold was deleted, or moved out of the window.
        const absent = rows.filter((r) => !seen.has(r.remoteEventId) && r.state !== 'REMOVED_IN_CALENDAR').slice(0, READ_BACK_LOOKUP_CAP);
        for (const row of absent) {
            // guardrail-allow: n+1 — at most READ_BACK_LOOKUP_CAP provider calls, one per event absent from the window.
            const found = await reader.get(connection.calendarId, row.remoteEventId);
            seen.set(row.remoteEventId, found === 'gone' ? { remoteEventId: row.remoteEventId, remoteVersion: null, deleted: true, time: null } : found);
        }
    }

    const counts: ReadBackCounts = { applied: 0, refused: 0, stale: 0, milestoneReverted: 0, removed: 0, reverted: 0 };
    for (const [remoteEventId, event] of seen) {
        const row = byRemote.get(remoteEventId)!;
        const decision: ReadBackDecision = decideReadBack({ remoteEventId: row.remoteEventId, remoteVersion: row.remoteVersion, pushedDueDate: dayOf(row.pushedDueDate), state: row.state }, event);
        const where = whereOf(connection.id, row);
        if (decision.kind === 'none') continue;
        if (decision.kind === 'forget') {
            // guardrail-allow: n+1 — one write per recorded event the calendar changed (bounded by the run's rows).
            await runInTenantContext(sys, (db) => CalendarSyncRepository.drop(db, sys, where));
            continue;
        }
        if (decision.kind === 'removed') {
            await runInTenantContext(sys, (db) => CalendarSyncRepository.markState(db, sys, where, 'REMOVED_IN_CALENDAR', null));
            counts.removed += 1;
            continue;
        }

        // A moved day.
        let refusal: Refusal | null = null;
        if (readOnly) {
            // A read-only feed: put back by this run's push, without a word.
            await runInTenantContext(sys, (db) => CalendarSyncRepository.markState(db, sys, where, 'FAILED', 'REFUSED'));
            counts.reverted += 1;
            continue;
        }
        if (row.kind === 'MILESTONE') {
            // Decision 227: milestones are read-only from a calendar.
            const label = await runInTenantReadContext(sys, (db) => CalendarSyncRepository.milestoneLabel(db, sys, where.sourceId));
            if (label) refusal = { reason: 'MILESTONE', label: label.name, linkUrl: `/t/${input.slug}/projects/${label.keyPrefix}/milestones/${where.sourceId}`, workItemId: null };
            counts.milestoneReverted += 1;
            recordCalendarSyncInbound({ provider: connection.provider, outcome: 'milestone_reverted' });
        } else {
            const outcome = await applyMovedDay(member, input.slug, where.sourceId, dayOf(row.pushedDueDate), decision.movedTo, connection.provider);
            if (outcome.kind === 'applied') {
                await runInTenantContext(sys, (db) =>
                    CalendarSyncRepository.recordReadBackApplied(db, sys, where, { pushedDueDate: new Date(`${decision.movedTo}T00:00:00.000Z`), remoteVersion: event.remoteVersion }),
                );
                counts.applied += 1;
                recordCalendarSyncInbound({ provider: connection.provider, outcome: 'applied' });
                continue;
            }
            if (outcome.kind === 'refused') {
                refusal = outcome.refusal;
                const stale = refusal.reason === 'STALE';
                if (stale) counts.stale += 1;
                else counts.refused += 1;
                recordCalendarSyncInbound({ provider: connection.provider, outcome: stale ? 'stale' : 'refused' });
            } else {
                // The item is gone or out of the member's sight: the push deletes its event.
                counts.refused += 1;
                recordCalendarSyncInbound({ provider: connection.provider, outcome: 'refused' });
            }
        }
        // Not applied: pushed again by this very run, so Islestone's date comes back.
        await runInTenantContext(sys, async (db) => {
            await CalendarSyncRepository.markState(db, sys, where, 'FAILED', 'REFUSED');
            if (refusal) {
                await createCalendarChangeNotAppliedNotification(db, {
                    tenantId: sys.tenantId,
                    userId: member.userId,
                    reason: refusal.reason,
                    label: refusal.label,
                    linkUrl: refusal.linkUrl,
                    workItemId: refusal.workItemId,
                    clientEventId: row.clientEventId,
                    movedTo: decision.movedTo,
                });
            }
        });
    }

    // Google's cursor, when the listing gave one; an unchanged calendar keeps the stored one (no write).
    const nextCursor = listing.nextCursor;
    if (nextCursor && (listing.events.length > 0 || !connection.syncCursor)) {
        await runInTenantContext(sys, (db) => CalendarSyncRepository.setCursor(db, sys, connection.id, nextCursor));
    }
    if (counts.applied + counts.refused + counts.stale + counts.milestoneReverted + counts.removed + counts.reverted > 0) {
        logger.info('calendar read back', { component: 'calendar-sync', tenantId: sys.tenantId, provider: connection.provider, ...counts });
    }
    return { outcome: 'read', counts };
}
