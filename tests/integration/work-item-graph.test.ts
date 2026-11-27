/**
 * The work-item graph against a real Postgres (ADR 0002 §2, §6, §10):
 * relations and the BLOCKS cycle refusal (including two concurrent inserts
 * that would close a cycle: exactly one is refused, under the graph lock),
 * duplicates, re-parenting with the cycle and depth refusals (and a
 * concurrent pair), reordering under concurrent writers, and moves between
 * projects and teams with aliases and state mapping.
 *
 * Written fresh for Islestone; the two-connection race shape follows
 * `tests/integration/tenant-owner-race.test.ts` (1.3).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createWorkItem, getWorkItem, getWorkItemByKey, listSubItems, listWorkItems } from '@/app-layer/usecases/work-item';
import { addWorkItemLabels } from '@/app-layer/usecases/work-item-collab';
import { moveWorkItemToProject, reorderWorkItem, reparentWorkItem } from '@/app-layer/usecases/work-item-moves';
import { addWorkItemRelation, listWorkItemRelations, removeWorkItemRelation } from '@/app-layer/usecases/work-item-relations';
import { createLabel } from '@/app-layer/usecases/label';
import { deleteProject } from '@/app-layer/usecases/project';
import { verifyAuditChain } from '@/lib/audit';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { prismaTestClient, resetDatabase } from '../helpers/db';
import { makeRequestContext } from '../helpers/make-context';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const TAG = `wig${Date.now().toString(36)}`;

describeFn('the work-item graph', () => {
    let prisma: PrismaClient;
    let tenantId = '';
    let ctx: RequestContext;
    let teamId = '';
    let states: Record<string, string> = {};
    let projectId = '';
    let typeId = '';

    const item = (title: string, extra: Partial<Parameters<typeof createWorkItem>[1]> = {}) =>
        createWorkItem(ctx, { projectId, typeId, title, ...extra });

    beforeAll(async () => {
        prisma = prismaTestClient();
        await resetDatabase(prisma);
        tenantId = (await createTenantWithDek({ name: TAG, slug: TAG })).id;
        const u = await prisma.user.create({ data: { email: `g-${TAG}@example.test` } });
        await prisma.tenantMembership.create({ data: { tenantId, userId: u.id, role: 'OWNER' } });
        ctx = makeRequestContext('OWNER', { tenantId, userId: u.id, tenantSlug: TAG, requestId: TAG });
        const team = await createTeam(ctx, { name: 'Graph' });
        teamId = team.id;
        states = Object.fromEntries(team.workflowStates.map((s) => [s.name, s.id]));
        projectId = (await createProject(ctx, { teamId, name: 'G', keyPrefix: 'GRA' })).id;
        typeId = (await listWorkItemTypes(ctx))[0]!.id;
    });

    afterAll(async () => {
        await resetDatabase(prisma);
    });

    describe('relations', () => {
        it('refuses a BLOCKS edge that closes a cycle, a self-relation, and a repeat in either direction', async () => {
            const [a, b, c] = await Promise.all([item('a'), item('b'), item('c')]);
            await addWorkItemRelation(ctx, a.id, { type: 'BLOCKS', toId: b.id });
            await addWorkItemRelation(ctx, b.id, { type: 'BLOCKS', toId: c.id });
            await expect(addWorkItemRelation(ctx, c.id, { type: 'BLOCKS', toId: a.id })).rejects.toMatchObject({
                status: 409,
                details: { reason: 'RELATION_WOULD_CYCLE' },
            });
            await expect(addWorkItemRelation(ctx, b.id, { type: 'BLOCKS', toId: a.id })).rejects.toMatchObject({
                details: { reason: 'RELATION_EXISTS' },
            });
            await expect(addWorkItemRelation(ctx, a.id, { type: 'BLOCKS', toId: a.id })).rejects.toMatchObject({ status: 400 });
        });

        it('a cycle through a deleted item is still refused (restoring it can never close one)', async () => {
            const [a, b] = await Promise.all([item('da'), item('db')]);
            await addWorkItemRelation(ctx, a.id, { type: 'BLOCKS', toId: b.id });
            await prisma.workItem.update({ where: { id: a.id }, data: { deletedAt: new Date(), deletionId: 'x' } });
            await expect(addWorkItemRelation(ctx, b.id, { type: 'BLOCKS', toId: a.id })).rejects.toMatchObject({ status: 404 });
            const c = await item('dc');
            await addWorkItemRelation(ctx, b.id, { type: 'BLOCKS', toId: c.id });
            await prisma.workItem.update({ where: { id: a.id }, data: { deletedAt: null, deletionId: null } });
            await expect(addWorkItemRelation(ctx, c.id, { type: 'BLOCKS', toId: a.id })).rejects.toMatchObject({
                details: { reason: 'RELATION_WOULD_CYCLE' },
            });
        });

        it('two concurrent inserts that would close a cycle: exactly one is refused', async () => {
            for (let round = 0; round < 5; round++) {
                const [a, b] = await Promise.all([item(`ra${round}`), item(`rb${round}`)]);
                const results = await Promise.allSettled([
                    addWorkItemRelation(ctx, a.id, { type: 'BLOCKS', toId: b.id }),
                    addWorkItemRelation(ctx, b.id, { type: 'BLOCKS', toId: a.id }),
                ]);
                expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
                expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
            }
        });

        it('RELATES is stored once, smaller id first; DUPLICATES cancels the duplicate and allows no chain', async () => {
            const [a, b, c] = await Promise.all([item('ra'), item('rb'), item('rc')]);
            const rel = await addWorkItemRelation(ctx, b.id, { type: 'RELATES', toId: a.id });
            expect(rel.fromId < rel.toId).toBe(true);
            await expect(addWorkItemRelation(ctx, a.id, { type: 'RELATES', toId: b.id })).rejects.toMatchObject({ status: 409 });
            await addWorkItemRelation(ctx, a.id, { type: 'DUPLICATES', toId: b.id });
            expect((await getWorkItem(ctx, a.id)).stateCategory).toBe('CANCELLED');
            await expect(addWorkItemRelation(ctx, c.id, { type: 'DUPLICATES', toId: a.id })).rejects.toMatchObject({
                details: { reason: 'TARGET_IS_DUPLICATE' },
            });
            await expect(addWorkItemRelation(ctx, b.id, { type: 'DUPLICATES', toId: c.id })).rejects.toMatchObject({
                details: { reason: 'DUPLICATE_CHAIN' },
            });
            const listed = await listWorkItemRelations(ctx, a.id);
            expect(listed.outgoing.some((r) => r.type === 'DUPLICATES' && r.item.id === b.id)).toBe(true);
            await removeWorkItemRelation(ctx, b.id, rel.id);
        });

        it('a relation end in a deleted project is listed as hidden, with no title', async () => {
            const other = await createProject(ctx, { teamId, name: 'Elsewhere', keyPrefix: 'ELS' });
            const there = await createWorkItem(ctx, { projectId: other.id, typeId, title: 'secret title' });
            const here = await item('here');
            await addWorkItemRelation(ctx, here.id, { type: 'BLOCKS', toId: there.id });
            await deleteProject(ctx, other.id);
            const listed = await listWorkItemRelations(ctx, here.id);
            expect(listed.outgoing[0]!.item).toEqual({ id: there.id, hidden: true });
        });
    });

    describe('sub-items and re-parenting', () => {
        it('refuses a cycle and a depth past five levels', async () => {
            const chain = [await item('L0')];
            for (let i = 1; i <= 5; i++) chain.push(await item(`L${i}`, { parentId: chain[i - 1]!.id }));
            await expect(item('L6', { parentId: chain[5]!.id })).rejects.toMatchObject({ details: { reason: 'SUB_ITEM_DEPTH_EXCEEDED' } });
            await expect(reparentWorkItem(ctx, chain[0]!.id, { parentId: chain[3]!.id })).rejects.toMatchObject({
                details: { reason: 'PARENT_WOULD_CYCLE' },
            });
            const leaf = await item('loose');
            const sub = await item('loose child', { parentId: leaf.id });
            void sub;
            // leaf has height 1: under L4 (depth 4) it would reach depth 6.
            await expect(reparentWorkItem(ctx, leaf.id, { parentId: chain[4]!.id })).rejects.toMatchObject({
                details: { reason: 'SUB_ITEM_DEPTH_EXCEEDED' },
            });
            const moved = await reparentWorkItem(ctx, leaf.id, { parentId: chain[3]!.id });
            expect(moved.parentId).toBe(chain[3]!.id);
            const subs = await listSubItems(ctx, chain[3]!.id, { progress: true });
            expect(subs.items.map((s) => s.id)).toEqual(expect.arrayContaining([chain[4]!.id, leaf.id]));
        });

        it('two concurrent re-parents that would make a cycle: exactly one succeeds', async () => {
            for (let round = 0; round < 5; round++) {
                const [a, b] = await Promise.all([item(`pa${round}`), item(`pb${round}`)]);
                const results = await Promise.allSettled([
                    reparentWorkItem(ctx, a.id, { parentId: b.id }),
                    reparentWorkItem(ctx, b.id, { parentId: a.id }),
                ]);
                expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
            }
        });
    });

    describe('ordering', () => {
        it('reorder writes a key between the neighbours, keeps the version, and concurrent reorders never tie', async () => {
            const p = await createProject(ctx, { teamId, name: 'Ordered', keyPrefix: 'ORD' });
            const rows = [];
            for (let i = 0; i < 6; i++) rows.push(await createWorkItem(ctx, { projectId: p.id, typeId, title: `o${i}` }));
            const moved = await reorderWorkItem(ctx, rows[5]!.id, { afterId: rows[0]!.id });
            expect(moved.version).toBe(1);
            const order = async () => (await listWorkItems(ctx, { projectId: p.id })).items.map((i) => i.title);
            expect(await order()).toEqual(['o0', 'o5', 'o1', 'o2', 'o3', 'o4']);
            await Promise.all([
                reorderWorkItem(ctx, rows[3]!.id, { afterId: rows[0]!.id }),
                reorderWorkItem(ctx, rows[4]!.id, { afterId: rows[0]!.id }),
            ]);
            const keys = await prisma.workItem.findMany({ where: { projectId: p.id }, select: { sortKey: true } });
            expect(new Set(keys.map((k) => k.sortKey)).size).toBe(keys.length);
            const final = await order();
            expect(final[0]).toBe('o0');
            expect(final.slice(1, 3).sort()).toEqual(['o3', 'o4']);
        });

        it('sort keys compare the same in Postgres (COLLATE "C") as in JavaScript', async () => {
            const keys = ['a', 'B', 'Z', '0', 'z', 'Aa', 'a0V', 'V', 'b'];
            const rows = await prisma.$queryRawUnsafe<{ k: string }[]>(
                `SELECT k FROM unnest($1::text[]) AS k ORDER BY k COLLATE "C"`,
                keys,
            );
            expect(rows.map((r) => r.k)).toEqual([...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
            const [col] = await prisma.$queryRaw<{ collation_name: string }[]>`
                SELECT collation_name FROM information_schema.columns WHERE table_name = 'WorkItem' AND column_name = 'sortKey'`;
            expect(col!.collation_name).toBe('C');
        });
    });

    describe('moves between projects', () => {
        it('moves the whole subtree with new numbers and aliases; old keys still resolve', async () => {
            const target = await createProject(ctx, { teamId, name: 'Target', keyPrefix: 'TGT' });
            const root = await item('mover');
            const child = await item('mover child', { parentId: root.id });
            await expect(moveWorkItemToProject(ctx, child.id, { projectId: target.id })).rejects.toMatchObject({
                details: { reason: 'SUB_ITEM_MOVE_REFUSED' },
            });
            const result = await moveWorkItemToProject(ctx, root.id, { projectId: target.id });
            expect(result.movedCount).toBe(2);
            const movedChild = await getWorkItem(ctx, child.id);
            expect(movedChild.projectId).toBe(target.id);
            expect(movedChild.key).toMatch(/^TGT-/);
            expect(movedChild.parent?.id).toBe(root.id);
            const old = await getWorkItemByKey(ctx, child.key);
            expect(old).toMatchObject({ redirected: true, canonicalKey: movedChild.key });
            expect(old.item.id).toBe(child.id);
        });

        it('to another team: each state maps to that team\'s default of the same category, team labels drop', async () => {
            const other = await createTeam(ctx, { name: 'Other team' });
            const target = await createProject(ctx, { teamId: other.id, name: 'Far', keyPrefix: 'FAR' });
            const label = await createLabel(ctx, { name: `team label ${TAG}`, teamId });
            const it1 = await item('cross', { stateId: states['In review'] });
            await addWorkItemLabels(ctx, it1.id, [label.id]);
            await moveWorkItemToProject(ctx, it1.id, { projectId: target.id });
            const moved = await getWorkItem(ctx, it1.id);
            const inProgress = other.workflowStates.find((s) => s.name === 'In progress')!;
            expect(moved).toMatchObject({ teamId: other.id, stateId: inProgress.id, stateCategory: 'STARTED' });
            expect(moved.labelIds).toEqual([]);
            const audit = await prisma.auditLog.findFirst({ where: { tenantId, entityId: it1.id, action: 'WORK_ITEM_MOVED' } });
            expect(audit?.metadataJson).toMatchObject({ movedCount: 1, stateRemapped: [{ id: it1.id }] });
        });

        it('refuses a move to a team with no live state of the category', async () => {
            const bare = await createTeam(ctx, { name: 'Bare' });
            const backlog = bare.workflowStates.find((s) => s.name === 'Backlog')!;
            await prisma.workflowState.update({ where: { id: backlog.id }, data: { archivedAt: new Date() } });
            const target = await createProject(ctx, { teamId: bare.id, name: 'Bare project', keyPrefix: 'BAR' });
            const it1 = await item('backlogged', { stateId: states['Backlog'] });
            await expect(moveWorkItemToProject(ctx, it1.id, { projectId: target.id })).rejects.toMatchObject({
                details: { reason: 'NO_STATE_OF_CATEGORY' },
            });
        });
    });

    describe('SQL constructs (catalogue)', () => {
        it('the parent link is DEFERRABLE INITIALLY DEFERRED and NO ACTION', async () => {
            const [fk] = await prisma.$queryRaw<{ condeferrable: boolean; condeferred: boolean; confdeltype: string }[]>`
                SELECT condeferrable, condeferred, confdeltype::text AS confdeltype FROM pg_constraint
                 WHERE conname = 'WorkItem_parentId_projectId_tenantId_fkey'`;
            expect(fk).toEqual({ condeferrable: true, condeferred: true, confdeltype: 'a' });
        });

        it('the relation CHECKs, the partial uniques and the category trigger exist', async () => {
            const names = (
                await prisma.$queryRaw<{ name: string }[]>`
                    SELECT conname AS name FROM pg_constraint WHERE conname IN ('WorkItemRelation_not_self', 'WorkItemRelation_relates_ordered', 'WorkItem_number_positive', 'WorkItem_version_positive')
                    UNION ALL SELECT indexname FROM pg_indexes WHERE indexname IN ('WorkItemRelation_one_duplicate_target', 'WorkflowState_one_default_per_team', 'Label_workspace_name_key')
                    UNION ALL SELECT tgname FROM pg_trigger WHERE tgname = 'workflow_state_category_immutable'`
            ).map((r) => r.name);
            expect(names.sort()).toEqual(
                [
                    'Label_workspace_name_key',
                    'WorkItemRelation_not_self',
                    'WorkItemRelation_one_duplicate_target',
                    'WorkItemRelation_relates_ordered',
                    'WorkItem_number_positive',
                    'WorkItem_version_positive',
                    'WorkflowState_one_default_per_team',
                    'workflow_state_category_immutable',
                ].sort(),
            );
            const collations = await prisma.$queryRaw<{ table_name: string; collation_name: string }[]>`
                SELECT table_name, collation_name FROM information_schema.columns
                 WHERE column_name = 'sortKey' AND table_schema = 'public' ORDER BY table_name`;
            expect(collations).toEqual(
                ['CustomField', 'CustomFieldOption', 'Label', 'Milestone', 'Page', 'ProjectTemplate', 'WorkItem', 'WorkItemTemplate', 'WorkItemType', 'WorkflowState'].map((t) => ({ table_name: t, collation_name: 'C' })),
            );
        });

        it('the constructs bite: a self relation, an unordered RELATES, a second duplicate and a second default are refused', async () => {
            const [a, b, c] = await Promise.all([item('ca'), item('cb'), item('cc')]);
            const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
            const raw = (type: 'RELATES' | 'DUPLICATES' | 'BLOCKS', fromId: string, toId: string) =>
                prisma.workItemRelation.create({ data: { tenantId, type, fromId, toId, createdByUserId: ctx.userId } });
            await expect(raw('BLOCKS', a.id, a.id)).rejects.toThrow(/WorkItemRelation_not_self/);
            await expect(raw('RELATES', hi, lo)).rejects.toThrow(/WorkItemRelation_relates_ordered/);
            await raw('DUPLICATES', c.id, a.id);
            await expect(raw('DUPLICATES', c.id, b.id)).rejects.toThrow();
            await expect(
                prisma.workflowState.update({ where: { id: states['Backlog'] }, data: { isDefault: true } }),
            ).rejects.toThrow();
            // The deferred parent link: a child may point at a parent that
            // appears later in the same transaction.
            await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`UPDATE "WorkItem" SET "parentId" = ${'not-yet'} WHERE id = ${c.id}`;
                await tx.$executeRaw`UPDATE "WorkItem" SET "parentId" = NULL WHERE id = ${c.id}`;
            });
            await expect(
                prisma.$executeRaw`UPDATE "WorkItem" SET "parentId" = ${'missing-parent'} WHERE id = ${c.id}`,
            ).rejects.toThrow();
        });
    });

    it('the audit chain verifies', async () => {
        expect((await verifyAuditChain(tenantId)).valid).toBe(true);
    });
});
