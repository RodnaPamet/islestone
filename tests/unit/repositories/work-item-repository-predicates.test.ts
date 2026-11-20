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
import { WorkItemRepository, CommentRepository } from '@/app-layer/repositories/WorkItemRepository';
import type { ProjectVisibility } from '@/app-layer/policies/project-visibility';
import type { PrismaTx } from '@/lib/db-context';

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
        ['list', (db) => WorkItemRepository.list(db, ctx, GUEST, {}, { limit: 10, order: { column: 'sortKey', direction: 'asc', kind: 'string' } })],
        [
            'list (My Work filters)',
            (db) =>
                WorkItemRepository.list(db, ctx, GUEST, { createdById: 'u-1', watching: 'me', due: 'soon' }, {
                    limit: 10,
                    order: { column: 'sortKey', direction: 'asc', kind: 'string' },
                }),
        ],
        ['listDeleted', (db) => WorkItemRepository.listDeleted(db, ctx, GUEST)],
        ['getById', (db) => WorkItemRepository.getById(db, ctx, GUEST, 'w1')],
        ['findVisible', (db) => WorkItemRepository.findVisible(db, ctx, GUEST, 'w1')],
        ['listByIds', (db) => WorkItemRepository.listByIds(db, ctx, GUEST, ['w1'])],
        ['updateVersioned', (db) => WorkItemRepository.updateVersioned(db, ctx, GUEST, 'w1', 3, { title: 't' })],
        ['bulkUpdate', (db) => WorkItemRepository.bulkUpdate(db, ctx, GUEST, ['w1'], { priority: 'LOW' })],
        ['setSortKey', (db) => WorkItemRepository.setSortKey(db, ctx, GUEST, 'w1', 'V')],
        ['listSubItems', (db) => WorkItemRepository.listSubItems(db, ctx, GUEST, 'p1', { limit: 10 })],
        ['findByNumber', (db) => WorkItemRepository.findByNumber(db, ctx, GUEST, 'p1', 3)],
        ['metrics', (db) => WorkItemRepository.metrics(db, ctx, GUEST, {}, new Date())],
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
        for (const call of calls) {
            expect(call.args.where).toMatchObject({ tenantId: 'tenant-1', deletedAt: null, project: { deletedAt: null, archivedAt: null } });
        }
    });

    it('the soft delete is an updateMany over live rows, never a delete', async () => {
        const { db, calls } = recorder();
        await WorkItemRepository.softDelete(db, ctx, ['w1'], 'del-1', new Date());
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
