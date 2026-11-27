/**
 * The transition record's 3.6a column and the analytics SQL reads against a
 * real Postgres (owner decisions 310, 311 and 331; ADR 0014 §1;
 * docs/porting/maps/3.6.md, "One new column", "H3 and 3.6"):
 *
 *   - the catalogue: the column, the trigger writing it (NULL on an insert,
 *     the old category on an update, also as `app_user`), and the partial
 *     indexes `WorkItemTransition_completions` and `_creations` with their
 *     exact predicates;
 *   - the migration's backfill (its own statement, read from the file) gives
 *     each row its item's previous category in the record's order and an
 *     item's first row NULL;
 *   - the SQL reads equal the pure modules (`domain/analytics/`) on random
 *     histories (reopens, deletions and restores, cancels, moves between
 *     projects, cycles and milestones, a deleted project, inserts into Done,
 *     ties at one instant) in five zones, under several scopes and
 *     visibilities: throughput per day, cycle time and lead time instants,
 *     created and completed counts, and cumulative flow and the burn-up.
 *
 * The rows are planted by the test client (the login role; `app_user` holds
 * SELECT alone) and read back through `runInTenantContext`, as `app_user`.
 *
 * Written fresh for Islestone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import type { PrismaClient, WorkflowStateCategory } from '@prisma/client';

import { completionAsOf } from '@/app-layer/domain/analytics/completion';
import { completionInstantsAsOf } from '@/app-layer/domain/analytics/durations';
import { flowFromDeltas, flowSweep } from '@/app-layer/domain/analytics/flow';
import { byItem, pictureAt, type RecordFact } from '@/app-layer/domain/analytics/record';
import { epochDayOf, startOfEpochDay } from '@/app-layer/domain/analytics/zone';
import { toEpochDay } from '@/app-layer/domain/schedule/calendar';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { WorkItemTransitionRepository, type RecordScope } from '@/app-layer/repositories/WorkItemTransitionRepository';
import { runInTenantContext } from '@/lib/db/rls-middleware';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';
import { seedWorkItem, seedWorkWorld, type WorkWorld } from '../helpers/work-fixture';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `anrec${Date.now().toString(36)}`;
const MIGRATION = path.resolve(__dirname, '../../prisma/migrations/20261226120000_transition_from_state_category/migration.sql');

/** The migration's backfill statement, exactly as written. */
function backfillSql(): string {
    const text = readFileSync(MIGRATION, 'utf8');
    const start = text.indexOf('UPDATE "WorkItemTransition" AS t');
    const end = text.indexOf(';', start);
    return text.slice(start, end + 1);
}

const CATEGORY = fc.constantFrom<WorkflowStateCategory>('BACKLOG', 'UNSTARTED', 'STARTED', 'STARTED', 'DONE', 'DONE', 'CANCELLED');
const ZONE = fc.constantFrom('UTC', 'Europe/Sofia', 'America/New_York', 'Asia/Tokyo', 'Australia/Lord_Howe');
const BASE = Date.UTC(2031, 2, 1);

describeFn('the transition record and the analytics reads (3.6a)', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let userId = '';
    let world: WorkWorld;
    let other: WorkWorld;
    let deletedProjectId = '';
    let ctx: ReturnType<typeof makeRequestContext>;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await prisma.tenant.create({ data: { name: TAG, slug: TAG } })).id;
        userId = (await prisma.user.create({ data: { email: `${TAG}@example.test` } })).id;
        await prisma.tenantMembership.create({ data: { tenantId, userId, role: 'OWNER' } });
        world = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'ANA' });
        other = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'ANB', teamName: 'Other' });
        const gone = await seedWorkWorld(prisma, tenantId, { keyPrefix: 'ANC', teamName: 'Gone' });
        deletedProjectId = gone.projectId;
        await prisma.project.update({ where: { id: deletedProjectId }, data: { deletedAt: new Date() } });
        ctx = makeRequestContext('OWNER', { tenantId, userId, tenantSlug: TAG });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('holds the column, the trigger body and the partial index with its exact predicate', async () => {
        const [col] = await prisma.$queryRaw<Array<{ udt_name: string; is_nullable: string }>>`
            SELECT udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'WorkItemTransition' AND column_name = 'fromStateCategory'`;
        expect(col).toEqual({ udt_name: 'WorkflowStateCategory', is_nullable: 'YES' });
        const [fn] = await prisma.$queryRaw<Array<{ src: string; secdef: boolean }>>`
            SELECT prosrc AS src, prosecdef AS secdef FROM pg_proc WHERE proname = 'work_item_transition_record'`;
        expect(fn!.secdef).toBe(true);
        expect(fn!.src).toMatch(/IF TG_OP = 'UPDATE' THEN\s+from_category := OLD\."stateCategory";/);
        expect(fn!.src).toContain('"stateCategory", "fromStateCategory", "cycleId"');
        const [ix] = await prisma.$queryRaw<Array<{ def: string }>>`SELECT indexdef::text AS def FROM pg_indexes WHERE indexname = 'WorkItemTransition_completions'`;
        expect(ix!.def).toBe(
            'CREATE INDEX "WorkItemTransition_completions" ON public."WorkItemTransition" USING btree ("tenantId", "projectId", at) WHERE (("stateCategory" = \'DONE\'::"WorkflowStateCategory") AND ("fromStateCategory" IS DISTINCT FROM \'DONE\'::"WorkflowStateCategory"))',
        );
        const [created] = await prisma.$queryRaw<Array<{ def: string }>>`SELECT indexdef::text AS def FROM pg_indexes WHERE indexname = 'WorkItemTransition_creations'`;
        expect(created!.def).toBe('CREATE INDEX "WorkItemTransition_creations" ON public."WorkItemTransition" USING btree ("tenantId", "projectId", at) WHERE ("fromStateCategory" IS NULL)');
    });

    it('writes NULL on the insert row and the old category on each change, also as app_user', async () => {
        const item = await seedWorkItem(prisma, tenantId, world, { title: 'trigger', createdByUserId: userId, sortKey: 'a0' });
        await runInTenantContext(ctx, (db) => db.workItem.update({ where: { id: item.id }, data: { stateId: world.states['In progress']!.id, stateCategory: 'STARTED' } }));
        await prisma.workItem.update({ where: { id: item.id }, data: { stateId: world.states.Done!.id, stateCategory: 'DONE' } });
        await prisma.workItem.update({ where: { id: item.id }, data: { deletedAt: new Date() } });
        const rows = await prisma.workItemTransition.findMany({ where: { workItemId: item.id }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
        expect(rows.map((r) => [r.fromStateCategory, r.stateCategory, r.deleted])).toEqual([
            [null, 'UNSTARTED', false],
            ['UNSTARTED', 'STARTED', false],
            ['STARTED', 'DONE', false],
            ['DONE', 'DONE', true],
        ]);
    });

    it("backfills each row with its item's previous category in the record's order, a first row NULL", async () => {
        const at = (h: number) => new Date(BASE + h * 3_600_000);
        const base = { tenantId, projectId: world.projectId, teamId: world.teamId, stateId: world.defaultStateId, deleted: false };
        // Inserted out of order, with a tie at one instant broken by the row's id.
        await prisma.workItemTransition.createMany({
            data: [
                { ...base, workItemId: `${TAG}-bf`, stateCategory: 'DONE', at: at(3) },
                { ...base, workItemId: `${TAG}-bf`, stateCategory: 'BACKLOG', at: at(1) },
                { ...base, workItemId: `${TAG}-bf`, stateCategory: 'STARTED', at: at(2) },
                { ...base, workItemId: `${TAG}-bf`, stateCategory: 'UNSTARTED', at: at(2) },
            ],
        });
        await prisma.$executeRawUnsafe(backfillSql());
        const rows = await prisma.workItemTransition.findMany({ where: { workItemId: `${TAG}-bf` }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });
        expect(rows.map((r) => [r.fromStateCategory, r.stateCategory])).toEqual([
            [null, 'BACKLOG'],
            ['BACKLOG', 'STARTED'],
            ['STARTED', 'UNSTARTED'],
            ['UNSTARTED', 'DONE'],
        ]);
    });

    describe('the SQL reads equal the pure modules on random histories', () => {
        const ROW = fc.record({
            item: fc.integer({ min: 0, max: 9 }),
            hour: fc.integer({ min: 0, max: 40 * 24 }),
            ms: fc.integer({ min: 0, max: 3 }),
            category: CATEGORY,
            project: fc.constantFrom<'a' | 'b' | 'gone'>('a', 'a', 'a', 'b', 'gone'),
            cycle: fc.constantFrom<string | null>('c1', 'c1', null),
            milestone: fc.constantFrom<string | null>('m1', null),
            deleted: fc.integer({ min: 0, max: 6 }).map((n) => n === 0),
            points: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
        });

        let round = 0;
        /** Plant a history, backfill `fromStateCategory`, and read it back as facts (the database's ids as sequence). */
        type Row = typeof ROW extends fc.Arbitrary<infer T> ? T : never;
        async function plant(raw: Row[]) {
            round += 1;
            // Each history alone in the workspace: the earlier ones (and the cases above) are cleared first.
            await prisma.workItemTransition.deleteMany({ where: { tenantId } });
            const projectOf = { a: world.projectId, b: other.projectId, gone: deletedProjectId };
            const teamOf = { a: world.teamId, b: other.teamId, gone: world.teamId };
            const prefix = `${TAG}-r${round}-`;
            await prisma.workItemTransition.createMany({
                data: raw.map((r) => ({
                    tenantId,
                    workItemId: `${prefix}${r.item}`,
                    projectId: projectOf[r.project],
                    teamId: teamOf[r.project],
                    stateId: world.defaultStateId,
                    stateCategory: r.category,
                    cycleId: r.cycle,
                    milestoneId: r.milestone,
                    deleted: r.deleted,
                    estimatePoints: r.points,
                    at: new Date(BASE + r.hour * 3_600_000 + r.ms * 1_800_000),
                })),
            });
            await prisma.$executeRawUnsafe(backfillSql());
            const rows = await prisma.workItemTransition.findMany({ where: { tenantId, workItemId: { startsWith: prefix } } });
            const facts: RecordFact[] = rows.map((r) => ({
                workItemId: r.workItemId,
                projectId: r.projectId,
                teamId: r.teamId,
                stateCategory: r.stateCategory,
                cycleId: r.cycleId,
                milestoneId: r.milestoneId,
                deleted: r.deleted,
                at: r.at,
                seq: Number(r.id),
                estimatePoints: r.estimatePoints,
                estimateMinutes: r.estimateMinutes,
            }));
            return { facts, prefix };
        }

        type ScopeCase = { name: string; visibility: ProjectVisibility; projectIds: string[] | null; cycle: RecordScope['cycle']; milestone: RecordScope['milestone']; items: number[] | null };
        const scopes = (): ScopeCase[] => [
            { name: 'everything visible', visibility: { kind: 'ALL' }, projectIds: null, cycle: null, milestone: null, items: null },
            { name: 'one project', visibility: { kind: 'ALL' }, projectIds: [world.projectId], cycle: null, milestone: null, items: null },
            { name: 'a cycle, no milestone', visibility: { kind: 'ALL' }, projectIds: null, cycle: { ids: ['c1'], none: false }, milestone: { ids: [], none: true }, items: null },
            { name: 'a granted project and some items', visibility: { kind: 'GRANTED', projectIds: [other.projectId] }, projectIds: null, cycle: null, milestone: null, items: [1, 2, 3, 5, 8] },
        ];

        it('throughput, durations, counts and flow, in five zones and four scopes', async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(ROW, { minLength: 1, maxLength: 45 }),
                    ZONE,
                    fc.integer({ min: 0, max: 20 }),
                    fc.integer({ min: 0, max: 25 }),
                    fc.integer({ min: 0, max: 45 }),
                    async (raw, tz, startOffset, length, nowOffsetDays) => {
                        const { facts, prefix } = await plant(raw);
                        const visibleLive = new Set([world.projectId, other.projectId]);
                        const fromDay = toEpochDay(new Date(BASE)) + startOffset;
                        const now = new Date(BASE + nowOffsetDays * 86_400_000 + 7 * 3_600_000 + 123);
                        const asOfDay = epochDayOf(now, tz);
                        const toDay = Math.min(fromDay + length, asOfDay);
                        if (toDay < fromDay) return;
                        const start = startOfEpochDay(fromDay, tz);
                        const end = startOfEpochDay(toDay + 1, tz);
                        const asOf = new Date(Math.min(now.getTime(), end.getTime()));

                        for (const sc of scopes()) {
                            const itemIds = sc.items ? sc.items.map((i) => `${prefix}${i}`) : null;
                            const scope: RecordScope = { visibility: sc.visibility, projectIds: sc.projectIds, teamIds: null, cycle: sc.cycle, milestone: sc.milestone, itemIds };
                            const visible = (p: string) => visibleLive.has(p) && (sc.visibility.kind === 'ALL' || sc.visibility.projectIds.includes(p));
                            const inScope = (r: RecordFact) =>
                                visible(r.projectId) &&
                                (!sc.projectIds || sc.projectIds.includes(r.projectId)) &&
                                (!sc.cycle || (r.cycleId === null ? sc.cycle.none : sc.cycle.ids.includes(r.cycleId))) &&
                                (!sc.milestone || ((r.milestoneId ?? null) === null ? sc.milestone.none : sc.milestone.ids.includes(r.milestoneId!)));
                            const mine = facts.filter((f) => !itemIds || itemIds.includes(f.workItemId));
                            const items = byItem(mine);
                            const R = asOf.getTime();

                            // Throughput per day.
                            const expectedPerDay = new Map<number, number>();
                            const expectedDurations: Array<{ workItemId: string; startedAt: number | null; createdAt: number; completedAt: number }> = [];
                            let expectedCreated = 0;
                            for (const rows of items.values()) {
                                const c = completionAsOf(rows, R);
                                if (c && c.row.at >= start && c.row.at < end && inScope(c.row)) {
                                    const day = epochDayOf(c.row.at, tz);
                                    expectedPerDay.set(day, (expectedPerDay.get(day) ?? 0) + 1);
                                    const inst = completionInstantsAsOf(rows, R)!;
                                    expectedDurations.push({ workItemId: inst.workItemId, startedAt: inst.startedAt?.getTime() ?? null, createdAt: inst.createdAt.getTime(), completedAt: inst.completedAt.getTime() });
                                }
                                const first = rows[0]!;
                                const pic = pictureAt(rows, R);
                                if (first.at >= start && first.at < end && first.at.getTime() <= R && inScope(first) && pic && !pic.deleted) expectedCreated += 1;
                            }
                            const got = await runInTenantContext(ctx, async (db) => ({
                                perDay: await WorkItemTransitionRepository.completionsPerDay(db, ctx, scope, { from: start, to: end, asOf, tz }),
                                durations: await WorkItemTransitionRepository.completionDurations(db, ctx, scope, { from: start, to: end, asOf }, 1000),
                                counts: await WorkItemTransitionRepository.windowCounts(db, ctx, scope, { from: start, to: end, asOf }),
                                flowIds: await WorkItemTransitionRepository.flowItemIds(db, ctx, scope, asOf, 1000),
                            }));
                            const label = `${sc.name} in ${tz}`;
                            expect({ label, perDay: new Map(got.perDay.map((r) => [r.day, r.count])) }).toEqual({ label, perDay: expectedPerDay });
                            expect({ label, durations: got.durations.map((d) => ({ workItemId: d.workItemId, startedAt: d.startedAt?.getTime() ?? null, createdAt: d.createdAt.getTime(), completedAt: d.completedAt.getTime() })).sort((a, b) => a.workItemId.localeCompare(b.workItemId)) }).toEqual({
                                label,
                                durations: expectedDurations.sort((a, b) => a.workItemId.localeCompare(b.workItemId)),
                            });
                            expect({ label, counts: got.counts }).toEqual({ label, counts: { done: [...expectedPerDay.values()].reduce((a, b) => a + b, 0), created: expectedCreated } });

                            // Cumulative flow (Done since the window's start) and the weighted burn-up.
                            for (const measure of ['items', 'points'] as const) {
                                const deltas = await runInTenantContext(ctx, (db) =>
                                    WorkItemTransitionRepository.flowDeltas(db, ctx, scope, got.flowIds, { fromDay, end, asOf, tz, doneSince: start, measure }),
                                );
                                const sql = flowFromDeltas(fromDay, toDay, deltas);
                                const pure = flowSweep({ fromDay, toDay, now: asOf, timeZone: tz, facts: mine.filter((f) => f.at < end), inScope, doneSince: start, measure });
                                expect({ label, measure, sql }).toEqual({ label, measure, sql: pure });
                            }
                        }
                    },
                ),
                { numRuns: 60 },
            );
        }, 300_000);
    });
});
