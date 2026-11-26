/**
 * Calendar sync's pure rules (roadmap 3.3b; ADR 0011; decisions 226, 229,
 * 232, 239): the deterministic client id, the content hash, the diff driven by
 * the rows, the teardown, and — H3's "duplicates" — a property: whatever
 * point a run crashes at (after the provider wrote, before the row was
 * confirmed) and however often it is retried, the calendar ends with at most
 * one event per (connection, kind, id), exactly the desired set, and a
 * further run makes no provider call.
 */
import fc from 'fast-check';

import {
    calendarClientEventId,
    calendarContentHash,
    nextDay,
    reconcileSyncedEvents,
    teardownActions,
    type DesiredSyncedEvent,
    type RecordedSyncedEvent,
    type SyncAction,
} from '@/app-layer/domain/calendar-sync';

const identity = { tenantId: 't1', connectionId: 'c1' };
const item = (id: string, over: Partial<DesiredSyncedEvent> = {}): DesiredSyncedEvent => ({
    kind: 'WORK_ITEM',
    sourceId: id,
    title: `Item ${id}`,
    dueDate: '2026-12-10',
    link: `https://islestone.test/t/acme/work-items/ISL-${id}`,
    ...over,
});
const pushed = (e: DesiredSyncedEvent, over: Partial<RecordedSyncedEvent> = {}): RecordedSyncedEvent => ({
    kind: e.kind,
    sourceId: e.sourceId,
    remoteEventId: `r-${e.sourceId}`,
    contentHash: calendarContentHash(e),
    pushedDueDate: e.dueDate,
    state: 'PUSHED',
    ...over,
});

describe('the client id and the content hash', () => {
    it('is 40 lowercase hex (inside Google base32hex), stable, and differs per workspace, connection, kind and id', () => {
        const id = calendarClientEventId({ ...identity, kind: 'WORK_ITEM', sourceId: 'a' });
        expect(id).toMatch(/^[0-9a-f]{40}$/);
        expect(calendarClientEventId({ ...identity, kind: 'WORK_ITEM', sourceId: 'a' })).toBe(id);
        const others = [
            calendarClientEventId({ tenantId: 't2', connectionId: 'c1', kind: 'WORK_ITEM', sourceId: 'a' }),
            calendarClientEventId({ tenantId: 't1', connectionId: 'c2', kind: 'WORK_ITEM', sourceId: 'a' }),
            calendarClientEventId({ ...identity, kind: 'MILESTONE', sourceId: 'a' }),
            calendarClientEventId({ ...identity, kind: 'WORK_ITEM', sourceId: 'b' }),
        ];
        expect(new Set([id, ...others]).size).toBe(5);
    });

    it('is length-prefixed: shifting characters between components never collides', () => {
        expect(calendarClientEventId({ tenantId: 'ab', connectionId: 'c', kind: 'WORK_ITEM', sourceId: 'x' })).not.toBe(
            calendarClientEventId({ tenantId: 'a', connectionId: 'bc', kind: 'WORK_ITEM', sourceId: 'x' }),
        );
    });

    it('the hash covers the title, the date and the link (decision 229), and nothing else moves it', () => {
        const base = calendarContentHash(item('1'));
        expect(base).toMatch(/^[0-9a-f]{32}$/);
        expect(calendarContentHash(item('1', { title: 'Other' }))).not.toBe(base);
        expect(calendarContentHash(item('1', { dueDate: '2026-12-11' }))).not.toBe(base);
        expect(calendarContentHash(item('1', { link: 'https://islestone.test/t/acme/work-items/NEW-1' }))).not.toBe(base);
        expect(calendarContentHash({ ...item('1') })).toBe(base);
    });

    it('an all-day event ends the next day (exclusive), across a month and a year', () => {
        expect(nextDay('2026-12-10')).toBe('2026-12-11');
        expect(nextDay('2026-02-28')).toBe('2026-03-01');
        expect(nextDay('2026-12-31')).toBe('2027-01-01');
    });
});

describe('the diff', () => {
    it('inserts what has no row, patches a changed or failed one, leaves an unchanged one alone, deletes what is no longer wanted', () => {
        const a = item('a');
        const b = item('b');
        const c = item('c');
        const d = item('d');
        const actions = reconcileSyncedEvents({
            identity,
            desired: [a, { ...b, title: 'changed' }, c],
            existing: [pushed(b), pushed(c), pushed(d), pushed(a, { state: 'FAILED' })],
        });
        expect(actions.map((x) => [x.kind, x.kind === 'delete' ? x.sourceId : x.event.sourceId])).toEqual([
            ['patch', 'a'],
            ['patch', 'b'],
            ['delete', 'd'],
        ]);
    });

    it('an unchanged calendar emits no action (a nightly run makes no provider call)', () => {
        const desired = [item('a'), item('b', { kind: 'MILESTONE' })];
        expect(reconcileSyncedEvents({ identity, desired, existing: desired.map((e) => pushed(e)) })).toEqual([]);
    });

    it('a row whose insert was never confirmed is looked up before it is inserted, or deleted', () => {
        const a = item('a');
        const [insert] = reconcileSyncedEvents({ identity, desired: [a], existing: [pushed(a, { remoteEventId: '', state: 'FAILED' })] });
        expect(insert).toMatchObject({ kind: 'insert', lookupFirst: true });
        const [del] = reconcileSyncedEvents({ identity, desired: [], existing: [pushed(a, { remoteEventId: '' })] });
        expect(del).toMatchObject({ kind: 'delete', remoteEventId: '', clientEventId: calendarClientEventId({ ...identity, kind: 'WORK_ITEM', sourceId: 'a' }) });
    });

    it('an event deleted in the calendar is not pushed again until its due date changes (decision 232)', () => {
        const a = item('a');
        expect(reconcileSyncedEvents({ identity, desired: [a], existing: [pushed(a, { state: 'REMOVED_IN_CALENDAR' })] })).toEqual([]);
        expect(reconcileSyncedEvents({ identity, desired: [{ ...a, dueDate: '2026-12-12' }], existing: [pushed(a, { state: 'REMOVED_IN_CALENDAR' })] })[0]).toMatchObject({
            kind: 'insert',
            lookupFirst: true,
        });
    });

    it('a work item and a milestone with the same id are two events', () => {
        const actions = reconcileSyncedEvents({ identity, desired: [item('x'), item('x', { kind: 'MILESTONE' })], existing: [] });
        expect(actions).toHaveLength(2);
        expect(new Set(actions.map((x) => (x.kind === 'insert' ? x.clientEventId : '')))).toHaveProperty('size', 2);
    });

    it('the teardown deletes every row, whatever is wanted', () => {
        const rows = [pushed(item('a')), pushed(item('b'), { remoteEventId: '' }), pushed(item('m', { kind: 'MILESTONE' }), { state: 'PENDING_DELETE' })];
        expect(teardownActions(identity, rows).map((x) => x.kind)).toEqual(['delete', 'delete', 'delete']);
    });
});

/**
 * A provider that finds events by Islestone's client id but does NOT refuse a
 * second insert of one (Google documents that a collision is not guaranteed
 * to be detected at creation): only the lookup before a re-insert keeps the
 * calendar to one event.
 */
class FakeProvider {
    events = new Map<string, { remote: string; clientId: string; event: DesiredSyncedEvent }>();
    private n = 0;
    find(clientId: string) {
        return [...this.events.values()].find((e) => e.clientId === clientId) ?? null;
    }
    insert(clientId: string, event: DesiredSyncedEvent) {
        const remote = `r${++this.n}`;
        this.events.set(remote, { remote, clientId, event });
        return remote;
    }
}

/** Apply actions the way `applySyncActions` does (row first, provider, then confirm); `crash` fails the confirm. */
function apply(actions: readonly SyncAction[], provider: FakeProvider, rows: Map<string, RecordedSyncedEvent>, crash: (i: number) => boolean) {
    actions.forEach((action, i) => {
        if (action.kind === 'delete') {
            const remote = action.remoteEventId || provider.find(action.clientEventId)?.remote || '';
            if (remote) provider.events.delete(remote);
            rows.delete(`${action.sourceKind}:${action.sourceId}`);
            return;
        }
        const key = `${action.event.kind}:${action.event.sourceId}`;
        if (action.kind === 'insert') {
            rows.set(key, { kind: action.event.kind, sourceId: action.event.sourceId, remoteEventId: '', contentHash: action.contentHash, pushedDueDate: action.event.dueDate, state: 'FAILED' });
            const found = action.lookupFirst ? provider.find(action.clientEventId) : null;
            if (found) found.event = action.event;
            const remote = found?.remote ?? provider.insert(action.clientEventId, action.event);
            if (crash(i)) return; // the provider wrote; the row stays unconfirmed
            rows.set(key, { ...rows.get(key)!, remoteEventId: remote, state: 'PUSHED' });
        } else {
            provider.events.get(action.remoteEventId)!.event = action.event;
            rows.set(key, { ...rows.get(key)!, contentHash: action.contentHash, pushedDueDate: action.event.dueDate, state: 'PUSHED' });
        }
    });
}

describe('H3 duplicates: crash points and retries never leave two events for one item', () => {
    const arbDesired = fc.uniqueArray(fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd', 'e'), kind: fc.constantFrom('WORK_ITEM' as const, 'MILESTONE' as const), title: fc.constantFrom('One', 'Two') }), {
        selector: (r) => `${r.kind}:${r.id}`,
        maxLength: 6,
    });

    it('converges to exactly the desired set, one event each, and then makes no call', () => {
        fc.assert(
            fc.property(fc.array(arbDesired, { minLength: 1, maxLength: 4 }), fc.array(fc.boolean(), { maxLength: 40 }), (generations, crashes) => {
                const provider = new FakeProvider();
                const rows = new Map<string, RecordedSyncedEvent>();
                let k = 0;
                const crash = () => crashes[k++ % Math.max(crashes.length, 1)] ?? false;
                let desired: DesiredSyncedEvent[] = [];
                for (const gen of generations) {
                    desired = gen.map((g) => item(g.id, { kind: g.kind, title: g.title }));
                    // A crashing run, then retries until a run with no crash settles it.
                    apply(reconcileSyncedEvents({ identity, desired, existing: [...rows.values()] }), provider, rows, crash);
                }
                for (let retry = 0; retry < 3; retry++) apply(reconcileSyncedEvents({ identity, desired, existing: [...rows.values()] }), provider, rows, () => false);
                const byClient = new Map<string, number>();
                for (const e of provider.events.values()) byClient.set(e.clientId, (byClient.get(e.clientId) ?? 0) + 1);
                expect([...byClient.values()].every((n) => n === 1)).toBe(true);
                expect([...provider.events.values()].map((e) => `${e.event.kind}:${e.event.sourceId}:${e.event.title}`).sort()).toEqual(
                    desired.map((e) => `${e.kind}:${e.sourceId}:${e.title}`).sort(),
                );
                expect(reconcileSyncedEvents({ identity, desired, existing: [...rows.values()] })).toEqual([]);
            }),
            { numRuns: 300 },
        );
    });
});
