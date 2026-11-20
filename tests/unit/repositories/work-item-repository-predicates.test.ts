/**
 * Every `WorkItem` read and write in `WorkItemRepository` carries its own
 * soft-delete predicate and, where it serves a person, the caller's project
 * visibility (ADR 0002 §8: "a test checks the repository's queries";
 * docs/porting/maps/2.1-2.2.md, "Explicit predicates").
 *
 * inflect-compliance relied on a soft-delete extension that rewrote `Task`
 * reads; Islestone ports none, so a method that forgets `deletedAt` returns
 * deleted items, and one that forgets the visibility fragment leaks a guest
 * into projects it was never granted. Each method runs against a recording
 * client here and its `where` is inspected.
 */
import { WorkItemRepository, CommentRepository, listSortSpec } from '@/app-layer/repositories/WorkItemRepository';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import type { PrismaTx } from '@/lib/db-context';
import { mintLockedWorkItemIds as locked } from '@/app-layer/repositories/work-item-locks';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('MEMBER', { tenantId: 'tenant-1' });
const GUEST: ProjectVisibility = { kind: 'GRANTED', projectIds: ['granted-1'] };

function recorder() {
    const calls: Array<{ op: string; args: Record<string, unknown> }> = [];
    const op = (name: string, result: unknown) =>
        jest.fn(async (args: Record<string, unknown>) => {
            calls.push({ op: name, args });
            return result;
        });
    const db = {
        workItem: {
            findMany: op('findMany', []),
            findFirst: op('findFirst', null),
            updateMany: op('updateMany', { count: 1 }),
            count: op('count', 0),
            groupBy: op('groupBy', []),
        },
        comment: { findMany: op('comment.findMany', []) },
        customFieldValue: { findMany: op('customFieldValue.findMany', [{ id: 'v1', workItemId: 'w1', fieldType: 'NUMBER', numberValue: '2', textValue: null, dateValue: null, option: null }]) },
    } as unknown as PrismaTx;
    return { db, calls };
}

/** The visibility fragment for GUEST appears somewhere in the `where`. */
function carriesVisibility(where: unknown): boolean {
    const text = JSON.stringify(where);
    return text.includes('"granted-1"') && text.includes('"project":{"deletedAt":null');
}

const deletedPredicate = (where: Record<string, unknown>) => JSON.stringify(where).includes('"deletedAt"');

describe('WorkItemRepository — every person-facing method carries deletedAt AND visibility', () => {
    const cases: Array<[string, (db: PrismaTx) => Promise<unknown>]> = [
        ['list', (db) => WorkItemRepository.list(db, ctx, GUEST, {}, { limit: 10, sort: listSortSpec('manual') })],
        [
            'list (My Work filters)',
            (db) =>
                WorkItemRepository.list(db, ctx, GUEST, { createdById: 'u-1', watching: 'me', due: 'soon' }, {
                    limit: 10,
                    sort: listSortSpec('manual'),
                }),
        ],
        ['list (every 2.4 sort)', (db) => Promise.all((['updated', 'created', 'due', 'priority', 'key'] as const).map((s) => WorkItemRepository.list(db, ctx, GUEST, {}, { limit: 10, sort: listSortSpec(s) })))],
        [
            'list (a custom-field filter)',
            (db) =>
                WorkItemRepository.list(db, ctx, GUEST, { customFields: [{ field: { id: 'f1', type: 'SELECT' }, condition: { op: 'any', ids: ['o1'], orEmpty: true } }] }, {
                    limit: 10,
                    sort: listSortSpec('manual'),
                }),
        ],
        [
            'listByCustomField (both phases and the row read)',
            (db) => WorkItemRepository.listByCustomField(db, ctx, GUEST, {}, { limit: 10, field: { id: 'f1', type: 'NUMBER' }, direction: 'asc' }),
        ],
        ['listDeleted', (db) => WorkItemRepository.listDeleted(db, ctx, GUEST)],
        ['getById', (db) => WorkItemRepository.getById(db, ctx, GUEST, 'w1')],
        ['findVisible', (db) => WorkItemRepository.findVisible(db, ctx, GUEST, 'w1')],
        ['listByIds', (db) => WorkItemRepository.listByIds(db, ctx, GUEST, ['w1'])],
        ['updateVersioned', (db) => WorkItemRepository.updateVersioned(db, ctx, GUEST, 'w1', 3, { title: 't' })],
        ['bulkUpdate', (db) => WorkItemRepository.bulkUpdate(db, ctx, GUEST, locked(['w1']), { priority: 'LOW' })],
        ['setSortKey', (db) => WorkItemRepository.setSortKey(db, ctx, GUEST, 'w1', 'V')],
        ['listSubItems', (db) => WorkItemRepository.listSubItems(db, ctx, GUEST, 'p1', { limit: 10 })],
        ['findByNumber', (db) => WorkItemRepository.findByNumber(db, ctx, GUEST, 'p1', 3)],
        ['metrics', (db) => WorkItemRepository.metrics(db, ctx, GUEST, {}, new Date())],
        ['countsByCycle (2.5a)', (db) => WorkItemRepository.countsByCycle(db, ctx, GUEST, ['c1'])],
        ['list (a cycle filter, 2.5a)', (db) => WorkItemRepository.list(db, ctx, GUEST, { cycleId: 'c1,c2' }, { limit: 10, sort: listSortSpec('manual') })],
        ['openItemsForTemplate (2.5c, top level and sub-items)', (db) => Promise.all([WorkItemRepository.openItemsForTemplate(db, ctx, GUEST, 'p1', null, 10), WorkItemRepository.openItemsForTemplate(db, ctx, GUEST, 'p1', ['w1'], 10)])],
        ['countsByMilestone (2.5b)', (db) => WorkItemRepository.countsByMilestone(db, ctx, GUEST, ['m1'])],
        ['list (a milestone filter, 2.5b)', (db) => WorkItemRepository.list(db, ctx, GUEST, { milestoneId: 'm1,none' }, { limit: 10, sort: listSortSpec('manual') })],
        ['list (q with description and comment matches, 2.7f)', (db) => WorkItemRepository.list(db, ctx, GUEST, { q: 'login', fullTextMatchIds: ['w1'] }, { limit: 10, sort: listSortSpec('manual') })],
        ['findSearchRows (2.7f)', (db) => WorkItemRepository.findSearchRows(db, ctx, GUEST, ['w1'])],
        ['searchSnippetSources (2.7f, descriptions and comments)', (db) => WorkItemRepository.searchSnippetSources(db, ctx, GUEST, { descriptionItemIds: ['w1'], commentIds: ['c1'] })],
    ];

    it.each(cases)('%s', async (_name, run) => {
        const { db, calls } = recorder();
        await run(db);
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            const where = call.args.where as Record<string, unknown>;
            expect({ op: call.op, tenant: JSON.stringify(where).includes('"tenantId":"tenant-1"') }).toEqual({ op: call.op, tenant: true });
            expect({ op: call.op, deleted: deletedPredicate(where) }).toEqual({ op: call.op, deleted: true });
            expect({ op: call.op, visible: carriesVisibility(where) }).toEqual({ op: call.op, visible: true });
        }
    });

    it('the versioned write is ONE updateMany whose where carries the version, the live row and visibility', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.updateVersioned(db, ctx, GUEST, 'w1', 3, { title: 't' });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.op).toBe('updateMany');
        expect(calls[0]!.args.where).toMatchObject({ id: 'w1', tenantId: 'tenant-1', deletedAt: null, version: 3 });
        expect(calls[0]!.args.data).toMatchObject({ title: 't', version: { increment: 1 } });
    });

    it('a sortKey write does not increase the version (ADR 0002 §5)', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.setSortKey(db, ctx, GUEST, 'w1', 'V');
        expect(calls[0]!.args.data).toEqual({ sortKey: 'V' });
    });

    it('the job reads carry the job form (live, unarchived project) and deletedAt', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.listForFanOut(db, ctx, ['w1']);
        await WorkItemRepository.dueCandidates(db, 'tenant-1', [new Date()], null, 10);
        // The daily digest's two reads (2.7c).
        await WorkItemRepository.digestDueItems(db, 'tenant-1', ['u-1'], new Date(), 10);
        await WorkItemRepository.liveForDigest(db, 'tenant-1', ['w1']);
        expect(calls).toHaveLength(4);
        for (const call of calls) {
            expect(call.args.where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null, project: { deletedAt: null, archivedAt: null } });
        }
    });

    it('the rollover reads and moves live, open items in live, unarchived projects only (2.5a)', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.rolloverCandidates(db, ctx, 'c1', 10);
        await WorkItemRepository.moveCycle(db, ctx, locked(['w1']), 'c1', 'c2');
        expect(calls.map((c) => c.op)).toEqual(['findMany', 'updateMany']);
        for (const call of calls) {
            expect(call.args.where).toMatchObject({ tenantId: 'tenant-1', cycleId: 'c1', deletedAt: null });
            expect(JSON.stringify(call.args.where)).toContain('"project":{"deletedAt":null,"archivedAt":null}');
        }
        expect(calls[0]!.args.where).toMatchObject({ stateCategory: { in: ['BACKLOG', 'UNSTARTED', 'STARTED'] } });
        expect(calls[1]!.args.data).toEqual({ cycleId: 'c2', version: { increment: 1 } });
    });

    it('deleting a cycle clears it from every item, deleted ones included, and bumps the version (2.5a)', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.idsInCycleIncludingDeleted(db, ctx, 'c1', 10);
        await WorkItemRepository.clearCycleIncludingDeleted(db, ctx, locked(['w1']), 'c1');
        for (const call of calls) {
            expect(call.args.where).toMatchObject({ tenantId: 'tenant-1', cycleId: 'c1' });
            expect(deletedPredicate(call.args.where as Record<string, unknown>)).toBe(false);
        }
        expect(calls[1]!.args.data).toEqual({ cycleId: null, version: { increment: 1 } });
    });

    it('an empty cycle filter matches nothing, and "none" matches items in no cycle (2.5a)', () => {
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { cycleId: '' }))).toContain('"cycleId":{"in":[]}');
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { cycleId: 'none' }))).toContain('"cycleId":null');
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { cycleId: 'none,c1' }))).toContain('{"OR":[{"cycleId":null},{"cycleId":{"in":["c1"]}}]}');
    });

    it('deleting a milestone clears it from every item, deleted ones included, and bumps the version (2.5b)', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.idsInMilestoneIncludingDeleted(db, ctx, 'm1', 10);
        await WorkItemRepository.clearMilestoneIncludingDeleted(db, ctx, locked(['w1']), 'm1');
        expect(calls.map((c) => c.op)).toEqual(['findMany', 'updateMany']);
        for (const call of calls) {
            expect(call.args.where).toMatchObject({ tenantId: 'tenant-1', milestoneId: 'm1' });
            expect(deletedPredicate(call.args.where as Record<string, unknown>)).toBe(false);
        }
        expect(calls[1]!.args.data).toEqual({ milestoneId: null, version: { increment: 1 } });
    });

    it('a milestone filter: "none" matches items in no milestone, and an id list its items (2.5b)', () => {
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { milestoneId: 'none' }))).toContain('"milestoneId":null');
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { milestoneId: 'm1,m2' }))).toContain('"milestoneId":{"in":["m1","m2"]}');
        expect(JSON.stringify(WorkItemRepository._buildWhere(ctx, GUEST, { milestoneId: 'none,m1' }))).toContain('{"OR":[{"milestoneId":null},{"milestoneId":{"in":["m1"]}}]}');
    });

    it('the soft delete is an updateMany over live rows, never a delete', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.softDelete(db, ctx, locked(['w1']), 'del-1', new Date());
        expect(calls).toHaveLength(1);
        expect(calls[0]!.op).toBe('updateMany');
        expect(calls[0]!.args.where).toMatchObject({ deletedAt: null });
        expect(calls[0]!.args.data).toMatchObject({ deletionId: 'del-1' });
    });

    it('comments are listed live only', async () => {
        const { db, calls } = recorder();
        await CommentRepository.list(db, ctx, 'w1', { limit: 10 });
        expect(calls[0]!.args.where).toMatchObject({ tenantId: 'tenant-1', workItemId: 'w1', deletedAt: null });
    });
});
