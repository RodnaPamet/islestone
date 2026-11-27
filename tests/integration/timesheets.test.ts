/**
 * Timesheets and their approval (sub-phase 3.4c; docs/porting/maps/3.4.md,
 * "Timesheets and approval (3.4c)"; ADR 0012 §5; owner decisions 256, 268 to
 * 270, 276 and 278), against a real Postgres:
 *
 *   - the catalogue: the CHECKs, the freeze trigger, no DELETE for app_user;
 *   - the settings: off by default, changed by an Owner or Admin only, a
 *     workspace recipient list named, audited;
 *   - submit: approval on, a week begun, no timer counting in it, an empty
 *     week allowed, never twice;
 *   - the freeze: every entry write into a submitted or approved week refused
 *     (409 `TIMESHEET_FROZEN`), by the usecases and for a raw write, and the
 *     three admitted writes passing (the re-wrap, the purge's item link);
 *   - take back, approve, return, reopen: the statuses, never one's own week
 *     (an audited 403), a person only, versions, the explanation sanitised,
 *     encrypted and never audited or notified;
 *   - the notifications: approvers on a submit (the list, else every holder),
 *     the person's bell and immediate email on a return, a bell on approval;
 *   - the reads: the status line, the pending and decided weeks with their
 *     sums, a week's detail;
 *   - the Monday reminder;
 *   - a submit racing entry writes leaves no entry in a frozen week;
 *   - two-tenant isolation (ISOLATION_TESTED: Timesheet, TenantTimeSettings).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { createRecipientList } from '@/app-layer/usecases/recipient-list';
import { createTeam } from '@/app-layer/usecases/team';
import { addTimeEntry, deleteTimeEntry, startTimer, updateTimeEntry } from '@/app-layer/usecases/time-entry';
import {
    approveTimesheet,
    getTimeSettings,
    getTimesheet,
    getTimesheetWeek,
    listTimesheets,
    reopenTimesheet,
    returnTimesheet,
    setTimeSettings,
    submitTimesheet,
    withdrawTimesheet,
} from '@/app-layer/usecases/timesheet';
import { remindWorkspaceToSubmit } from '@/app-layer/usecases/timesheet-reminder';
import { purgeWorkspaceWorkItems } from '@/app-layer/usecases/work-item-purge';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem } from '@/app-layer/usecases/work-item';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `tms${Date.now().toString(36)}`;

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

/** The Monday `n` weeks after 2002-01-07 (a Monday): weeks long begun. */
function week(n: number): string {
    return new Date(Date.UTC(2002, 0, 7) + n * 7 * 86_400_000).toISOString().slice(0, 10);
}
/** A day of week `n`, `d` days after its Monday. */
function dayOf(n: number, d = 0): string {
    return new Date(Date.UTC(2002, 0, 7) + (n * 7 + d) * 86_400_000).toISOString().slice(0, 10);
}

describeFn('timesheets and their approval (3.4c)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let other: RequestContext;
    let projectId = '';
    let typeId = '';

    const item = async (title = `item ${Math.random().toString(36).slice(2, 8)}`) => (await createWorkItem(owner, { projectId, typeId, title })).id;
    const bells = (userId: string, type: string) => prisma.notification.findMany({ where: { tenantId, userId, type: type as never }, orderBy: { createdAt: 'asc' } });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'ADMIN' | 'MEMBER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('Olga', 'OWNER');
        admin = await mk('Ana', 'ADMIN');
        member = await mk('Mila', 'MEMBER');
        other = await mk('Oleg', 'MEMBER');
        const team = await createTeam(owner, { name: 'Sheets' });
        projectId = (await createProject(owner, { teamId: team.id, name: 'Sheets', keyPrefix: 'TMS' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('holds the CHECKs, the freeze trigger and no DELETE for app_user', async () => {
            const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint WHERE conrelid = '"Timesheet"'::regclass AND contype = 'c' ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual([
                'Timesheet_decision_stamped',
                'Timesheet_explanation_iff_returned',
                'Timesheet_not_own_decision',
                'Timesheet_version_positive',
                'Timesheet_week_starts_monday',
            ]);
            const trigger = await prisma.$queryRaw<Array<{ tgname: string }>>`
                SELECT tgname FROM pg_trigger WHERE tgrelid = '"TimeEntry"'::regclass AND NOT tgisinternal`;
            expect(trigger.map((t) => t.tgname)).toContain('time_entry_week_frozen');
            const grants = await prisma.$queryRaw<Array<{ table_name: string; privilege_type: string }>>`
                SELECT table_name, privilege_type FROM information_schema.role_table_grants
                 WHERE grantee = 'app_user' AND table_name IN ('Timesheet', 'TenantTimeSettings') ORDER BY table_name, privilege_type`;
            expect(grants.filter((g) => g.privilege_type === 'DELETE')).toEqual([]);
            expect(grants.map((g) => `${g.table_name}:${g.privilege_type}`)).toEqual(
                expect.arrayContaining(['Timesheet:INSERT', 'Timesheet:SELECT', 'Timesheet:UPDATE', 'TenantTimeSettings:UPDATE']),
            );
        });
    });

    describe('the settings (decisions 268 and 269)', () => {
        it('are off by default; only whoever manages the workspace changes them, audited', async () => {
            expect(await getTimeSettings(member)).toMatchObject({ approvalRequired: false, approvalRecipientListId: null, viewer: { manage: false } });
            expect(await reasonOf(setTimeSettings(member, { approvalRequired: true }))).toMatch(/403/);
            expect(await reasonOf(submitTimesheet(member, { week: week(0) }))).toBe('APPROVAL_OFF');
            const set = await setTimeSettings(admin, { approvalRequired: true });
            expect(set).toMatchObject({ approvalRequired: true, version: 1, viewer: { manage: true } });
            expect(await reasonOf(setTimeSettings(admin, { approvalRequired: true }, 0))).toBe('VERSION_CONFLICT');
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIME_SETTINGS_SET' } });
            expect(audit.detailsJson).toMatchObject({ changedFields: ['approvalRequired'] });
        });

        it('name only a live recipient list of the workspace itself', async () => {
            const projectList = await createRecipientList(owner, projectId, { name: 'Desk', userIds: [admin.userId] });
            expect(await reasonOf(setTimeSettings(owner, { approvalRecipientListId: projectList.id }))).toBe('RECIPIENT_LIST_UNKNOWN');
            expect(await reasonOf(setTimeSettings(owner, { approvalRecipientListId: 'nope' }))).toBe('RECIPIENT_LIST_UNKNOWN');
        });
    });

    describe('submit and the freeze (decisions 256, 268 and 270)', () => {
        it('submits a begun week once, refuses a future one and one with a timer on; an empty week is allowed', async () => {
            const empty = await submitTimesheet(member, { week: dayOf(1, 3) });
            expect(empty).toMatchObject({ weekStart: week(1), frozen: true, sums: { minutes: 0, entries: 0 }, timesheet: { status: 'SUBMITTED', version: 1 } });
            expect(await reasonOf(submitTimesheet(member, { week: week(1) }))).toBe('TIMESHEET_SUBMITTED');
            expect(await reasonOf(submitTimesheet(member, { week: '2999-01-07' }))).toBe('WEEK_IN_FUTURE');
            // A timer counting today: this week cannot be submitted.
            const id = await item('timer week');
            await startTimer(other, { workItemId: id, timeZone: 'UTC' });
            const today = new Date().toISOString().slice(0, 10);
            expect(await reasonOf(submitTimesheet(other, { week: today }))).toBe('TIMER_ON_IN_WEEK');
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIMESHEET_SUBMITTED', entityId: empty.timesheet!.id } });
            expect(audit.detailsJson).toMatchObject({ category: 'status_change', fromStatus: null, toStatus: 'SUBMITTED' });
            expect(audit.metadataJson).toMatchObject({ weekStart: week(1), minutes: 0, entries: 0 });
        });

        it('refuses every entry write into a submitted week, through the usecases and for a raw write', async () => {
            const id = await item('frozen');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: dayOf(2, 1), minutes: 30, description: 'drafting' });
            const open = await addTimeEntry(member, { workItemId: id, workDate: dayOf(3, 1), minutes: 20 });
            const sheet = await submitTimesheet(member, { week: week(2) });
            expect(sheet.sums).toEqual({ minutes: 30, billableMinutes: 0, entries: 1 });
            expect(await reasonOf(addTimeEntry(member, { workItemId: id, workDate: dayOf(2, 2), minutes: 5 }))).toBe('TIMESHEET_FROZEN');
            expect(await reasonOf(updateTimeEntry(member, entry.id, { minutes: 31 }))).toBe('TIMESHEET_FROZEN');
            expect(await reasonOf(deleteTimeEntry(member, entry.id))).toBe('TIMESHEET_FROZEN');
            // Moving an open week's entry into the frozen week is refused too.
            expect(await reasonOf(updateTimeEntry(member, open.id, { workDate: dayOf(2, 4) }))).toBe('TIMESHEET_FROZEN');
            // A raw write as app_user meets the trigger.
            await expect(runInTenantContext(member, (db) => db.timeEntry.updateMany({ where: { id: entry.id }, data: { minutes: 1 } }))).rejects.toThrow(/TIMESHEET_FROZEN/);
            expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).minutes).toBe(30);
            // The status line says so.
            expect((await getTimesheetWeek(member, { week: week(2) })).viewer).toEqual({ submit: false, withdraw: true, edit: false });
        });

        it("admits the key rotations' re-wrap and the purge's clearing of the item link in a frozen week", async () => {
            const id = await item('admitted');
            const entry = await addTimeEntry(member, { workItemId: id, workDate: dayOf(4, 1), minutes: 15, description: 'kept' });
            await submitTimesheet(member, { week: week(4) });
            const [raw] = await prisma.$queryRaw<Array<{ description: string }>>`SELECT "description" FROM "TimeEntry" WHERE id = ${entry.id}`;
            // The sweep's own statement shape: one ciphertext for another, nothing else (here a stand-in
            // ciphertext, then the original back).
            const rewrap = (to: string, from: string) =>
                runInTenantContext(member, (db) => db.$executeRawUnsafe(`UPDATE "TimeEntry" SET "description" = $1 WHERE id = $2 AND "description" = $3`, to, entry.id, from));
            const standIn = raw!.description.replace(/^v\d:/, 'v9:');
            expect(await rewrap(standIn, raw!.description)).toBe(1);
            expect(await rewrap(raw!.description, standIn)).toBe(1);
            // Changing anything else beside the description is refused.
            await expect(
                runInTenantContext(member, (db) => db.$executeRawUnsafe(`UPDATE "TimeEntry" SET "description" = $1, "minutes" = 1 WHERE id = $2`, standIn, entry.id)),
            ).rejects.toThrow(/TIMESHEET_FROZEN/);
            await deleteWorkItem(owner, id);
            await purgeWorkspaceWorkItems({ ...owner, actorType: 'JOB' }, new Date(Date.now() + 86_400_000), 0);
            expect(await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { workItemId: true, minutes: true } })).toEqual({ workItemId: null, minutes: 15 });
        });

        it('takes a submitted week back, its entries open again; another person\'s is a 404', async () => {
            const id = await item('withdraw');
            const sheet = await submitTimesheet(member, { week: week(5) });
            expect(await reasonOf(withdrawTimesheet(other, sheet.timesheet!.id))).toMatch(/404/);
            expect(await reasonOf(withdrawTimesheet(member, sheet.timesheet!.id, 99))).toBe('VERSION_CONFLICT');
            expect(await withdrawTimesheet(member, sheet.timesheet!.id)).toMatchObject({ status: 'WITHDRAWN', version: 2 });
            expect((await addTimeEntry(member, { workItemId: id, workDate: dayOf(5, 2), minutes: 10 })).minutes).toBe(10);
            expect(await reasonOf(withdrawTimesheet(member, sheet.timesheet!.id))).toBe('TIMESHEET_NOT_SUBMITTED');
            // Resubmitted from WITHDRAWN.
            expect((await submitTimesheet(member, { week: week(5) })).timesheet).toMatchObject({ status: 'SUBMITTED', version: 3 });
        });
    });

    describe('decisions (decisions 269 and 270)', () => {
        it('approves a member\'s week, never one\'s own (an audited 403), and only with time.approve', async () => {
            const own = await submitTimesheet(admin, { week: week(6) });
            expect(await reasonOf(approveTimesheet(admin, own.timesheet!.id))).toBe('OWN_TIMESHEET');
            const denied = await prisma.auditLog.findFirst({ where: { tenantId, action: 'AUTHZ_DENIED', entityId: own.timesheet!.id } });
            expect(denied).not.toBeNull();
            const sheet = await submitTimesheet(member, { week: week(6) });
            expect(await reasonOf(approveTimesheet(other, sheet.timesheet!.id))).toMatch(/403/);
            expect(await reasonOf(approveTimesheet({ ...owner, apiKeyId: 'key_1' } as RequestContext, sheet.timesheet!.id))).toBe('NOT_A_PERSON');
            expect(await reasonOf(approveTimesheet(owner, sheet.timesheet!.id, 7))).toBe('VERSION_CONFLICT');
            const approved = await approveTimesheet(owner, sheet.timesheet!.id, 1);
            expect(approved).toMatchObject({ status: 'APPROVED', decidedByUserId: owner.userId, returnExplanation: null, version: 2 });
            expect(await reasonOf(withdrawTimesheet(member, sheet.timesheet!.id))).toBe('TIMESHEET_NOT_SUBMITTED');
            expect(await reasonOf(returnTimesheet(owner, sheet.timesheet!.id, { explanation: 'late' }))).toBe('TIMESHEET_NOT_SUBMITTED');
            // An approved week stays frozen.
            const id = await item('approved week');
            expect(await reasonOf(addTimeEntry(member, { workItemId: id, workDate: dayOf(6, 3), minutes: 5 }))).toBe('TIMESHEET_FROZEN');
            // The person's bell, never an email for an approval.
            expect((await bells(member.userId, 'TIMESHEET_APPROVED')).map((b) => b.body)).toEqual([`Olga approved your timesheet for the week of 18 February 2002.`]);
        });

        it('returns a week with an explanation, sanitised, encrypted, never audited or notified; resubmitting clears it', async () => {
            const sheet = await submitTimesheet(member, { week: week(7) });
            expect(await reasonOf(returnTimesheet(admin, sheet.timesheet!.id, { explanation: '   ' }))).toBe('TIMESHEET_EXPLANATION_REQUIRED');
            const returned = await returnTimesheet(admin, sheet.timesheet!.id, { explanation: 'Tuesday <b>is</b> missing' });
            expect(returned).toMatchObject({ status: 'RETURNED', returnExplanation: 'Tuesday is missing', decidedByUserId: admin.userId });
            const [raw] = await prisma.$queryRaw<Array<{ returnExplanation: string }>>`SELECT "returnExplanation" FROM "Timesheet" WHERE id = ${sheet.timesheet!.id}`;
            expect(raw!.returnExplanation).toMatch(/^v\d:/);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIMESHEET_RETURNED', entityId: sheet.timesheet!.id } });
            expect(JSON.stringify(audit)).not.toContain('Tuesday');
            const bell = await bells(member.userId, 'TIMESHEET_RETURNED');
            expect(bell.map((b) => b.body)).toEqual(['Ana returned your timesheet for the week of 25 February 2002. Open it to see why.']);
            expect(bell[0]!.linkUrl).toBe(`/t/${TAG}/time?week=${week(7)}`);
            // The immediate email (the default), naming the week and who, never the text.
            const mail = await prisma.notificationOutbox.findMany({ where: { tenantId, type: 'TIMESHEET_RETURNED' } });
            expect(mail).toHaveLength(1);
            expect(mail[0]!.bodyText).toContain('Ana returned your timesheet for the week of 25 February 2002. Open it to see why.');
            expect(mail[0]!.bodyText).not.toContain('Tuesday');
            // Its entries are open again; resubmitting clears the explanation.
            const id = await item('returned week');
            expect((await addTimeEntry(member, { workItemId: id, workDate: dayOf(7, 1), minutes: 45 })).minutes).toBe(45);
            expect((await submitTimesheet(member, { week: week(7) })).timesheet).toMatchObject({ status: 'SUBMITTED', returnExplanation: null, decidedAt: null });
        });

        it('reopens an approved week with an explanation: RETURNED again, audited and notified', async () => {
            const sheet = await submitTimesheet(member, { week: week(8) });
            await approveTimesheet(admin, sheet.timesheet!.id);
            expect(await reasonOf(reopenTimesheet(member, sheet.timesheet!.id, { explanation: 'x' }))).toMatch(/403/);
            const reopened = await reopenTimesheet(owner, sheet.timesheet!.id, { explanation: 'Wrong project on Monday' });
            expect(reopened).toMatchObject({ status: 'RETURNED', returnExplanation: 'Wrong project on Monday', decidedByUserId: owner.userId });
            expect(await prisma.auditLog.count({ where: { tenantId, action: 'TIMESHEET_REOPENED', entityId: sheet.timesheet!.id } })).toBe(1);
            expect((await bells(member.userId, 'TIMESHEET_RETURNED')).map((b) => b.title)).toContain('Timesheet reopened');
            expect(await reasonOf(reopenTimesheet(owner, sheet.timesheet!.id, { explanation: 'again' }))).toBe('TIMESHEET_NOT_APPROVED');
        });
    });

    describe('who is told of a submitted week (decision 269)', () => {
        it('every holder of time.approve but the person, with no list; the list\'s approvers when one is set', async () => {
            const a = await submitTimesheet(member, { week: week(9) });
            expect((await bells(owner.userId, 'TIMESHEET_SUBMITTED')).some((b) => b.body === 'Mila submitted their timesheet for the week of 11 March 2002.')).toBe(true);
            expect((await bells(admin.userId, 'TIMESHEET_SUBMITTED')).length).toBeGreaterThan(0);
            expect(await bells(member.userId, 'TIMESHEET_SUBMITTED')).toEqual([]);
            expect(await bells(other.userId, 'TIMESHEET_SUBMITTED')).toEqual([]);
            expect((await bells(owner.userId, 'TIMESHEET_SUBMITTED'))[0]!.linkUrl).toBe(`/t/${TAG}/time/timesheets`);
            // A workspace list naming the admin and a member (who does not approve): only the admin.
            const list = await createRecipientList(owner, null, { name: 'Approvers', userIds: [admin.userId, other.userId] });
            await setTimeSettings(owner, { approvalRecipientListId: list.id });
            const before = (await bells(owner.userId, 'TIMESHEET_SUBMITTED')).length;
            const b = await submitTimesheet(member, { week: week(10) });
            expect((await bells(owner.userId, 'TIMESHEET_SUBMITTED')).length).toBe(before);
            expect((await bells(admin.userId, 'TIMESHEET_SUBMITTED')).map((x) => x.dedupeKey)).toContain(`${tenantId}:TIMESHEET_SUBMITTED:${b.timesheet!.id}:1:${admin.userId}`);
            expect(await bells(other.userId, 'TIMESHEET_SUBMITTED')).toEqual([]);
            await setTimeSettings(owner, { approvalRecipientListId: null });
            expect(a.timesheet!.id).not.toBe(b.timesheet!.id);
        });
    });

    describe('reads', () => {
        it('lists the weeks waiting for a decision, oldest first, with their sums, and the decided ones', async () => {
            const id = await item('sums');
            await addTimeEntry(other, { workItemId: id, workDate: dayOf(11, 0), minutes: 60, billable: true });
            await addTimeEntry(other, { workItemId: id, workDate: dayOf(11, 2), minutes: 30 });
            const sheet = await submitTimesheet(other, { week: week(11) });
            const pending = await listTimesheets(owner, { status: 'SUBMITTED' });
            const weeks = pending.rows.map((r) => r.weekStart);
            expect([...weeks].sort()).toEqual(weeks);
            expect(pending.rows.find((r) => r.id === sheet.timesheet!.id)).toMatchObject({ personName: 'Oleg', sums: { minutes: 90, billableMinutes: 60, entries: 2 } });
            expect(await reasonOf(listTimesheets(member, { status: 'SUBMITTED' }))).toMatch(/403/);
            const detail = await getTimesheet(owner, sheet.timesheet!.id);
            expect(detail).toMatchObject({ personName: 'Oleg', sums: { minutes: 90 }, viewer: { approve: true, return: true, reopen: false } });
            expect(detail.entries).toHaveLength(2);
            expect(detail.dayTotals[0]).toEqual({ date: week(11), minutes: 60 });
            await approveTimesheet(owner, sheet.timesheet!.id);
            // Decided weeks reach back 12 weeks from today: 2002 is out of reach.
            expect((await listTimesheets(owner, { status: 'DECIDED' })).rows.find((r) => r.id === sheet.timesheet!.id)).toBeUndefined();
        });

        it("reads one's own week's status, and another member's only with time.approve (audited)", async () => {
            const own = await getTimesheetWeek(other, { week: week(30) });
            expect(own).toMatchObject({ timesheet: null, approvalRequired: true, frozen: false, viewer: { submit: true, withdraw: false, edit: true } });
            expect(await reasonOf(getTimesheetWeek(other, { week: week(11), userId: member.userId }))).toBe('TIME_APPROVE_REQUIRED');
            expect((await getTimesheetWeek(owner, { week: week(11), userId: other.userId })).timesheet).toMatchObject({ status: 'APPROVED', decidedByName: 'Olga' });
        });
    });

    describe('the Monday reminder (decision 276)', () => {
        it('reminds whoever recorded time in the week and has not submitted it, once; nobody when approval is off', async () => {
            const id = await item('reminder');
            await addTimeEntry(member, { workItemId: id, workDate: dayOf(20, 1), minutes: 10 });
            await addTimeEntry(other, { workItemId: id, workDate: dayOf(20, 2), minutes: 10 });
            await submitTimesheet(other, { week: week(20) });
            const system = { ...owner, actorType: 'JOB' } as RequestContext;
            expect(await remindWorkspaceToSubmit(system, { tenantSlug: TAG, weekStart: week(20) })).toEqual({ reminded: 1 });
            expect(await remindWorkspaceToSubmit(system, { tenantSlug: TAG, weekStart: week(20) })).toEqual({ reminded: 0 });
            const [bell] = await bells(member.userId, 'TIMESHEET_REMINDER');
            expect(bell).toMatchObject({ linkUrl: `/t/${TAG}/time?week=${week(20)}` });
            expect(await bells(other.userId, 'TIMESHEET_REMINDER')).toEqual([]);
            await setTimeSettings(owner, { approvalRequired: false });
            await addTimeEntry(member, { workItemId: id, workDate: dayOf(21, 1), minutes: 10 });
            expect(await remindWorkspaceToSubmit(system, { tenantSlug: TAG, weekStart: week(21) })).toEqual({ reminded: 0 });
            await setTimeSettings(owner, { approvalRequired: true });
        });
    });

    describe('concurrency', () => {
        it('a submit racing entry writes: the frozen week holds no entry written after the submit committed', async () => {
            const id = await item('race');
            const writes = Array.from({ length: 6 }, (_, i) => addTimeEntry(member, { workItemId: id, workDate: dayOf(25, i), minutes: 10 }));
            const results = await Promise.allSettled([submitTimesheet(member, { week: week(25) }), ...writes]);
            expect(results[0]!.status).toBe('fulfilled');
            const submitted = (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof submitTimesheet>>>).value;
            const stored = await prisma.timeEntry.count({ where: { tenantId, userId: member.userId, workItemId: id } });
            // What the submit counted is exactly what the week holds: nothing slipped in after it.
            expect(submitted.sums.entries).toBe(stored);
            for (const r of results.slice(1)) {
                if (r.status === 'rejected') expect((r.reason as { details?: { reason?: string } }).details?.reason).toBe('TIMESHEET_FROZEN');
            }
        });
    });

    describe('two-tenant isolation', () => {
        it('an outsider workspace neither reads, changes nor plants Timesheet or TenantTimeSettings rows', async () => {
            const sheet = await submitTimesheet(member, { week: week(40) });
            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            expect(await runInTenantContext(outsider, (db) => db.timesheet.count({ where: { tenantId } }))).toBe(0);
            expect(await runInTenantContext(outsider, (db) => db.tenantTimeSettings.count({ where: { tenantId } }))).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.timesheet.updateMany({ where: { tenantId }, data: { status: 'APPROVED' } }))).count).toBe(0);
            expect((await runInTenantContext(outsider, (db) => db.tenantTimeSettings.updateMany({ where: { tenantId }, data: { approvalRequired: false } }))).count).toBe(0);
            await expect(
                runInTenantContext(outsider, (db) => db.timesheet.create({ data: { tenantId, userId: ou.id, weekStart: new Date(`${week(41)}T00:00:00Z`), status: 'SUBMITTED', submittedAt: new Date() } })),
            ).rejects.toThrow();
            await expect(runInTenantContext(outsider, (db) => db.tenantTimeSettings.create({ data: { tenantId, approvalRequired: false } }))).rejects.toThrow();
            expect(await reasonOf(approveTimesheet(outsider, sheet.timesheet!.id))).toMatch(/404/);
            expect(await reasonOf(getTimesheet(outsider, sheet.timesheet!.id))).toMatch(/404/);
            expect((await runInTenantContext(owner, (db) => db.timesheet.findUniqueOrThrow({ where: { id: sheet.timesheet!.id } }))).status).toBe('SUBMITTED');
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });
});
