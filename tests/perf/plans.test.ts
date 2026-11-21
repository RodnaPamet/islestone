/**
 * Plan checks on the seeded database (Hardening H2a; docs/porting/maps/H2.md
 * part 1.2; owner decision 168: deterministic, blocking on every pull request
 * at 10k).
 *
 * Every query in PLAN_CHECKED_QUERIES runs its real repository methods with
 * realistic arguments, as the heavy member, inside `runInTenantContext`
 * (`app_user`, row-level security on), with auto_explain capturing each
 * statement's plan as it executes. Each query must:
 *   - read no guarded table (`WorkItem`, `Comment`, `SearchVector`,
 *     `WorkItemTransition`, `AuditLog`) with a sequential scan;
 *   - use the indexes it names;
 *   - stay under its shared-buffer budget.
 * Needs the seeded database (`scripts/seed-scale/`), `DIRECT_DATABASE_URL`,
 * and runs only in the `perf` project (`npm run test:perf`).
 */
import { capturePlans } from './plan-env';

import * as fs from 'node:fs';

import type { PrismaClient } from '@prisma/client';

import { SORT_KEY_REBALANCE_LENGTH } from '@/app-layer/domain/fractional-index';
import { visibleProjects, type ProjectVisibility } from '@/app-layer/policies/project-visibility';
import { ReviewRepository } from '@/app-layer/repositories/ReviewRepository';
import { SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import { TeamRepository } from '@/app-layer/repositories/TeamRepository';
import { CommentRepository, listSortSpec, WorkItemRepository, type WorkItemFilters } from '@/app-layer/repositories/WorkItemRepository';
import type { RequestContext } from '@/app-layer/types';
import { resolveWorkingCalendars } from '@/app-layer/usecases/working-calendar';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { prisma } from '@/lib/prisma';
import { sortValuesOf, type SortCursor } from '@/lib/pagination';
import type { ListSort } from '@/lib/work-items/list-sorts';

import { conditionMisses, GUARDED_TABLES, judgePlans, type CapturedPlan, type PlanVerdict } from './plan-capture';
import { PLAN_CHECKED_QUERIES, type PlanCheckedQuery } from './plan-checked-queries';
import { directClient, loadPerfWorld, type PerfWorld } from './perf-world';

type Runner = (w: PerfWorld, db: PrismaTx, ctx: RequestContext, v: ProjectVisibility) => Promise<unknown>;

const DAY = 86_400_000;
const today = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const page = (sort: ListSort, extra: { cursor?: SortCursor } = {}) => ({ limit: 50, sort: listSortSpec(sort), today: today(), ...extra });
const list = (filters: WorkItemFilters, sort: ListSort = 'manual'): Runner => (w, db, ctx, v) => WorkItemRepository.list(db, ctx, v, filters, page(sort));

/** The phrase every content search uses: two common Bulgarian words, stemmed. */
const CONTENT_QUERY = 'задачата проекта';

const RUNNERS: Record<string, Runner> = {
    'list: project, manual order': (w, db, ctx, v) => list({ projectId: w.projectId })(w, db, ctx, v),
    'list: project, by updated': (w, db, ctx, v) => list({ projectId: w.projectId }, 'updated')(w, db, ctx, v),
    'list: project, by created': (w, db, ctx, v) => list({ projectId: w.projectId }, 'created')(w, db, ctx, v),
    'list: project, by due date': (w, db, ctx, v) => list({ projectId: w.projectId }, 'due')(w, db, ctx, v),
    'list: project, by priority': (w, db, ctx, v) => list({ projectId: w.projectId }, 'priority')(w, db, ctx, v),
    'list: project, by key': (w, db, ctx, v) => list({ projectId: w.projectId }, 'key')(w, db, ctx, v),
    'list: project, second page (keyset)': async (w, db, ctx, v) => {
        const spec = listSortSpec('manual');
        const first = await WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, page('manual'));
        const last = first[49]!;
        return WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, page('manual', { cursor: { v: sortValuesOf(spec, last), id: last.id } }));
    },
    'list: workspace, manual order': (w, db, ctx, v) => list({})(w, db, ctx, v),
    'list: workspace, two filters, by due date': (w, db, ctx, v) => list({ stateCategory: 'BACKLOG,UNSTARTED,STARTED', priority: 'HIGH,URGENT' }, 'due')(w, db, ctx, v),
    'list: project, label filter': (w, db, ctx, v) => list({ projectId: w.projectId, labelId: w.labelId })(w, db, ctx, v),
    'list: project, custom-field filter': (w, db, ctx, v) =>
        list({ projectId: w.projectId, customFields: [{ field: { id: w.selectFieldId, type: 'SELECT' }, condition: { op: 'any', ids: [w.optionId], orEmpty: false } }] })(w, db, ctx, v),
    'list: project, sorted by a custom field': (w, db, ctx, v) =>
        WorkItemRepository.listByCustomField(db, ctx, v, { projectId: w.projectId }, { limit: 50, field: { id: w.selectFieldId, type: 'SELECT' }, direction: 'asc', today: today() }),
    'list: q (titles, stemmed titles, contents)': async (w, db, ctx, v) => {
        // As `listWorkItems` builds it: stemmed titles and contents first, then the list with `q`.
        const titles = await WorkItemRepository.titleFullTextIds(db, ctx, v, CONTENT_QUERY, 1000);
        const contents = await SearchVectorRepository.matchItems(db, ctx, v, CONTENT_QUERY, 1000);
        const ids = [...new Set([...titles, ...contents.map((m) => m.workItemId)])];
        return WorkItemRepository.list(db, ctx, v, { q: CONTENT_QUERY, fullTextMatchIds: ids }, page('manual'));
    },
    'list: the Deleted view': (w, db, ctx, v) => WorkItemRepository.listDeleted(db, ctx, v),
    'board: one column (by state)': (w, db, ctx, v) => list({ projectId: w.bigProjectId, stateId: w.stateId })(w, db, ctx, v),
    'my work: to review': (w, db, ctx, v) => list({ reviewerId: 'me' })(w, db, ctx, v),
    'my work: assigned': (w, db, ctx, v) => list({ assigneeId: w.heavyUserId, stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: waiting on me': (w, db, ctx, v) => list({ waitingOnId: 'me', stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: created': (w, db, ctx, v) => list({ createdById: w.heavyUserId, stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: watching': (w, db, ctx, v) => list({ watching: 'me', stateCategory: 'BACKLOG,UNSTARTED,STARTED' })(w, db, ctx, v),
    'my work: due soon': (w, db, ctx, v) => list({ assigneeId: w.heavyUserId, due: 'soon' })(w, db, ctx, v),
    'detail: the item': (w, db, ctx, v) => WorkItemRepository.getById(db, ctx, v, w.itemId),
    'detail: comments': (w, db, ctx) => CommentRepository.list(db, ctx, w.itemId, { limit: 50 }),
    'detail: sub-items and their progress': async (w, db, ctx, v) => {
        const subs = await WorkItemRepository.listSubItems(db, ctx, v, w.itemId, { limit: 50 });
        return WorkItemRepository.subItemProgress(db, ctx, subs.map((s) => s.id));
    },
    'detail: the subtree and ancestors': async (w, db, ctx) => {
        await WorkItemRepository.liveSubtree(db, ctx, [w.itemId]);
        await WorkItemRepository.subtreeHeight(db, ctx, w.itemId);
        return WorkItemRepository.ancestors(db, ctx, w.leafId);
    },
    'counts: list metrics (one project)': (w, db, ctx, v) => WorkItemRepository.metrics(db, ctx, v, { projectId: w.projectId }, today()),
    'counts: cycles': async (w, db, ctx, v) => {
        await WorkItemRepository.countsByCycle(db, ctx, v, [w.currentCycleId]);
        return WorkItemRepository.cycleIdsInUse(db, ctx, [w.currentCycleId]);
    },
    'counts: milestones': (w, db, ctx, v) => WorkItemRepository.countsByMilestone(db, ctx, v, [w.milestoneId]),
    'counts: items in a state': async (w, db, ctx) => {
        await TeamRepository.countItemsInState(db, ctx, w.stateId);
        await ReviewRepository.itemsInStateRequiringReview(db, ctx, w.stateId);
        return WorkItemRepository.lockInState(db, ctx, w.stateId);
    },
    'search: titles (trigram and full text)': (w, db, ctx, v) => WorkItemRepository.searchTitles(db, ctx, v, 'проект', { limit: 20 }),
    'search: contents and snippets': async (w, db, ctx, v) => {
        const hits = await SearchVectorRepository.matchItems(db, ctx, v, CONTENT_QUERY, 20);
        await WorkItemRepository.findSearchRows(db, ctx, v, hits.map((h) => h.workItemId));
        return WorkItemRepository.searchSnippetSources(db, ctx, v, {
            descriptionItemIds: hits.filter((h) => h.commentId === null).slice(0, 5).map((h) => h.workItemId),
            commentIds: hits.flatMap((h) => (h.commentId ? [h.commentId] : [])).slice(0, 5),
        });
    },
    'timeline: scope, count and relations': async (w, db, ctx, v) => {
        const rows = await WorkItemRepository.listForTimeline(db, ctx, v, { projectId: w.projectId }, { take: 5001, today: today() });
        await WorkItemRepository.countForTimeline(db, ctx, v, { projectId: w.projectId }, { today: today() });
        return WorkItemRepository.timelineContextRows(db, ctx, v, rows.slice(0, 500).map((r) => r.id), 500);
    },
    'timeline: working calendars': async (w, db, ctx) => {
        await resolveWorkingCalendars(db, ctx, [w.teamId]);
        return resolveWorkingCalendars(db, ctx);
    },
    'placement: sort keys around a position': async (w, db, ctx, v) => {
        const last = await WorkItemRepository.lastSortKey(db, ctx, w.projectId);
        const [row] = await WorkItemRepository.list(db, ctx, v, { projectId: w.projectId }, { ...page('manual'), limit: 1 });
        await WorkItemRepository.nextSortKeyAfter(db, ctx, w.projectId, { sortKey: row!.sortKey, id: row!.id });
        return WorkItemRepository.prevSortKeyBefore(db, ctx, w.projectId, { sortKey: last ?? row!.sortKey, id: row!.id });
    },
    "removal: a member's items": (w, db, ctx) => WorkItemRepository.lockItemsOfPerson(db, ctx, w.heavyUserId, []),
    'deletion: a deletion group': (w, db, ctx) => WorkItemRepository.idsOfDeletion(db, ctx, w.deletionId),
    'cycle and milestone deletes: their items': async (w, db, ctx) => {
        await WorkItemRepository.idsInCycleIncludingDeleted(db, ctx, w.currentCycleId, 500);
        await WorkItemRepository.idsInMilestoneIncludingDeleted(db, ctx, w.milestoneId, 500);
        return WorkItemRepository.rolloverCandidates(db, ctx, w.currentCycleId, 500);
    },
    'templates: open items of a project': (w, db, ctx, v) => WorkItemRepository.openItemsForTemplate(db, ctx, v, w.projectId, null, 500),
    'job: due reminders': (w, db) => {
        const t = today().getTime();
        return WorkItemRepository.dueCandidates(db, w.tenantId, [new Date(t), new Date(t + DAY), new Date(t + 7 * DAY)], null, 500);
    },
    'job: the daily digest': (w, db) => WorkItemRepository.digestDueItems(db, w.tenantId, [w.heavyUserId], new Date(today().getTime() + 3 * DAY), 200),
    'job: the purge sweep': (w, db, ctx) => WorkItemRepository.purgeableIds(db, ctx, new Date(today().getTime() - 30 * DAY), 500),
    'job: a purged project': async (w, db, ctx) => {
        await WorkItemRepository.countLiveInProject(db, ctx, w.projectId);
        return WorkItemRepository.projectItemIds(db, ctx, w.projectId, 500);
    },
    'job: the sort-key rebalance': async (w, db, ctx) => {
        await WorkItemRepository.projectsNeedingRebalance(db, ctx, SORT_KEY_REBALANCE_LENGTH);
        return WorkItemRepository.orderedPage(db, ctx, w.projectId, undefined, 500);
    },
    'job: the search-index rebuild': async (w, db, ctx) => {
        await SearchVectorRepository.staleDescriptionPage(db, ctx, null, { force: false });
        return SearchVectorRepository.staleCommentPage(db, ctx, null, { force: false });
    },
};

describe(`plan checks on the seeded database (PERF_SHAPE=${process.env.PERF_SHAPE || '10k'})`, () => {
    let direct: PrismaClient;
    let world: PerfWorld;
    const verdicts: Array<{ name: string; verdict: PlanVerdict; budget: number }> = [];
    const trees: Record<string, CapturedPlan[]> = {};

    beforeAll(async () => {
        direct = directClient();
        world = await loadPerfWorld(direct);
        // Deterministic statistics, so a plan does not flip between runs: the
        // visibility map set (index-only scans fetch no heap pages at random),
        // and ANALYZE sampling every row at 10k (300 x 1,000 rows), where the
        // default target samples 30,000 at random and the same query could
        // take another plan on the next run.
        await direct.$executeRawUnsafe('VACUUM');
        await direct.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL default_statistics_target = 1000');
            await tx.$executeRawUnsafe('ANALYZE');
        }, { timeout: 600_000 });
    }, 900_000);

    afterAll(async () => {
        await direct?.$disconnect();
        await prisma.$disconnect();
        const lines = [
            `### Plan checks (${world?.shape ?? '?'})`,
            '',
            '| Query | Statements | Buffers / budget | Indexes | Seq scans |',
            '|---|---:|---:|---|---|',
            ...verdicts.map(
                ({ name, verdict, budget }) =>
                    `| ${name} | ${verdict.statements} | ${verdict.buffers} / ${budget} | ${verdict.indexes.join(', ')} | ${verdict.seqScans.join(', ') || 'none'} |`,
            ),
            '',
        ];
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
        if (process.env.PERF_REPORT_DIR) {
            fs.mkdirSync(process.env.PERF_REPORT_DIR, { recursive: true });
            fs.writeFileSync(`${process.env.PERF_REPORT_DIR}/plans.json`, JSON.stringify(verdicts, null, 2));
            // Every statement's full plan, for reading a failure.
            fs.writeFileSync(`${process.env.PERF_REPORT_DIR}/plan-trees.json`, JSON.stringify(trees, null, 2));
        }
    });

    it('every registered query has a runner and every runner a registration', () => {
        expect(Object.keys(RUNNERS).sort()).toEqual(PLAN_CHECKED_QUERIES.map((q) => q.name).sort());
    });

    it('auto_explain captures the plans of the statements a call runs', async () => {
        const plans = await capturePlans(() => runInTenantContext(world.ctx, (db) => WorkItemRepository.getById(db, world.ctx, { kind: 'ALL' }, world.itemId)));
        expect(plans.length).toBeGreaterThan(0);
        expect(plans.some((p) => /"WorkItem"/.test(p.query))).toBe(true);
    });

    it("row-level security holds on the measured connection: the sibling workspace's item reads as nothing", async () => {
        const row = await runInTenantContext(world.ctx, (db) => db.workItem.findFirst({ where: { id: world.siblingItemId }, select: { id: true } }));
        expect(row).toBeNull();
    });

    const captured = new Map<string, Promise<CapturedPlan[]>>();
    /** Each query runs once; its checks read the same captured plans. */
    const plansOf = (q: PlanCheckedQuery): Promise<CapturedPlan[]> => {
        let hit = captured.get(q.name);
        if (!hit) {
            const run = RUNNERS[q.name];
            if (!run) throw new Error(`no runner for ${q.name}`);
            hit = capturePlans(() =>
                runInTenantContext(world.ctx, async (db) => {
                    const v = await visibleProjects(world.ctx, db);
                    return run(world, db, world.ctx, v);
                }),
            ).then((plans) => {
                trees[q.name] = plans;
                verdicts.push({ name: q.name, verdict: judgePlans(plans, q.indexes), budget: q.maxBuffers });
                return plans;
            });
            captured.set(q.name, hit);
        }
        return hit;
    };

    for (const q of PLAN_CHECKED_QUERIES) {
        it(`${q.name}: statements captured, its indexes used, within ${q.maxBuffers} buffers at 10k`, async () => {
            const verdict = judgePlans(await plansOf(q), q.indexes);
            expect({ name: q.name, statements: verdict.statements > 0 }).toEqual({ name: q.name, statements: true });
            expect({ name: q.name, missingIndexes: verdict.missingIndexes, used: verdict.indexes }).toEqual({ name: q.name, missingIndexes: [], used: verdict.indexes });
            // The budgets are the 10k shape's; elsewhere the buffers are reported only (H2b brings 100k's).
            if (world.shape === '10k') expect({ name: q.name, buffers: verdict.buffers <= q.maxBuffers, measured: verdict.buffers }).toEqual({ name: q.name, buffers: true, measured: verdict.buffers });
        });

        const seqScans = async () => {
            const verdict = judgePlans(await plansOf(q), q.indexes);
            expect({ name: q.name, seqScans: verdict.seqScans }).toEqual({ name: q.name, seqScans: [] });
        };
        const seqTitle = `${q.name}: no sequential scan on ${GUARDED_TABLES.join(', ')}`;
        if (q.knownFinding?.fails === 'seqScans') it.failing(`${seqTitle} (known finding ${q.knownFinding.id}, docs/performance.md)`, seqScans);
        else it(seqTitle, seqScans);

        if (q.conditions && q.conditions.length > 0) {
            const conditions = async () => {
                expect({ name: q.name, misses: conditionMisses(await plansOf(q), q.conditions!) }).toEqual({ name: q.name, misses: [] });
            };
            const condTitle = `${q.name}: ${q.conditions.map((c) => `${c.index} searched with ${c.operator}`).join('; ')}`;
            if (q.knownFinding?.fails === 'conditions') it.failing(`${condTitle} (known finding ${q.knownFinding.id}, docs/performance.md)`, conditions);
            else it(condTitle, conditions);
        }
    }
});
