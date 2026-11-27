/**
 * Time entries and timers (sub-phase 3.4b; docs/porting/maps/3.4.md, "Time
 * entries and timers (3.4b)"; ADR 0012 §2; owner decisions 260 to 267, 277
 * and 278), against a real Postgres:
 *
 *   - the catalogue: one running timer per person per workspace, the CHECKs,
 *     the work item's link clearing only its own column;
 *   - adding time: one work item, open and closed items, never a deleted
 *     item or an archived project; to the minute; a day of at most 24 hours;
 *     the description sanitised and encrypted, never audited;
 *   - changing and deleting one's own entries only; a delete for good, the
 *     audit keeping its date and minutes;
 *   - a person only: an API key and a job refused with an audited 403;
 *   - the timer: start, the one that was on stopped and recorded, the
 *     12-hour cap, fewer minutes stated, under 30 seconds discarded, two
 *     starts racing leaving one timer, the day it counts on in the zone;
 *   - the week and an item's time, and who sees what (decision 266);
 *   - entries staying with their project on a move, kept on a purge (the
 *     item reads "Deleted item"), a project with time kept as a tombstone
 *     (issue #117; project-tombstone.test.ts);
 *   - member removal stopping the timer;
 *   - two-tenant isolation (ISOLATION_TESTED: TimeEntry).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { purgeWorkspaceWorkItems } from '@/app-layer/usecases/work-item-purge';
import { createProject, deleteProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import {
    addTimeEntry,
    deleteTimeEntry,
    getRunningTimer,
    getTimeWeek,
    getWorkItemTime,
    startTimer,
    stopTimer,
    updateTimeEntry,
} from '@/app-layer/usecases/time-entry';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem, setWorkItemState } from '@/app-layer/usecases/work-item';
import { moveWorkItemToProject } from '@/app-layer/usecases/work-item-moves';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `tme${Date.now().toString(36)}`;

/** The error's `details.reason`, or its status and message. */
async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

/** A date `n` days after 2051-03-06, a Monday (date-only). */
function day(n: number): string {
    return new Date(Date.UTC(2051, 2, 6) + n * 86_400_000).toISOString().slice(0, 10);
}

describeFn('time entries and timers (3.4b)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let other: RequestContext;
    let teamId = '';
    let projectId = '';
    let otherProjectId = '';
    let typeId = '';
    let doneStateId = '';

    const item = async (title = `item ${Math.random().toString(36).slice(2, 8)}`, project = projectId) =>
        (await createWorkItem(owner, { projectId: project, typeId, title })).id;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'MEMBER' | 'VIEWER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('owner', 'OWNER');
        member = await mk('member', 'MEMBER');
        viewer = await mk('viewer', 'VIEWER');
        other = await mk('other', 'MEMBER');
        const team = await createTeam(owner, { name: 'Time' });
        teamId = team.id;
        doneStateId = team.workflowStates.find((s) => s.category === 'DONE')!.id;
        projectId = (await createProject(owner, { teamId, name: 'Time', keyPrefix: 'TME' })).id;
        otherProjectId = (await createProject(owner, { teamId, name: 'Time other', keyPrefix: 'TMO' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('holds one running timer per person per workspace, the CHECKs and the link clearing its own column', async () => {
            const idx = await prisma.$queryRaw<Array<{ indexdef: string }>>`SELECT indexdef FROM pg_indexes WHERE indexname = 'TimeEntry_one_timer_per_person'`;
            expect(idx[0]?.indexdef).toMatch(/UNIQUE INDEX .* \("tenantId", "userId"\) WHERE \(minutes IS NULL\)/);
            const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint WHERE conrelid = '"TimeEntry"'::regclass AND contype = 'c' ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual([
                'TimeEntry_frozen_rate_billable',
                'TimeEntry_frozen_rate_whole',
                'TimeEntry_minutes_range',
                'TimeEntry_own_time',
                'TimeEntry_running_is_timer',
                'TimeEntry_timer_started_iff_timer',
                'TimeEntry_version_positive',
            ]);
            const fk = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'TimeEntry_workItemId_tenantId_fkey'`;
            expect(fk[0]?.def).toContain('ON DELETE SET NULL ("workItemId")');
            const rls = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
                SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'TimeEntry'`;
            expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
        });

        it('refuses a row no usecase would write, whatever the writer', async () => {
            const id = await item();
            const base = { tenantId, userId: member.userId, createdByUserId: member.userId, workItemId: id, projectId, workDate: new Date(`${day(400)}T00:00:00Z`) };
            await expect(prisma.timeEntry.create({ data: { ...base, minutes: 0, source: 'MANUAL' } })).rejects.toThrow(/TimeEntry_minutes_range/);
            await expect(prisma.timeEntry.create({ data: { ...base, minutes: 1441, source: 'MANUAL' } })).rejects.toThrow(/TimeEntry_minutes_range/);
            await expect(prisma.timeEntry.create({ data: { ...base, minutes: null, source: 'MANUAL' } })).rejects.toThrow(/TimeEntry_running_is_timer|TimeEntry_timer_started_iff_timer/);
            await expect(prisma.timeEntry.create({ data: { ...base, minutes: 10, source: 'TIMER' } })).rejects.toThrow(/TimeEntry_timer_started_iff_timer/);
            await expect(prisma.timeEntry.create({ data: { ...base, createdByUserId: owner.userId, minutes: 10, source: 'MANUAL' } })).rejects.toThrow(/TimeEntry_own_time/);
            await prisma.timeEntry.create({ data: { ...base, minutes: null, source: 'TIMER', timerStartedAt: new Date() } });
            await expect(prisma.timeEntry.create({ data: { ...base, minutes: null, source: 'TIMER', timerStartedAt: new Date() } })).rejects.toThrow(/Unique constraint|TimeEntry_one_timer_per_person/);
            await prisma.timeEntry.deleteMany({ where: { tenantId, userId: member.userId } });
        });
    });

    describe('adding time', () => {
        it('records minutes on one item, unrounded, unticked, sanitised and encrypted, the audit naming numbers only', async () => {
            const id = await item('add one');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: day(0), minutes: 37, description: 'Wrote <script>alert(1)</script>the draft' });
            expect(entry).toMatchObject({ workItemId: id, projectId, workDate: day(0), minutes: 37, source: 'MANUAL', billable: false, description: 'Wrote the draft', version: 1 });
            const raw = await prisma.$queryRaw<Array<{ description: string }>>`SELECT "description" FROM "TimeEntry" WHERE id = ${entry.id}`;
            expect(raw[0]!.description).not.toContain('draft');
            expect(raw[0]!.description).toMatch(/^v\d:/);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIME_ENTRY_CREATED', entityId: entry.id } });
            expect(audit.metadataJson).toMatchObject({ workItemId: id, workDate: day(0), minutes: 37, billable: false, timer: false });
            expect(JSON.stringify(audit)).not.toContain('draft');
        });

        it('takes closed items, refuses deleted items and archived projects (decision 261)', async () => {
            const closed = await item('closed');
            await setWorkItemState(owner, closed, { stateId: doneStateId });
            expect((await addTimeEntry(member, { workItemId: closed, workDate: day(1), minutes: 5 })).minutes).toBe(5);
            const gone = await item('gone');
            await deleteWorkItem(owner, gone);
            expect(await reasonOf(addTimeEntry(member, { workItemId: gone, workDate: day(1), minutes: 5 }))).toMatch(/404/);
            const archivedProject = (await createProject(owner, { teamId, name: 'Archived time', keyPrefix: 'TMA' })).id;
            const inArchived = await item('archived', archivedProject);
            await setProjectArchived(owner, archivedProject, true);
            expect(await reasonOf(addTimeEntry(member, { workItemId: inArchived, workDate: day(1), minutes: 5 }))).toBe('PROJECT_ARCHIVED');
        });

        it('holds a person\'s day to 24 hours (409 DAY_FULL), also under parallel writes', async () => {
            const id = await item('full day');
            await addTimeEntry(member, { workItemId: id, workDate: day(2), minutes: 1_400 });
            expect(await reasonOf(addTimeEntry(member, { workItemId: id, workDate: day(2), minutes: 41 }))).toBe('DAY_FULL');
            expect((await addTimeEntry(member, { workItemId: id, workDate: day(2), minutes: 40 })).minutes).toBe(40);
            // Another person's day is their own.
            expect((await addTimeEntry(other, { workItemId: id, workDate: day(2), minutes: 600 })).minutes).toBe(600);
            // Ten writes of 200 minutes at once on one day: the week's lock lets seven through.
            const results = await Promise.allSettled(Array.from({ length: 10 }, () => addTimeEntry(member, { workItemId: id, workDate: day(3), minutes: 200 })));
            expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(7);
            const sum = await prisma.timeEntry.aggregate({ where: { tenantId, userId: member.userId, workDate: new Date(`${day(3)}T00:00:00Z`) }, _sum: { minutes: true } });
            expect(sum._sum.minutes).toBe(1_400);
        });
    });

    describe('changing and deleting', () => {
        it('changes one\'s own entry, versioned, moving it across weeks; refuses another person\'s as a 404', async () => {
            const id = await item('change');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: day(4), minutes: 30 });
            const changed = await updateTimeEntry(member, entry.id, { minutes: 45, workDate: day(9), billable: true }, 1);
            expect(changed).toMatchObject({ minutes: 45, workDate: day(9), billable: true, version: 2 });
            expect(await reasonOf(updateTimeEntry(member, entry.id, { minutes: 50 }, 1))).toBe('VERSION_CONFLICT');
            expect(await reasonOf(updateTimeEntry(other, entry.id, { minutes: 50 }))).toMatch(/404/);
            expect(await reasonOf(deleteTimeEntry(owner, entry.id))).toMatch(/404/);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIME_ENTRY_UPDATED', entityId: entry.id } });
            expect(audit.detailsJson).toMatchObject({ changedFields: ['workDate', 'minutes', 'billable'] });
            // Re-picking the item records the time in the new item's project.
            const elsewhere = await item('elsewhere', otherProjectId);
            expect((await updateTimeEntry(member, entry.id, { workItemId: elsewhere })).projectId).toBe(otherProjectId);
        });

        it('deletes for good, the audit keeping the date and the minutes (decision 277)', async () => {
            const id = await item('delete');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: day(5), minutes: 25 });
            await deleteTimeEntry(member, entry.id);
            expect(await prisma.timeEntry.count({ where: { id: entry.id } })).toBe(0);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIME_ENTRY_DELETED', entityId: entry.id } });
            expect(audit.metadataJson).toMatchObject({ workDate: day(5), minutes: 25 });
        });
    });

    describe('a person only (decision 278)', () => {
        it('refuses an API key and a job with an audited 403, and a Viewer by its key', async () => {
            const id = await item('machines');
            const key = { ...member, apiKeyId: 'key_1', requestId: `${TAG}-key` } as RequestContext;
            expect(await reasonOf(addTimeEntry(key, { workItemId: id, workDate: day(6), minutes: 5 }))).toBe('NOT_A_PERSON');
            expect(await reasonOf(startTimer(key, { workItemId: id, timeZone: 'UTC' }))).toBe('NOT_A_PERSON');
            const job = { ...member, actorType: 'JOB', requestId: `${TAG}-job` } as RequestContext;
            expect(await reasonOf(addTimeEntry(job, { workItemId: id, workDate: day(6), minutes: 5 }))).toBe('NOT_A_PERSON');
            const denied = await prisma.auditLog.findMany({ where: { tenantId, action: 'AUTHZ_DENIED', requestId: { in: [`${TAG}-key`, `${TAG}-job`] } } });
            expect(denied.length).toBe(3);
            expect(await reasonOf(addTimeEntry(viewer, { workItemId: id, workDate: day(6), minutes: 5 }))).toMatch(/403/);
            expect(await prisma.timeEntry.count({ where: { workItemId: id } })).toBe(0);
        });
    });

    describe('the timer', () => {
        const backdate = async (minutesAgo: number) => {
            await prisma.timeEntry.updateMany({ where: { tenantId, userId: member.userId, minutes: null }, data: { timerStartedAt: new Date(Date.now() - minutesAgo * 60_000) } });
        };

        it('starts on today in the zone, and a second start stops and records the first (decision 262)', async () => {
            const a = await item('timer a');
            const b = await item('timer b');
            const started = await startTimer(member, { workItemId: a, timeZone: 'Pacific/Kiritimati' });
            expect(started.entry).toMatchObject({ minutes: null, source: 'TIMER', workItemId: a });
            const kiritimati = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
            expect(started.entry.workDate).toBe(kiritimati);
            await backdate(42);
            const next = await startTimer(member, { workItemId: b, timeZone: 'Pacific/Kiritimati' });
            const first = await prisma.timeEntry.findUniqueOrThrow({ where: { id: started.entry.id } });
            expect(first.minutes).toBe(42);
            expect((await getRunningTimer(member)).timer?.entry.id).toBe(next.entry.id);
            expect(await reasonOf(startTimer(member, { workItemId: b, timeZone: 'Not/AZone' }))).toBe('TIME_ZONE_UNKNOWN');
            expect(await reasonOf(updateTimeEntry(member, next.entry.id, { minutes: 5 }))).toBe('TIMER_ON');
            await deleteTimeEntry(member, next.entry.id);
            expect((await getRunningTimer(member)).timer).toBeNull();
        });

        it('stops at 12 hours, takes fewer minutes, refuses more, and discards under 30 seconds (decision 263)', async () => {
            const id = await item('timer cap');
            await startTimer(member, { workItemId: id, timeZone: 'UTC' });
            await backdate(20 * 60);
            expect((await getRunningTimer(member)).timer?.stoppedCounting).toBe(true);
            expect((await stopTimer(member)).entry?.minutes).toBe(720);

            await startTimer(member, { workItemId: id, timeZone: 'UTC' });
            await backdate(90);
            expect(await reasonOf(stopTimer(member, { minutes: 91 }))).toBe('TIMER_MINUTES');
            expect((await stopTimer(member, { minutes: 60 })).entry?.minutes).toBe(60);

            const quick = await startTimer(member, { workItemId: id, timeZone: 'UTC' });
            expect(await stopTimer(member)).toEqual({ entry: null, discarded: true });
            expect(await prisma.timeEntry.count({ where: { id: quick.entry.id } })).toBe(0);
            expect(await reasonOf(stopTimer(member))).toBe('TIMER_OFF');
        });

        it('leaves one timer when two starts race on two devices', async () => {
            const id = await item('race');
            const results = await Promise.allSettled([startTimer(other, { workItemId: id, timeZone: 'UTC' }), startTimer(other, { workItemId: id, timeZone: 'UTC' })]);
            expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
            expect(await prisma.timeEntry.count({ where: { tenantId, userId: other.userId, minutes: null } })).toBe(1);
            await stopTimer(other);
        });
    });

    describe('reads and who sees what (decision 266)', () => {
        it("reads one's week with its day totals; another member's only with time.approve", async () => {
            const id = await item('week');
            await addTimeEntry(other, { workItemId: id, workDate: day(14), minutes: 60 });
            await addTimeEntry(other, { workItemId: id, workDate: day(16), minutes: 30 });
            await addTimeEntry(other, { workItemId: id, workDate: day(21), minutes: 15 });
            const week = await getTimeWeek(other, { week: day(17) });
            expect(week.weekStart).toBe(day(14));
            expect(week.entries.map((e) => e.minutes)).toEqual([60, 30]);
            expect(week.entries[0]!.item).toMatchObject({ kind: 'visible', id });
            expect(week.dayTotals.map((d) => d.minutes)).toEqual([60, 0, 30, 0, 0, 0, 0]);
            expect(week.totalMinutes).toBe(90);
            expect(week.viewer.edit).toBe(true);
            expect(await reasonOf(getTimeWeek(member, { week: day(14), userId: other.userId }))).toBe('TIME_APPROVE_REQUIRED');
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'TimeEntry', entityId: other.userId } })).toBeGreaterThanOrEqual(1);
            const asOwner = await getTimeWeek(owner, { week: day(14), userId: other.userId });
            expect(asOwner.totalMinutes).toBe(90);
            expect(asOwner.viewer.edit).toBe(false);
        });

        it("shows an item's entries and total to time.view, only one's own to time.track alone, nothing to neither", async () => {
            const id = await item('item time');
            await addTimeEntry(member, { workItemId: id, workDate: day(30), minutes: 20 });
            await addTimeEntry(other, { workItemId: id, workDate: day(31), minutes: 50, description: 'mine' });
            const asViewer = await getWorkItemTime(viewer, id);
            expect(asViewer).toMatchObject({ totalMinutes: 70, ownMinutes: 0, viewer: { track: false, viewAll: true } });
            expect(asViewer.entries.map((e) => [e.minutes, e.personName])).toEqual([[50, 'other'], [20, 'member']]);
            const trackOnly = makeRequestContext('MEMBER', { tenantId, tenantSlug: TAG, userId: member.userId, requestId: `${TAG}-track` });
            trackOnly.appPermissions = getPermissionsForRole('MEMBER');
            trackOnly.appPermissions.time.view = false;
            const own = await getWorkItemTime(trackOnly, id);
            expect(own).toMatchObject({ totalMinutes: null, ownMinutes: 20, viewer: { track: true, viewAll: false } });
            expect(own.entries.map((e) => e.minutes)).toEqual([20]);
            trackOnly.appPermissions.time.track = false;
            expect(await reasonOf(getWorkItemTime(trackOnly, id))).toBe('TIME_VIEW_REQUIRED');
        });

        it('pages an item\'s entries newest first', async () => {
            const id = await item('pages');
            for (let n = 0; n < 52; n++) {
                // guardrail-allow: n+1 — a fixture of 52 entries on 52 days.
                await addTimeEntry(other, { workItemId: id, workDate: day(100 + n), minutes: 1 });
            }
            const first = await getWorkItemTime(owner, id);
            expect(first.entries).toHaveLength(50);
            expect(first.entries[0]!.workDate).toBe(day(151));
            expect(first.pageInfo.hasNextPage).toBe(true);
            const second = await getWorkItemTime(owner, id, { cursor: first.pageInfo.nextCursor });
            expect(second.entries.map((e) => e.workDate)).toEqual([day(101), day(100)]);
            expect(await reasonOf(getWorkItemTime(owner, id, { cursor: 'nonsense' }))).toBe('INVALID_CURSOR');
        });
    });

    describe('moves, purges and removal', () => {
        it('keeps an entry with its project on a move, and keeps it, unnamed, on a purge (decision 261)', async () => {
            const id = await item('moved');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: day(40), minutes: 10 });
            await moveWorkItemToProject(owner, id, { projectId: otherProjectId });
            const after = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
            expect(after).toMatchObject({ workItemId: id, projectId });
            await deleteWorkItem(owner, id);
            const week = await getTimeWeek(member, { week: day(40) });
            expect(week.entries.find((e) => e.id === entry.id)?.item).toEqual({ kind: 'deleted' });
            await purgeWorkspaceWorkItems({ ...owner, actorType: 'JOB' }, new Date(Date.now() + 86_400_000), 0);
            const purged = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
            expect(purged).toMatchObject({ workItemId: null, projectId, minutes: 10 });
        });

        it('keeps a tombstone of a deleted project time was recorded in, and purges one without time (issue #117)', async () => {
            const kept = (await createProject(owner, { teamId, name: 'Held', keyPrefix: 'TMH' })).id;
            const id = await item('held', kept);
            await addTimeEntry(member, { workItemId: id, workDate: day(41), minutes: 10 });
            const plain = (await createProject(owner, { teamId, name: 'Plain', keyPrefix: 'TMP' })).id;
            await deleteProject(owner, kept);
            await deleteProject(owner, plain);
            await purgeWorkspaceWorkItems({ ...owner, actorType: 'JOB' }, new Date(Date.now() + 86_400_000), 0);
            expect(await prisma.project.findUniqueOrThrow({ where: { id: kept }, select: { purgedAt: true } })).toEqual({ purgedAt: expect.any(Date) });
            expect(await prisma.workItem.count({ where: { projectId: kept } })).toBe(0);
            expect(await prisma.project.count({ where: { id: plain } })).toBe(0);
        });

        it('stops and records a removed member\'s timer in the removal, keeping their entries', async () => {
            const u = await prisma.user.create({ data: { email: `leaver-${TAG}@example.test`, name: 'leaver' } });
            const m = await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'MEMBER' } });
            const leaver = makeRequestContext('MEMBER', { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-leaver` });
            const id = await item('leaver');
            await addTimeEntry(leaver, { workItemId: id, workDate: day(50), minutes: 15 });
            const timer = await startTimer(leaver, { workItemId: id, timeZone: 'UTC' });
            await prisma.timeEntry.update({ where: { id: timer.entry.id }, data: { timerStartedAt: new Date(Date.now() - 25 * 60_000) } });
            await removeTenantMember(owner, { membershipId: m.id });
            expect(await prisma.timeEntry.count({ where: { tenantId, userId: u.id, minutes: null } })).toBe(0);
            expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: timer.entry.id } })).minutes).toBe(25);
            expect(await prisma.timeEntry.count({ where: { tenantId, userId: u.id } })).toBe(2);
        });
    });

    describe('two-tenant isolation', () => {
        it('an outsider workspace neither reads, changes, deletes nor plants TimeEntry rows', async () => {
            const id = await item('isolated');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: day(60), minutes: 10 });
            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            expect(await runInTenantContext(outsider, (db) => db.timeEntry.count({ where: { tenantId } }))).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.timeEntry.updateMany({ where: { tenantId }, data: { minutes: 1 } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.timeEntry.deleteMany({ where: { id: entry.id } }))).count).toBe(0);
            await expect(
                runInTenantContext(outsider, (db) =>
                    db.timeEntry.create({ data: { tenantId, userId: ou.id, createdByUserId: ou.id, projectId, workItemId: id, workDate: new Date(`${day(60)}T00:00:00Z`), minutes: 5, source: 'MANUAL' } }),
                ),
            ).rejects.toThrow();
            expect(await reasonOf(updateTimeEntry(outsider, entry.id, { minutes: 2 }))).toMatch(/404/);
            expect(await reasonOf(getWorkItemTime(outsider, id))).toMatch(/404/);
            expect(await runInTenantContext(owner, (db) => db.timeEntry.count({ where: { id: entry.id } }))).toBe(1);
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
