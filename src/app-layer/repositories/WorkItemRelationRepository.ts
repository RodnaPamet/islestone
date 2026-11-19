/**
 * Relations between work items (sub-phase 2.1, ADR 0002 §6).
 *
 * The cycle query walks every BLOCKS edge, edges to soft-deleted items
 * included, with a recursive `UNION` (not `UNION ALL`), so it ends on any
 * graph and a restore can never close a cycle. It is the SQL twin of
 * `wouldCreateCycle` (`src/app-layer/domain/work-item-graph.ts`); the caller
 * holds the workspace's graph lock (`lockWorkItemGraph`) around it and the
 * insert. Written fresh for Islestone.
 */
import type { WorkItemRelationType } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { projectVisibilityWhere, type ProjectVisibility } from '../policies/project-visibility';
import type { RequestContext } from '../types';

/** Relations listed per item and direction. */
export const RELATION_LIST_TAKE = 100;

const END_SELECT = {
        id: true,
        number: true,
        title: true,
        stateCategory: true,
        deletedAt: true,
        projectId: true,
        project: { select: { keyPrefix: true, deletedAt: true } },
} as const;

export class WorkItemRelationRepository {
    /** True when `fromId` already reaches `toId` through BLOCKS edges. */
    static async blocksPathExists(db: PrismaTx, ctx: RequestContext, fromId: string, toId: string): Promise<boolean> {
        const rows = await db.$queryRaw<Array<{ hit: number }>>`
            WITH RECURSIVE reach AS (
                SELECT "toId" AS id FROM "WorkItemRelation"
                 WHERE "tenantId" = ${ctx.tenantId} AND "type" = 'BLOCKS' AND "fromId" = ${fromId}
                UNION
                SELECT e."toId" FROM "WorkItemRelation" e
                  JOIN reach ON e."fromId" = reach.id
                 WHERE e."tenantId" = ${ctx.tenantId} AND e."type" = 'BLOCKS'
            )
            SELECT 1 AS hit FROM reach WHERE id = ${toId} LIMIT 1`;
        return rows.length > 0;
    }

    static async find(db: PrismaTx, ctx: RequestContext, type: WorkItemRelationType, fromId: string, toId: string) {
        return db.workItemRelation.findFirst({ where: { tenantId: ctx.tenantId, type, fromId, toId }, select: { id: true } });
    }

    /** The relation `fromId` has as a duplicate, if any. */
    static async duplicateOf(db: PrismaTx, ctx: RequestContext, fromId: string) {
        return db.workItemRelation.findFirst({ where: { tenantId: ctx.tenantId, type: 'DUPLICATES', fromId }, select: { id: true, toId: true } });
    }

    /** Whether any item duplicates `toId` (it is an original). */
    static async isDuplicated(db: PrismaTx, ctx: RequestContext, toId: string): Promise<boolean> {
        const row = await db.workItemRelation.findFirst({ where: { tenantId: ctx.tenantId, type: 'DUPLICATES', toId }, select: { id: true } });
        return row !== null;
    }

    static async create(db: PrismaTx, ctx: RequestContext, data: { type: WorkItemRelationType; fromId: string; toId: string }) {
        return db.workItemRelation.create({
            data: { tenantId: ctx.tenantId, createdByUserId: ctx.userId, ...data },
            select: { id: true, type: true, fromId: true, toId: true, createdAt: true },
        });
    }

    /** The relation, only when `workItemId` is one of its ends (unlink is scoped to the item). */
    static async getForItem(db: PrismaTx, ctx: RequestContext, workItemId: string, relationId: string) {
        return db.workItemRelation.findFirst({
            where: { id: relationId, tenantId: ctx.tenantId, OR: [{ fromId: workItemId }, { toId: workItemId }] },
            select: { id: true, type: true, fromId: true, toId: true },
        });
    }

    static async delete(db: PrismaTx, ctx: RequestContext, relationId: string) {
        return db.workItemRelation.deleteMany({ where: { id: relationId, tenantId: ctx.tenantId } });
    }

    /**
     * Both directions of an item's relations. The other end comes back with its
     * deleted state and project; the caller hides an end the reader may not see.
     */
    static async listForItem(db: PrismaTx, ctx: RequestContext, workItemId: string) {
        const [outgoing, incoming] = await Promise.all([
            db.workItemRelation.findMany({
                where: { tenantId: ctx.tenantId, fromId: workItemId },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: RELATION_LIST_TAKE,
                select: { id: true, type: true, fromId: true, toId: true, createdAt: true, to: { select: END_SELECT } },
            }),
            db.workItemRelation.findMany({
                where: { tenantId: ctx.tenantId, toId: workItemId },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                take: RELATION_LIST_TAKE,
                select: { id: true, type: true, fromId: true, toId: true, createdAt: true, from: { select: END_SELECT } },
            }),
        ]);
        return { outgoing, incoming };
    }

    /** The ids among `ids` the reader may see (live, visible project). */
    static async visibleIds(db: PrismaTx, ctx: RequestContext, v: ProjectVisibility, ids: readonly string[]): Promise<Set<string>> {
        if (ids.length === 0) return new Set();
        const rows = await db.workItem.findMany({
            where: { tenantId: ctx.tenantId, id: { in: [...ids] }, deletedAt: null, AND: [projectVisibilityWhere(v, { includeArchived: true })] },
            take: ids.length,
            select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
    }
}
