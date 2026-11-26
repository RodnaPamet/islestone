/**
 * Calendar sync end to end against a fake Google and Microsoft (roadmap 3.3b;
 * ADR 0011; docs/porting/maps/3.3.md, "Connecting a calendar", "The push",
 * "Disconnecting and teardown", "H3"; owner decisions 226 to 239).
 *
 * The real routes, usecases, repositories, encryption and row-level security,
 * with the providers faked at the fetch seam (`tests/helpers/fake-calendar-provider.ts`)
 * and the job queue captured. Covers: the connect flow (PKCE, the calendar
 * scope alone, a sealed single-use state bound to the member and the
 * workspace, the token encrypted under the workspace's key and never
 * audited); what is pushed (the member's open assigned items and their
 * projects' milestones; a title and one link, private, free, all-day;
 * nothing else); changes, a closed item's event deleted and a reopened one
 * restored (Google keeps a deleted id); H3's duplicates (an insert the
 * provider stored before the connection dropped is adopted); H3's revoked
 * tokens (REVOKED once, destroyed, audited as the system user, never called
 * again; a throttle is not revocation); the teardown (events before the
 * token, a failed delete kept and retried, then the empty calendar); member
 * removal, the switch off and Microsoft's consent withdrawn; and a
 * workspace's connection never pushing another's items.
 *
 * The callback's single use needs Redis (`claimStateNonce`); the suite needs
 * `REDIS_URL`, as CI's Integration job provides, unless `ALLOW_REDIS_SKIP=1`.
 */
import { NextRequest } from 'next/server';
import type { PrismaClient, Role } from '@prisma/client';

import { DB_AVAILABLE } from './db-helper';

const mockAuth = jest.fn();
jest.mock('@/auth', () => ({ auth: () => mockAuth() }));
const mockQueued: Array<{ name: string; data: Record<string, string>; jobId?: string }> = [];
jest.mock('@/app-layer/jobs/queue', () => ({
    enqueue: async (name: string, data: Record<string, string>, opts?: { jobId?: string }) => {
        mockQueued.push({ name, data, jobId: opts?.jobId });
        return { id: `job-${mockQueued.length}` };
    },
}));

import { calendarClientEventId } from '@/app-layer/domain/calendar-sync';
import { disconnectCalendar, startCalendarConnect } from '@/app-layer/usecases/calendar-connection';
import { dispatchCalendarSync, generateDesiredEvents, runCalendarSync, runCalendarTeardown } from '@/app-layer/usecases/calendar-sync-run';
import { recordMicrosoftConsent, setCalendarSyncEnabled, withdrawMicrosoftConsent } from '@/app-layer/usecases/calendar-sync-settings';
import { createMilestone } from '@/app-layer/usecases/milestone';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { assignWorkItem, createWorkItem, setWorkItemState, updateWorkItem } from '@/app-layer/usecases/work-item';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import type { RequestContext } from '@/app-layer/types';
import { verifyAuditChain } from '@/lib/audit';
import { disconnectRedis } from '@/lib/redis';
import { CONNECT_STATE_COOKIE } from '@/lib/calendar-sync/oauth-state';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';
import { getPermissionsForRole } from '@/lib/permissions';

import { FakeCalendarProvider } from '../helpers/fake-calendar-provider';
import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL && process.env.ALLOW_REDIS_SKIP !== '1') {
    throw new Error('[calendar-sync] REDIS_URL is not set: the callback claims its state once in Redis. Set REDIS_URL, or ALLOW_REDIS_SKIP=1 to skip this suite locally.');
}
const describeFn = DB_AVAILABLE && REDIS_URL ? describe : describe.skip;

const SUFFIX = Date.now().toString(36);
const APP = 'https://islestone.example.test';
const DIRECTORY = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

type Who = 'OWNER' | 'MEG' | 'VIC' | 'OTTO';
interface Side {
    tenantId: string;
    slug: string;
    users: Record<string, string>;
    memberships: Record<string, string>;
}

describeFn('calendar sync, end to end against a fake provider', () => {
    let prisma: PrismaClient;
    const fake = new FakeCalendarProvider();
    const a = {} as Side;
    const b = {} as Side;
    const ids: Record<string, string> = {};
    const roles: Record<Who, Role> = { OWNER: 'OWNER', MEG: 'MEMBER', VIC: 'VIEWER', OTTO: 'MEMBER' };

    const ctxOf = (side: Side, who: Who): RequestContext =>
        makeRequestContext(roles[who], { tenantId: side.tenantId, tenantSlug: side.slug, userId: side.users[who], appPermissions: getPermissionsForRole(roles[who]), requestId: `cal-${who}-${Math.random()}` });

    const sessionAs = (side: Side, who: Who) =>
        mockAuth.mockImplementation(async () => ({
            user: { id: side.users[who], email: `${who.toLowerCase()}-${side.slug}@example.test`, name: who, image: null, role: roles[who], tenantId: side.tenantId, memberships: [{ slug: side.slug, role: roles[who], tenantId: side.tenantId }], orgMemberships: [], mfaPendingTenantIds: [] },
            expires: new Date(Date.now() + 3_600_000).toISOString(),
        }));

    async function seed(side: Side, slug: string, who: Who[]) {
        side.slug = slug;
        side.tenantId = (await createTenantWithDek({ name: slug, slug })).id;
        side.users = {};
        side.memberships = {};
        for (const w of who) {
            const u = await prisma.user.create({ data: { email: `${w.toLowerCase()}-${slug}@example.test`, name: w } });
            const m = await prisma.tenantMembership.create({ data: { tenantId: side.tenantId, userId: u.id, role: roles[w] } });
            side.users[w] = u.id;
            side.memberships[w] = m.id;
        }
    }

    async function connectThroughRoutes(side: Side, who: Who, provider: 'google' | 'microsoft') {
        sessionAs(side, who);
        const connect = (await import('@/app/api/t/[tenantSlug]/calendar-sync/connect/route')).POST;
        const res = await connect(new NextRequest(`${APP}/api/t/${side.slug}/calendar-sync/connect?provider=${provider}`, { method: 'POST', headers: { 'x-forwarded-for': '10.1.1.1' } }), {
            params: Promise.resolve({ tenantSlug: side.slug }),
        });
        expect(res.status).toBe(200);
        const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
        const cookie = res.headers.get('set-cookie')!;
        const sealed = /isl_cal_connect=([^;]+)/.exec(cookie)![1]!;
        return { authorizeUrl: new URL(authorizeUrl), cookie, sealed };
    }

    async function callback(side: Side, who: Who, sealed: string, query: string) {
        sessionAs(side, who);
        const route = (await import('@/app/api/integrations/calendar/callback/route')).GET;
        const res = await route(new NextRequest(`${APP}/api/integrations/calendar/callback?${query}`, { headers: { cookie: `${CONNECT_STATE_COOKIE}=${sealed}` } }), { params: Promise.resolve({}) });
        return { status: res.status, location: res.headers.get('location') ?? '' };
    }

    async function connectFully(side: Side, who: Who, provider: 'google' | 'microsoft') {
        const { authorizeUrl, sealed } = await connectThroughRoutes(side, who, provider);
        const r = await callback(side, who, sealed, `state=${authorizeUrl.searchParams.get('state')}&code=code-${who}`);
        expect(r.location).toContain('calendar=connected');
        return prisma.calendarConnection.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId: side.tenantId, userId: side.users[who]!, provider: provider === 'google' ? 'GOOGLE' : 'MICROSOFT' } } });
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

        await seed(a, `cala${SUFFIX}`, ['OWNER', 'MEG', 'VIC', 'OTTO']);
        await seed(b, `calb${SUFFIX}`, ['OWNER', 'MEG']);
        for (const side of [a, b]) {
            const owner = ctxOf(side, 'OWNER');
            const team = await createTeam(owner, { name: 'Cal' });
            const project = await createProject(owner, { teamId: team.id, name: 'Calendar', keyPrefix: side === a ? 'CAL' : 'CBB' });
            const type = (await listWorkItemTypes(owner))[0]!;
            const states = Object.fromEntries(team.workflowStates.map((s) => [s.category, s.id]));
            ids[`${side.slug}:project`] = project.id;
            ids[`${side.slug}:projectKey`] = project.keyPrefix;
            ids[`${side.slug}:type`] = type.id;
            ids[`${side.slug}:done`] = states.DONE!;
            ids[`${side.slug}:started`] = states.STARTED!;
            const mk = async (title: string, extra: Record<string, unknown>) => (await createWorkItem(owner, { projectId: project.id, typeId: type.id, title, ...extra })).id;
            ids[`${side.slug}:soon`] = await mk(`Ship the release ${side.slug}`, { assigneeId: side.users.MEG, dueDate: day(3), description: 'SECRET-DESCRIPTION-TEXT' });
            ids[`${side.slug}:later`] = await mk(`Write the notes ${side.slug}`, { assigneeId: side.users.MEG, dueDate: day(40) });
            ids[`${side.slug}:undated`] = await mk(`No date ${side.slug}`, { assigneeId: side.users.MEG });
            ids[`${side.slug}:farFuture`] = await mk(`Next year ${side.slug}`, { assigneeId: side.users.MEG, dueDate: day(400) });
            ids[`${side.slug}:othersItem`] = await mk(`Not Meg's ${side.slug}`, { assigneeId: side.users.OWNER, dueDate: day(5) });
            ids[`${side.slug}:milestone`] = (await createMilestone(owner, project.id, { name: `Launch ${side.slug}`, dueDate: day(10) })).id;
            await setCalendarSyncEnabled(owner, { syncEnabled: true });
        }
        ids.vicItem = (await createWorkItem(ctxOf(a, 'OWNER'), { projectId: ids[`${a.slug}:project`]!, typeId: ids[`${a.slug}:type`]!, title: "Vic's review", assigneeId: a.users.VIC, dueDate: day(6) })).id;
    });

    afterAll(async () => {
        fake.uninstall();
        await resetDatabase(prisma);
        // The callback's single use opened the shared Redis client.
        await disconnectRedis();
    });

    describe('connecting', () => {
        it('connect: PKCE, the calendar scope alone, a sealed state; the callback stores an encrypted token, audits no secret, creates the Islestone calendar and queues the first run', async () => {
            const { authorizeUrl, cookie, sealed } = await connectThroughRoutes(a, 'MEG', 'google');
            expect(authorizeUrl.origin).toBe('https://accounts.google.com');
            expect(authorizeUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
            expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
            expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(`${APP}/api/integrations/calendar/callback`);
            expect(cookie).toMatch(/HttpOnly/i);
            expect(cookie).toMatch(/SameSite=lax/i);
            expect(cookie).toMatch(/Path=\/api\/integrations\/calendar/);

            const r = await callback(a, 'MEG', sealed, `state=${authorizeUrl.searchParams.get('state')}&code=meg-code`);
            expect(r.status).toBe(307);
            expect(r.location).toBe(`${APP}/t/${a.slug}/inbox/preferences?calendar=connected`);
            const exchange = fake.requests.find((x) => x.url === 'https://oauth2.googleapis.com/token')!;
            expect((exchange.body as Record<string, string>).code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);

            const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { tenantId_userId_provider: { tenantId: a.tenantId, userId: a.users.MEG!, provider: 'GOOGLE' } } });
            expect(row.state).toBe('CONNECTED');
            expect(row.tokenEncrypted).toMatch(/^v2:/);
            expect(row.tokenEncrypted).not.toContain('rt-');
            expect(fake.calendars.get(row.externalCalendarId!)).toEqual({ provider: 'GOOGLE', name: 'Islestone' });
            const audits = await prisma.auditLog.findMany({ where: { tenantId: a.tenantId, action: 'CALENDAR_CONNECTED' } });
            expect(audits).toHaveLength(1);
            expect(JSON.stringify(audits)).not.toMatch(/at-\d|rt-\d|accessToken|refreshToken/);
            expect(mockQueued.some((j) => j.name === 'calendar-sync-connection' && j.data.connectionId === row.id)).toBe(true);
            ids.megConnection = row.id;

            // The same state again: refused, nothing exchanged twice.
            const tokenCalls = fake.requests.filter((x) => x.url.endsWith('/token')).length;
            const again = await callback(a, 'MEG', sealed, `state=${authorizeUrl.searchParams.get('state')}&code=meg-code`);
            expect(again.location).toContain('calendar=failed');
            expect(fake.requests.filter((x) => x.url.endsWith('/token')).length).toBe(tokenCalls);
        });

        it('the callback refuses a state minted for another person or another workspace, a wrong state and a missing cookie; nothing is stored', async () => {
            const { authorizeUrl, sealed } = await connectThroughRoutes(a, 'OTTO', 'google');
            const state = authorizeUrl.searchParams.get('state')!;
            expect((await callback(a, 'VIC', sealed, `state=${state}&code=x`)).location).toContain('calendar=failed');
            expect((await callback(b, 'MEG', sealed, `state=${state}&code=x`)).location).toContain('calendar=failed');
            expect((await callback(a, 'OTTO', sealed, `state=not-the-state&code=x`)).location).toContain('calendar=failed');
            expect((await callback(a, 'OTTO', '', `state=${state}&code=x`)).location).toContain('calendar=failed');
            expect(await prisma.calendarConnection.count({ where: { userId: { in: [a.users.VIC!, a.users.OTTO!, b.users.MEG!] } } })).toBe(0);
            // A provider's refusal is recorded by its code only.
            expect((await callback(a, 'OTTO', sealed, `state=${state}&error=access_denied&error_description=Someone%20said%20no`)).location).toContain('calendar=declined');
        });

        it('is refused while the switch is off, for Microsoft without consent, and to a guest', async () => {
            await setCalendarSyncEnabled(ctxOf(b, 'OWNER'), { syncEnabled: false });
            await expect(startCalendarConnect(ctxOf(b, 'MEG'), 'GOOGLE')).rejects.toMatchObject({ status: 409, details: { reason: 'CALENDAR_SYNC_OFF' } });
            await setCalendarSyncEnabled(ctxOf(b, 'OWNER'), { syncEnabled: true });
            await expect(startCalendarConnect(ctxOf(b, 'MEG'), 'MICROSOFT')).rejects.toMatchObject({ status: 409, details: { reason: 'MICROSOFT_NOT_AUTHORISED' } });
            await expect(startCalendarConnect(makeRequestContext('GUEST', { tenantId: b.tenantId, tenantSlug: b.slug, userId: b.users.MEG, appPermissions: getPermissionsForRole('GUEST') }), 'GOOGLE')).rejects.toMatchObject({ status: 403 });
        });
    });

    describe('the push', () => {
        it("pushes the member's open assigned items in the window and their project's milestone: a title and one link, private, free, all-day; nothing else", async () => {
            const before = fake.requests.length;
            const r = await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            expect(r.outcome).toBe('pushed');
            const calendarId = (await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.megConnection! } })).externalCalendarId!;
            const events = fake.liveEvents('GOOGLE').filter((e) => e.calendarId === calendarId);
            expect(events.map((e) => e.body.summary).sort()).toEqual([`Launch ${a.slug}`, `Ship the release ${a.slug}`, `Write the notes ${a.slug}`]);
            const ship = events.find((e) => e.body.summary === `Ship the release ${a.slug}`)!;
            expect(ship.body.description).toMatch(new RegExp(`^${APP}/t/${a.slug}/work-items/CAL-\\d+$`));
            expect(ship.body).toMatchObject({ start: { date: day(3) }, end: { date: day(4) }, visibility: 'private', transparency: 'transparent' });
            const launch = events.find((e) => e.body.summary === `Launch ${a.slug}`)!;
            expect(launch.body.description).toBe(`${APP}/t/${a.slug}/projects/CAL/milestones/${ids[`${a.slug}:milestone`]}`);
            // Exactly these keys left, and no description, comment, person or key outside the link.
            for (const body of fake.requests.slice(before).filter((x) => x.method === 'POST' && x.url.includes('/events')).map((x) => x.body as Record<string, unknown>)) {
                expect(Object.keys(body).sort()).toEqual(['description', 'end', 'extendedProperties', 'id', 'start', 'summary', 'transparency', 'visibility']);
            }
            expect(JSON.stringify(fake.requests.slice(before))).not.toMatch(/SECRET-DESCRIPTION-TEXT|example\.test"|Not Meg's|Next year|No date/);
            const rows = await prisma.calendarSyncedEvent.findMany({ where: { connectionId: ids.megConnection! } });
            expect(rows).toHaveLength(3);
            expect(rows.every((x) => x.state === 'PUSHED' && x.remoteEventId && x.remoteVersion)).toBe(true);

            // The synced-event rows are bookkeeping, outside the audit extension (owner decision,
            // 2026-11-26); the connection's own writes are still recorded.
            const trail = await prisma.auditLog.findMany({ where: { tenantId: a.tenantId }, select: { detailsJson: true } });
            const lifecycle = trail.map((x) => x.detailsJson as { category?: string; entityName?: string } | null).filter((d) => d?.category === 'entity_lifecycle');
            const entities = new Set(lifecycle.map((d) => d!.entityName));
            expect(entities.has('CalendarSyncedEvent')).toBe(false);
            expect(entities.has('CalendarConnection')).toBe(true);

            // An unchanged calendar: the next run makes no provider call.
            const settled = fake.requests.length;
            expect((await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! })).outcome).toBe('nothing');
            expect(fake.requests.length).toBe(settled);
        });

        it("a workspace's connection never pushes another workspace's items", async () => {
            const meg = ctxOf(a, 'MEG');
            const desired = await generateDesiredEvents({ ...meg, actorType: 'JOB' }, a.slug);
            expect(desired.events.map((e) => e.title).every((t) => t.endsWith(a.slug))).toBe(true);
            expect(desired.events.some((e) => e.title.includes(b.slug))).toBe(false);
        });

        it("a retitled item is patched; a closed item's event is deleted; reopened, Google's reserved id is restored, never doubled", async () => {
            const owner = ctxOf(a, 'OWNER');
            const soon = ids[`${a.slug}:soon`]!;
            const { version } = await prisma.workItem.findUniqueOrThrow({ where: { id: soon }, select: { version: true } });
            await updateWorkItem(owner, soon, { title: 'Ship the release, renamed' }, version);
            await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            expect(fake.liveEvents('GOOGLE').map((e) => e.body.summary)).toContain('Ship the release, renamed');

            await setWorkItemState(owner, soon, { stateId: ids[`${a.slug}:done`]! });
            await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            expect(fake.liveEvents('GOOGLE').map((e) => e.body.summary)).not.toContain('Ship the release, renamed');
            expect(await prisma.calendarSyncedEvent.count({ where: { connectionId: ids.megConnection!, workItemId: soon } })).toBe(0);

            await setWorkItemState(owner, soon, { stateId: ids[`${a.slug}:started`]! });
            await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            const clientId = calendarClientEventId({ tenantId: a.tenantId, connectionId: ids.megConnection!, kind: 'WORK_ITEM', sourceId: soon });
            expect([...fake.events.values()].filter((e) => e.clientId === clientId)).toHaveLength(1);
            expect(fake.liveEvents('GOOGLE').map((e) => e.body.summary)).toContain('Ship the release, renamed');
        });

        it('H3 duplicates: an insert the provider stored before the connection dropped is adopted, even when the provider does not refuse a second insert', async () => {
            const owner = ctxOf(a, 'OWNER');
            const id = (await createWorkItem(owner, { projectId: ids[`${a.slug}:project`]!, typeId: ids[`${a.slug}:type`]!, title: 'Crash test', assigneeId: a.users.MEG, dueDate: day(8) })).id;
            fake.crashAfterInserts = 1;
            fake.detectCollisions = false;
            expect((await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! })).outcome).toBe('failed');
            const row = await prisma.calendarSyncedEvent.findFirstOrThrow({ where: { connectionId: ids.megConnection!, workItemId: id } });
            expect(row).toMatchObject({ remoteEventId: '', state: 'FAILED' });
            await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            await runCalendarSync({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            fake.detectCollisions = true;
            const clientId = calendarClientEventId({ tenantId: a.tenantId, connectionId: ids.megConnection!, kind: 'WORK_ITEM', sourceId: id });
            expect([...fake.events.values()].filter((e) => e.clientId === clientId)).toHaveLength(1);
            expect((await prisma.calendarSyncedEvent.findFirstOrThrow({ where: { connectionId: ids.megConnection!, workItemId: id } })).state).toBe('PUSHED');
        });

        it('a change queues a run for the assignee within a minute (decision 233)', async () => {
            mockQueued.length = 0;
            await assignWorkItem(ctxOf(a, 'OWNER'), ids[`${a.slug}:othersItem`]!, { assigneeId: a.users.MEG! });
            expect(mockQueued.filter((j) => j.name === 'calendar-sync-connection').map((j) => j.data.connectionId)).toContain(ids.megConnection);
            expect(mockQueued.every((j) => !j.jobId || !j.jobId.includes(':'))).toBe(true);
        });

        it('the dispatcher queues a run for each live connection', async () => {
            mockQueued.length = 0;
            const r = await dispatchCalendarSync();
            expect(r.runs).toBeGreaterThanOrEqual(1);
            expect(mockQueued.filter((j) => j.name === 'calendar-sync-connection').map((j) => j.data.connectionId)).toContain(ids.megConnection);
        });
    });

    describe('revoked tokens (H3)', () => {
        it('a throttle is not a revocation; a refused call is: REVOKED once, the token destroyed, one audit entry as the system user, never called again', async () => {
            const conn = await connectFully(a, 'OTTO', 'google');
            await prisma.workItem.update({ where: { id: ids[`${a.slug}:othersItem`]! }, data: { assigneeId: a.users.OTTO } });
            fake.throttle = true;
            expect((await runCalendarSync({ tenantId: a.tenantId, connectionId: conn.id })).outcome).toBe('throttled');
            fake.throttle = false;
            expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).state).toBe('CONNECTED');
            await runCalendarSync({ tenantId: a.tenantId, connectionId: conn.id });

            fake.refuseCalls = true;
            await prisma.workItem.update({ where: { id: ids[`${a.slug}:othersItem`]! }, data: { title: 'force a patch' } });
            await expect(runCalendarSync({ tenantId: a.tenantId, connectionId: conn.id })).rejects.toThrow(/refused/);
            fake.refuseCalls = false;
            const row = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
            expect(row).toMatchObject({ state: 'REVOKED', revokedReason: 'ACCESS_WITHDRAWN', tokenEncrypted: null });
            const audit = await prisma.auditLog.findMany({ where: { tenantId: a.tenantId, action: 'CALENDAR_CONNECTION_REVOKED' } });
            expect(audit).toHaveLength(1);
            expect(audit[0]!.userId).toBe(`sys_${a.tenantId}`);
            const before = fake.requests.length;
            expect((await runCalendarSync({ tenantId: a.tenantId, connectionId: conn.id })).outcome).toBe('nothing');
            expect(fake.requests.length).toBe(before);
            expect(await prisma.calendarSyncedEvent.count({ where: { connectionId: conn.id, state: { not: 'PENDING_DELETE' } } })).toBe(0);
            ids.ottoConnection = conn.id;
        });

        it('a refused refresh (400 invalid_grant) revokes too, with its own reason', async () => {
            const conn = await connectFully(b, 'MEG', 'google');
            // Make the stored token expired so the run refreshes it.
            const { runInTenantContext } = await import('@/lib/db/rls-middleware');
            await runInTenantContext(ctxOf(b, 'OWNER'), (db) => db.calendarConnection.update({ where: { id: conn.id }, data: { tokenEncrypted: JSON.stringify({ accessToken: 'old', refreshToken: 'rt-old', expiresAt: 1 }) } }));
            fake.refuseRefresh = true;
            await expect(runCalendarSync({ tenantId: b.tenantId, connectionId: conn.id })).rejects.toThrow(/refused/);
            fake.refuseRefresh = false;
            expect(await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).toMatchObject({ state: 'REVOKED', revokedReason: 'GRANT_INVALID', tokenEncrypted: null });
            // Nothing anywhere asked Google to revoke a token (decision 236).
            expect(fake.requests.some((x) => /revoke/.test(x.url))).toBe(false);
        });
    });

    describe('teardown (decision 239)', () => {
        it("disconnect deletes every event before the token, keeps a row whose delete failed and retries, then deletes the empty calendar; a Viewer's feed included", async () => {
            const conn = await connectFully(a, 'VIC', 'google');
            await runCalendarSync({ tenantId: a.tenantId, connectionId: conn.id });
            const calendarId = conn.externalCalendarId!;
            expect(fake.liveEvents().filter((e) => e.calendarId === calendarId).map((e) => e.body.summary)).toEqual(expect.arrayContaining(["Vic's review", `Launch ${a.slug}`]));

            mockQueued.length = 0;
            await disconnectCalendar(ctxOf(a, 'VIC'), 'GOOGLE');
            expect(mockQueued.map((j) => j.name)).toEqual(['calendar-teardown']);
            fake.failDeletes = true;
            await expect(runCalendarTeardown({ tenantId: a.tenantId, connectionId: conn.id })).rejects.toThrow(/could not be removed/);
            fake.failDeletes = false;
            const kept = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
            expect(kept.state).toBe('DISCONNECTING');
            expect(kept.tokenEncrypted).not.toBeNull();
            expect(await prisma.calendarSyncedEvent.count({ where: { connectionId: conn.id, state: 'PENDING_DELETE' } })).toBeGreaterThan(0);

            const mark = fake.requests.length;
            expect((await runCalendarTeardown({ tenantId: a.tenantId, connectionId: conn.id })).outcome).toBe('torn_down');
            const after = fake.requests.slice(mark);
            const eventDeletes = after.map((x, i) => ({ ...x, i })).filter((x) => x.method === 'DELETE' && x.url.includes('/events/'));
            const calendarDelete = after.findIndex((x) => x.method === 'DELETE' && x.url.endsWith(`/calendars/${encodeURIComponent(calendarId)}`));
            expect(eventDeletes.length).toBeGreaterThan(0);
            expect(calendarDelete).toBeGreaterThan(Math.max(...eventDeletes.map((x) => x.i)));
            expect(fake.calendars.has(calendarId)).toBe(false);
            expect(await prisma.calendarConnection.count({ where: { id: conn.id } })).toBe(0);
            expect(await prisma.calendarSyncedEvent.count({ where: { connectionId: conn.id } })).toBe(0);
            expect(await prisma.auditLog.count({ where: { tenantId: a.tenantId, action: 'CALENDAR_DISCONNECTED' } })).toBe(1);
        });

        it('a revoked connection disconnects locally: nothing can be removed remotely, the rows go with it', async () => {
            await disconnectCalendar(ctxOf(a, 'OTTO'), 'GOOGLE');
            const before = fake.requests.length;
            expect((await runCalendarTeardown({ tenantId: a.tenantId, connectionId: ids.ottoConnection! })).outcome).toBe('torn_down');
            expect(fake.requests.length).toBe(before);
            expect(await prisma.calendarConnection.count({ where: { id: ids.ottoConnection! } })).toBe(0);
        });

        it("removing a member deletes their events from their calendar, then the token", async () => {
            mockQueued.length = 0;
            await removeTenantMember(ctxOf(a, 'OWNER'), { membershipId: a.memberships.MEG! });
            expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.megConnection! } })).state).toBe('DISCONNECTING');
            expect(mockQueued.filter((j) => j.name === 'calendar-teardown').map((j) => j.data.connectionId)).toEqual([ids.megConnection]);
            const calendarId = (await prisma.calendarConnection.findUniqueOrThrow({ where: { id: ids.megConnection! } })).externalCalendarId!;
            await runCalendarTeardown({ tenantId: a.tenantId, connectionId: ids.megConnection! });
            expect(fake.liveEvents().filter((e) => e.calendarId === calendarId)).toEqual([]);
            expect(await prisma.calendarConnection.count({ where: { id: ids.megConnection! } })).toBe(0);
            expect(await prisma.auditLog.count({ where: { tenantId: a.tenantId, action: 'CALENDAR_CONNECTIONS_TORN_DOWN_ON_MEMBER_REMOVAL' } })).toBe(1);
        });

        it("Microsoft: the consent recorded, an Outlook connection pushed through Graph, then the consent withdrawn tears it down; the switch off tears down the rest", async () => {
            const owner = ctxOf(b, 'OWNER');
            await recordMicrosoftConsent(owner, { directoryId: DIRECTORY });
            const conn = await connectFully(b, 'OWNER', 'microsoft');
            expect(fake.requests.some((x) => x.url === `https://login.microsoftonline.com/${DIRECTORY}/oauth2/v2.0/token`)).toBe(true);
            await runCalendarSync({ tenantId: b.tenantId, connectionId: conn.id });
            const outlook = fake.liveEvents('MICROSOFT');
            expect(outlook.map((e) => e.body.subject)).toEqual(expect.arrayContaining([`Not Meg's ${b.slug}`, `Launch ${b.slug}`]));
            expect(outlook.every((e) => e.body.sensitivity === 'private' && e.body.showAs === 'free' && e.body.isAllDay === true)).toBe(true);

            await withdrawMicrosoftConsent(owner);
            expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).state).toBe('DISCONNECTING');
            await runCalendarTeardown({ tenantId: b.tenantId, connectionId: conn.id });
            expect(fake.liveEvents('MICROSOFT')).toEqual([]);
            expect(await prisma.auditLog.count({ where: { tenantId: b.tenantId, action: { in: ['CALENDAR_MICROSOFT_CONSENT_GRANTED', 'CALENDAR_MICROSOFT_CONSENT_REVOKED'] } } })).toBe(2);

            // The switch off moves every remaining connection to the teardown.
            const left = await connectFully(a, 'OWNER', 'google');
            await setCalendarSyncEnabled(ctxOf(a, 'OWNER'), { syncEnabled: false });
            expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: left.id } })).state).toBe('DISCONNECTING');
        });
    });

    it("the workspaces' audit chains verify", async () => {
        expect((await verifyAuditChain(a.tenantId)).valid).toBe(true);
        expect((await verifyAuditChain(b.tenantId)).valid).toBe(true);
    });
});
