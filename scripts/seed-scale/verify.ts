/**
 * Every seed is verified before anything is measured on it (Hardening H2a;
 * docs/porting/maps/H2.md part 1.1): a seeder that wrote the wrong thing
 * fails here, on a fresh seed and on a restored dump alike.
 *
 *   1. Row counts per workspace against the shape, and the bookkeeping that
 *      must agree with them: every project's sequence equals its highest
 *      number and its item count, one search vector per description and per
 *      live comment, a transition per item.
 *   2. `verifyAuditChain` for both workspaces: valid, and not empty.
 *   3. 100 random descriptions per workspace read through the application's
 *      decrypting client in the workspace's context: plaintext, never an
 *      envelope, and found by the real content search (`matchItems`) on a
 *      phrase of their own first sentence, which proves the ciphertext, the
 *      key and the vector agree.
 *   4. A two-tenant read through `runInTenantContext`: in the measured
 *      workspace's context the sibling's rows read as nothing, and the
 *      workspace's own read in full.
 */
import type { PrismaClient } from '@prisma/client';

import { visibleProjects } from '../../src/app-layer/policies/project-visibility';
import { SearchVectorRepository } from '../../src/app-layer/repositories/SearchVectorRepository';
import type { RequestContext } from '../../src/app-layer/types';
import { resolveMemberContext } from '../../src/app-layer/context-system';
import { verifyAuditChain } from '../../src/lib/audit';
import { runInTenantContext } from '../../src/lib/db-context';
import { prisma } from '../../src/lib/prisma';

import { shapeItemCount, type Shape } from './shapes';

export interface WorkspaceReport {
    slug: string;
    tenantId: string;
    items: number;
    liveItems: number;
    comments: number;
    liveComments: number;
    describedItems: number;
    searchVectors: number;
    transitions: number;
    labels: number;
    relations: number;
    customFieldValues: number;
    watchers: number;
    /** Sub-phase 3.4b. */
    timeEntries: number;
    /** Sub-phase 3.4d. */
    approvedWeeks: number;
    auditEntries: number;
    decryptedChecked: number;
}

export interface SeedReport {
    workspaces: WorkspaceReport[];
    databaseBytes: number;
}

class SeedCheckError extends Error {}

function check(ok: boolean, what: string): void {
    if (!ok) throw new SeedCheckError(`seed-scale verify: ${what}`);
}

const count = async (bulk: PrismaClient, sql: string, tenantId: string): Promise<number> => {
    const rows = await bulk.$queryRawUnsafe<Array<{ n: bigint }>>(sql, tenantId);
    return Number(rows[0]!.n);
};

async function ownerContext(tenantId: string): Promise<RequestContext> {
    const owner = await prisma.tenantMembership.findFirst({ where: { tenantId, role: 'OWNER' }, select: { userId: true } });
    check(owner !== null, `workspace ${tenantId} has no owner`);
    const ctx = await resolveMemberContext({ tenantId, userId: owner!.userId, job: 'seed-scale-verify' });
    check(ctx !== null, `the owner of ${tenantId} does not resolve`);
    return ctx!;
}

/** The first sentence of a description, as a quoted phrase for `websearch_to_tsquery`. */
export function phraseOf(text: string): string {
    const first = text.split('.')[0]!.trim();
    return `"${first.replace(/"/g, ' ')}"`;
}

async function verifyWorkspace(bulk: PrismaClient, shape: Shape, slug: string): Promise<WorkspaceReport> {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
    check(tenant !== null, `workspace ${slug} is missing`);
    const tenantId = tenant!.id;
    const q = (sql: string) => count(bulk, sql, tenantId);

    const items = await q(`SELECT count(*) AS n FROM "WorkItem" WHERE "tenantId" = $1`);
    const liveItems = await q(`SELECT count(*) AS n FROM "WorkItem" WHERE "tenantId" = $1 AND "deletedAt" IS NULL`);
    const describedItems = await q(`SELECT count(*) AS n FROM "WorkItem" WHERE "tenantId" = $1 AND "description" IS NOT NULL`);
    const comments = await q(`SELECT count(*) AS n FROM "Comment" WHERE "tenantId" = $1`);
    const liveComments = await q(`SELECT count(*) AS n FROM "Comment" WHERE "tenantId" = $1 AND "deletedAt" IS NULL`);
    const searchVectors = await q(`SELECT count(*) AS n FROM "SearchVector" WHERE "tenantId" = $1`);
    const transitions = await q(`SELECT count(DISTINCT "workItemId") AS n FROM "WorkItemTransition" WHERE "tenantId" = $1`);
    const labels = await q(`SELECT count(*) AS n FROM "WorkItemLabel" WHERE "tenantId" = $1`);
    const relations = await q(`SELECT count(*) AS n FROM "WorkItemRelation" WHERE "tenantId" = $1`);
    const customFieldValues = await q(`SELECT count(*) AS n FROM "CustomFieldValue" WHERE "tenantId" = $1`);
    const watchers = await q(`SELECT count(*) AS n FROM "WorkItemWatcher" WHERE "tenantId" = $1`);
    const badEnvelopes = await q(
        `SELECT (SELECT count(*) FROM "WorkItem" WHERE "tenantId" = $1 AND "description" IS NOT NULL AND "description" NOT LIKE 'v2:%')
              + (SELECT count(*) FROM "Comment" WHERE "tenantId" = $1 AND "body" NOT LIKE 'v2:%') AS n`,
    );
    const sequenceMismatches = await q(
        `SELECT count(*) AS n
           FROM "ProjectKeySequence" s
           LEFT JOIN LATERAL (SELECT max(w."number") AS "top", count(*) AS "items" FROM "WorkItem" w WHERE w."projectId" = s."projectId") w ON true
          WHERE s."tenantId" = $1 AND (s."lastValue" <> COALESCE(w."top", 0) OR s."lastValue" <> w."items")`,
    );
    // Sub-phase 3.4b: time entries, their envelopes, and a heavy member with a full week behind them.
    const timeEntries = await q(`SELECT count(*) AS n FROM "TimeEntry" WHERE "tenantId" = $1`);
    const timeBadEnvelopes = await q(`SELECT count(*) AS n FROM "TimeEntry" WHERE "tenantId" = $1 AND "description" IS NOT NULL AND "description" NOT LIKE 'v2:%'`);
    const overfullDays = await q(
        `SELECT count(*) AS n FROM (SELECT 1 FROM "TimeEntry" WHERE "tenantId" = $1 GROUP BY "userId", "workDate" HAVING sum("minutes") > 1440) d`,
    );
    const liveDescribed = await q(`SELECT count(*) AS n FROM "WorkItem" WHERE "tenantId" = $1 AND "description" IS NOT NULL AND "deletedAt" IS NULL`);
    // Sub-phase 3.4d: the rates at three levels, approved weeks, and every stamp in an approved week.
    const rateLevels = await q(`SELECT count(DISTINCT "level") AS n FROM "BillableRate" WHERE "tenantId" = $1`);
    const approvedWeeks = await q(`SELECT count(*) AS n FROM "Timesheet" WHERE "tenantId" = $1 AND "status" = 'APPROVED'`);
    const stamped = await q(`SELECT count(*) AS n FROM "TimeEntry" WHERE "tenantId" = $1 AND "frozenRateMinor" IS NOT NULL`);
    const strayStamps = await q(
        `SELECT count(*) AS n FROM "TimeEntry" t
          WHERE t."tenantId" = $1 AND t."frozenRateMinor" IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM "Timesheet" s WHERE s."tenantId" = t."tenantId" AND s."userId" = t."userId" AND s."status" = 'APPROVED'
                              AND s."weekStart" = t."workDate" - (extract(isodow FROM t."workDate")::integer - 1))`,
    );
    const currencySet = await q(`SELECT count(*) AS n FROM "TenantTimeSettings" WHERE "tenantId" = $1 AND "currency" = 'EUR'`);

    check(items === shapeItemCount(shape), `${slug} holds ${items} items, the shape ${shapeItemCount(shape)}`);
    check(liveItems > items * 0.95 && liveItems < items, `${slug}: ${liveItems} of ${items} items live (about 1 % are deleted)`);
    check(comments > items * 2 && comments < items * 4, `${slug}: ${comments} comments for ${items} items (about three each)`);
    check(searchVectors === describedItems + liveComments, `${slug}: ${searchVectors} search vectors for ${describedItems} descriptions and ${liveComments} live comments`);
    check(transitions === items, `${slug}: ${transitions} items with a transition of ${items}`);
    check(badEnvelopes === 0, `${slug}: ${badEnvelopes} descriptions or comments not in the workspace key's envelope`);
    check(sequenceMismatches === 0, `${slug}: ${sequenceMismatches} key sequences disagree with their items`);
    check(timeEntries > liveItems * 2 && timeEntries < liveItems * 4 + 600, `${slug}: ${timeEntries} time entries for ${liveItems} live items (about three each, and the heavy member's weeks)`);
    check(timeBadEnvelopes === 0, `${slug}: ${timeBadEnvelopes} time entry descriptions not in the workspace key's envelope`);
    check(overfullDays === 0, `${slug}: ${overfullDays} person-days hold more than 24 hours`);
    check(currencySet === 1, `${slug}: the workspace's currency is not EUR`);
    check(rateLevels === 3, `${slug}: rates at ${rateLevels} levels, not the three`);
    check(approvedWeeks > 20, `${slug}: ${approvedWeeks} approved weeks`);
    check(stamped > 0, `${slug}: no entry of an approved week carries a frozen rate`);
    check(strayStamps === 0, `${slug}: ${strayStamps} frozen rates outside an approved week`);

    const chain = await verifyAuditChain(tenantId);
    check(chain.valid, `${slug}: the audit chain is broken at ${chain.firstBreakAt ?? '?'}`);
    check(chain.totalEntries > 0, `${slug}: the audit chain is empty`);

    // Decrypt and find 100 random descriptions through the application's own client.
    const ctx = await ownerContext(tenantId);
    const sampled = await bulk.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "WorkItem" WHERE "tenantId" = $1 AND "description" IS NOT NULL AND "deletedAt" IS NULL ORDER BY md5("id") LIMIT 100`,
        tenantId,
    );
    check(sampled.length === Math.min(100, liveDescribed), `${slug}: sampled ${sampled.length} of ${liveDescribed} live descriptions`);
    let decryptedChecked = 0;
    await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const rows = await db.workItem.findMany({ where: { tenantId, id: { in: sampled.map((s) => s.id) } }, take: 100, select: { id: true, description: true } });
        check(rows.length === sampled.length, `${slug}: read ${rows.length} of ${sampled.length} sampled items in context`);
        for (const row of rows) {
            const text = row.description ?? '';
            check(text.length > 0 && !/^v[12]:/.test(text), `${slug}: item ${row.id} did not decrypt`);
            // guardrail-allow: n+1 — the verification's 100 bounded searches, one per sampled description.
            const hits = await SearchVectorRepository.matchItems(db, ctx, v, phraseOf(text), 1000);
            check(hits.matches.some((h) => h.workItemId === row.id), `${slug}: item ${row.id} is not found by its own description`);
            decryptedChecked++;
        }
    }, { timeout: 120_000 });

    return {
        slug,
        tenantId,
        items,
        liveItems,
        comments,
        liveComments,
        describedItems,
        searchVectors,
        transitions,
        labels,
        relations,
        customFieldValues,
        watchers,
        timeEntries,
        approvedWeeks,
        auditEntries: chain.totalEntries,
        decryptedChecked,
    };
}

/** The two-tenant read: in A's context B reads as nothing, and A reads in full. */
async function verifyIsolation(a: WorkspaceReport, b: WorkspaceReport): Promise<void> {
    const ctx = await ownerContext(a.tenantId);
    const other = await prisma.workItem.findFirst({ where: { tenantId: b.tenantId }, select: { id: true } });
    check(other !== null, `${b.slug} has no item to probe`);
    await runInTenantContext(ctx, async (db) => {
        // No tenant filter on purpose: row-level security alone must hold the line.
        const all = await db.workItem.count();
        const foreign = await db.workItem.findFirst({ where: { id: other!.id }, select: { id: true } });
        const foreignComments = await db.comment.count({ where: { tenantId: b.tenantId } });
        check(all === a.items, `in ${a.slug}'s context ${all} items read, ${a.items} expected`);
        check(foreign === null && foreignComments === 0, `${a.slug}'s context reads ${b.slug}'s rows`);
    });
}

export async function verifySeed(bulk: PrismaClient, shape: Shape, slugs: readonly [string, string]): Promise<SeedReport> {
    const a = await verifyWorkspace(bulk, shape, slugs[0]);
    const b = await verifyWorkspace(bulk, shape, slugs[1]);
    await verifyIsolation(a, b);
    await verifyIsolation(b, a);
    const size = await bulk.$queryRaw<Array<{ n: bigint }>>`SELECT pg_database_size(current_database()) AS n`;
    return { workspaces: [a, b], databaseBytes: Number(size[0]!.n) };
}
