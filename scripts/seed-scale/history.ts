/**
 * The scale seed's back-dated history (sub-phase 3.6a;
 * docs/porting/maps/3.6.md, "Performance"; owner decision 331). The bulk
 * writer's items each carry one transition, written by the trigger at seed
 * time, which gives the analytics reads nothing to measure. This step
 * replaces a workspace's record with a plausible one over the 52 weeks
 * before the anchor, written by the seeding superuser directly (the trigger
 * stays the only writer in the product; `app_user` holds SELECT alone), with
 * explicit `at` and `fromStateCategory`:
 *
 *   - every item is created, leaves the backlog, is estimated after
 *     creation (most estimated items), may wait on a member for a while
 *     (about 30 %, a quarter of those twice), joins its cycle, is started,
 *     goes to review (about 60 % of done items, a quarter of those sent back
 *     once), is reopened once (about 8 % of done items),
 *     moves from another project (about 3 %), and ends on its CURRENT
 *     picture: its project, team, state, cycle, milestone, waiting on,
 *     estimates and deletion exactly as the item row holds them (the
 *     verifier checks every item's last row against its row);
 *   - closings follow a non-stationary year: growth across the year, a slow
 *     quarter, and a holiday dip in late December, so a back-test (3.6c) is
 *     not calibrated by construction; open items were created in the last
 *     half year;
 *   - each item's rows are strictly increasing in time and end before the
 *     anchor; about six rows per item.
 *
 * Deterministic: one stream per item, named by its key. Written fresh for
 * Islestone.
 */
import type { PrismaClient, WorkflowStateCategory } from '@prisma/client';

import { stream, type Rng } from './random';
import type { SeedEnv } from './workspace';
import { DAY_MS } from './workspace';

const HOUR_MS = 3_600_000;
const INSERT_CHUNK = 10_000;

interface ItemRow {
    id: string;
    number: number;
    keyPrefix: string;
    projectId: string;
    teamId: string;
    stateId: string;
    stateCategory: WorkflowStateCategory;
    cycleId: string | null;
    milestoneId: string | null;
    waitingOnUserId: string | null;
    estimatePoints: number | null;
    estimateMinutes: number | null;
    deletedAt: Date | null;
}

interface Picture {
    projectId: string;
    teamId: string;
    stateId: string;
    stateCategory: WorkflowStateCategory;
    cycleId: string | null;
    milestoneId: string | null;
    waitingOnUserId: string | null;
    estimatePoints: number | null;
    estimateMinutes: number | null;
    deleted: boolean;
}

export interface HistoryRow extends Picture {
    tenantId: string;
    workItemId: string;
    fromStateCategory: WorkflowStateCategory | null;
    at: Date;
}

/** The weight of week `w` (0 the oldest of 52) whose Monday is `monday`: growth, a slow quarter, a holiday dip. */
export function weekWeight(w: number, monday: Date): number {
    const growth = 0.6 + (0.8 * w) / 51;
    const slow = w >= 26 && w <= 38 ? 0.55 : 1;
    const end = new Date(monday.getTime() + 6 * DAY_MS);
    const holiday = [monday, end].some((d) => (d.getUTCMonth() === 11 && d.getUTCDate() >= 22) || (d.getUTCMonth() === 0 && d.getUTCDate() <= 2)) ? 0.25 : 1;
    return growth * slow * holiday;
}

/** An instant in the year before `anchor`, by the weekly weights (weekdays mostly, office hours). */
function closingInstant(rng: Rng, anchor: Date, weeks: ReadonlyArray<readonly [number, number]>): number {
    const w = rng.weighted(weeks);
    const yearStart = anchor.getTime() - 52 * 7 * DAY_MS;
    const weekday = rng.weighted([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 0.12], [6, 0.08]] as const);
    return yearStart + (w * 7 + weekday) * DAY_MS + rng.int(8 * HOUR_MS, 18 * HOUR_MS) + rng.int(0, 999);
}

/** One item's rows, ending on its current picture. */
export function itemHistory(
    rng: Rng,
    item: ItemRow,
    ctx: {
        tenantId: string;
        anchor: Date;
        weeks: ReadonlyArray<readonly [number, number]>;
        statesOf: (teamId: string) => Partial<Record<'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'REVIEW' | 'DONE', string>>;
        otherProject: (projectId: string) => { projectId: string; teamId: string } | null;
        members: readonly string[];
    },
): HistoryRow[] {
    const anchor = ctx.anchor.getTime();
    const final: Picture = {
        projectId: item.projectId,
        teamId: item.teamId,
        stateId: item.stateId,
        stateCategory: item.stateCategory,
        cycleId: item.cycleId,
        milestoneId: item.milestoneId,
        waitingOnUserId: item.waitingOnUserId,
        estimatePoints: item.estimatePoints,
        estimateMinutes: item.estimateMinutes,
        deleted: item.deletedAt !== null,
    };
    const closed = item.stateCategory === 'DONE' || item.stateCategory === 'CANCELLED';
    // When the item reached its current state, and when it was created.
    let endAt: number;
    let createdAt: number;
    if (closed) {
        endAt = closingInstant(rng, ctx.anchor, ctx.weeks);
        const leadDays = Math.min(60, Math.floor(Math.exp(rng.next() * 3.6)));
        createdAt = endAt - leadDays * DAY_MS - rng.int(HOUR_MS, 20 * HOUR_MS);
    } else {
        createdAt = anchor - rng.int(2 * DAY_MS, 26 * 7 * DAY_MS);
        endAt = createdAt + Math.floor((anchor - HOUR_MS - createdAt) * (0.2 + 0.8 * rng.next()));
    }
    const span = Math.max(endAt - createdAt, HOUR_MS);
    const at = (fraction: number) => createdAt + Math.floor(span * fraction);
    const states = ctx.statesOf(item.teamId);
    const moved = rng.chance(0.03) ? ctx.otherProject(item.projectId) : null;

    // The picture at creation.
    const start: Picture = {
        ...final,
        projectId: moved?.projectId ?? final.projectId,
        teamId: moved?.teamId ?? final.teamId,
        stateCategory: item.stateCategory === 'BACKLOG' || rng.chance(0.3) ? 'BACKLOG' : 'UNSTARTED',
        stateId: '',
        cycleId: null,
        milestoneId: moved ? null : final.milestoneId,
        waitingOnUserId: null,
        deleted: false,
    };
    start.stateId = (moved ? ctx.statesOf(moved.teamId) : states)[start.stateCategory as 'BACKLOG' | 'UNSTARTED'] ?? final.stateId;

    const events: Array<{ at: number; patch: Partial<Picture> }> = [];
    if (moved) events.push({ at: at(0.03 + 0.03 * rng.next()), patch: { projectId: final.projectId, teamId: final.teamId, milestoneId: final.milestoneId, stateId: states[start.stateCategory as 'BACKLOG' | 'UNSTARTED'] ?? final.stateId } });
    // Triage: out of the backlog before any work.
    if (start.stateCategory === 'BACKLOG' && item.stateCategory !== 'BACKLOG' && states.UNSTARTED) events.push({ at: at(0.1 + 0.05 * rng.next()), patch: { stateCategory: 'UNSTARTED', stateId: states.UNSTARTED } });
    // An estimate given after creation (3.4a's columns are recorded).
    if ((final.estimatePoints !== null || final.estimateMinutes !== null) && rng.chance(0.6)) {
        start.estimatePoints = null;
        start.estimateMinutes = null;
        events.push({ at: at(0.17), patch: { estimatePoints: final.estimatePoints, estimateMinutes: final.estimateMinutes } });
    }
    if (final.cycleId) events.push({ at: at(0.2 + 0.1 * rng.next()), patch: { cycleId: final.cycleId } });
    // Waiting on (decision 107): one spell on about 30 %, a second on a quarter of those.
    if (rng.chance(0.3) && ctx.members.length > 0) {
        events.push({ at: at(0.3 + 0.1 * rng.next()), patch: { waitingOnUserId: ctx.members[rng.int(0, ctx.members.length - 1)]! } });
        events.push({ at: at(0.45 + 0.05 * rng.next()), patch: { waitingOnUserId: null } });
        if (rng.chance(0.25)) {
            events.push({ at: at(0.6 + 0.06 * rng.next()), patch: { waitingOnUserId: ctx.members[rng.int(0, ctx.members.length - 1)]! } });
            events.push({ at: at(0.68), patch: { waitingOnUserId: null } });
        }
    }
    const startedFinal = item.stateCategory === 'STARTED';
    const goesThroughStarted = startedFinal || (item.stateCategory === 'DONE' && rng.chance(0.85)) || (item.stateCategory === 'CANCELLED' && rng.chance(0.3));
    if (goesThroughStarted && states.STARTED) {
        events.push({ at: at(0.55 + 0.1 * rng.next()), patch: { stateCategory: 'STARTED', stateId: states.STARTED } });
        if (item.stateCategory === 'DONE' && states.REVIEW && rng.chance(0.6)) {
            events.push({ at: at(0.72), patch: { stateCategory: 'STARTED', stateId: states.REVIEW } });
            if (rng.chance(0.25)) {
                events.push({ at: at(0.76), patch: { stateCategory: 'STARTED', stateId: states.STARTED } });
                events.push({ at: at(0.79), patch: { stateCategory: 'STARTED', stateId: states.REVIEW } });
            }
        }
    }
    if (item.stateCategory === 'DONE' && states.DONE && states.STARTED && rng.chance(0.08)) {
        events.push({ at: at(0.82), patch: { stateCategory: 'DONE', stateId: states.DONE } });
        events.push({ at: at(0.9), patch: { stateCategory: 'STARTED', stateId: states.STARTED } });
    }
    // The current picture, then its deletion when it is deleted.
    events.push({ at: endAt, patch: { ...final, deleted: false } });
    if (final.deleted) events.push({ at: Math.min(endAt + rng.int(HOUR_MS, 10 * DAY_MS), anchor - 1000), patch: { deleted: true } });
    events.sort((a, b) => a.at - b.at);

    const rows: HistoryRow[] = [];
    let picture: Picture = { ...start };
    let previous: WorkflowStateCategory | null = null;
    let last = -Infinity;
    const push = (t: number) => {
        const when = Math.min(Math.max(t, last + 1), anchor - 1);
        last = when;
        rows.push({ tenantId: ctx.tenantId, workItemId: item.id, ...picture, fromStateCategory: previous, at: new Date(when) });
        previous = picture.stateCategory;
    };
    push(createdAt);
    for (const e of events) {
        picture = { ...picture, ...e.patch };
        push(e.at);
    }
    // The last row is the item's row, whatever the clamping did.
    const tail = rows[rows.length - 1]!;
    Object.assign(tail, final);
    return rows;
}

/** Replace a workspace's record with its back-dated history; returns the rows written. */
export async function seedHistory(env: SeedEnv, bulk: PrismaClient, tenantId: string, slug: string): Promise<number> {
    const items = await bulk.$queryRaw<ItemRow[]>`
        SELECT w."id", w."number", p."keyPrefix", w."projectId", w."teamId", w."stateId", w."stateCategory", w."cycleId", w."milestoneId",
               w."waitingOnUserId", w."estimatePoints", w."estimateMinutes", w."deletedAt"
          FROM "WorkItem" w JOIN "Project" p ON p."id" = w."projectId"
         WHERE w."tenantId" = ${tenantId}
         ORDER BY p."keyPrefix", w."number"`;
    const stateRows = await bulk.$queryRaw<Array<{ id: string; teamId: string; name: string; category: WorkflowStateCategory }>>`
        SELECT "id", "teamId", "name", "category" FROM "WorkflowState" WHERE "tenantId" = ${tenantId} AND "archivedAt" IS NULL ORDER BY "teamId", "sortKey"`;
    const projects = await bulk.$queryRaw<Array<{ id: string; teamId: string }>>`
        SELECT "id", "teamId" FROM "Project" WHERE "tenantId" = ${tenantId} AND "deletedAt" IS NULL ORDER BY "id"`;
    const members = (await bulk.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM "TenantMembership" WHERE "tenantId" = ${tenantId} AND "status" = 'ACTIVE' ORDER BY "userId"`).map((m) => m.userId);

    const states = new Map<string, Partial<Record<'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'REVIEW' | 'DONE', string>>>();
    for (const s of stateRows) {
        const own = states.get(s.teamId) ?? {};
        if (s.category === 'STARTED' && own.STARTED) own.REVIEW ??= s.id;
        else if (s.category !== 'CANCELLED') own[s.category as 'BACKLOG' | 'UNSTARTED' | 'STARTED' | 'DONE'] ??= s.id;
        states.set(s.teamId, own);
    }
    const yearStart = env.anchor.getTime() - 52 * 7 * DAY_MS;
    const weeks = Array.from({ length: 52 }, (_, w) => [w, weekWeight(w, new Date(yearStart + w * 7 * DAY_MS))] as const);
    const ctx = {
        tenantId,
        anchor: env.anchor,
        weeks,
        statesOf: (teamId: string) => states.get(teamId) ?? {},
        otherProject: (projectId: string) => {
            const others = projects.filter((p) => p.id !== projectId);
            return others.length ? { projectId: others[0]!.id, teamId: others[0]!.teamId } : null;
        },
        members,
    };

    const rows: HistoryRow[] = [];
    for (const item of items) rows.push(...itemHistory(stream(env.seed, `${slug}:history:${item.keyPrefix}-${item.number}`), item, ctx));
    await bulk.$executeRaw`DELETE FROM "WorkItemTransition" WHERE "tenantId" = ${tenantId}`;
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await bulk.workItemTransition.createMany({ data: rows.slice(i, i + INSERT_CHUNK) });
    }
    env.log(`  ${slug}: ${rows.length} back-dated transitions for ${items.length} items`);
    return rows.length;
}
