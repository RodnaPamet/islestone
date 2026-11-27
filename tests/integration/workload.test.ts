/**
 * Capacity and time off (sub-phase 3.5a; docs/porting/maps/3.5.md, "Capacity
 * (3.5a)", "Time off (3.5a)", "The type, held apart" and "H3 and 3.5"; ADR
 * 0013; owner decisions 284 to 303), against a real Postgres:
 *
 *   - the catalogue: the CHECKs, the team link clearing its own column, the
 *     membership cascades, RLS forced;
 *   - the type held apart: the three codes' ciphertexts have equal lengths, a
 *     plaintext insert is refused, no audit row or bell holds the code, the
 *     read omits the key for a caller who may not see it;
 *   - capacity: the default, a member's rows from a Monday, a future change
 *     removed and one in effect kept, a deleted team falling back to the
 *     workspace's calendar, the workload read's weekly capacity with holidays
 *     and time off;
 *   - time off: one row per person and date, versions (409 for the whole
 *     write), two writes of one date racing, another person's only with
 *     workload.manage, a person only, the bell to the person when someone
 *     else writes it;
 *   - member removal taking capacity and time off with the membership, and a
 *     write racing it refused;
 *   - two-tenant isolation (ISOLATION_TESTED: TenantWorkloadSettings,
 *     MemberCapacity, TimeOff).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createTeam, deleteTeam } from '@/app-layer/usecases/team';
import { removeTenantMember } from '@/app-layer/usecases/tenant-admin';
import { listTimeOff, removeTimeOffDays, setTimeOffDays } from '@/app-layer/usecases/time-off';
import { getWorkload } from '@/app-layer/usecases/workload';
import { getMemberCapacity, getWorkloadSettings, listWorkloadMembers, removeMemberCapacity, setMemberCapacity, setWorkloadSettings } from '@/app-layer/usecases/workload-capacity';
import { addWorkspaceHolidays, setWorkspaceWorkingCalendar } from '@/app-layer/usecases/working-calendar';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wkl${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

/** A date `n` days after 2027-03-01, a Monday (date-only). */
function day(n: number): string {
    return new Date(Date.UTC(2027, 2, 1) + n * 86_400_000).toISOString().slice(0, 10);
}

describeFn('capacity and time off (3.5a)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    const users: Record<string, string> = {};

    const mk = async (who: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') => {
        const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
        users[who] = u.id;
        return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}-${Math.random().toString(36).slice(2, 8)}` });
    };

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        owner = await mk('owner', 'OWNER');
        admin = await mk('admin', 'ADMIN');
        member = await mk('member', 'MEMBER');
        viewer = await mk('viewer', 'VIEWER');
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('holds the CHECKs, the team link clearing its own column, the cascades and forced RLS', async () => {
            const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint
                 WHERE conrelid IN ('"TimeOff"'::regclass, '"MemberCapacity"'::regclass, '"TenantWorkloadSettings"'::regclass) AND contype = 'c'
                 ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual([
                'MemberCapacity_effective_monday',
                'MemberCapacity_version_positive',
                'MemberCapacity_weekly_minutes_range',
                'TenantWorkloadSettings_version_positive',
                'TenantWorkloadSettings_weekly_minutes_range',
                'TimeOff_minutes_range',
                'TimeOff_type_ciphertext',
                'TimeOff_version_positive',
            ]);
            const fks = await prisma.$queryRaw<Array<{ conname: string; def: string }>>`
                SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                 WHERE conname IN ('MemberCapacity_calendarTeamId_tenantId_fkey', 'MemberCapacity_tenantId_userId_fkey', 'TimeOff_tenantId_userId_fkey') ORDER BY conname`;
            expect(fks[0]?.def).toContain('ON DELETE SET NULL ("calendarTeamId")');
            expect(fks[1]?.def).toContain('ON DELETE CASCADE');
            expect(fks[2]?.def).toContain('ON DELETE CASCADE');
            const rls = await prisma.$queryRaw<Array<{ relname: string; relforcerowsecurity: boolean }>>`
                SELECT relname, relforcerowsecurity FROM pg_class WHERE relname IN ('TimeOff', 'MemberCapacity', 'TenantWorkloadSettings') ORDER BY relname`;
            expect(rls.every((r) => r.relforcerowsecurity)).toBe(true);
            const pref = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'NotificationPreference_in_app_only_types'`;
            expect(pref[0]?.def).toContain('TIME_OFF_CHANGED_BY_OTHER');
        });
    });

    describe('the type, held apart (decision 287)', () => {
        it('stores the three codes as ciphertexts of one length, and refuses a plaintext type', async () => {
            await setTimeOffDays(member, {
                days: [
                    { day: day(0), minutes: null, type: 'VACATION' },
                    { day: day(1), minutes: 240, type: 'SICK' },
                    { day: day(2), minutes: null, type: 'OTHER' },
                ],
            });
            const raw = await prisma.$queryRaw<Array<{ type: string }>>`SELECT "type" FROM "TimeOff" WHERE "tenantId" = ${tenantId} AND "userId" = ${users.member} ORDER BY "day"`;
            expect(raw).toHaveLength(3);
            expect(raw.every((r) => /^v[12]:/.test(r.type))).toBe(true);
            expect(new Set(raw.map((r) => r.type.length)).size).toBe(1);
            expect(raw.some((r) => /SICK|VACATION|OTHER/.test(r.type))).toBe(false);
            await expect(
                prisma.$executeRaw`INSERT INTO "TimeOff" ("id", "tenantId", "userId", "day", "type", "createdByUserId", "updatedByUserId", "updatedAt")
                    VALUES ('plain', ${tenantId}, ${users.member}, '2027-06-01', 'SICK', ${users.member}, ${users.member}, now())`,
            ).rejects.toThrow(/TimeOff_type_ciphertext/);
        });

        it('shows the type to the person and to workload.manage, and omits the key for everyone else', async () => {
            const own = await listTimeOff(member, { from: day(0), to: day(6) });
            expect(own.days.map((d) => d.type)).toEqual(['VACATION', 'SICK', 'OTHER']);
            const managed = await listTimeOff(admin, { from: day(0), to: day(6), userId: users.member });
            expect(managed.days.map((d) => d.type)).toEqual(['VACATION', 'SICK', 'OTHER']);
            const colleague = await listTimeOff(viewer, { from: day(0), to: day(6), userId: users.member });
            expect(colleague.typeShown).toBe(false);
            expect(colleague.days.map((d) => d.minutes)).toEqual([null, 240, null]);
            for (const d of colleague.days) expect('type' in d).toBe(false);
            expect(JSON.stringify(colleague)).not.toMatch(/SICK|VACATION|"type":/);
            // An API key never reads a type, even its person's own (ADR 0003 §4).
            const key = { ...member, apiKeyId: 'key_1' } as RequestContext;
            expect((await listTimeOff(key, { from: day(0), to: day(6) })).typeShown).toBe(false);
        });

        it('writes no type into the audit trail, the bell or the workload read', async () => {
            await setTimeOffDays(admin, { userId: users.viewer, days: [{ day: day(7), minutes: 60, type: 'SICK' }] });
            const audit = await prisma.auditLog.findMany({ where: { tenantId, action: { in: ['TIME_OFF_SET', 'TIME_OFF_REMOVED'] } } });
            expect(audit.length).toBeGreaterThan(0);
            for (const row of audit) expect(JSON.stringify(row)).not.toMatch(/SICK|VACATION|"OTHER"/);
            const lifecycle = await prisma.auditLog.findMany({ where: { tenantId, entity: 'TimeOff' } });
            for (const row of lifecycle) expect(JSON.stringify(row)).not.toMatch(/SICK|VACATION|OTHER/);
            const bells = await prisma.notification.findMany({ where: { tenantId, type: 'TIME_OFF_CHANGED_BY_OTHER' } });
            expect(bells.map((b) => b.userId)).toEqual([users.viewer]);
            for (const b of bells) expect(JSON.stringify(b)).not.toMatch(/SICK|Sick/);
            expect(bells[0]?.body).toBe(`admin recorded time off for you on 8 Mar 2027.`);
            expect(bells[0]?.linkUrl).toBe(`/t/${TAG}/workload`);
            const workload = await getWorkload(owner, { from: day(0), weeks: 2 });
            expect(JSON.stringify(workload)).not.toMatch(/SICK|VACATION|"type"/);
        });
    });

    describe('capacity', () => {
        it('reads the default as 40 hours until one is saved, and changes it under its version', async () => {
            expect(await getWorkloadSettings(viewer)).toEqual({ defaultWeeklyMinutes: 2400, version: 0 });
            const saved = await setWorkloadSettings(owner, { defaultWeeklyMinutes: 2250 });
            expect(saved).toEqual({ defaultWeeklyMinutes: 2250, version: 1 });
            expect(await reasonOf(setWorkloadSettings(owner, { defaultWeeklyMinutes: 2400 }, 7))).toBe('VERSION_CONFLICT');
            expect(await reasonOf(setWorkloadSettings(member, { defaultWeeklyMinutes: 2400 }))).toMatch(/403/);
            expect((await setWorkloadSettings(owner, { defaultWeeklyMinutes: 2400 }, 1)).version).toBe(2);
        });

        it('sets a member\'s capacity from a Monday, keeps history, and removes only a future change', async () => {
            expect(await reasonOf(setMemberCapacity(owner, users.member, { effectiveFrom: day(1), weeklyMinutes: 1200, calendarTeamId: null }))).toBe('NOT_A_MONDAY');
            await setMemberCapacity(owner, users.member, { effectiveFrom: '2026-11-02', weeklyMinutes: 1800, calendarTeamId: null });
            const future = await setMemberCapacity(owner, users.member, { effectiveFrom: day(0), weeklyMinutes: 1200, calendarTeamId: null });
            const replaced = await setMemberCapacity(owner, users.member, { effectiveFrom: day(0), weeklyMinutes: 1440, calendarTeamId: null }, future.version);
            expect(replaced).toMatchObject({ id: future.id, weeklyMinutes: 1440, version: 2 });
            const history = await getMemberCapacity(viewer, users.member);
            expect(history.rows.map((r) => [r.effectiveFrom, r.weeklyMinutes])).toEqual([
                [day(0), 1440],
                ['2026-11-02', 1800],
            ]);
            const past = history.rows[1]!;
            expect(await reasonOf(removeMemberCapacity(owner, users.member, past.id))).toBe('CAPACITY_IN_EFFECT');
            const members = await listWorkloadMembers(admin);
            const row = members.members.find((m) => m.userId === users.member)!;
            expect(row.inForce?.weeklyMinutes).toBe(1800);
            expect(row.next?.weeklyMinutes).toBe(1440);
            await removeMemberCapacity(owner, users.member, replaced.id);
            expect((await getMemberCapacity(viewer, users.member)).rows).toHaveLength(1);
            const audit = await prisma.auditLog.findMany({ where: { tenantId, action: { in: ['MEMBER_CAPACITY_SET', 'MEMBER_CAPACITY_REMOVED', 'WORKLOAD_SETTINGS_SET'] } } });
            expect(audit.map((a) => a.action).sort()).toEqual([
                'MEMBER_CAPACITY_REMOVED',
                'MEMBER_CAPACITY_SET',
                'MEMBER_CAPACITY_SET',
                'MEMBER_CAPACITY_SET',
                'WORKLOAD_SETTINGS_SET',
                'WORKLOAD_SETTINGS_SET',
            ]);
        });

        it('counts a week on the calendar, holidays and time off, and falls back to the workspace calendar when the team goes', async () => {
            await setWorkspaceWorkingCalendar(owner, { timeZone: 'Europe/Sofia', workingWeekdays: [1, 2, 3, 4, 5] });
            await addWorkspaceHolidays(owner, { holidays: [{ day: day(9), name: 'A holiday' }] });
            // The member: 1,800 a week from 2026-11-02 on the workspace calendar; time off 7 Mar (whole), 2 Mar (240) …
            const w = await getWorkload(owner, { from: day(0), weeks: 2, userId: users.member });
            const person = w.people[0]!;
            expect(person.weeklyMinutes).toEqual([1800, 1800]);
            // Week 1: Mon whole off (360), Tue 240, Wed whole off (360): 1,800 - 960.
            expect(person.capacity[0]).toBe(840);
            expect(person.timeOffMinutes[0]).toBe(960);
            expect(person.timeOffDays[0]).toEqual([day(0), day(1), day(2)]);
            // Week 2: the holiday on Wednesday 10 March removes its share.
            expect(person.capacity[1]).toBe(1440);

            const team = await createTeam(owner, { name: `Four-day ${TAG}` });
            await setMemberCapacity(owner, users.viewer, { effectiveFrom: day(0), weeklyMinutes: 2400, calendarTeamId: team.id });
            await deleteTeam(owner, team.id);
            const rows = (await getMemberCapacity(viewer, users.viewer)).rows;
            expect(rows[0]?.calendarTeamId).toBeNull();
            expect(await reasonOf(setMemberCapacity(owner, users.viewer, { effectiveFrom: day(7), weeklyMinutes: 2400, calendarTeamId: 'no-such-team' }))).toBe('TEAM_NOT_FOUND');
        });

        it('refuses a read before the current week and above 26 weeks', async () => {
            expect(await reasonOf(getWorkload(owner, { from: '2026-01-05' }))).toBe('WORKLOAD_RANGE');
            expect(await reasonOf(getWorkload(owner, { weeks: 27 }))).toBe('WORKLOAD_RANGE');
            expect(await reasonOf(getWorkload(owner, { from: day(1) }))).toBe('WORKLOAD_RANGE');
        });
    });

    describe('time off', () => {
        it('replaces a date under its version and refuses the whole write on one mismatch', async () => {
            const [first] = (await listTimeOff(member, { from: day(1), to: day(1) })).days;
            expect(await reasonOf(setTimeOffDays(member, { days: [{ day: day(1), minutes: 120, type: 'OTHER' }] }))).toBe('VERSION_CONFLICT');
            expect(
                await reasonOf(setTimeOffDays(member, { days: [{ day: day(1), minutes: 120, type: 'OTHER', version: first!.version }, { day: day(20), minutes: null, type: 'VACATION', version: 3 }] })),
            ).toBe('VERSION_CONFLICT');
            expect(await prisma.timeOff.count({ where: { tenantId, userId: users.member, day: new Date(`${day(20)}T00:00:00Z`) } })).toBe(0);
            const done = await setTimeOffDays(member, { days: [{ day: day(1), minutes: 120, type: 'OTHER', version: first!.version }] });
            expect(done.days[0]).toMatchObject({ day: day(1), minutes: 120, type: 'OTHER', version: first!.version + 1 });
            expect(await reasonOf(setTimeOffDays(member, { days: [{ day: day(30), minutes: null, type: 'OTHER' }, { day: day(30), minutes: 60, type: 'OTHER' }] }))).toBe('DUPLICATE_DAY');
        });

        it('lets one of two writes of the same date win', async () => {
            const writes = await Promise.allSettled([
                setTimeOffDays({ ...member, requestId: `${TAG}-race-a` }, { days: [{ day: day(40), minutes: 60, type: 'OTHER' }] }),
                setTimeOffDays({ ...member, requestId: `${TAG}-race-b` }, { days: [{ day: day(40), minutes: 90, type: 'VACATION' }] }),
            ]);
            expect(writes.filter((w) => w.status === 'fulfilled')).toHaveLength(1);
            const refused = writes.find((w) => w.status === 'rejected') as PromiseRejectedResult;
            expect((refused.reason as { details?: { reason?: string } }).details?.reason).toBe('VERSION_CONFLICT');
            expect(await prisma.timeOff.count({ where: { tenantId, userId: users.member, day: new Date(`${day(40)}T00:00:00Z`) } })).toBe(1);
        });

        it("refuses another member's time off without workload.manage (audited) and any write by a key or a job", async () => {
            expect(await reasonOf(setTimeOffDays(member, { userId: users.viewer, days: [{ day: day(3), minutes: null, type: 'OTHER' }] }))).toBe('WORKLOAD_MANAGE_REQUIRED');
            const denied = await prisma.auditLog.findMany({ where: { tenantId, action: 'AUTHZ_DENIED', entity: 'TimeOff', entityId: users.viewer } });
            expect(denied).toHaveLength(1);
            const key = { ...member, apiKeyId: 'key_1', requestId: `${TAG}-key` } as RequestContext;
            expect(await reasonOf(setTimeOffDays(key, { days: [{ day: day(4), minutes: null, type: 'OTHER' }] }))).toBe('NOT_A_PERSON');
            const job = { ...owner, actorType: 'JOB', requestId: `${TAG}-job` } as RequestContext;
            expect(await reasonOf(setMemberCapacity(job, users.member, { effectiveFrom: day(14), weeklyMinutes: 60, calendarTeamId: null }))).toBe('NOT_A_PERSON');
            expect(await reasonOf(setWorkloadSettings(job, { defaultWeeklyMinutes: 60 }))).toBe('NOT_A_PERSON');
        });

        it('lets a Viewer record and remove its own time off, and rings nobody for one\'s own', async () => {
            const before = await prisma.notification.count({ where: { tenantId, type: 'TIME_OFF_CHANGED_BY_OTHER' } });
            const set = await setTimeOffDays(viewer, { days: [{ day: day(21), minutes: null, type: 'VACATION' }] });
            await removeTimeOffDays(viewer, { days: [{ day: day(21), version: set.days[0]!.version }] });
            expect(await prisma.notification.count({ where: { tenantId, type: 'TIME_OFF_CHANGED_BY_OTHER' } })).toBe(before);
            expect(await reasonOf(removeTimeOffDays(viewer, { days: [{ day: day(21), version: 1 }] }))).toBe('VERSION_CONFLICT');
        });

        it('rings the person once when a manager removes their dates', async () => {
            const [d] = (await listTimeOff(admin, { from: day(7), to: day(7), userId: users.viewer })).days;
            await removeTimeOffDays({ ...admin, requestId: `${TAG}-rm` }, { userId: users.viewer, days: [{ day: day(7), version: d!.version }] });
            const bells = await prisma.notification.findMany({ where: { tenantId, userId: users.viewer, type: 'TIME_OFF_CHANGED_BY_OTHER' }, orderBy: { createdAt: 'asc' } });
            expect(bells.map((b) => b.body)).toEqual(['admin recorded time off for you on 8 Mar 2027.', 'admin removed your time off on 8 Mar 2027.']);
        });
    });

    describe('member removal', () => {
        it("takes the member's capacity and time off with the membership", async () => {
            const leaver = await mk('leaver', 'MEMBER');
            await setTimeOffDays(leaver, { days: [{ day: day(5), minutes: null, type: 'SICK' }] });
            await setMemberCapacity(owner, users.leaver!, { effectiveFrom: day(7), weeklyMinutes: 600, calendarTeamId: null });
            const m = await prisma.tenantMembership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: users.leaver! } } });
            await removeTenantMember(owner, { membershipId: m.id });
            expect(await prisma.timeOff.count({ where: { tenantId, userId: users.leaver } })).toBe(0);
            expect(await prisma.memberCapacity.count({ where: { tenantId, userId: users.leaver } })).toBe(0);
            expect(await reasonOf(setTimeOffDays(owner, { userId: users.leaver, days: [{ day: day(6), minutes: null, type: 'OTHER' }] }))).toBe('NOT_A_MEMBER');
            expect(await reasonOf(setMemberCapacity(owner, users.leaver!, { effectiveFrom: day(7), weeklyMinutes: 600, calendarTeamId: null }))).toBe('NOT_A_MEMBER');
        });

        it('never fails a removal racing a time-off write: the write is refused or its row goes with the membership', async () => {
            const racer = await mk('racer', 'MEMBER');
            const m = await prisma.tenantMembership.findUniqueOrThrow({ where: { tenantId_userId: { tenantId, userId: users.racer! } } });
            const [write, removal] = await Promise.allSettled([
                setTimeOffDays(racer, { days: [{ day: day(8), minutes: null, type: 'OTHER' }] }),
                removeTenantMember(owner, { membershipId: m.id }),
            ]);
            expect(removal.status).toBe('fulfilled');
            if (write.status === 'rejected') expect(await reasonOf(Promise.reject(write.reason))).toBe('NOT_A_MEMBER');
            expect(await prisma.timeOff.count({ where: { tenantId, userId: users.racer } })).toBe(0);
        });
    });

    describe('two-tenant isolation', () => {
        it('an outsider workspace neither reads, changes, deletes nor plants TenantWorkloadSettings, MemberCapacity or TimeOff rows', async () => {
            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            await runInTenantContext(outsider, async (db) => {
                expect(await db.timeOff.count({ where: { tenantId } })).toBe(0);
                expect(await db.memberCapacity.count({ where: { tenantId } })).toBe(0);
                expect(await db.tenantWorkloadSettings.count({ where: { tenantId } })).toBe(0);
                expect((await db.timeOff.updateMany({ where: { tenantId }, data: { minutes: 1 } })).count).toBe(0);
                expect((await db.timeOff.deleteMany({ where: { tenantId } })).count).toBe(0);
                expect((await db.memberCapacity.deleteMany({ where: { tenantId } })).count).toBe(0);
                expect((await db.tenantWorkloadSettings.updateMany({ where: { tenantId }, data: { defaultWeeklyMinutes: 1 } })).count).toBe(0);
            });
            await expect(
                runInTenantContext(outsider, (db) => db.memberCapacity.create({ data: { tenantId, userId: users.member!, effectiveFrom: new Date('2027-05-03T00:00:00Z'), weeklyMinutes: 60, createdByUserId: ou.id } })),
            ).rejects.toThrow();
            await expect(runInTenantContext(outsider, (db) => db.tenantWorkloadSettings.create({ data: { tenantId, defaultWeeklyMinutes: 60 } }))).rejects.toThrow();
            expect(await reasonOf(listTimeOff(outsider, { from: day(0), to: day(6), userId: users.member }))).toMatch(/404/);
            expect(await prisma.timeOff.count({ where: { tenantId, userId: users.member } })).toBeGreaterThan(0);
            expect((await getWorkloadSettings(owner)).defaultWeeklyMinutes).toBe(2400);
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
