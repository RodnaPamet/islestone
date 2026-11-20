/**
 * Recipient lists (sub-phase 2.7e; docs/porting/maps/2.7.md, part 6). Every
 * query filters by `tenantId` (RLS also scopes it). A list is never deleted
 * (owner decision 141; `app_user` holds no DELETE on it): it is archived and
 * restored.
 *
 * Written fresh for Islestone.
 */
import type { Prisma } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';
import { RECIPIENT_LIST_MEMBERS_MAX } from '@/lib/recipient-lists/types';
import type { RequestContext } from '../types';

type Ctx = Pick<RequestContext, 'tenantId' | 'userId'>;

/** One scope's lists on one read: far beyond a real workspace's or project's. */
export const RECIPIENT_LISTS_TAKE = 200;
/** The lists usable across every visible project (Settings → Intake's pickers). */
export const RECIPIENT_LISTS_USABLE_TAKE = 2_000;

export const recipientListSelect = {
    id: true,
    projectId: true,
    name: true,
    description: true,
    archivedAt: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.RecipientListSelect;

export type RecipientListRow = Prisma.RecipientListGetPayload<{ select: typeof recipientListSelect }>;

/** Which lists a read returns. */
export type RecipientListScope =
    /** The workspace's own lists. */
    | { kind: 'workspace' }
    /** One project's own lists. */
    | { kind: 'project'; projectId: string }
    /** The lists usable on the items of these projects: the workspace's and theirs. */
    | { kind: 'usable'; projectIds: readonly string[] };

function scopeWhere(scope: RecipientListScope): Prisma.RecipientListWhereInput {
    switch (scope.kind) {
        case 'workspace':
            return { projectId: null };
        case 'project':
            return { projectId: scope.projectId };
        case 'usable':
            return { OR: [{ projectId: null }, { projectId: { in: [...scope.projectIds] } }] };
    }
}

export class RecipientListRepository {
    static async list(db: PrismaTx, ctx: Ctx, scope: RecipientListScope, opts: { includeArchived?: boolean } = {}): Promise<RecipientListRow[]> {
        return db.recipientList.findMany({
            where: { tenantId: ctx.tenantId, ...scopeWhere(scope), ...(opts.includeArchived ? {} : { archivedAt: null }) },
            orderBy: [{ projectId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }, { id: 'asc' }],
            take: scope.kind === 'usable' ? RECIPIENT_LISTS_USABLE_TAKE : RECIPIENT_LISTS_TAKE,
            select: recipientListSelect,
        });
    }

    static async getById(db: PrismaTx, ctx: Ctx, id: string): Promise<RecipientListRow | null> {
        return db.recipientList.findFirst({ where: { id, tenantId: ctx.tenantId }, select: recipientListSelect });
    }

    /**
     * Serialise the writes that name a list in one scope (a name is unique in
     * it): one advisory lock per workspace or project, for the transaction.
     */
    static async lockScope(db: PrismaTx, ctx: Ctx, projectId: string | null): Promise<void> {
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recipient-lists:${ctx.tenantId}:${projectId ?? '-'}`}))`;
    }

    static async nameTaken(db: PrismaTx, ctx: Ctx, projectId: string | null, name: string, exceptId?: string): Promise<boolean> {
        const hit = await db.recipientList.findFirst({
            where: { tenantId: ctx.tenantId, projectId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
            select: { id: true },
        });
        return hit !== null;
    }

    static async create(db: PrismaTx, ctx: Ctx, data: { projectId: string | null; name: string; description: string | null }): Promise<RecipientListRow> {
        return db.recipientList.create({
            data: { tenantId: ctx.tenantId, projectId: data.projectId, name: data.name, description: data.description, createdById: ctx.userId },
            select: recipientListSelect,
        });
    }

    static async update(db: PrismaTx, ctx: Ctx, id: string, data: { name?: string; description?: string | null; archivedAt?: Date | null }): Promise<RecipientListRow> {
        const { count } = await db.recipientList.updateMany({ where: { id, tenantId: ctx.tenantId }, data });
        if (count !== 1) throw new Error('recipient list update matched no row');
        return (await RecipientListRepository.getById(db, ctx, id))!;
    }

    /** The people on each of `listIds`, as stored. */
    static async listMembers(db: PrismaTx, ctx: Ctx, listIds: readonly string[]): Promise<Array<{ listId: string; userId: string }>> {
        if (listIds.length === 0) return [];
        return db.recipientListMember.findMany({
            where: { tenantId: ctx.tenantId, listId: { in: [...listIds] } },
            orderBy: [{ listId: 'asc' }, { createdAt: 'asc' }, { userId: 'asc' }],
            take: listIds.length * RECIPIENT_LIST_MEMBERS_MAX,
            select: { listId: true, userId: true },
        });
    }

    /** Add people to a list; say which of them were not on it before. */
    static async addMembers(db: PrismaTx, ctx: Ctx, listId: string, userIds: readonly string[]): Promise<string[]> {
        const ids = [...new Set(userIds)];
        if (ids.length === 0) return [];
        const already = await db.recipientListMember.findMany({
            where: { tenantId: ctx.tenantId, listId, userId: { in: ids } },
            take: ids.length,
            select: { userId: true },
        });
        const on = new Set(already.map((m) => m.userId));
        const added = ids.filter((id) => !on.has(id));
        if (added.length > 0) {
            await db.recipientListMember.createMany({
                data: added.map((userId) => ({ tenantId: ctx.tenantId, listId, userId, addedById: ctx.userId })),
                skipDuplicates: true,
            });
        }
        return added;
    }

    /** Remove people from a list; say which of them were on it. */
    static async removeMembers(db: PrismaTx, ctx: Ctx, listId: string, userIds: readonly string[]): Promise<string[]> {
        const ids = [...new Set(userIds)];
        if (ids.length === 0) return [];
        const on = await db.recipientListMember.findMany({
            where: { tenantId: ctx.tenantId, listId, userId: { in: ids } },
            take: ids.length,
            select: { userId: true },
        });
        if (on.length > 0) await db.recipientListMember.deleteMany({ where: { tenantId: ctx.tenantId, listId, userId: { in: on.map((m) => m.userId) } } });
        return on.map((m) => m.userId);
    }

    static async countMembers(db: PrismaTx, ctx: Ctx, listId: string): Promise<number> {
        return db.recipientListMember.count({ where: { tenantId: ctx.tenantId, listId } });
    }
}
