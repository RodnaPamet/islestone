/**
 * Billable rates, totals and the export (sub-phase 3.4d;
 * docs/porting/maps/3.4.md, "Rates, totals and export (3.4d)"; ADR 0012 §6
 * and §7; owner decisions 271 to 275), against a real Postgres:
 *
 *   - the catalogue: the rate's CHECKs and its one row per level, scope and
 *     date (NULLS NOT DISTINCT), the currency's CHECK, the frozen rates'
 *     CHECKs;
 *   - the currency: required before the first rate, an ISO code, a rates
 *     holder's (beside `admin.manage`), never changed while rates exist;
 *   - rates: the three levels, a date's row replaced, a future one removed, a
 *     past one never, a member who is not ACTIVE refused, `time.rates` only;
 *   - the billable default: a new entry and a timer start take the project's,
 *     the person's own choice wins, a rates holder sets it, audited;
 *   - the cascade: project, then member, then workspace; a NULL row falls
 *     through; no rate is "No rate";
 *   - the freeze: an approval stamps each billable entry's rate, later rate
 *     changes never reach it, a reopening clears it, the trigger admits only
 *     the stamp; an approved week with no rate stays "No rate";
 *   - Time totals: each grouping, amounts for a rates holder only, "No rate"
 *     minutes, the window's bound, a tombstone's project named with no team
 *     (issue #120) and a deleted item's group;
 *   - the export: CSV and Excel with the same rows, amounts only for a rates
 *     holder, a description only to its person or `time.approve`, formulas
 *     neutralised, the row bound, audited;
 *   - two-tenant isolation (ISOLATION_TESTED: BillableRate).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { getBillableRates, removeBillableRate, setMemberRate, setProjectBillableDefault, setProjectRate, setWorkspaceRate } from '@/app-layer/usecases/billable-rate';
import { createProject, deleteProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { addTimeEntry, startTimer, stopTimer, updateTimeEntry } from '@/app-layer/usecases/time-entry';
import { exportTimeEntries, getTimeTotals } from '@/app-layer/usecases/time-totals';
import { approveTimesheet, reopenTimesheet, setTimeSettings, submitTimesheet } from '@/app-layer/usecases/timesheet';
import { purgeWorkspaceWorkItems } from '@/app-layer/usecases/work-item-purge';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, deleteWorkItem } from '@/app-layer/usecases/work-item';
import { verifyAuditChain } from '@/lib/audit';
import { runInTenantContext } from '@/lib/db/rls-middleware';
import { getPermissionsForRole } from '@/lib/permissions';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `bil${Date.now().toString(36)}`;

async function reasonOf(p: Promise<unknown>): Promise<string> {
    try {
        await p;
    } catch (err) {
        const e = err as { details?: { reason?: string }; status?: number; message?: string };
        return e.details?.reason ?? `${e.status ?? ''} ${e.message ?? ''}`;
    }
    return 'no error';
}

/** A day of the week starting 2004-01-05 (a Monday), `n` days in: long past. */
function day(n: number): string {
    return new Date(Date.UTC(2004, 0, 5) + n * 86_400_000).toISOString().slice(0, 10);
}

describeFn('billable rates, totals and the export (3.4d)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let owner: RequestContext;
    let admin: RequestContext;
    let member: RequestContext;
    let viewer: RequestContext;
    let teamId = '';
    let projectA = '';
    let projectB = '';
    let typeId = '';

    const item = async (projectId: string, title = `item ${Math.random().toString(36).slice(2, 8)}`) => (await createWorkItem(owner, { projectId, typeId, title })).id;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const mk = async (who: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER') => {
            const u = await prisma.user.create({ data: { email: `${who}-${TAG}@example.test`, name: who } });
            await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role } });
            return makeRequestContext(role, { tenantId, tenantSlug: TAG, userId: u.id, requestId: `${TAG}-${who}` });
        };
        owner = await mk('Olga', 'OWNER');
        admin = await mk('Ana', 'ADMIN');
        member = await mk('Mila', 'MEMBER');
        viewer = await mk('Vera', 'VIEWER');
        teamId = (await createTeam(owner, { name: 'Billing' })).id;
        projectA = (await createProject(owner, { teamId, name: 'Client A', keyPrefix: 'BLA' })).id;
        projectB = (await createProject(owner, { teamId, name: 'Internal', keyPrefix: 'BLB' })).id;
        typeId = (await listWorkItemTypes(owner))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('the catalogue', () => {
        it('holds the CHECKs, the unique row per scope and date, and the frozen rates', async () => {
            const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint WHERE conrelid = '"BillableRate"'::regclass AND contype = 'c' ORDER BY conname`;
            expect(checks.map((c) => c.conname)).toEqual(['BillableRate_rate_range', 'BillableRate_scope_of_level']);
            const unique = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indexrelid = '"BillableRate_tenantId_level_projectId_userId_effectiveFrom_key"'::regclass`;
            expect(unique[0]?.def).toMatch(/NULLS NOT DISTINCT/);
            const entryChecks = await prisma.$queryRaw<Array<{ conname: string }>>`
                SELECT conname FROM pg_constraint WHERE conrelid = '"TimeEntry"'::regclass AND conname LIKE 'TimeEntry_frozen%' ORDER BY conname`;
            expect(entryChecks.map((c) => c.conname)).toEqual(['TimeEntry_frozen_rate_billable', 'TimeEntry_frozen_rate_whole']);
            const currency = await prisma.$queryRaw<Array<{ def: string }>>`
                SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'TenantTimeSettings_currency_iso'`;
            expect(currency[0]?.def).toMatch(/\^\[A-Z\]\{3\}\$/);
            // A workspace row names no scope: two on one date collide.
            await prisma.billableRate.create({ data: { tenantId, level: 'WORKSPACE', hourlyRateMinor: 1, effectiveFrom: new Date('1990-01-01'), createdByUserId: owner.userId } });
            await expect(prisma.billableRate.create({ data: { tenantId, level: 'WORKSPACE', hourlyRateMinor: 2, effectiveFrom: new Date('1990-01-01'), createdByUserId: owner.userId } })).rejects.toThrow();
            // A level names its own scope only.
            await expect(prisma.billableRate.create({ data: { tenantId, level: 'PROJECT', hourlyRateMinor: 1, effectiveFrom: new Date('1990-01-02'), createdByUserId: owner.userId } })).rejects.toThrow(/BillableRate_scope_of_level/);
            await prisma.billableRate.deleteMany({ where: { tenantId } });
        });
    });

    describe('the currency (decision 273)', () => {
        it('is required before the first rate, an ISO code, a rates holder\'s, and fixed once rates exist', async () => {
            expect(await reasonOf(setWorkspaceRate(owner, { effectiveFrom: day(0), hourlyRateMinor: 10_000 }))).toBe('CURRENCY_REQUIRED');
            expect(await reasonOf(setTimeSettings(owner, { currency: 'ZZZ' }))).toBe('CURRENCY_UNKNOWN');
            const noMoney = makeRequestContext('ADMIN', { tenantId, tenantSlug: TAG, userId: admin.userId, requestId: `${TAG}-nomoney` });
            noMoney.appPermissions = getPermissionsForRole('ADMIN');
            noMoney.appPermissions.time.rates = false;
            expect(await reasonOf(setTimeSettings(noMoney, { currency: 'EUR' }))).toBe('TIME_RATES_REQUIRED');
            expect(await reasonOf(setTimeSettings(member, { currency: 'EUR' }))).toMatch(/403/);
            const set = await setTimeSettings(owner, { currency: 'EUR' });
            expect(set.currency).toBe('EUR');
            await setWorkspaceRate(owner, { effectiveFrom: day(0), hourlyRateMinor: 10_000 });
            expect(await reasonOf(setTimeSettings(owner, { currency: 'USD' }))).toBe('CURRENCY_IN_USE');
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIME_SETTINGS_SET' }, orderBy: { createdAt: 'desc' } });
            expect(audit.metadataJson).toMatchObject({ currency: 'EUR' });
        });
    });

    describe('rates (decisions 272 to 274)', () => {
        it('are set at three levels, a date replaced, a future one removed and a past one kept, for a rates holder only', async () => {
            await setProjectRate(owner, projectA, { effectiveFrom: day(0), hourlyRateMinor: 15_000 });
            await setMemberRate(owner, member.userId, { effectiveFrom: day(0), hourlyRateMinor: 8_000 });
            // The same date again replaces its row.
            const replaced = await setMemberRate(owner, member.userId, { effectiveFrom: day(0), hourlyRateMinor: 9_000 });
            expect(await prisma.billableRate.count({ where: { tenantId, level: 'MEMBER', userId: member.userId } })).toBe(1);
            expect(replaced.hourlyRateMinor).toBe(9_000);
            const future = await setWorkspaceRate(owner, { effectiveFrom: '2099-01-01', hourlyRateMinor: 12_000 });
            expect(future.removable).toBe(true);
            const all = await getBillableRates(admin);
            expect(all.currency).toBe('EUR');
            expect(all.rates.map((r) => `${r.level}:${r.hourlyRateMinor}`).sort()).toEqual(['MEMBER:9000', 'PROJECT:15000', 'WORKSPACE:10000', 'WORKSPACE:12000']);
            await removeBillableRate(owner, future.id);
            const past = all.rates.find((r) => r.level === 'WORKSPACE' && r.effectiveFrom === day(0))!;
            expect(await reasonOf(removeBillableRate(owner, past.id))).toBe('RATE_IN_FORCE');
            // Money is the rate holders' (decision 274): a member reads and sets none.
            expect(await reasonOf(getBillableRates(member))).toMatch(/403/);
            expect(await reasonOf(setProjectRate(member, projectA, { effectiveFrom: day(0), hourlyRateMinor: 1 }))).toMatch(/403/);
            // A member who is not one, and a project that is not one, are 404s.
            expect(await reasonOf(setMemberRate(owner, 'nobody', { effectiveFrom: day(0), hourlyRateMinor: 1 }))).toMatch(/404/);
            expect(await reasonOf(setProjectRate(owner, 'nothing', { effectiveFrom: day(0), hourlyRateMinor: 1 }))).toMatch(/404/);
            const audit = await prisma.auditLog.findMany({ where: { tenantId, action: { in: ['BILLABLE_RATE_SET', 'BILLABLE_RATE_REMOVED'] } } });
            expect(audit.filter((a) => a.action === 'BILLABLE_RATE_REMOVED')).toHaveLength(1);
            expect(audit.find((a) => (a.metadataJson as { level?: string }).level === 'MEMBER' && (a.metadataJson as { fromHourlyRateMinor?: number }).fromHourlyRateMinor === 8_000)).toBeTruthy();
        });
    });

    describe('the billable default (decision 271)', () => {
        it("is the project's for a new entry and a timer, the person's choice wins, and only a rates holder sets it", async () => {
            const project = await prisma.project.findUniqueOrThrow({ where: { id: projectA } });
            expect(await reasonOf(setProjectBillableDefault(member, projectA, { billableByDefault: true }))).toMatch(/403/);
            const out = await setProjectBillableDefault(owner, projectA, { billableByDefault: true }, project.version);
            expect(out).toMatchObject({ timeBillableByDefault: true, version: project.version + 1 });
            const wi = await item(projectA);
            const plain = await addTimeEntry(member, { workItemId: wi, workDate: day(1), minutes: 30 });
            expect(plain.billable).toBe(true);
            const chosen = await addTimeEntry(member, { workItemId: wi, workDate: day(1), minutes: 30, billable: false });
            expect(chosen.billable).toBe(false);
            // Off on the other project: unticked, as before 3.4d.
            const inB = await addTimeEntry(member, { workItemId: await item(projectB), workDate: day(1), minutes: 30 });
            expect(inB.billable).toBe(false);
            await startTimer(member, { workItemId: wi, timeZone: 'UTC' });
            const timer = await prisma.timeEntry.findFirstOrThrow({ where: { tenantId, userId: member.userId, minutes: null } });
            expect(timer.billable).toBe(true);
            await stopTimer(member);
            const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'PROJECT_UPDATED', entityId: projectA }, orderBy: { createdAt: 'desc' } });
            expect(audit.detailsJson).toMatchObject({ changedFields: ['timeBillableByDefault'] });
            // A stale version is refused.
            expect(await reasonOf(setProjectBillableDefault(owner, projectA, { billableByDefault: false }, project.version))).toBe('VERSION_CONFLICT');
            await prisma.timeEntry.deleteMany({ where: { tenantId } });
        });
    });

    describe('the cascade and the freeze (decisions 272 and 273)', () => {
        it('prices project, then member, then workspace, and an approval freezes each rate until a reopening', async () => {
            // Week of day(7): project A has 150.00, the member 90.00, the workspace 100.00 (all from day 0).
            const a = await item(projectA, 'Priced on A');
            const b = await item(projectB, 'Priced on B');
            await addTimeEntry(member, { workItemId: a, workDate: day(7), minutes: 60, billable: true });
            await addTimeEntry(member, { workItemId: b, workDate: day(8), minutes: 30, billable: true });
            await addTimeEntry(admin, { workItemId: b, workDate: day(8), minutes: 45, billable: true });
            await addTimeEntry(admin, { workItemId: b, workDate: day(8), minutes: 20, billable: false });
            const filter = { from: day(7), to: day(13) };
            const byPerson = await getTimeTotals(owner, { filter, groupBy: 'person' });
            const of = (userId: string) => byPerson.groups.find((g) => g.key === userId)!;
            // Mila: 60 min × 150.00 + 30 min × 90.00 (her own rate on B) = 150.00 + 45.00.
            expect(of(member.userId).amountMinor).toBe(15_000 + 4_500);
            // Ana: 45 min × 100.00 (the workspace's) = 75.00; her non-billable 20 minutes have no amount.
            expect(of(admin.userId)).toMatchObject({ minutes: 65, billableMinutes: 45, amountMinor: 7_500, noRateMinutes: 0 });
            expect(byPerson.currency).toBe('EUR');

            // A NULL member row from day 8 falls through to the workspace for Mila on B.
            await setMemberRate(owner, member.userId, { effectiveFrom: day(8), hourlyRateMinor: null });
            expect((await getTimeTotals(owner, { filter, groupBy: 'person' })).groups.find((g) => g.key === member.userId)!.amountMinor).toBe(15_000 + 5_000);

            // Approve Mila's week: her rates are stamped.
            await setTimeSettings(owner, { approvalRequired: true });
            const sheet = await submitTimesheet(member, { week: day(7) });
            await approveTimesheet(owner, sheet.timesheet!.id);
            const stamped = await prisma.timeEntry.findMany({ where: { tenantId, userId: member.userId, workDate: { gte: new Date(day(7)), lte: new Date(day(13)) } }, orderBy: { minutes: 'desc' }, select: { frozenRateMinor: true, frozenRateLevel: true } });
            expect(stamped).toEqual([
                { frozenRateMinor: 15_000, frozenRateLevel: 'PROJECT' },
                { frozenRateMinor: 10_000, frozenRateLevel: 'WORKSPACE' },
            ]);
            const approvedAudit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'TIMESHEET_APPROVED' }, orderBy: { createdAt: 'desc' } });
            expect(approvedAudit.metadataJson).toMatchObject({ frozenRates: 2 });

            // A later rate change on a past date never reaches the approved week, and does reach Ana's open one.
            await setProjectRate(owner, projectA, { effectiveFrom: day(7), hourlyRateMinor: 99_000 });
            await setWorkspaceRate(owner, { effectiveFrom: day(7), hourlyRateMinor: 20_000 });
            const after = await getTimeTotals(owner, { filter, groupBy: 'person' });
            expect(after.groups.find((g) => g.key === member.userId)!.amountMinor).toBe(15_000 + 5_000);
            expect(after.groups.find((g) => g.key === admin.userId)!.amountMinor).toBe(15_000);

            // The trigger admits the stamp alone: a frozen entry's other columns still refuse.
            const frozen = await prisma.timeEntry.findFirstOrThrow({ where: { tenantId, userId: member.userId, minutes: 60 } });
            await expect(prisma.timeEntry.update({ where: { id: frozen.id }, data: { frozenRateMinor: 1, minutes: 61 } })).rejects.toThrow(/TIMESHEET_FROZEN/);
            await expect(prisma.timeEntry.update({ where: { id: frozen.id }, data: { frozenRateMinor: 1 } })).resolves.toBeTruthy();
            await prisma.timeEntry.update({ where: { id: frozen.id }, data: { frozenRateMinor: 15_000 } });
            // A frozen rate only on a billable entry, and both columns or neither (the CHECKs).
            await expect(prisma.timeEntry.update({ where: { id: frozen.id }, data: { frozenRateLevel: null } })).rejects.toThrow(/TimeEntry_frozen_rate_whole/);

            // Reopen: the stamps go, and the history prices the week again.
            await reopenTimesheet(owner, sheet.timesheet!.id, { explanation: 'Fix the client' });
            expect(await prisma.timeEntry.count({ where: { tenantId, userId: member.userId, frozenRateMinor: { not: null } } })).toBe(0);
            const reopened = await getTimeTotals(owner, { filter, groupBy: 'person' });
            expect(reopened.groups.find((g) => g.key === member.userId)!.amountMinor).toBe(99_000 + 10_000);
            await setTimeSettings(owner, { approvalRequired: false });
        });

        it('keeps "No rate" frozen for an approved week whose billable time had none', async () => {
            const team = await createTeam(owner, { name: 'Norate' });
            const project = (await createProject(owner, { teamId: team.id, name: 'Norate', keyPrefix: 'BLN' })).id;
            // A workspace NULL row from day 21: no rate anywhere for the viewer-free project (Ana has no member rate).
            await setWorkspaceRate(owner, { effectiveFrom: day(21), hourlyRateMinor: null });
            await addTimeEntry(admin, { workItemId: await item(project), workDate: day(21), minutes: 90, billable: true });
            await setTimeSettings(owner, { approvalRequired: true });
            const sheet = await submitTimesheet(admin, { week: day(21) });
            await approveTimesheet(owner, sheet.timesheet!.id);
            await setWorkspaceRate(owner, { effectiveFrom: day(21), hourlyRateMinor: 50_000 });
            const totals = await getTimeTotals(owner, { filter: { from: day(21), to: day(27), projectId: project }, groupBy: 'project' });
            expect(totals.groups[0]).toMatchObject({ amountMinor: 0, noRateMinutes: 90 });
            await setTimeSettings(owner, { approvalRequired: false });
        });
    });

    describe('Time totals (decisions 266 and 274)', () => {
        it('groups by project, item and week, hides money from a member, and bounds the window', async () => {
            const filter = { from: day(7), to: day(13) };
            const byProject = await getTimeTotals(member, { filter, groupBy: 'project' });
            expect(byProject.viewer.rates).toBe(false);
            expect(byProject.currency).toBeNull();
            for (const g of byProject.groups) expect(g).toMatchObject({ amountMinor: null, noRateMinutes: null });
            expect(byProject.groups.map((g) => g.subject.kind === 'project' && g.subject.keyPrefix).sort()).toEqual(['BLA', 'BLB']);
            expect(byProject.total).toMatchObject({ minutes: 60 + 30 + 45 + 20, amountMinor: null });
            const byItem = await getTimeTotals(viewer, { filter, groupBy: 'item' });
            expect(byItem.groups.map((g) => (g.subject.kind === 'item' && g.subject.item.kind === 'visible' ? g.subject.item.title : '?')).sort()).toEqual(['Priced on A', 'Priced on B']);
            const byWeek = await getTimeTotals(owner, { filter: { from: day(0), to: day(27) }, groupBy: 'week' });
            expect(byWeek.groups.map((g) => g.key)).toEqual([day(7), day(21)]);
            expect(await reasonOf(getTimeTotals(owner, { filter: { from: '2004-01-01', to: '2005-01-02' }, groupBy: 'project' }))).toBe('TIME_RANGE');
            expect(await reasonOf(getTimeTotals(owner, { filter: { from: day(5), to: day(1) }, groupBy: 'project' }))).toBe('TIME_RANGE');
            // The filter narrows: a person, billable only.
            const mila = await getTimeTotals(owner, { filter: { ...filter, userId: member.userId, billable: true }, groupBy: 'project' });
            expect(mila.total).toMatchObject({ minutes: 90, billableMinutes: 90, entries: 2 });
        });

        it("names a tombstone's project with no team (issue #120) and a deleted item's group", async () => {
            const team = await createTeam(owner, { name: 'Gone soon' });
            const project = (await createProject(owner, { teamId: team.id, name: 'Old client', keyPrefix: 'BLT' })).id;
            const gone = await item(project, 'To be purged');
            await addTimeEntry(member, { workItemId: gone, workDate: day(35), minutes: 15 });
            const purged = await item(projectB, 'Purged alone');
            await addTimeEntry(member, { workItemId: purged, workDate: day(35), minutes: 25 });
            await deleteProject(owner, project);
            await deleteWorkItem(owner, purged);
            await purgeWorkspaceWorkItems({ ...owner, actorType: 'JOB' }, new Date(Date.now() + 86_400_000), 0);
            const tomb = await prisma.project.findUniqueOrThrow({ where: { id: project } });
            expect(tomb).toMatchObject({ teamId: null });
            expect(tomb.purgedAt).toBeInstanceOf(Date);
            const byProject = await getTimeTotals(member, { filter: { from: day(35), to: day(35) }, groupBy: 'project' });
            expect(byProject.groups.find((g) => g.key === project)).toMatchObject({
                minutes: 15,
                subject: { kind: 'project', projectId: project, name: 'Old client', keyPrefix: 'BLT', teamId: null, deleted: true },
            });
            const byItem = await getTimeTotals(member, { filter: { from: day(35), to: day(35) }, groupBy: 'item' });
            expect(byItem.groups.find((g) => g.key === 'deleted')).toMatchObject({ minutes: 40, subject: { kind: 'item', item: { kind: 'deleted' } } });
            // The export names the tombstone's key too.
            const csv = (await exportTimeEntries(member, { filter: { from: day(35), to: day(35) }, format: 'csv' })).body.toString('utf8');
            expect(csv).toContain(',BLT,Deleted item,');
        });
    });

    describe('the export (decision 275)', () => {
        it('writes CSV and Excel with the same rows, money and descriptions only where allowed, formulas neutralised, audited', async () => {
            const wi = await item(projectA, '=HYPERLINK("http://evil")');
            await addTimeEntry(member, { workItemId: wi, workDate: day(42), minutes: 90, billable: true, description: '@SUM(A1:A2)' });
            await addTimeEntry(admin, { workItemId: wi, workDate: day(42), minutes: 30, description: 'Admin text' });
            const filter = { from: day(42), to: day(42) };

            const own = (await exportTimeEntries(member, { filter, format: 'csv' })).body.toString('utf8');
            const lines = own.replace(/^﻿/, '').trimEnd().split('\r\n');
            expect(lines[0]).toBe('Date,Person,Project,Item,Title,Hours,Minutes,Billable,Description');
            expect(lines).toHaveLength(3);
            // A member: their own description, never another's; no money columns.
            expect(own).toContain("'@SUM(A1:A2)");
            expect(own).not.toContain('Admin text');
            // A title that opens a formula is a text cell with a quote in front.
            expect(own).toContain(`"'=HYPERLINK(""http://evil"")"`);

            const full = await exportTimeEntries(owner, { filter, format: 'csv' });
            const fullLines = full.body.toString('utf8').replace(/^﻿/, '').trimEnd().split('\r\n');
            expect(fullLines[0]).toBe('Date,Person,Project,Item,Title,Hours,Minutes,Billable,Rate (EUR per hour),Amount (EUR),Description');
            expect(full.body.toString('utf8')).toContain('Admin text');
            // Mila on A at the project's 990.00 from day 7: 90 minutes = 1,485.00.
            expect(fullLines.find((l) => l.includes('Mila'))).toContain(',1.50,90,Yes,990.00,1485.00,');
            expect(full.contentType).toBe('text/csv; charset=utf-8');
            expect(full.filename).toBe(`time-entries-${day(42)}-to-${day(42)}.csv`);

            const xlsx = await exportTimeEntries(owner, { filter, format: 'xlsx' });
            expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
            expect(xlsx.rows).toBe(full.rows);
            expect(xlsx.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

            const audit = await prisma.auditLog.findMany({ where: { tenantId, action: 'TIME_EXPORTED' }, orderBy: { createdAt: 'asc' } });
            expect(audit.length).toBeGreaterThanOrEqual(3);
            const last = audit[audit.length - 1]!;
            expect(last.detailsJson).toMatchObject({ category: 'data_lifecycle', operation: 'exported', recordCount: 2 });
            expect(last.metadataJson).toMatchObject({ format: 'xlsx', from: day(42), to: day(42), rows: 2, amounts: true });
            expect(JSON.stringify(last)).not.toContain('Admin text');
        });

        it('refuses more than 50,000 rows, never cut', async () => {
            const wi = await item(projectB, 'Bulk');
            // Inserted directly: 50,001 one-minute entries over one week of an open week.
            await prisma.$executeRawUnsafe(
                `INSERT INTO "TimeEntry" ("id", "tenantId", "userId", "workItemId", "projectId", "workDate", "minutes", "source", "billable", "createdByUserId", "updatedAt")
                 SELECT 'bulk' || g, $1, $2, $3, $4, DATE '2004-06-07' + (g % 7), 1, 'MANUAL', false, $2, now() FROM generate_series(1, 50001) g`,
                tenantId,
                viewer.userId,
                wi,
                projectB,
            );
            expect(await reasonOf(exportTimeEntries(owner, { filter: { from: '2004-06-07', to: '2004-06-13' }, format: 'csv' }))).toBe('TIME_EXPORT_TOO_LARGE');
            await prisma.timeEntry.deleteMany({ where: { tenantId, id: { startsWith: 'bulk' } } });
        });
    });

    describe('two-tenant isolation', () => {
        it("one workspace's rates never reach another's reads, writes or totals", async () => {
            const otherTenant = (await createTenantWithDek({ name: `${TAG}x`, slug: `${TAG}x` })).id;
            const ou = await prisma.user.create({ data: { email: `outsider-${TAG}@example.test`, name: 'outsider' } });
            await prisma.tenantMembership.create({ data: { tenantId: otherTenant, userId: ou.id, role: 'OWNER' } });
            const outsider = makeRequestContext('OWNER', { tenantId: otherTenant, tenantSlug: `${TAG}x`, userId: ou.id, requestId: `${TAG}-outsider` });
            expect((await getBillableRates(outsider)).rates).toEqual([]);
            expect(await runInTenantContext(outsider, (db) => db.billableRate.count())).toBe(0);
            const ours = await prisma.billableRate.findFirstOrThrow({ where: { tenantId } });
            expect(await reasonOf(removeBillableRate(outsider, ours.id))).toMatch(/404/);
            expect(await reasonOf(setProjectRate(outsider, projectA, { effectiveFrom: day(0), hourlyRateMinor: 1 }))).not.toBe('no error');
            expect((await getTimeTotals(outsider, { filter: { from: day(0), to: day(60) }, groupBy: 'project' })).groups).toEqual([]);
            // A raw insert naming another workspace is refused by row-level security.
            await expect(
                runInTenantContext(outsider, (db) => db.billableRate.create({ data: { tenantId, level: 'WORKSPACE', hourlyRateMinor: 1, effectiveFrom: new Date('1991-01-01'), createdByUserId: ou.id } })),
            ).rejects.toThrow();
        });

        it('kept the audit chain whole', async () => {
            expect((await verifyAuditChain(tenantId)).valid).toBe(true);
        });
    });

    it('lets a person change the billable flag of an open entry (decision 271)', async () => {
        const wi = await item(projectB);
        const e = await addTimeEntry(member, { workItemId: wi, workDate: day(49), minutes: 10 });
        const changed = await updateTimeEntry(member, e.id, { billable: true }, e.version);
        expect(changed.billable).toBe(true);
    });
});
