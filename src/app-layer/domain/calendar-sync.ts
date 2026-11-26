/**
 * Calendar sync's pure rules (roadmap 3.3b; ADR 0011; owner decisions 226 to
 * 229, 232 and 239): what a synced event is, its deterministic id and content
 * hash, and the diff between what a member should have in their calendar and
 * what Islestone has recorded pushing there.
 *
 * Copied from inflect-compliance `src/app-layer/usecases/calendar-event-reconcile.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and adapted: the
 * identity is (workspace, connection, kind, item or milestone id) instead of
 * (tenant, user, provider, source key, entity id); the hash covers exactly the
 * title, the due date and the link (decision 229); a row whose insert was never
 * confirmed (no remote id) is looked up before it is inserted or deleted, so a
 * crash between the provider's insert and the row's write leaves one event,
 * never two; a row the member deleted in their calendar is not pushed again
 * until its due date changes (decision 232, read back in 3.3c).
 *
 * Deletes are driven by the rows, never by diffing generations: an item the
 * member can no longer see never appears in a new generation at all, so the
 * row is the only thing that can name what to remove.
 *
 * Pure: no database, no provider, no clock.
 */
import { createHash } from 'node:crypto';

export type SyncedEventKind = 'WORK_ITEM' | 'MILESTONE';
export type SyncedEventState = 'PUSHED' | 'PENDING_DELETE' | 'FAILED' | 'REMOVED_IN_CALENDAR';

/** One event a member should have: exactly what leaves Islestone (decision 229). */
export interface DesiredSyncedEvent {
    kind: SyncedEventKind;
    /** The work item's or the milestone's id. */
    sourceId: string;
    /** The item's title or the milestone's name, exactly. */
    title: string;
    /** Date-only `YYYY-MM-DD`. */
    dueDate: string;
    /** One absolute `appLink` URL, the event's whole description. */
    link: string;
}

/** A synced event row, reduced to what the diff needs. */
export interface RecordedSyncedEvent {
    kind: SyncedEventKind;
    sourceId: string;
    /** Empty while the provider has not confirmed the insert. */
    remoteEventId: string;
    contentHash: string;
    /** `YYYY-MM-DD`. */
    pushedDueDate: string;
    state: SyncedEventState;
}

export type SyncAction =
    | { kind: 'insert'; event: DesiredSyncedEvent; clientEventId: string; contentHash: string; lookupFirst: boolean }
    | { kind: 'patch'; event: DesiredSyncedEvent; remoteEventId: string; clientEventId: string; contentHash: string }
    | { kind: 'delete'; sourceKind: SyncedEventKind; sourceId: string; remoteEventId: string; clientEventId: string };

export interface SyncIdentity {
    tenantId: string;
    connectionId: string;
}

/**
 * The event's deterministic id for (workspace, connection, kind, id).
 *
 * LOWERCASE HEX, 40 characters: Google requires the base32hex alphabet (0-9,
 * a-v) and 5 to 1,024 characters, and hex is a strict subset; Graph takes it as
 * `transactionId`. LENGTH-PREFIXED rather than joined on a separator, so no
 * content of a component can make two identities collide.
 */
export function calendarClientEventId(identity: SyncIdentity & { kind: SyncedEventKind; sourceId: string }): string {
    const material = [identity.tenantId, identity.connectionId, identity.kind, identity.sourceId].map((c) => `${c.length}:${c}`).join('');
    return createHash('sha256').update(material).digest('hex').slice(0, 40);
}

/**
 * A hash over exactly what is pushed: a field pushed but not hashed would never
 * trigger a patch. The kind is pushed too (it decides nothing a provider shows,
 * but a milestone and an item never share a row).
 */
export function calendarContentHash(event: DesiredSyncedEvent): string {
    return createHash('sha256').update(JSON.stringify([event.kind, event.title, event.dueDate, event.link])).digest('hex').slice(0, 32);
}

/** The day after a date-only `YYYY-MM-DD`: the exclusive end of an all-day event. */
export function nextDay(day: string): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

function key(kind: SyncedEventKind, sourceId: string): string {
    return `${kind.length}:${kind}${sourceId.length}:${sourceId}`;
}

/**
 * Diff the events a member should have against the rows recorded for the
 * connection. A nightly run over an unchanged calendar emits no action, so it
 * makes no provider call.
 */
export function reconcileSyncedEvents(input: {
    identity: SyncIdentity;
    desired: readonly DesiredSyncedEvent[];
    existing: readonly RecordedSyncedEvent[];
}): SyncAction[] {
    const actions: SyncAction[] = [];
    const existingByKey = new Map(input.existing.map((r) => [key(r.kind, r.sourceId), r]));
    const desiredKeys = new Set<string>();
    const idOf = (kind: SyncedEventKind, sourceId: string) => calendarClientEventId({ ...input.identity, kind, sourceId });

    for (const event of input.desired) {
        const k = key(event.kind, event.sourceId);
        if (desiredKeys.has(k)) continue;
        desiredKeys.add(k);
        const hash = calendarContentHash(event);
        const clientEventId = idOf(event.kind, event.sourceId);
        const found = existingByKey.get(k);

        if (!found) {
            actions.push({ kind: 'insert', event, clientEventId, contentHash: hash, lookupFirst: false });
            continue;
        }
        if (found.state === 'REMOVED_IN_CALENDAR') {
            // Decision 232: deleted in the calendar, so not pushed again until
            // its due date changes (or the member asks to resync, 3.3c).
            if (found.pushedDueDate !== event.dueDate) {
                actions.push({ kind: 'insert', event, clientEventId, contentHash: hash, lookupFirst: true });
            }
            continue;
        }
        if (!found.remoteEventId) {
            // An insert the provider never confirmed: it may exist remotely.
            actions.push({ kind: 'insert', event, clientEventId, contentHash: hash, lookupFirst: true });
            continue;
        }
        // A FAILED row is pushed again even when the hash matches (the failure
        // may have been the push itself); a row whose delete failed but is
        // wanted again is put back with the current content.
        if (found.contentHash !== hash || found.state === 'FAILED' || found.state === 'PENDING_DELETE') {
            actions.push({ kind: 'patch', event, remoteEventId: found.remoteEventId, clientEventId, contentHash: hash });
        }
    }

    for (const r of input.existing) {
        if (desiredKeys.has(key(r.kind, r.sourceId))) continue;
        actions.push({ kind: 'delete', sourceKind: r.kind, sourceId: r.sourceId, remoteEventId: r.remoteEventId, clientEventId: idOf(r.kind, r.sourceId) });
    }
    return actions;
}

/**
 * Every row as a delete: the teardown (decision 239). Separate from the diff
 * against an empty set because removal must never depend on a successful
 * generation (a removed member's items cannot be generated at all).
 */
export function teardownActions(identity: SyncIdentity, existing: readonly RecordedSyncedEvent[]): SyncAction[] {
    return existing.map((r) => ({
        kind: 'delete' as const,
        sourceKind: r.kind,
        sourceId: r.sourceId,
        remoteEventId: r.remoteEventId,
        clientEventId: calendarClientEventId({ ...identity, kind: r.kind, sourceId: r.sourceId }),
    }));
}
