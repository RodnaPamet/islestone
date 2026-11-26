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
    method: 'GET' | 'POST';
    path: (w: PerfWorld) => string;
    params?: (w: PerfWorld) => Record<string, string>;
    body?: (w: PerfWorld, run: number) => unknown;
    /** The most statements one request may run (docs/performance.md, "Statements per request"). */
    budget: number;
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
    // The roadmap (3.2c): the map's budget is at most 7 statements whatever the workspace's size.
    { name: 'roadmap: the whole workspace', file: `${ROUTES}/roadmap/route.ts`, method: 'GET', path: () => '/roadmap', budget: 7 },
    { name: 'roadmap: grouped by goal', file: `${ROUTES}/roadmap/route.ts`, method: 'GET', path: () => '/roadmap?groupBy=goal', budget: 7 },
    {
        name: 'create: one item with a description',
        file: `${ROUTES}/work-items/route.ts`,
        method: 'POST',
        path: () => '/work-items',
        body: (w, run) => ({ projectId: w.projectId, typeId: w.typeId, title: `Perf create ${run}`, description: 'Задачата на проекта and a description to index.' }),
        budget: 32,
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
            const perRequest = await statementsPer((run) =>
                handler(request(world, s.method, s.path(world), s.body?.(world, run)), { params: Promise.resolve({ tenantSlug: world.slug, ...(s.params?.(world) ?? {}) }) }),
            );
            measured.push({ name: s.name, perRequest, budget: s.budget });
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
