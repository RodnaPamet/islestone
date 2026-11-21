/**
 * "Also move the N items it pushes later" against a real Postgres (roadmap
 * 3.1c; ADR 0010 §6; owner decision 194): `rescheduleWorkItems`, behind
 * `POST /work-items/bulk/dates`.
 *
 *   - a chain moves together: one versioned write per item (each version up
 *     once, `sortKey` untouched), one `WORK_ITEM_UPDATED` per item with the
 *     old and new dates, the change's `rescheduleId` and, on a pushed item,
 *     `pushedBy`, and one `WORK_ITEMS_RESCHEDULED` summary;
 *   - all or nothing: a stale version anywhere is 409 `VERSION_CONFLICT`
 *     naming it, nothing written; an item that is not downstream is 400
 *     `NOT_DOWNSTREAM` (a relation through a deleted item does not count); a
 *     pushed item moved earlier, or given or cleared a date, is 400
 *     `PUSH_NOT_LATER`; a closed item 409 `ITEM_CLOSED`; an archived project
 *     409 `PROJECT_ARCHIVED`; a type that hides a date 400 `FIELD_HIDDEN`; a
 *     start after the due date 400 `START_AFTER_DUE`;
 *   - two changes over overlapping chains at once, through PgBouncer: no
 *     deadlock, one applies and the other is refused for the versions it
 *     read, and every row's version moves once per write;
 *   - the audit chain verifies.
 *
 * Written fresh for Islestone.
 */
import type { PrismaClient } from '@prisma/client';

import { setTypeField } from '@/app-layer/usecases/field-set';
import { createProject, setProjectArchived } from '@/app-layer/usecases/project';
import { createWorkItem, deleteWorkItem, rescheduleWorkItems, setWorkItemState, type RescheduleDates } from '@/app-layer/usecases/work-item';
import { addWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { createWorkItemType } from '@/app-layer/usecases/work-item-type';
import { verifyAuditChain } from '@/lib/audit';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { createWorkItemWorkspace, isDeadlock, type WorkItemWorkspace } from '../helpers/work-item-workspace';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `rsch${Date.now().toString(36)}`;

describeFn('a change of dates with the items it pushes later (3.1c)', () => {
    let prisma: PrismaClient;
    let ws: WorkItemWorkspace;

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        ws = await createWorkItemWorkspace(prisma, TAG);
    });

    afterAll(async () => {
        if (!process.env.KEEP_DB) await resetDatabase(prisma);
    });

    const item = (title: string, startDate: string | null, dueDate: string | null, extra: Record<string, unknown> = {}) =>
        createWorkItem(ws.owner, { projectId: ws.projectId, typeId: ws.typeId, title, startDate, dueDate, ...extra });
    const blocks = (from: string, to: string) => addWorkItemRelation(ws.owner, from, { type: 'BLOCKS', toId: to });
    const dates = (it: { id: string; version: number }, startDate: string | null, dueDate: string | null): RescheduleDates => ({ id: it.id, version: it.version, startDate, dueDate });
    const rows = (ids: string[]) =>
        prisma.workItem.findMany({ where: { id: { in: ids } }, select: { id: true, version: true, sortKey: true, startDate: true, dueDate: true } }).then((rs) =>
            Object.fromEntries(rs.map((r) => [r.id, { version: r.version, sortKey: r.sortKey, startDate: r.startDate?.toISOString().slice(0, 10) ?? null, dueDate: r.dueDate?.toISOString().slice(0, 10) ?? null }])),
        );
    const reason = async (p: Promise<unknown>) => {
        try {
            await p;
            return 'fulfilled';
        } catch (err) {
            const e = err as { status?: number; details?: { reason?: string } };
            return `${e.status} ${e.details?.reason}`;
        }
    };
    /** A chain a → b → c, a's version after the relations (a relation does not bump it). */
    async function chain(label: string) {
        const a = await item(`${label} a`, '2049-03-01', '2049-03-02');
        const b = await item(`${label} b`, '2049-03-03', '2049-03-04');
        const c = await item(`${label} c`, null, '2049-03-05');
        await blocks(a.id, b.id);
        await blocks(b.id, c.id);
        return { a, b, c };
    }

    it('moves the chain together, one versioned write and one audit entry per item, and one summary', async () => {
        const { a, b, c } = await chain('happy');
        const before = await rows([a.id, b.id, c.id]);
        const result = await rescheduleWorkItems(ws.owner, {
            dragged: dates(a, '2049-03-08', '2049-03-09'),
            pushed: [dates(b, '2049-03-10', '2049-03-11'), dates(c, null, '2049-03-12')],
        });
        const after = await rows([a.id, b.id, c.id]);
        expect(after[a.id]).toMatchObject({ version: a.version + 1, startDate: '2049-03-08', dueDate: '2049-03-09', sortKey: before[a.id]!.sortKey });
        expect(after[b.id]).toMatchObject({ version: b.version + 1, startDate: '2049-03-10', dueDate: '2049-03-11', sortKey: before[b.id]!.sortKey });
        expect(after[c.id]).toMatchObject({ version: c.version + 1, startDate: null, dueDate: '2049-03-12' });
        expect(result.items.map((i) => [i.id, i.version])).toEqual([
            [a.id, a.version + 1],
            [b.id, b.version + 1],
            [c.id, c.version + 1],
        ]);

        const entries = await prisma.auditLog.findMany({ where: { tenantId: ws.tenantId, action: { in: ['WORK_ITEM_UPDATED', 'WORK_ITEMS_RESCHEDULED'] }, entityId: { in: [a.id, b.id, c.id] } } });
        const updated = entries.filter((e) => e.action === 'WORK_ITEM_UPDATED');
        expect(updated).toHaveLength(3);
        const meta = (id: string) => updated.find((e) => e.entityId === id)!.metadataJson as Record<string, unknown>;
        expect(meta(a.id)).toMatchObject({ rescheduleId: result.rescheduleId, startDate: { from: '2049-03-01', to: '2049-03-08' }, dueDate: { from: '2049-03-02', to: '2049-03-09' } });
        expect(meta(a.id).pushedBy).toBeUndefined();
        expect(meta(b.id)).toMatchObject({ rescheduleId: result.rescheduleId, pushedBy: a.id, changedFields: ['startDate', 'dueDate'] });
        expect(meta(c.id)).toMatchObject({ pushedBy: a.id, changedFields: ['dueDate'], startDate: { from: null, to: null } });
        const summary = entries.filter((e) => e.action === 'WORK_ITEMS_RESCHEDULED');
        expect(summary.map((e) => e.entityId)).toEqual([a.id]);
        const summaryMeta = summary[0]!.metadataJson as Record<string, unknown>;
        expect(summaryMeta).toMatchObject({ rescheduleId: result.rescheduleId, pushedIds: [b.id, c.id], pushedCount: 2 });
    });

    it('a single item without pushes changes alone', async () => {
        const solo = await item('solo', '2049-04-01', '2049-04-02');
        await rescheduleWorkItems(ws.owner, { dragged: dates(solo, '2049-04-05', '2049-04-06'), pushed: [] });
        expect((await rows([solo.id]))[solo.id]).toMatchObject({ version: solo.version + 1, startDate: '2049-04-05', dueDate: '2049-04-06' });
    });

    it('is all or nothing: a stale version anywhere refuses the whole change', async () => {
        const { a, b, c } = await chain('stale');
        const before = await rows([a.id, b.id, c.id]);
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-08', '2049-03-09'), pushed: [dates(b, '2049-03-10', '2049-03-11'), { ...dates(c, null, '2049-03-12'), version: c.version + 5 }] }))).toBe(
            '409 VERSION_CONFLICT',
        );
        expect(await rows([a.id, b.id, c.id])).toEqual(before);
    });

    it('refuses an item that is not downstream, also through a deleted item', async () => {
        const { a, b } = await chain('reach');
        const elsewhere = await item('reach elsewhere', '2049-03-03', '2049-03-04');
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-08', '2049-03-09'), pushed: [dates(elsewhere, '2049-03-10', '2049-03-11')] }))).toBe('400 NOT_DOWNSTREAM');
        // b relays nothing once deleted: c is no longer downstream of a.
        const x = await item('relay x', '2049-03-01', '2049-03-02');
        const y = await item('relay y', '2049-03-03', '2049-03-03');
        const z = await item('relay z', '2049-03-04', '2049-03-04');
        await blocks(x.id, y.id);
        await blocks(y.id, z.id);
        await deleteWorkItem(ws.owner, y.id);
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(x, '2049-03-08', '2049-03-09'), pushed: [dates(z, '2049-03-10', '2049-03-10')] }))).toBe('400 NOT_DOWNSTREAM');
        expect((await rows([b.id]))[b.id]!.startDate).toBe('2049-03-03');
    });

    it('refuses a pushed item moved earlier, or given or cleared a date', async () => {
        const { a, b, c } = await chain('later');
        const send = (pushed: RescheduleDates[]) => reason(rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-08', '2049-03-09'), pushed }));
        expect(await send([dates(b, '2049-03-02', '2049-03-11')])).toBe('400 PUSH_NOT_LATER');
        expect(await send([dates(b, '2049-03-03', '2049-03-04')])).toBe('400 PUSH_NOT_LATER');
        expect(await send([dates(c, '2049-03-06', '2049-03-07')])).toBe('400 PUSH_NOT_LATER');
        expect(await send([dates(b, null, '2049-03-11')])).toBe('400 PUSH_NOT_LATER');
    });

    it('refuses a closed item, an archived project, a hidden date and a start after the due date', async () => {
        const { a, b } = await chain('rules');
        const done = await setWorkItemState(ws.owner, b.id, { stateId: ws.states['Done']!.id });
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-08', '2049-03-09'), pushed: [dates(done, '2049-03-10', '2049-03-11')] }))).toBe('409 ITEM_CLOSED');

        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-09', '2049-03-08'), pushed: [] }))).toBe('400 START_AFTER_DUE');

        const hiding = await createWorkItemType(ws.owner, { name: `Hiding ${TAG}` });
        await setTypeField(ws.owner, hiding.id, { field: 'startDate', requirement: 'HIDDEN' });
        const hidden = await createWorkItem(ws.owner, { projectId: ws.projectId, typeId: hiding.id, title: 'hides its start', dueDate: '2049-03-02' });
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(hidden, '2049-03-01', '2049-03-02'), pushed: [] }))).toBe('400 FIELD_HIDDEN');

        const archived = await createProject(ws.owner, { teamId: ws.teamId, name: `Archived ${TAG}`, keyPrefix: 'RSA' });
        const old = await createWorkItem(ws.owner, { projectId: archived.id, typeId: ws.typeId, title: 'in an archived project', startDate: '2049-03-01', dueDate: '2049-03-02' });
        await setProjectArchived(ws.owner, archived.id, true);
        expect(await reason(rescheduleWorkItems(ws.owner, { dragged: dates(old, '2049-03-08', '2049-03-09'), pushed: [] }))).toBe('409 PROJECT_ARCHIVED');
    });

    it('two changes over overlapping chains at once: no deadlock, one applies, the other is refused for its versions', async () => {
        for (let round = 0; round < 4; round++) {
            const { a, b, c } = await chain(`race ${round}`);
            const first = rescheduleWorkItems(ws.owner, { dragged: dates(a, '2049-03-08', '2049-03-09'), pushed: [dates(b, '2049-03-10', '2049-03-11'), dates(c, null, '2049-03-12')] });
            const second = rescheduleWorkItems(ws.member, { dragged: dates(b, '2049-03-15', '2049-03-16'), pushed: [dates(c, null, '2049-03-17')] });
            const settled = await Promise.allSettled([first, second]);
            const failures = settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason);
            expect(failures.filter(isDeadlock)).toEqual([]);
            expect(failures).toHaveLength(1);
            expect(failures[0]).toMatchObject({ status: 409, details: { reason: 'VERSION_CONFLICT' } });
            const after = await rows([a.id, b.id, c.id]);
            if (settled[0]!.status === 'fulfilled') {
                expect([after[a.id]!.version, after[b.id]!.version, after[c.id]!.version]).toEqual([a.version + 1, b.version + 1, c.version + 1]);
                expect(after[c.id]!.dueDate).toBe('2049-03-12');
            } else {
                expect([after[a.id]!.version, after[b.id]!.version, after[c.id]!.version]).toEqual([a.version, b.version + 1, c.version + 1]);
                expect(after[c.id]!.dueDate).toBe('2049-03-17');
            }
        }
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(ws.tenantId)).valid).toBe(true);
    });
});
