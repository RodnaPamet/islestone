/**
 * Statements per request on the seeded database (Hardening H2a;
 * docs/porting/maps/H2.md part 1.3; owner decision 168: deterministic,
 * blocking on every pull request).
 *
 * The runtime twin of the lexical "no query in a loop" guard
 * (`query-shape-guardrails.test.ts`, D1): each scenario drives its real route
 * handler, as the heavy member, through PgBouncer as production does, N
 * times, and `pg_stat_statements` (preloaded by `scripts/ci-postgres.sh
 * --pg-stat-statements`; top-level statements, utility statements such as
 * BEGIN and SET not counted) says how many statements the database ran. Two
 * checks: the count per request stays within the scenario's budget, and a
 * list's count does not grow with its page size (a read per row would).
 *
 * `getTenantCtx` is replaced by the heavy member's context (the session and
 * the edge are 1.4's, tested there); everything below it is real. The create
 * scenario writes items into the seeded workspace, so run it after the seed
 * is verified and dumped (the Performance job's order).
 */
import * as fs from 'node:fs';

import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';

import { flushAllAuditStreams } from '@/app-layer/events/audit-stream';
import type { RequestContext } from '@/app-layer/types';

const getTenantCtxMock = jest.fn<Promise<RequestContext>, [unknown, unknown]>();
jest.mock('@/app-layer/context', () => ({
    getTenantCtx: (params: unknown, req: unknown) => getTenantCtxMock(params, req),
}));

import { prisma } from '@/lib/prisma';

import { directClient, loadPerfWorld, type PerfWorld } from './perf-world';

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ROUTES = 'src/app/api/t/[tenantSlug]';
/** Repetitions per scenario: the budget is the mean, which must be a whole number of statements. */
const RUNS = 5;

interface Scenario {
    name: string;
    file: string;
    method: 'GET' | 'POST' | 'PUT';
    path: (w: PerfWorld, run: number) => string;
    params?: (w: PerfWorld, run: number) => Record<string, string>;
    body?: (w: PerfWorld, run: number) => unknown;
    /** Who calls: the heavy member (the default), or the workspace's owner, who approves weeks (3.4c). */
    as?: 'approver';
    /** Rows a write needs, written on the direct connection before the scenario is warmed (never measured). */
    setup?: (direct: PrismaClient, w: PerfWorld) => Promise<void>;
    /** The most statements one request may run (docs/performance.md, "Statements per request"). */
    budget: number;
    /** What the answer must hold, so the scenario measures the path it names (read once more, never counted). */
    answers?: (body: string) => boolean;
}

/**
 * The budgets are the counts measured on the 10k seed when H2a landed, every
 * statement once per request (none per row). The map's proposals (list 8,
 * board 8, search 10, detail 12, My Work 8, create 25) were met by all but
 * two: the detail reads its thirteen relations one statement each (14), and a
 * create appends three hash-chained audit entries at three statements each
 * (32). docs/performance.md, "Statements per request", lists them. A budget
 * only ever goes down.
 */
/** The 42 days around today, as the calendar view first asks for them. */
function monthGrid(): string {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    return `from=${day(-14)}&to=${day(27)}`;
}

/** The Analytics page's default window (3.6a): the twelve weeks ending today. */
function analyticsWindow(): string {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    return `from=${day(-83)}&to=${day(0)}`;
}

/** The Monday `n` weeks after `from` (a Monday), date-only. */
function mondayAfter(from: string, n: number): string {
    return new Date(Date.parse(`${from}T00:00:00Z`) + n * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** Time totals' quarter ending with the Sunday of the week starting `monday` (3.4d). */
function quarterQuery(monday: string): string {
    const to = Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000;
    const key = (t: number) => new Date(t).toISOString().slice(0, 10);
    return `from=${key(to - 90 * 86_400_000)}&to=${key(to)}`;
}

/** The export's month ending with the Sunday of the week starting `monday` (3.4d). */
function monthQuery(monday: string): string {
    const to = Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000;
    const key = (t: number) => new Date(t).toISOString().slice(0, 10);
    return `from=${key(to - 29 * 86_400_000)}&to=${key(to)}`;
}

/** Weeks of this process's timesheet scenarios start here, so a run against the same database never meets an earlier run's week. */
const WEEK_OFFSET = Date.now() % 400;

/** Timesheets (3.4c): approval on in the seeded workspace. */
async function approvalOn(direct: PrismaClient, w: PerfWorld): Promise<void> {
    await direct.$executeRawUnsafe(
        `INSERT INTO "TenantTimeSettings" ("tenantId", "approvalRequired", "updatedAt") VALUES ($1, true, now())
         ON CONFLICT ("tenantId") DO UPDATE SET "approvalRequired" = true`,
        w.tenantId,
    );
}

/** One submitted week of the heavy member per run (and the warm-up), for the approver to decide; their ids by run. */
const submittedSheets = new Map<number, string>();
async function heavyMemberSubmittedWeeks(direct: PrismaClient, w: PerfWorld): Promise<void> {
    await approvalOn(direct, w);
    // Written once: the waiting weeks' read lists them, the approval decides them.
    if (submittedSheets.size > 0) return;
    for (let run = -1; run < RUNS; run++) {
        const id = `perf-sheet-${WEEK_OFFSET}-${run + 1}`;
        // guardrail-allow: n+1 — fixture rows written once before the scenario, never measured.
        await direct.$executeRawUnsafe(
            `INSERT INTO "Timesheet" ("id", "tenantId", "userId", "weekStart", "status", "submittedAt", "updatedAt")
             VALUES ($1, $2, $3, $4::date, 'SUBMITTED', now(), now())`,
            id,
            w.tenantId,
            w.heavyUserId,
            mondayAfter('2002-01-07', run + 1 + WEEK_OFFSET),
        );
        submittedSheets.set(run, id);
    }
}

/** The Monday of next week (3.5b): a workload cell's week, never before the current week in the workspace's zone. */
function nextMonday(): string {
    const now = new Date();
    const back = (now.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7)).toISOString().slice(0, 10);
}

/**
 * The week after next made over capacity for the heavy member (3.5c): a capacity row of 0 hours from that Monday and
 * the row in force before it again from the Monday after, written once (never measured), so the cell of that week
 * works out its ways to rebalance.
 */
const weekAfterNext = () => new Date(Date.parse(`${nextMonday()}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
async function heavyMemberOverWeek(direct: PrismaClient, w: PerfWorld): Promise<void> {
    const monday = weekAfterNext();
    const after = new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const inForce = await direct.$queryRawUnsafe<Array<{ weeklyMinutes: number; calendarTeamId: string | null }>>(
        `SELECT c."weeklyMinutes", c."calendarTeamId" FROM "MemberCapacity" c WHERE c."tenantId" = $1 AND c."userId" = $2 AND c."effectiveFrom" < $3::date ORDER BY c."effectiveFrom" DESC LIMIT 1`,
        w.tenantId, w.heavyUserId, monday,
    );
    const settings = await direct.$queryRawUnsafe<Array<{ m: number }>>(`SELECT "defaultWeeklyMinutes" AS m FROM "TenantWorkloadSettings" WHERE "tenantId" = $1`, w.tenantId);
    const restore = inForce[0] ?? { weeklyMinutes: settings[0]?.m ?? 2400, calendarTeamId: null };
    await direct.$executeRawUnsafe(
        `INSERT INTO "MemberCapacity" ("id", "tenantId", "userId", "effectiveFrom", "weeklyMinutes", "calendarTeamId", "createdByUserId", "updatedAt")
         VALUES ('perf-over-' || $1, $1, $2, $3::date, 0, NULL, $2, now()), ('perf-back-' || $1, $1, $2, $4::date, $5, $6, $2, now())
         ON CONFLICT ("tenantId", "userId", "effectiveFrom") DO NOTHING`,
        w.tenantId, w.heavyUserId, monday, after, restore.weeklyMinutes, restore.calendarTeamId,
    );
}

/** A month of time off around today (3.5a): the window "My capacity and time off" reads. */
function monthWindow(): string {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    return `from=${day(-6)}&to=${day(35)}`;
}

/**
 * A date of time off no earlier run on this database recorded (3.5a): far in the future, from this process's start.
 * Each minute owns six days (the warm-up and five runs), so runs a minute apart never meet each other's dates.
 */
const TIME_OFF_BASE = Date.UTC(2100, 0, 1) + (Math.floor(Date.now() / 60_000) % 200_000) * 86_400_000 * 6;
function timeOffDay(run: number): string {
    return new Date(TIME_OFF_BASE + (run + 1) * 86_400_000).toISOString().slice(0, 10);
}

const SCENARIOS: Scenario[] = [
    { name: 'list: one project, first page', file: `${ROUTES}/work-items/route.ts`, method: 'GET', path: (w) => `/work-items?projectId=${w.projectId}&limit=50`, budget: 8 },
    { name: 'board: one column of the large project', file: `${ROUTES}/work-items/route.ts`, method: 'GET', path: (w) => `/work-items?projectId=${w.bigProjectId}&stateId=${w.stateId}&limit=50`, budget: 8 },
    { name: 'search: the command palette', file: `${ROUTES}/search/route.ts`, method: 'GET', path: () => `/search?q=${encodeURIComponent('задачата проекта')}&limit=20`, budget: 6 },
    { name: 'detail: the item', file: `${ROUTES}/work-items/[workItemId]/route.ts`, method: 'GET', path: (w) => `/work-items/${w.itemId}`, params: (w) => ({ workItemId: w.itemId }), budget: 14 },
    {
        name: 'my work: assigned to me',
        file: `${ROUTES}/work-items/route.ts`,
        method: 'GET',
        path: (w) => `/work-items?assigneeId=${w.heavyUserId}&stateCategory=BACKLOG,UNSTARTED,STARTED&limit=50`,
        budget: 8,
    },
    // The roadmap (3.2c): the map's budget is at most 7 statements whatever the workspace's size; 6 since 3.5b read
    // the calendars and their holidays' dates in one statement.
    { name: 'roadmap: the whole workspace', file: `${ROUTES}/roadmap/route.ts`, method: 'GET', path: () => '/roadmap', budget: 6 },
    { name: 'roadmap: grouped by goal', file: `${ROUTES}/roadmap/route.ts`, method: 'GET', path: () => '/roadmap?groupBy=goal', budget: 6 },
    // The calendar (3.3a): a month grid around today (42 days), the workspace's and one project's: the
    // tenant binding, the visible projects, the window's items, the undated count, the cycles, the
    // milestones and the working calendar with its holidays' dates (8 measured on the 10k seed, either way; 7 since
    // 3.5b read the calendars and their holidays in one statement).
    // Time entries (3.4b), as measured on the 10k seed: the week reads the context's settings, the entries and
    // their items (with their projects and types, Prisma's own statements); an item's time the context, the item and
    // its project, the total, the page and the people's names. The map proposed 4 and 3 counting neither the
    // context's statement nor Prisma's relation reads; none of these is per row.
    { name: 'time: a week of the heavy member', file: `${ROUTES}/time-entries/route.ts`, method: 'GET', path: (w) => `/time-entries?week=${w.timeWeek}`, budget: 5 },
    { name: "time: an item's time", file: `${ROUTES}/work-items/[workItemId]/time/route.ts`, method: 'GET', path: (w) => `/work-items/${w.timeItemId}/time`, params: (w) => ({ workItemId: w.timeItemId }), budget: 6 },
    // Timesheets (3.4c), as measured on the 10k seed: a week's status line (the tenant binding, the settings, the
    // week's row, its sums in one statement) and the Timesheets page's waiting weeks (the tenant binding, the page
    // with its people's names, its sums in one statement; the deciders' names when a row was decided).
    { name: "timesheets: a week's status", file: `${ROUTES}/timesheets/week/route.ts`, method: 'GET', path: (w) => `/timesheets/week?week=${w.timeWeek}`, budget: 4 },
    { name: 'timesheets: the waiting weeks', file: `${ROUTES}/timesheets/route.ts`, method: 'GET', as: 'approver', setup: heavyMemberSubmittedWeeks, path: () => '/timesheets?status=SUBMITTED', budget: 4 },
    // Capacity and time off (3.5a) and allocation (3.5b), as measured on the 10k seed (capacity, time off and
    // estimates seeded since 3.5b): the context's statement, the calendars with their holidays' dates (one statement),
    // the counts of unplaced work with each item's team's unit (one aggregate, which also names who holds open work),
    // the people (active, and deactivated holders) and their names, the default with the capacity rows and the
    // time-off dates (one statement), the counted items and the time recorded on them; a cell reads one person (and
    // their name; since 3.5c the others on their projects in the same read) in place of the counts and the people, and the
    // listed items' projects. A time-off month: the person,
    // its dates, the calendars and the person's capacity rows. None is per person or per item.
    { name: 'workload: capacity of every member, twelve weeks', file: `${ROUTES}/workload/route.ts`, method: 'GET', path: () => '/workload?weeks=12', budget: 8 },
    { name: "workload: My Work's line, the caller's two weeks", file: `${ROUTES}/workload/route.ts`, method: 'GET', path: () => '/workload?userId=me&weeks=2', budget: 8 },
    { name: "workload: the heavy member's next week, its items", file: `${ROUTES}/workload/cell/route.ts`, method: 'GET', path: () => `/workload/cell?userId=me&week=${nextMonday()}`, budget: 8 },
    // 3.5c: an over-capacity week, its items and the ways to rebalance it (every member's counted work in the item read,
    // the person and the others on their projects in the people read, their capacity in one): the cell's statements.
    {
        name: "workload: the heavy member's over-capacity week and its ways to rebalance",
        file: `${ROUTES}/workload/cell/route.ts`,
        method: 'GET',
        path: () => `/workload/cell?userId=me&week=${weekAfterNext()}`,
        setup: heavyMemberOverWeek,
        budget: 8,
        answers: (body) => body.includes('"assignTo":') && !body.includes('"rebalance":null'),
    },
    { name: "time off: the caller's month", file: `${ROUTES}/time-off/route.ts`, method: 'GET', path: () => `/time-off?${monthWindow()}`, budget: 5 },
    // Time totals and the export (3.4d), as measured on the 10k seed: the totals of a quarter by project, as the
    // heavy member (no money: the tenant binding, the aggregate, the projects' names: 3) and as the owner (also the
    // currency, the rate book, the approved weeks and the priced lines: 7); the export of a month as CSV by the
    // owner (the binding, the entries, the projects, the people, the items, the pricing reads and the audit
    // entry's statements: 13). None is per row.
    { name: 'time totals: a quarter by project, no money', file: `${ROUTES}/time-totals/route.ts`, method: 'GET', path: (w) => `/time-totals?${quarterQuery(w.timeWeek)}&groupBy=project`, budget: 3 },
    { name: 'time totals: a quarter by project, priced', file: `${ROUTES}/time-totals/route.ts`, method: 'GET', as: 'approver', path: (w) => `/time-totals?${quarterQuery(w.timeWeek)}&groupBy=project`, budget: 7 },
    { name: "time export: a month's entries as CSV", file: `${ROUTES}/time-totals/export/route.ts`, method: 'GET', as: 'approver', path: (w) => `/time-totals/export?${monthQuery(w.timeWeek)}&format=csv`, budget: 13 },
    { name: 'calendar: the workspace, a month grid', file: `${ROUTES}/work-items/calendar/route.ts`, method: 'GET', path: () => `/work-items/calendar?${monthGrid()}`, budget: 7 },
    { name: 'calendar: one project, a month grid', file: `${ROUTES}/work-items/calendar/route.ts`, method: 'GET', path: (w) => `/work-items/calendar?projectId=${w.projectId}&${monthGrid()}`, budget: 7 },
    // ── Analytics (3.6a; the map's budget: at most 7 statements a read), as measured on the 10k seed: the tenant
    // binding, the scope's team when it is one project, the calendars, the filter's items when it names current
    // values, the read itself (counts: the categories now and the window's counts; durations: the completions,
    // the age and the points' labels; flow: the teams' units, the items followed and the sweep). Counts 5,
    // throughput 4 (a label filter 5), durations 7, flow with the burn-up 7. The cycle burn-up, 7 before 3.6a,
    // reads its team's calendar for its zone (decision 316): 8. ──
    { name: 'analytics: counts, the workspace, twelve weeks', file: `${ROUTES}/analytics/counts/route.ts`, method: 'GET', path: () => `/analytics/counts?${analyticsWindow()}`, budget: 7 },
    { name: 'analytics: throughput, the workspace, twelve weeks', file: `${ROUTES}/analytics/throughput/route.ts`, method: 'GET', path: () => `/analytics/throughput?${analyticsWindow()}&bin=week`, budget: 7 },
    { name: 'analytics: cycle time with age, a project', file: `${ROUTES}/analytics/durations/route.ts`, method: 'GET', path: (w) => `/analytics/durations?projectId=${w.bigProjectId}&${analyticsWindow()}&measure=cycle`, budget: 7 },
    { name: 'analytics: flow and the burn-up, a project', file: `${ROUTES}/analytics/flow/route.ts`, method: 'GET', path: (w) => `/analytics/flow?projectId=${w.bigProjectId}&${analyticsWindow()}&burnUp=1`, budget: 7 },
    { name: 'analytics: throughput, a label filter (current values)', file: `${ROUTES}/analytics/throughput/route.ts`, method: 'GET', path: (w) => `/analytics/throughput?labelId=${w.labelId}&${analyticsWindow()}`, budget: 7 },
    { name: 'cycles: the burn-up of the current cycle', file: `${ROUTES}/cycles/[cycleId]/burn-up/route.ts`, method: 'GET', path: (w) => `/cycles/${w.currentCycleId}/burn-up`, params: (w) => ({ cycleId: w.currentCycleId }), budget: 8 },
    // ── end of the 3.6a analytics block ──
    {
        name: 'create: one item with a description',
        file: `${ROUTES}/work-items/route.ts`,
        method: 'POST',
        path: () => '/work-items',
        body: (w, run) => ({ projectId: w.projectId, typeId: w.typeId, title: `Perf create ${run}`, description: 'Задачата на проекта and a description to index.' }),
        budget: 32,
    },
    // Time entries (3.4b): adding time, a write of its own (the item gate, the week's lock, the day's total, the
    // insert, and its hash-chained audit entry). Each run a day of its own far in the future, so no day fills.
    {
        name: 'time: add an entry',
        file: `${ROUTES}/time-entries/route.ts`,
        method: 'POST',
        path: () => '/time-entries',
        body: (w, run) => ({ workItemId: w.timeItemId, workDate: `2099-01-${String(run + 2).padStart(2, '0')}`, minutes: 30 }),
        budget: 12,
    },
    // Timesheets (3.4c): submitting an empty week long past (the settings, the week's lock and row, its sums, the
    // insert, the audit entry; then, after the commit, the approvers found and their bells written), and an
    // approval of one of the heavy member's submitted weeks by the owner (the row, the lock, the claim, the
    // sums, the audit entry; then the person's bell). Each run a week of its own.
    {
        name: 'timesheets: submit a week',
        file: `${ROUTES}/timesheets/route.ts`,
        method: 'POST',
        setup: approvalOn,
        path: () => '/timesheets',
        body: (_w, run) => ({ week: mondayAfter('2001-01-01', run + 1 + WEEK_OFFSET) }),
        budget: 24,
    },
    {
        name: 'timesheets: approve a week',
        file: `${ROUTES}/timesheets/[timesheetId]/approve/route.ts`,
        method: 'POST',
        as: 'approver',
        setup: heavyMemberSubmittedWeeks,
        path: (_w, run) => `/timesheets/${submittedSheets.get(run)}/approve`,
        params: (_w, run) => ({ timesheetId: submittedSheets.get(run)! }),
        budget: 23,
    },
    // Time off (3.5a): one's own date recorded, a write of its own (the person's lock, the membership FOR KEY SHARE,
    // the dates it names, the insert and two hash-chained audit entries). Each run a date of its own.
    {
        name: 'time off: record one date',
        file: `${ROUTES}/time-off/days/route.ts`,
        method: 'PUT',
        path: () => '/time-off/days',
        body: (_w, run) => ({ days: [{ day: timeOffDay(run), minutes: null, type: 'VACATION' }] }),
        budget: 11,
    },
];

function request(w: PerfWorld, method: string, path: string, body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/t/${w.slug}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.9' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function handlerFor(file: string, method: string): Promise<Handler> {
    const mod = (await import(`../../${file}`)) as Record<string, Handler>;
    const handler = mod[method];
    if (!handler) throw new Error(`${file} exports no ${method}`);
    return handler;
}

describe(`statements per request on the seeded database (PERF_SHAPE=${process.env.PERF_SHAPE || '10k'})`, () => {
    let direct: PrismaClient;
    let world: PerfWorld;
    const measured: Array<{ name: string; perRequest: number; budget: number }> = [];

    /** Run `fn` RUNS times and return the statements per run, with every response a success. */
    async function statementsPer(fn: (run: number) => Promise<Response>): Promise<number> {
        // Warm once (the Prisma client's first connection, cached reads), then count.
        expect((await fn(-1)).status).toBeLessThan(300);
        // An audited request leaves its entry in the audit stream's buffer, flushed five seconds later with a read
        // of the workspace's stream settings: flushed here, outside every count, so that read never lands in a
        // later scenario's window (3.4d's export is the first audited read among the reads).
        await flushAllAuditStreams();
        await direct.$queryRawUnsafe('SELECT pg_stat_statements_reset()');
        for (let run = 0; run < RUNS; run++) {
            const res = await fn(run);
            expect(res.status).toBeLessThan(300);
        }
        const rows = await direct.$queryRawUnsafe<Array<{ calls: bigint | null }>>(
            `SELECT sum(s."calls") AS "calls"
               FROM pg_stat_statements s
              WHERE s."dbid" = (SELECT oid FROM pg_database WHERE datname = current_database())
                AND s."query" NOT ILIKE '%pg_stat_statements%'`,
        );
        await flushAllAuditStreams();
        return Number(rows[0]!.calls ?? 0) / RUNS;
    }

    beforeAll(async () => {
        direct = directClient();
        const ext = await direct.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM pg_extension WHERE extname = 'pg_stat_statements'`);
        if (Number(ext[0]!.n) === 0) {
            throw new Error('perf: pg_stat_statements is not installed (scripts/ci-postgres.sh --pg-stat-statements, then CREATE EXTENSION in the seeded database)');
        }
        world = await loadPerfWorld(direct);
        getTenantCtxMock.mockImplementation(async () => ({ ...world.ctx, requestId: `perf-${Math.random()}` }));
        // At 100k (the nightly run) the fixture reads on a cold cache take longer than a test's 120 s.
    }, 600_000);

    afterAll(async () => {
        await direct?.$disconnect();
        await prisma.$disconnect();
        const lines = [
            `### Statements per request (${world?.shape ?? '?'})`,
            '',
            '| Scenario | Statements | Budget |',
            '|---|---:|---:|',
            ...measured.map((m) => `| ${m.name} | ${m.perRequest} | ${m.budget} |`),
            '',
        ];
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
        if (process.env.PERF_REPORT_DIR) {
            fs.mkdirSync(process.env.PERF_REPORT_DIR, { recursive: true });
            fs.writeFileSync(`${process.env.PERF_REPORT_DIR}/statements.json`, JSON.stringify(measured, null, 2));
        }
    });

    for (const s of SCENARIOS) {
        it(`${s.name}: at most ${s.budget} statements`, async () => {
            const handler = await handlerFor(s.file, s.method);
            await s.setup?.(direct, world);
            const ctx = s.as === 'approver' ? world.approverCtx : world.ctx;
            getTenantCtxMock.mockImplementation(async () => ({ ...ctx, requestId: `perf-${Math.random()}` }));
            const perRequest = await statementsPer((run) =>
                handler(request(world, s.method, s.path(world, run), s.body?.(world, run)), { params: Promise.resolve({ tenantSlug: world.slug, ...(s.params?.(world, run) ?? {}) }) }),
            );
            measured.push({ name: s.name, perRequest, budget: s.budget });
            if (s.answers) {
                const res = await handler(request(world, s.method, s.path(world, 0), s.body?.(world, 0)), { params: Promise.resolve({ tenantSlug: world.slug, ...(s.params?.(world, 0) ?? {}) }) });
                expect({ name: s.name, answers: s.answers(await res.text()) }).toEqual({ name: s.name, answers: true });
            }
            getTenantCtxMock.mockImplementation(async () => ({ ...world.ctx, requestId: `perf-${Math.random()}` }));
            // A whole number: every request ran the same statements.
            expect({ name: s.name, perRequest, whole: Number.isInteger(perRequest) }).toEqual({ name: s.name, perRequest, whole: true });
            expect({ name: s.name, perRequest, withinBudget: perRequest <= s.budget }).toEqual({ name: s.name, perRequest, withinBudget: true });
        });
    }

    it.each([
        ['one project', (w: PerfWorld) => `projectId=${w.projectId}`],
        ['assigned to me', (w: PerfWorld) => `assigneeId=${w.heavyUserId}&stateCategory=BACKLOG,UNSTARTED,STARTED`],
    ])('the list (%s) runs as many statements for 10 rows as for 100: nothing is read per row', async (_label, filter) => {
        const handler = await handlerFor(`${ROUTES}/work-items/route.ts`, 'GET');
        const countFor = (limit: number) =>
            statementsPer(() => handler(request(world, 'GET', `/work-items?${filter(world)}&limit=${limit}`), { params: Promise.resolve({ tenantSlug: world.slug }) }));
        const small = await countFor(10);
        const large = await countFor(100);
        expect({ small, large }).toEqual({ small, large: small });
    });
});
