/**
 * The two search reads of sub-phase 2.7b are raw SQL (Prisma cannot order by
 * a rank), so `work-item-repository-predicates.test.ts`'s recorder of Prisma
 * `where` objects cannot see them. This suite records the `Prisma.Sql` each
 * sends and holds it to the same rules: the workspace, the soft-delete
 * predicate and project visibility in its own `WHERE` (CLAUDE.md, "Work-item
 * reads filter deletedAt and project visibility explicitly"), archived
 * projects out, a bound, and the query only ever a bind parameter.
 */
import type { Prisma } from '@prisma/client';

import { ProjectRepository } from '@/app-layer/repositories/ProjectRepository';
import { SEARCH_MATCH_CAP, SearchVectorRepository } from '@/app-layer/repositories/SearchVectorRepository';
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { projectVisibilitySql, type ProjectVisibility } from '@/app-layer/policies/project-visibility';
import type { PrismaTx } from '@/lib/db-context';
import { SEARCH_ROW_CAP } from '@/lib/search/query';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('MEMBER', { tenantId: 'tenant-1' });
const GUEST: ProjectVisibility = { kind: 'GRANTED', projectIds: ['granted-1'] };
const ALL: ProjectVisibility = { kind: 'ALL' };
const QUERY = "x' OR 1=1 --";

function recorder() {
    const sent: Prisma.Sql[] = [];
    const db = {
        $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
            sent.push(sql);
            return [];
        }),
        $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
            sent.push(sql);
            return 0;
        }),
    } as unknown as PrismaTx;
    return { db, sent };
}

/** The SQL text with every bind parameter as `$n`, collapsed to one line. */
const text = (sql: Prisma.Sql) => sql.text.replace(/\s+/g, ' ');

describe('WorkItemRepository.searchTitles', () => {
    it('carries the workspace, deletedAt, the visibility fragment and the archived filter in its own WHERE', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitles(db, ctx, GUEST, QUERY, { limit: 15 });
        expect(sent).toHaveLength(1);
        const sql = sent[0]!;
        const where = text(sql).split(' WHERE ')[1]!.split(' ORDER BY ')[0]!;
        expect(where).toContain('w."tenantId" = $1');
        expect(where).toContain('w."deletedAt" IS NULL');
        expect(where).toContain('p."deletedAt" IS NULL AND p."archivedAt" IS NULL');
        expect(where).toMatch(/w\."projectId" = ANY\(\$\d+::text\[\]\)/);
        expect(sql.values).toContain('tenant-1');
        expect(sql.values).toContainEqual(['granted-1']);
        // The join keeps the item's project in the same workspace.
        expect(text(sql)).toContain('p."tenantId" = w."tenantId"');
    });

    it('spells the indexed expressions exactly, so the planner can use them', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitles(db, ctx, ALL, 'login', { limit: 15 });
        const where = text(sent[0]!).split(' WHERE ')[1]!.split(' ORDER BY ')[0]!;
        expect(where).toMatch(/w\."title" ILIKE \$\d+/);
        expect(where).toMatch(/to_tsvector\('islestone_bg_en', w\."title"\) @@ plainto_tsquery\('islestone_bg_en', \$\d+\)/);
        expect(sent[0]!.values).toContain('%login%');
    });

    it('never puts the query in the SQL text, and ALL visibility adds no grant', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitles(db, ctx, ALL, QUERY, { limit: 15 });
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values).toContain(QUERY);
        expect(text(sent[0]!)).not.toContain('ANY(');
    });

    it('adds the key hit as a candidate and ranks it first', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitles(db, ctx, ALL, 'ISL-3', { limit: 15, keyHitId: 'w-key' });
        const sql = text(sent[0]!);
        expect(sql).toMatch(/OR w\."id" = \$\d+\)/);
        expect(sql).toMatch(/ORDER BY \(w\."id" = \$\d+\) DESC/);
        expect(sent[0]!.values.filter((v) => v === 'w-key')).toHaveLength(2);
    });

    it('is bounded: the limit is a parameter, capped at SEARCH_ROW_CAP', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitles(db, ctx, ALL, 'a', { limit: 10_000 });
        expect(text(sent[0]!)).toMatch(/LIMIT \$\d+$/);
        expect(sent[0]!.values[sent[0]!.values.length - 1]).toBe(SEARCH_ROW_CAP);
    });
});

describe('ProjectRepository.searchNames', () => {
    it('carries the workspace, deletedAt, archivedAt and the grant, and is bounded', async () => {
        const { db, sent } = recorder();
        await ProjectRepository.searchNames(db, ctx, GUEST, QUERY, { limit: 15 });
        const sql = text(sent[0]!);
        const where = sql.split(' WHERE ')[1]!.split(' ORDER BY ')[0]!;
        expect(where).toContain('p."tenantId" = $1');
        expect(where).toContain('p."deletedAt" IS NULL AND p."archivedAt" IS NULL');
        expect(where).toMatch(/p\."id" = ANY\(\$\d+::text\[\]\)/);
        expect(where).toMatch(/to_tsvector\('islestone_bg_en', p\."name"\) @@ plainto_tsquery\('islestone_bg_en', \$\d+\)/);
        expect(sql).toMatch(/LIMIT \$\d+$/);
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values).toContainEqual(['granted-1']);
    });
});

describe('SearchVectorRepository.matchItems (2.7f)', () => {
    it('carries the workspace, both deletedAts, the visibility fragment and the configuration in its own WHERE', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.matchItems(db, ctx, GUEST, QUERY, 20);
        expect(sent).toHaveLength(1);
        const sql = text(sent[0]!);
        const where = sql.split(' WHERE ')[1]!.split(' ORDER BY ')[0]!;
        expect(where).toContain('s."tenantId" = $');
        expect(where).toContain(`s."configName" = 'islestone_bg_en'`);
        expect(where).toContain('w."deletedAt" IS NULL');
        expect(where).toContain('(s."commentId" IS NULL OR c."deletedAt" IS NULL)');
        expect(where).toContain('p."deletedAt" IS NULL AND p."archivedAt" IS NULL');
        expect(where).toMatch(/w\."projectId" = ANY\(\$\d+::text\[\]\)/);
        // Every join stays in the workspace.
        expect(sql).toContain('w."tenantId" = s."tenantId"');
        expect(sql).toContain('p."tenantId" = w."tenantId"');
        expect(sql).toContain('c."tenantId" = s."tenantId"');
        expect(sent[0]!.values).toContain('tenant-1');
        expect(sent[0]!.values).toContainEqual(['granted-1']);
    });

    it('names the configuration as a literal and the query only as a parameter, and is bounded', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.matchItems(db, ctx, ALL, QUERY, 1_000_000);
        const sql = text(sent[0]!);
        expect(sql).toMatch(/websearch_to_tsquery\('islestone_bg_en', \$\d+\)/);
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values).toContain(QUERY);
        expect(sql).toMatch(/LIMIT \$\d+$/);
        expect(sent[0]!.values.at(-1)).toBe(SEARCH_MATCH_CAP);
    });
});

describe('WorkItemRepository.titleFullTextIds (2.7f, the list\'s q)', () => {
    it('carries the workspace, deletedAt and visibility, spells the indexed expression, and is bounded', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.titleFullTextIds(db, ctx, GUEST, QUERY, 1_000_000);
        const sql = text(sent[0]!);
        const where = sql.split(' WHERE ')[1]!.split(' ORDER BY ')[0]!;
        expect(where).toContain('w."tenantId" = $1');
        expect(where).toContain('w."deletedAt" IS NULL');
        expect(where).toContain('p."deletedAt" IS NULL AND p."archivedAt" IS NULL');
        expect(where).toMatch(/w\."projectId" = ANY\(\$\d+::text\[\]\)/);
        expect(where).toMatch(/to_tsvector\('islestone_bg_en', w\."title"\) @@ websearch_to_tsquery\('islestone_bg_en', \$\d+\)/);
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values.at(-1)).toBe(SEARCH_MATCH_CAP);
    });
});

describe('SearchVectorRepository writes (2.7f)', () => {
    it('vectorises the text as a bind parameter through islestone_bg_en, without mention tokens', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: 'w1', commentId: null }, `Ask <@user-1> about ${QUERY}`);
        const sql = text(sent[0]!);
        expect(sql).toMatch(/to_tsvector\('islestone_bg_en', \$\d+\)/);
        expect(sql).toContain('ON CONFLICT ("tenantId", "workItemId") WHERE "commentId" IS NULL');
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values).toContain(`Ask   about ${QUERY}`);
        expect(sent[0]!.values.join(' ')).not.toContain('user-1');
        expect(sent[0]!.values).toContain('tenant-1');
    });

    it('a comment row conflicts on its own unique; an empty text removes the row instead', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: 'w1', commentId: 'c1' }, 'Body');
        expect(text(sent[0]!)).toContain('ON CONFLICT ("tenantId", "commentId") WHERE "commentId" IS NOT NULL');
        await SearchVectorRepository.replaceForSource(db, ctx, { workItemId: 'w1', commentId: 'c1' }, '<@user-1>');
        expect(text(sent[1]!)).toMatch(/^ DELETE FROM "SearchVector" WHERE "tenantId" = \$1 AND "workItemId" = \$2 AND "commentId" = \$3$/);
    });
});

describe('projectVisibilitySql', () => {
    it('refuses anything but an alias and a column reference', () => {
        expect(() => projectVisibilitySql(ALL, { projectAlias: 'p; DROP TABLE x', projectIdColumn: 'w."projectId"' })).toThrow();
        expect(() => projectVisibilitySql(ALL, { projectAlias: 'p', projectIdColumn: 'w."projectId" OR true' })).toThrow();
    });

    it('an empty grant is a parameter that matches nothing', () => {
        const sql = projectVisibilitySql({ kind: 'GRANTED', projectIds: [] }, { projectAlias: 'p', projectIdColumn: 'p."id"' });
        expect(sql.sql).toContain('= ANY(');
        expect(sql.values).toEqual([[]]);
    });
});
