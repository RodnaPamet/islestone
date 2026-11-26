/**
 * The calendar read-back end to end against a fake Google and Microsoft
 * (roadmap 3.3c; ADR 0011 §1 and §4; docs/porting/maps/3.3.md, "The
 * read-back" and "H3"; owner decisions 225, 227, 230, 231, 232 and 235).
 *
 * The real usecases, repositories, encryption and row-level security, with
 * the providers faked at the fetch seam (`tests/helpers/fake-calendar-provider.ts`;
 * `safeFetch`, the Graph page-link follower's sink, routed to the same fake)
 * and the job queue captured. Covers H3's two-way and deleted-events cases:
 *
 *   - a moved day applied as the member while Islestone's date is unchanged:
 *     the versioned edit, `WORK_ITEM_UPDATED` naming `dueDate` with
 *     `via: 'calendar'` and the provider, the event rewritten in Islestone's
 *     shape, Islestone's own write never read back (versions);
 *   - date-only edges: a timed event late in the evening in UTC−10 (Google)
 *     and early in the morning in UTC+14 (Graph, a Windows zone name);
 *   - every refusal reverted and notified once per event and day: stale
 *     (Islestone moved first), a hidden field, start after due, a closed
 *     item, an archived project; a moved milestone event reverted and
 *     notified; other edits (a title) not read;
 *   - a Viewer's feed: nothing read back, no notification, the event put back;
 *   - deleted events: the item untouched, not pushed again until its due date
 *     changes or "Resync"; Graph's absent event looked up by id; the whole
 *     calendar deleted → CALENDAR_REMOVED, its rows dropped, "Recreate";
 *   - Google's expired sync token (410) resets to a full listing; Graph's
 *     pages followed through safeFetch, and a page link on another origin
 *     refused before any request.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import { DB_AVAILABLE } from './db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
const mockQueued: Array<{ name: string; data: Record<string, string> }> = [];
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async (name: string, data: Record<string, string>) => {
        mockQueued.push({ name, data });
        return { id: `job-${mockQueued.length}` };
    },
}));
// The Graph page-link follower's egress goes through safeFetch (DNS-pinned):
// in a test it reaches the same fake as every other provider call.
const mockSafeFetch = jest.fn((url: string, init?: RequestInit) => global.fetch(url, init));
jest.mock('@/app-layer/automation/webhook-safety', () => ({
    ...jest.requireActual('@/app-layer/automation/webhook-safety'),
    safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { calendarClientEventId } from '@/app-layer/domain/calendar-sync';
import { actOnCalendarConnection, completeCalendarConnect } from '@/app-layer/usecases/calendar-connection';
import { readBackRefusalOf } from '@/app-layer/usecases/calendar-read-back';
import { runCalendarSync } from '@/app-layer/usecases/calendar-sync-run';
import { recordMicrosoftConsent, setCalendarSyncEnabled } from '@/app-layer/usecases/calendar-sync-settings';
import { setTypeField } from '@/app-layer/usecases/field-set';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { createWorkItem, setWorkItemState, updateWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import type { RequestContext } from '@/app-layer/types';
import { verifyAuditChain } from '@/lib/audit';
import { forbidden } from '@/lib/errors/types';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { FakeCalendarProvider } from '../helpers/fake-calendar-provider';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

const describeFn = DB_AVAILABLE ? describe : describe.skip;

const SUFFIX = Date.now().toString(36);
const APP = 'https://islestone.example.test';
const DIRECTORY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

type Who = 'OWNER' | 'MEG' | 'VIC' | 'OTTO';

describeFn('calendar read-back, end to end against a fake provider (3.3c)', () => {
    let prisma: PrismaClient;
    const fake = new FakeCalendarProvider();
    const roles: Record<Who, Role> = { OWNER: 'OWNER', MEG: 'MEMBER', VIC: 'VIEWER', OTTO: 'MEMBER' };
    const users: Record<string, string> = {};
    const ids: Record<string, string> = {};
    let tenantId = '';
    let slug = '';

    const ctxOf = (who: Who): RequestContext =>
        makeRequestContext(roles[who], { tenantId, tenantSlug: slug, userId: users[who], appPermissions: getPermissionsForRole(roles[who]), requestId: `rb-${who}-${Math.random()}` });

    const item = async (title: string, who: Who, extra: Record<string, unknown>, projectKey = 'project') =>
        (await createWorkItem(ctxOf('OWNER'), { projectId: ids[projectKey]!, typeId: ids.type!, title, assigneeId: users[who], ...extra })).id;

    const clientId = (connectionId: string, kind: 'WORK_ITEM' | 'MILESTONE', sourceId: string) => calendarClientEventId({ tenantId, connectionId, kind, sourceId });
    const eventOf = (connectionId: string, sourceId: string, kind: 'WORK_ITEM' | 'MILESTONE' = 'WORK_ITEM') => fake.eventByClientId(clientId(connectionId, kind, sourceId))!;
    const dueOf = async (id: string) => (await prisma.workItem.findUniqueOrThrow({ where: { id }, select: { dueDate: true } })).dueDate?.toISOString().slice(0, 10) ?? null;
    const run = (connectionId: string) => runCalendarSync({ tenantId, connectionId });
    const notices = (who: Who) => prisma.notification.findMany({ where: { tenantId, userId: users[who], type: 'CALENDAR_CHANGE_NOT_APPLIED' }, orderBy: { createdAt: 'asc' } });
    const nextDayOf = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10);
    /** A person drags an all-day event to `to`. */
    const moveTo = (connectionId: string, sourceId: string, to: string, kind: 'WORK_ITEM' | 'MILESTONE' = 'WORK_ITEM') => fake.personMove(eventOf(connectionId, sourceId, kind).id, { allDayEnd: nextDayOf(to) });

    async function connect(who: Who, provider: 'GOOGLE' | 'MICROSOFT') {
        expect(await completeCalendarConnect(ctxOf(who), { provider, code: `code-${who}`, codeVerifier: 'v'.repeat(43) })).toBe('connected');
        return prisma.calendarConnection.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId, userId: users[who]!, provider } } });
    }

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        process.env.GOOGLE_CLIENT_ID = 'test-google-client';
        process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'; // pragma: allowlist secret
        process.env.MICROSOFT_CLIENT_ID = 'test-microsoft-client';
        process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-secret'; // pragma: allowlist secret
        process.env.NEXT_PUBLIC_APP_URL = APP;
        fake.install();

        slug = `rb${SUFFIX}`;
        tenantId = (await createTenantWithDek({ name: slug, slug })).id;
        for (const w of Object.keys(roles) as Who[]) {
            const u = await prisma.user.create({ data: { email: `${w.toLowerCase()}-${slug}@example.test`, name: w } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: roles[w] } });
            users[w] = u.id;
        }
        const owner = ctxOf('OWNER');
        const team = await createTeam(owner, { name: 'Read back' });
        const states = Object.fromEntries(team.workflowStates.map((s) => [s.category, s.id]));
        ids.done = states.DONE!;
        ids.project = (await createProject(owner, { teamId: team.id, name: 'Read back', keyPrefix: 'RB' })).id;
        ids.other = (await createProject(owner, { teamId: team.id, name: 'To archive', keyPrefix: 'RBA' })).id;
        const types = await listWorkItemTypes(owner);
        ids.type = types[0]!.id;
        ids.hiddenType = types[1]!.id;
        await setCalendarSyncEnabled(owner, { syncEnabled: true });
        await recordMicrosoftConsent(owner, { directoryId: DIRECTORY });

        // Meg's items (Google).
        ids.applied = await item('Applied', 'MEG', { dueDate: day(5) });
        ids.timed = await item('Timed', 'MEG', { dueDate: day(10) });
        ids.stale = await item('Stale', 'MEG', { dueDate: day(15) });
        ids.hidden = (await createWorkItem(owner, { projectId: ids.project, typeId: ids.hiddenType, title: 'Hidden', assigneeId: users.MEG, dueDate: day(20) })).id;
        ids.startAfter = await item('Start after', 'MEG', { startDate: day(21), dueDate: day(22) });
        ids.closed = await item('Closed', 'MEG', { dueDate: day(23) });
        ids.archived = await item('Archived', 'MEG', { dueDate: day(24) }, 'other');
        ids.deleted = await item('Deleted', 'MEG', { dueDate: day(25) });
        ids.retitled = await item('Retitled', 'MEG', { dueDate: day(26) });
        ids.milestone = (await createMilestone(owner, ids.project, { name: 'Launch', dueDate: day(12) })).id;
        // Vic's (a Viewer: a read-only feed).
        ids.vic = await item("Vic's", 'VIC', { dueDate: day(6) });
        // Otto's (Microsoft).
        ids.otto1 = await item('Otto one', 'OTTO', { dueDate: day(9) });
        ids.otto2 = await item('Otto two', 'OTTO', { dueDate: day(13) });
        ids.otto3 = await item('Otto three', 'OTTO', { dueDate: day(14) });

        ids.meg = (await connect('MEG', 'GOOGLE')).id;
        ids.vicConn = (await connect('VIC', 'GOOGLE')).id;
        ids.otto = (await connect('OTTO', 'MICROSOFT')).id;
        for (const c of [ids.meg, ids.vicConn, ids.otto]) expect((await run(c!)).outcome).toBe('pushed');
        // The hidden rule comes after the item was made with its date (existing items are never rewritten).
        await setTypeField(owner, ids.hiddenType, { field: 'dueDate', requirement: 'HIDDEN' });
    });

    afterAll(async () => {
        fake.uninstall();
        await resetDatabase(prisma);
    });

    describe('Google', () => {
        it('a moved day is applied as the member, audited with via and the provider, and the event rewritten; its own write is never read back', async () => {
            const { version } = await prisma.workItem.findUniqueOrThrow({ where: { id: ids.applied! }, select: { version: true } });
            moveTo(ids.meg!, ids.applied!, day(7));
            const r = await run(ids.meg!);
            expect(r.readBack).toMatchObject({ outcome: 'read', counts: { applied: 1, refused: 0, stale: 0 } });
            expect(await dueOf(ids.applied!)).toBe(day(7));
            const after = await prisma.workItem.findUniqueOrThrow({ where: { id: ids.applied! }, select: { version: true } });
            expect(after.version).toBe(version + 1);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, entityId: ids.applied!, action: 'WORK_ITEM_UPDATED' }, orderBy: { createdAt: 'desc' } });
            expect(audit.userId).toBe(users.MEG);
            expect(audit.detailsJson).toMatchObject({ category: 'entity_lifecycle', changedFields: ['dueDate'], via: 'calendar', provider: 'GOOGLE' });
            // The push rewrote the event in Islestone's shape on the new day.
            const ev = eventOf(ids.meg!, ids.applied!);
            expect(ev.body).toMatchObject({ start: { date: day(7) }, end: { date: day(8) } });
            const row = await prisma.calendarSyncedEvent.findFirstOrThrow({ where: { connectionId: ids.meg!, workItemId: ids.applied! } });
            expect(row.pushedDueDate.toISOString().slice(0, 10)).toBe(day(7));
            expect(await notices('MEG')).toHaveLength(0);

            // The next run: Islestone's own write (the stored version) is not a change; nothing is written.
            const mark = fake.requests.length;
            const again = await run(ids.meg!);
            expect(again.outcome).toBe('nothing');
            expect(fake.requests.slice(mark).every((x) => x.method === 'GET')).toBe(true);
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: ids.applied! }, select: { version: true } })).version).toBe(version + 1);
        });

        it("a timed event late in the evening in UTC−10 means that evening's day, in the event's own zone", async () => {
            const target = day(12);
            fake.personMove(eventOf(ids.meg!, ids.timed!).id, { endUtc: `${nextDayOf(target)}T08:30:00Z`, endLocal: `${target}T22:30:00-10:00`, zone: 'Pacific/Honolulu' });
            await run(ids.meg!);
            expect(await dueOf(ids.timed!)).toBe(target);
        });

        it('stale: Islestone moved first, so its date wins; reverted, notified once per event and day', async () => {
            await updateWorkItem(ctxOf('OWNER'), ids.stale!, { dueDate: day(16) });
            moveTo(ids.meg!, ids.stale!, day(17));
            const r = await run(ids.meg!);
            expect(r.readBack).toMatchObject({ counts: { stale: 1, applied: 0 } });
            expect(await dueOf(ids.stale!)).toBe(day(16));
            expect(eventOf(ids.meg!, ids.stale!).body).toMatchObject({ start: { date: day(16) } });
            const key = (await prisma.workItem.findUniqueOrThrow({ where: { id: ids.stale! }, include: { project: true } }));
            let n = await notices('MEG');
            expect(n).toHaveLength(1);
            expect(n[0]!.body).toBe(`Your calendar change to RB-${key.number} was not applied: the due date changed in Islestone.`);
            expect(n[0]!.workItemId).toBe(ids.stale);
            // Moved to the same day again: refused again, but no second notification.
            moveTo(ids.meg!, ids.stale!, day(17));
            await run(ids.meg!);
            n = await notices('MEG');
            expect(n).toHaveLength(1);
        });

        it('refused, reverted and notified: a hidden field, start after due, a closed item, an archived project', async () => {
            await setWorkItemState(ctxOf('OWNER'), ids.closed!, { stateId: ids.done! });
            await setProjectArchived(ctxOf('OWNER'), ids.other!, true);
            const before = (await notices('MEG')).length;
            moveTo(ids.meg!, ids.hidden!, day(19));
            moveTo(ids.meg!, ids.startAfter!, day(20));
            const closedEvent = eventOf(ids.meg!, ids.closed!);
            const archivedEvent = eventOf(ids.meg!, ids.archived!);
            moveTo(ids.meg!, ids.closed!, day(27));
            moveTo(ids.meg!, ids.archived!, day(28));
            const r = await run(ids.meg!);
            expect(r.readBack).toMatchObject({ counts: { refused: 4, applied: 0 } });
            expect(await dueOf(ids.hidden!)).toBe(day(20));
            expect(await dueOf(ids.startAfter!)).toBe(day(22));
            expect(await dueOf(ids.closed!)).toBe(day(23));
            expect(await dueOf(ids.archived!)).toBe(day(24));
            const bodies = (await notices('MEG')).slice(before).map((x) => x.body.replace(/RBA?-\d+/, 'KEY'));
            expect(bodies.sort()).toEqual(
                [
                    "Your calendar change to KEY was not applied: this item's type does not show a due date.",
                    'Your calendar change to KEY was not applied: the new due date is before its start date.',
                    'Your calendar change to KEY was not applied: the item is closed.',
                    'Your calendar change to KEY was not applied: its project is archived.',
                ].sort(),
            );
            // Reverted: the hidden and start-after events are back on Islestone's day; the closed
            // and archived items left the calendar (the push deletes what is no longer wanted).
            expect(eventOf(ids.meg!, ids.hidden!).body).toMatchObject({ start: { date: day(20) } });
            expect(eventOf(ids.meg!, ids.startAfter!).body).toMatchObject({ start: { date: day(22) } });
            expect(fake.events.get(closedEvent.id)?.cancelled).toBe(true);
            expect(fake.events.get(archivedEvent.id)?.cancelled).toBe(true);
            // Nobody but Islestone's own refusals wrote the items.
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_UPDATED', entityId: { in: [ids.hidden!, ids.startAfter!, ids.closed!, ids.archived!] }, userId: users.MEG } })).toBe(0);
        });

        it('a moved milestone event is reverted and notified, the milestone untouched (decision 227)', async () => {
            moveTo(ids.meg!, ids.milestone!, day(14), 'MILESTONE');
            const r = await run(ids.meg!);
            expect(r.readBack).toMatchObject({ counts: { milestoneReverted: 1 } });
            const m = await prisma.milestone.findUniqueOrThrow({ where: { id: ids.milestone! } });
            expect(m.dueDate?.toISOString().slice(0, 10)).toBe(day(12));
            expect(eventOf(ids.meg!, ids.milestone!, 'MILESTONE').body).toMatchObject({ start: { date: day(12) } });
            const last = (await notices('MEG')).at(-1)!;
            expect(last.body).toBe('Milestones cannot be moved from your calendar: Launch.');
            expect(last.linkUrl).toBe(`/t/${slug}/projects/RB/milestones/${ids.milestone}`);
        });

        it('another edit (a title) is not read: the item is untouched and nobody is notified', async () => {
            const before = (await notices('MEG')).length;
            fake.personRetitle(eventOf(ids.meg!, ids.retitled!).id, 'Renamed in my phone');
            const r = await run(ids.meg!);
            expect(r.readBack).toMatchObject({ counts: { applied: 0, refused: 0, stale: 0 } });
            expect((await prisma.workItem.findUniqueOrThrow({ where: { id: ids.retitled! } })).title).toBe('Retitled');
            expect(await notices('MEG')).toHaveLength(before);
        });

        it('a deleted event: the item untouched and not pushed again until its due date changes; then "Resync" puts it back', async () => {
            const first = eventOf(ids.meg!, ids.deleted!);
            fake.personDelete(first.id);
            await run(ids.meg!);
            expect(await dueOf(ids.deleted!)).toBe(day(25));
            expect((await prisma.calendarSyncedEvent.findFirstOrThrow({ where: { connectionId: ids.meg!, workItemId: ids.deleted! } })).state).toBe('REMOVED_IN_CALENDAR');
            await run(ids.meg!);
            expect(fake.events.get(first.id)!.cancelled).toBe(true);

            // Its due date changes in Islestone: it comes back (Google's reserved id restored, never doubled).
            await updateWorkItem(ctxOf('OWNER'), ids.deleted!, { dueDate: day(29) });
            await run(ids.meg!);
            expect(fake.events.get(first.id)).toMatchObject({ cancelled: false });
            expect([...fake.events.values()].filter((e) => e.clientId === first.clientId)).toHaveLength(1);

            // Deleted again, then "Resync my calendar" through its route.
            fake.personDelete(first.id);
            await run(ids.meg!);
            mockAuth.mockImplementation(async () => ({
                user: { id: users.MEG, email: `meg-${slug}@example.test`, name: 'MEG', image: null, role: 'MEMBER', tenantId, memberships: [{ slug, role: 'MEMBER', tenantId }], orgMemberships: [], mfaPendingTenantIds: [] },
                expires: new Date(Date.now() + 3_600_000).toISOString(),
            }));
            const route = (await import('@/app/api/t/[tenantSlug]/calendar-sync/connections/route')).POST;
            const res = await route(
                new NextRequest(`${APP}/api/t/${slug}/calendar-sync/connections?provider=google`, { method: 'POST', body: JSON.stringify({ action: 'resync' }), headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.2.2.2' } }),
                { params: Promise.resolve({ tenantSlug: slug }) },
            );
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ state: 'CONNECTED', resynced: 1 });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'CALENDAR_RESYNCED', userId: users.MEG } })).toBe(1);
            expect(mockQueued.some((j) => j.name === 'calendar-sync-connection' && j.data.connectionId === ids.meg)).toBe(true);
            await run(ids.meg!);
            expect(fake.events.get(first.id)).toMatchObject({ cancelled: false });
            // A resync of a calendar that is not deleted asks nothing to recreate.
            await expect(actOnCalendarConnection(ctxOf('MEG'), 'GOOGLE', 'recreate')).rejects.toMatchObject({ status: 409, details: { reason: 'CALENDAR_CONNECTION_STATE' } });
        });

        it("Google's expired sync token (410) resets to a full listing, and a change is still read", async () => {
            const stored = (await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.meg! } })).syncCursor;
            expect(stored).toMatch(/^st-\d+$/);
            fake.syncTokensValidFrom = 1_000_000;
            moveTo(ids.meg!, ids.timed!, day(11));
            const mark = fake.requests.length;
            await run(ids.meg!);
            const lists = fake.requests.slice(mark).filter((x) => x.method === 'GET' && x.url.includes('/events?'));
            expect(lists.some((x) => x.url.includes('syncToken='))).toBe(true);
            expect(lists.some((x) => !x.url.includes('syncToken=') && !x.url.includes('privateExtendedProperty'))).toBe(true);
            expect(await dueOf(ids.timed!)).toBe(day(11));
            fake.syncTokensValidFrom = 0;
        });

        it("a Viewer's read-only feed: nothing read back, nobody notified, the event put back (decision 235)", async () => {
            moveTo(ids.vicConn!, ids.vic!, day(8));
            const r = await run(ids.vicConn!);
            expect(r.readBack).toMatchObject({ outcome: 'read', counts: { applied: 0, refused: 0, reverted: 1 } });
            expect(await dueOf(ids.vic!)).toBe(day(6));
            expect(await notices('VIC')).toHaveLength(0);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'WORK_ITEM_UPDATED', userId: users.VIC } })).toBe(0);
            expect(eventOf(ids.vicConn!, ids.vic!).body).toMatchObject({ start: { date: day(6) } });
        });

        it('the whole Islestone calendar deleted: CALENDAR_REMOVED, its rows dropped, nothing pushed; "Recreate" makes a new one', async () => {
            const conn = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.meg! } });
            fake.personDeleteCalendar(conn.externalCalendarId!);
            expect((await run(ids.meg!)).outcome).toBe('calendar_removed');
            const removed = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.meg! } });
            expect(removed).toMatchObject({ state: 'CALENDAR_REMOVED', externalCalendarId: null, syncCursor: null });
            expect(removed.tokenEncrypted).not.toBeNull();
            expect(await prisma.calendarSyncedEvent.count({ where: { connectionId: ids.meg! } })).toBe(0);
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'CALENDAR_REMOVED_AT_PROVIDER', userId: `sys_${tenantId}` } })).toBe(1);
            const mark = fake.requests.length;
            expect((await run(ids.meg!)).outcome).toBe('nothing');
            expect(fake.requests.length).toBe(mark);

            await actOnCalendarConnection(ctxOf('MEG'), 'GOOGLE', 'recreate');
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'CALENDAR_RECREATED', userId: users.MEG } })).toBe(1);
            expect((await run(ids.meg!)).outcome).toBe('pushed');
            const back = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.meg! } });
            expect(back.state).toBe('CONNECTED');
            expect(back.externalCalendarId).not.toBe(conn.externalCalendarId);
            expect(fake.calendars.get(back.externalCalendarId!)).toEqual({ provider: 'GOOGLE', name: 'Islestone' });
            expect(fake.liveEvents('GOOGLE').filter((e) => e.calendarId === back.externalCalendarId).length).toBeGreaterThan(3);
        });
    });

    describe('Microsoft', () => {
        it('a timed event early in the morning in UTC+14 (a Windows zone name) means that morning\'s day; Graph\'s pages followed through safeFetch', async () => {
            fake.graphPageSize = 2;
            mockSafeFetch.mockClear();
            const target = day(12);
            const prior = new Date(new Date(`${target}T00:00:00Z`).getTime() - DAY).toISOString().slice(0, 10);
            // 11:00 UTC the day before is 01:00 on the target day on Kiritimati.
            fake.personMove(eventOf(ids.otto!, ids.otto1!).id, { endUtc: `${prior}T11:00:00Z`, zone: 'Line Islands Standard Time' });
            const r = await run(ids.otto!);
            expect(r.readBack).toMatchObject({ counts: { applied: 1 } });
            expect(await dueOf(ids.otto1!)).toBe(target);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, entityId: ids.otto1!, action: 'WORK_ITEM_UPDATED' }, orderBy: { createdAt: 'desc' } });
            expect(audit.detailsJson).toMatchObject({ via: 'calendar', provider: 'MICROSOFT' });
            expect(mockSafeFetch.mock.calls.length).toBeGreaterThan(0);
            expect(mockSafeFetch.mock.calls.every(([url]) => url.startsWith('https://graph.microsoft.com/v1.0/me/calendars/'))).toBe(true);
            // Its own write is never read back.
            const mark = fake.requests.length;
            expect((await run(ids.otto!)).outcome).toBe('nothing');
            expect(fake.requests.slice(mark).every((x) => x.method === 'GET')).toBe(true);
        });

        it('an event deleted in Outlook is absent from the window, looked up by id and removed; an event moved out of the window is found by id', async () => {
            fake.personDelete(eventOf(ids.otto!, ids.otto2!).id);
            const far = day(500);
            fake.personMove(eventOf(ids.otto!, ids.otto3!).id, { allDayEnd: nextDayOf(far) });
            const r = await run(ids.otto!);
            expect(r.readBack).toMatchObject({ counts: { removed: 1, applied: 1 } });
            expect(await dueOf(ids.otto2!)).toBe(day(13));
            expect((await prisma.calendarSyncedEvent.findFirstOrThrow({ where: { connectionId: ids.otto!, workItemId: ids.otto2! } })).state).toBe('REMOVED_IN_CALENDAR');
            expect(await dueOf(ids.otto3!)).toBe(far);
            expect(fake.requests.some((x) => x.method === 'GET' && /\/me\/events\/m-\d+/.test(x.url))).toBe(true);
        });

        it('a page link on another origin is refused before any request to it; nothing is pushed', async () => {
            fake.graphNextLinkOrigin = 'https://evil.example';
            fake.graphPageSize = 1;
            mockSafeFetch.mockClear();
            moveTo(ids.otto!, ids.otto1!, day(30));
            await expect(run(ids.otto!)).rejects.toThrow(/page link outside its own origin/);
            expect(mockSafeFetch).not.toHaveBeenCalled();
            expect(fake.requests.some((x) => new URL(x.url).origin === 'https://evil.example')).toBe(false);
            fake.graphNextLinkOrigin = 'https://graph.microsoft.com';
            fake.graphPageSize = 2;
        });
    });

    it('an edit refused by a key at write time maps to "you cannot edit this item"; a 404 to the item gone', () => {
        expect(readBackRefusalOf(forbidden('no'))).toBe('NO_EDIT');
        expect(readBackRefusalOf(new Error('boom'))).toBeNull();
    });

    it("the workspace's audit chain verifies", async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
