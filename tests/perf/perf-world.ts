/**
 * The seeded workspace the `perf` project measures (Hardening H2a,
 * docs/performance.md): `perf-<PERF_SHAPE>` from `scripts/seed-scale/`, read
 * once with a plain client on the direct connection. The heavy member (Zipf
 * rank 0, `member003@…`) is the caller, as My Work's heaviest user; the
 * "project" is the first one, the "big project" the largest (20,000 items at
 * 100k).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { resolveMemberContext } from '@/app-layer/context-system';
import type { RequestContext } from '@/app-layer/types';
import { hashForLookup } from '@/lib/security/encryption';

export interface PerfWorld {
    shape: string;
    tenantId: string;
    slug: string;
    ctx: RequestContext;
    heavyUserId: string;
    projectId: string;
    bigProjectId: string;
    teamId: string;
    /** "Todo" in the big project's team (the board column read). */
    stateId: string;
    labelId: string;
    selectFieldId: string;
    optionId: string;
    currentCycleId: string;
    milestoneId: string;
    /** A live item of the project with comments and sub-items. */
    itemId: string;
    /** A deep sub-item (for ancestors). */
    leafId: string;
    deletionId: string;
    /** The first work item type (a create's). */
    typeId: string;
    /** A cuid-shaped item id of the sibling workspace (never readable here). */
    siblingItemId: string;
}

export function perfShape(): string {
    return process.env.PERF_SHAPE || '10k';
}

/** A plain client on the direct connection: fixture reads, never measured. */
export function directClient(): PrismaClient {
    const url = process.env.DIRECT_DATABASE_URL;
    if (!url) throw new Error('perf: DIRECT_DATABASE_URL is not set');
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 2 }) });
}

const one = async <T>(db: PrismaClient, sql: string, ...params: unknown[]): Promise<T> => {
    const rows = await db.$queryRawUnsafe<T[]>(sql, ...params);
    if (rows.length === 0) throw new Error(`perf: the seeded database has no row for: ${sql.slice(0, 120)}`);
    return rows[0]!;
};

export async function loadPerfWorld(db: PrismaClient): Promise<PerfWorld> {
    const shape = perfShape();
    const slug = `perf-${shape}`;
    const tenant = await one<{ id: string }>(db, `SELECT "id" FROM "Tenant" WHERE "slug" = $1`, slug);
    const sibling = await one<{ id: string }>(db, `SELECT w."id" FROM "WorkItem" w JOIN "Tenant" t ON t."id" = w."tenantId" WHERE t."slug" = $1 LIMIT 1`, `${slug}-sibling`);
    const tenantId = tenant.id;
    const heavy = await one<{ id: string }>(db, `SELECT "id" FROM "User" WHERE "emailHash" = $1`, hashForLookup(`member003@${slug}.seed.invalid`));
    const project = await one<{ id: string; teamId: string }>(db, `SELECT "id", "teamId" FROM "Project" WHERE "tenantId" = $1 AND "keyPrefix" = 'AA'`, tenantId);
    const big = await one<{ projectId: string; teamId: string }>(
        db,
        `SELECT "projectId", "teamId" FROM "WorkItem" WHERE "tenantId" = $1 GROUP BY "projectId", "teamId" ORDER BY count(*) DESC, "projectId" LIMIT 1`,
        tenantId,
    );
    const state = await one<{ id: string }>(db, `SELECT "id" FROM "WorkflowState" WHERE "tenantId" = $1 AND "teamId" = $2 AND "name" = 'Todo'`, tenantId, big.teamId);
    const label = await one<{ id: string }>(db, `SELECT "labelId" AS "id" FROM "WorkItemLabel" WHERE "tenantId" = $1 GROUP BY "labelId" ORDER BY count(*) DESC, "labelId" LIMIT 1`, tenantId);
    const field = await one<{ id: string }>(db, `SELECT "id" FROM "CustomField" WHERE "tenantId" = $1 AND "projectId" = $2 AND "type" = 'SELECT'`, tenantId, project.id);
    const option = await one<{ id: string }>(db, `SELECT "id" FROM "CustomFieldOption" WHERE "tenantId" = $1 AND "fieldId" = $2 ORDER BY "sortKey" LIMIT 1`, tenantId, field.id);
    const cycle = await one<{ id: string }>(
        db,
        `SELECT "id" FROM "Cycle" WHERE "tenantId" = $1 AND "teamId" = $2 AND "startsOn" <= CURRENT_DATE AND "endsOn" >= CURRENT_DATE`,
        tenantId,
        project.teamId,
    );
    const milestone = await one<{ id: string }>(db, `SELECT "id" FROM "Milestone" WHERE "tenantId" = $1 AND "projectId" = $2 ORDER BY "sortKey" LIMIT 1`, tenantId, project.id);
    const item = await one<{ id: string }>(
        db,
        `SELECT p."id" FROM "WorkItem" p
          WHERE p."tenantId" = $1 AND p."projectId" = $2 AND p."deletedAt" IS NULL
          ORDER BY (SELECT count(*) FROM "WorkItem" c WHERE c."parentId" = p."id") DESC,
                   (SELECT count(*) FROM "Comment" m WHERE m."workItemId" = p."id") DESC, p."id"
          LIMIT 1`,
        tenantId,
        project.id,
    );
    const leaf = await one<{ id: string }>(
        db,
        `SELECT c."id" FROM "WorkItem" c JOIN "WorkItem" p ON p."id" = c."parentId" AND p."parentId" IS NOT NULL
          WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL ORDER BY c."id" LIMIT 1`,
        tenantId,
    );
    const deletion = await one<{ deletionId: string }>(db, `SELECT "deletionId" FROM "WorkItem" WHERE "tenantId" = $1 AND "deletionId" IS NOT NULL ORDER BY "deletionId" LIMIT 1`, tenantId);
    const type = await one<{ id: string }>(db, `SELECT "id" FROM "WorkItemType" WHERE "tenantId" = $1 ORDER BY "sortKey" LIMIT 1`, tenantId);
    const ctx = await resolveMemberContext({ tenantId, userId: heavy.id, job: 'perf' });
    if (!ctx) throw new Error('perf: the heavy member does not resolve');
    return {
        shape,
        tenantId,
        slug,
        ctx: { ...ctx, requestId: 'perf' },
        heavyUserId: heavy.id,
        projectId: project.id,
        bigProjectId: big.projectId,
        teamId: project.teamId,
        stateId: state.id,
        labelId: label.id,
        selectFieldId: field.id,
        optionId: option.id,
        currentCycleId: cycle.id,
        milestoneId: milestone.id,
        itemId: item.id,
        leafId: leaf.id,
        deletionId: deletion.deletionId,
        typeId: type.id,
        siblingItemId: sibling.id,
    };
}
