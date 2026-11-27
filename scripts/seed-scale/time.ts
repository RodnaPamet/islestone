/**
 * The scale seed's time entries (sub-phase 3.4b; docs/porting/maps/3.4.md,
 * "Performance"): about five entries on 60 % of the live items over the last
 * 26 weeks, by writers drawn as assignees are, and a full working week for
 * the heavy member every week (four entries a day, Monday to Friday), so a
 * person's week, an item's time and a project's time read real volume.
 *
 * Written as the database superuser in batches of 5,000, as the bulk half
 * writes items: minutes 15 to 240 (never past 24 hours in one person's day),
 * a fifth billable, a fifth with a description sanitised and encrypted with
 * the workspace's key by the real field-encryption function. No running
 * timer, no audit entry (the sample of usecase-written rows is the
 * integration suite's).
 *
 * Sub-phase 3.4d adds money and approved weeks (`seedRatesAndApprovals`): the
 * workspace's currency (EUR), rates at the three levels with a change half
 * way (a workspace rate from the first week, raised 13 weeks ago; a rate on
 * every third project; the first two writers' own rates, the second's ended
 * by a NULL row 8 weeks ago), and approved weeks (every week of the heavy
 * member's but the last two, and the first five writers' weeks older than
 * eight weeks), each billable entry of them stamped with the rate the
 * cascade resolves on its date (the real `resolveRate`), as an approval
 * would. Entries are written before their weeks' rows, so the freeze trigger
 * meets no approved week.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { encryptWithKey } from '../../src/lib/security/encryption';
import { sanitizePlainText } from '../../src/lib/security/sanitize';
import { getTenantDek } from '../../src/lib/security/tenant-key-manager';
import { rateBook, resolveRate, type RateRow } from '../../src/app-layer/domain/billable-rate';
import { weekStartOf } from '../../src/lib/time/week';

import { stream, zipf } from './random';
import { shortText } from './text';
import type { SeedEnv, SeedWorkspace } from './workspace';
import { DAY_MS, dayKey } from './workspace';

export const TIME_RATIOS = {
    /** Share of live items with time on them. */
    itemsWithTime: 0.6,
    /** Entries on each of those items. */
    entriesPerItem: 5,
    /** Weeks of history. */
    weeks: 26,
    /** The heavy member's entries per working day. */
    heavyPerDay: 4,
    billable: 0.2,
    described: 0.2,
} as const;

const MINUTES = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const BATCH = 5_000;

export async function seedTimeEntries(env: SeedEnv, bulk: PrismaClient, ws: SeedWorkspace): Promise<number> {
    const dek = await getTenantDek(ws.tenantId);
    const rng = stream(env.seed, `${ws.slug}:time`);
    const items = await bulk.$queryRawUnsafe<Array<{ id: string; projectId: string }>>(
        `SELECT "id", "projectId" FROM "WorkItem" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY "id"`,
        ws.tenantId,
    );
    const writer = zipf(ws.writers.length);
    const days = TIME_RATIOS.weeks * 7;
    const used = new Map<string, number>();
    const rows: Prisma.TimeEntryCreateManyInput[] = [];
    const add = (userId: string, item: { id: string; projectId: string }, date: string): boolean => {
        const minutes = rng.pick(MINUTES);
        const key = `${userId}:${date}`;
        const before = used.get(key) ?? 0;
        if (before + minutes > 1_440) return false;
        used.set(key, before + minutes);
        const created = new Date(`${date}T17:00:00Z`);
        rows.push({
            id: rng.id(),
            tenantId: ws.tenantId,
            userId,
            createdByUserId: userId,
            workItemId: item.id,
            projectId: item.projectId,
            workDate: new Date(`${date}T00:00:00Z`),
            minutes,
            source: 'MANUAL',
            billable: rng.chance(TIME_RATIOS.billable),
            description: rng.chance(TIME_RATIOS.described) ? encryptWithKey(dek, sanitizePlainText(shortText(rng))) : null,
            createdAt: created,
            updatedAt: created,
        });
        return true;
    };

    for (const item of items) {
        if (!rng.chance(TIME_RATIOS.itemsWithTime)) continue;
        for (let n = 0; n < TIME_RATIOS.entriesPerItem; n++) {
            const date = dayKey(new Date(env.anchor.getTime() - rng.int(0, days - 1) * DAY_MS));
            // A writer whose day is full hands the entry to another, drawn evenly.
            if (!add(ws.writers[writer(rng)]!.userId, item, date)) add(rng.pick(ws.writers).userId, item, date);
        }
    }
    // The heavy member's full weeks: Monday to Friday of each of the last 26 weeks, up to today.
    const heavy = ws.members[0]!.userId;
    const thisMonday = weekStartOf(dayKey(env.anchor));
    for (let w = 0; w < TIME_RATIOS.weeks; w++) {
        for (let d = 0; d < 5; d++) {
            const at = new Date(new Date(`${thisMonday}T00:00:00Z`).getTime() - (w * 7 - d) * DAY_MS);
            if (at.getTime() > env.anchor.getTime()) continue;
            for (let n = 0; n < TIME_RATIOS.heavyPerDay; n++) add(heavy, rng.pick(items), dayKey(at));
        }
    }

    const approvals = planRatesAndApprovals(env, ws, rows);
    for (let i = 0; i < rows.length; i += BATCH) {
        // guardrail-allow: n+1 — a bounded batch insert, one statement per 5,000 rows.
        await bulk.timeEntry.createMany({ data: rows.slice(i, i + BATCH) });
    }
    await bulk.tenantTimeSettings.upsert({ where: { tenantId: ws.tenantId }, create: { tenantId: ws.tenantId, currency: 'EUR' }, update: { currency: 'EUR' } });
    await bulk.billableRate.createMany({ data: approvals.rates });
    await bulk.timesheet.createMany({ data: approvals.timesheets });
    env.log(`${ws.slug}: ${rows.length} time entries, ${approvals.rates.length} rates, ${approvals.timesheets.length} approved weeks (${approvals.stamped} entries stamped)`);
    return rows.length;
}

export const RATE_PLAN = {
    /** Minor units of EUR an hour. */
    workspace: 10_000,
    workspaceRaised: 12_000,
    project: 15_000,
    member: 8_000,
    /** The workspace's rise and the second writer's NULL row, weeks before the anchor's week. */
    raisedWeeksAgo: 13,
    memberEndedWeeksAgo: 8,
    /** Weeks of the heavy member's not approved (this one and the last). */
    heavyOpenWeeks: 2,
    /** The writers whose older weeks are approved, and how old. */
    approvedWriters: 5,
    approvedOlderThanWeeks: 8,
} as const;

/**
 * Plan the rates and approved weeks of a workspace's entries (3.4d), and stamp
 * the billable entries of those weeks with their resolved rate, in place.
 */
function planRatesAndApprovals(env: SeedEnv, ws: SeedWorkspace, rows: Prisma.TimeEntryCreateManyInput[]) {
    const rng = stream(env.seed, `${ws.slug}:rates`);
    const thisMonday = weekStartOf(dayKey(env.anchor));
    const mondayAgo = (weeks: number) => dayKey(new Date(new Date(`${thisMonday}T00:00:00Z`).getTime() - weeks * 7 * DAY_MS));
    const first = mondayAgo(TIME_RATIOS.weeks);
    const owner = ws.owner.userId;
    const plan: RateRow[] = [
        { level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: RATE_PLAN.workspace, effectiveFrom: first },
        { level: 'WORKSPACE', projectId: null, userId: null, hourlyRateMinor: RATE_PLAN.workspaceRaised, effectiveFrom: mondayAgo(RATE_PLAN.raisedWeeksAgo) },
        ...ws.projects.filter((_, i) => i % 3 === 0).map((p): RateRow => ({ level: 'PROJECT', projectId: p.id, userId: null, hourlyRateMinor: RATE_PLAN.project, effectiveFrom: first })),
        ...ws.writers.slice(0, 2).map((m): RateRow => ({ level: 'MEMBER', projectId: null, userId: m.userId, hourlyRateMinor: RATE_PLAN.member, effectiveFrom: first })),
        ...(ws.writers[1] ? [{ level: 'MEMBER', projectId: null, userId: ws.writers[1].userId, hourlyRateMinor: null, effectiveFrom: mondayAgo(RATE_PLAN.memberEndedWeeksAgo) } satisfies RateRow] : []),
    ];
    const book = rateBook(plan);
    const heavy = ws.members[0]!.userId;
    const decider = ws.members.find((m) => m.userId !== heavy && m.role !== 'VIEWER')?.userId ?? owner;
    const approved = new Set<string>();
    const weekOf = (userId: string, monday: string) => `${userId}:${monday}`;
    for (let w = RATE_PLAN.heavyOpenWeeks; w < TIME_RATIOS.weeks; w++) approved.add(weekOf(heavy, mondayAgo(w)));
    for (const m of ws.writers.slice(0, RATE_PLAN.approvedWriters)) {
        if (m.userId === heavy) continue;
        for (let w = RATE_PLAN.approvedOlderThanWeeks; w <= TIME_RATIOS.weeks; w++) approved.add(weekOf(m.userId, mondayAgo(w)));
    }
    // Only weeks holding time become rows; a decider never decides their own week.
    const withTime = new Set<string>();
    let stamped = 0;
    for (const r of rows) {
        const date = (r.workDate as Date).toISOString().slice(0, 10);
        const key = weekOf(r.userId, weekStartOf(date));
        if (!approved.has(key)) continue;
        withTime.add(key);
        if (!r.billable) continue;
        const rate = resolveRate(book, { projectId: r.projectId, userId: r.userId, workDate: date });
        if (!rate) continue;
        r.frozenRateMinor = rate.hourlyRateMinor;
        r.frozenRateLevel = rate.level;
        stamped += 1;
    }
    const timesheets: Prisma.TimesheetCreateManyInput[] = [...withTime]
        .filter((key) => !key.startsWith(`${decider}:`))
        .map((key) => {
            const [userId, monday] = key.split(':') as [string, string];
            const submitted = new Date(new Date(`${monday}T00:00:00Z`).getTime() + 7 * DAY_MS + 9 * 3_600_000);
            return {
                id: rng.id(),
                tenantId: ws.tenantId,
                userId,
                weekStart: new Date(`${monday}T00:00:00Z`),
                status: 'APPROVED',
                submittedAt: submitted,
                decidedAt: new Date(submitted.getTime() + 86_400_000),
                decidedByUserId: decider,
            };
        });
    // A decider's own week stays open: unstamp its entries, so no stamp names a week that is not approved.
    for (const r of rows) {
        if (r.userId === decider && r.frozenRateMinor !== undefined && r.frozenRateMinor !== null) {
            r.frozenRateMinor = null;
            r.frozenRateLevel = null;
            stamped -= 1;
        }
    }
    const rates: Prisma.BillableRateCreateManyInput[] = plan.map((r) => ({
        id: rng.id(),
        tenantId: ws.tenantId,
        level: r.level,
        projectId: r.projectId,
        userId: r.userId,
        hourlyRateMinor: r.hourlyRateMinor,
        effectiveFrom: new Date(`${r.effectiveFrom}T00:00:00Z`),
        createdByUserId: owner,
    }));
    return { rates, timesheets, stamped };
}
