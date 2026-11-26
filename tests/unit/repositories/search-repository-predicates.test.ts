/**
 * The search reads are raw SQL, so `work-item-repository-predicates.test.ts`'s
 * recorder of Prisma `where` objects cannot see them. Since owner decision 245
 * each search read is a call of a SECURITY DEFINER search function (migration
 * `20261214120000_search_definer_functions`), whose body carries the
 * workspace, `deletedAt`, visibility and archived predicates
 * (`tests/guards/search-definer-functions.test.ts`,
 * `tests/integration/search-definer.test.ts`). This suite records the
 * `Prisma.Sql` each repository method sends and holds the call to its half:
 * it names its function, binds the query and the visibility input and never
 * puts the query in the SQL text, never hands the function a workspace (the
 * function reads `app.tenant_id` itself), and is bounded. It also holds the
 * rebuild's page reads (issue #79), plain SQL under row-level security, to
 * the workspace in their own `WHERE` and a keyset bounded to the page.
 */
import type { Prisma } from '@prisma/client';

import { ProjectRepository } from '@/app-layer/repositories/ProjectRepository';
import { CONTENT_CANDIDATE_BOUND, REBUILD_PAGE_SIZE, SEARCH_MATCH_CAP, SearchVectorRepository, matchesOf } from '@/app-layer/repositories/SearchVectorRepository';
import { WorkItemRepository } from '@/app-layer/repositories/WorkItemRepository';
import { projectVisibilityArgs, type ProjectVisibility } from '@/app-layer/policies/project-visibility';
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

/** The one function call a read sends, its arguments as `$n` placeholders. */
function callOf(sql: Prisma.Sql, fn: string): string {
    const m = new RegExp(`${fn}\\(([^)]*)\\)`).exec(text(sql));
    if (!m) throw new Error(`${fn} not called in: ${text(sql)}`);
    return m[1]!;
}

describe.each([
    {
        name: 'WorkItemRepository.searchTitleIds',
        fn: 'search_work_item_titles',
        run: (db: PrismaTx, v: ProjectVisibility, q: string, cap: number) => WorkItemRepository.searchTitleIds(db, ctx, v, q, { limit: cap }),
        cap: SEARCH_ROW_CAP,
        args: 7,
    },
    {
        name: 'WorkItemRepository.titleFullTextIds',
        fn: 'search_work_item_title_words',
        run: (db: PrismaTx, v: ProjectVisibility, q: string, cap: number) => WorkItemRepository.titleFullTextIds(db, ctx, v, q, cap),
        cap: SEARCH_MATCH_CAP,
        args: 4,
    },
    {
        name: 'WorkItemRepository.titleSubstringIds',
        fn: 'search_work_item_title_substring',
        run: (db: PrismaTx, v: ProjectVisibility, q: string, cap: number) => WorkItemRepository.titleSubstringIds(db, ctx, v, q, cap),
        cap: SEARCH_MATCH_CAP,
        args: 4,
    },
    {
        name: 'ProjectRepository.searchNameIds',
        fn: 'search_project_names',
        run: (db: PrismaTx, v: ProjectVisibility, q: string, cap: number) => ProjectRepository.searchNameIds(db, ctx, v, q, { limit: cap }),
        cap: SEARCH_ROW_CAP,
        args: 6,
    },
    {
        name: 'SearchVectorRepository.matchItems',
        fn: 'search_item_contents',
        run: (db: PrismaTx, v: ProjectVisibility, q: string, cap: number) => SearchVectorRepository.matchItems(db, ctx, v, q, cap),
        cap: SEARCH_MATCH_CAP,
        args: 4,
    },
])('$name (decision 245)', ({ fn, run, cap, args }) => {
    it(`calls ${fn} once, every argument a typed bind parameter, never the SQL text`, async () => {
        const { db, sent } = recorder();
        await run(db, GUEST, QUERY, 15);
        expect(sent).toHaveLength(1);
        const call = callOf(sent[0]!, fn).split(',').map((a) => a.trim());
        expect(call).toHaveLength(args);
        for (const arg of call) expect(arg).toMatch(/^\$\d+::(text|boolean|text\[\]|integer)$/);
        expect(sent[0]!.sql).not.toContain('OR 1=1');
        expect(sent[0]!.values.some((v) => typeof v === 'string' && v.includes(QUERY))).toBe(true);
    });

    it('never hands the function a workspace: the function reads app.tenant_id itself', async () => {
        const { db, sent } = recorder();
        await run(db, ALL, QUERY, 15);
        expect(sent[0]!.values).not.toContain('tenant-1');
        expect(text(sent[0]!)).not.toMatch(/tenant/i);
    });

    it('binds the visibility input: every live project, or exactly the grant', async () => {
        const all = recorder();
        await run(all.db, ALL, QUERY, 15);
        expect(all.sent[0]!.values).toEqual(expect.arrayContaining([true, []]));
        const guest = recorder();
        await run(guest.db, GUEST, QUERY, 15);
        expect(guest.sent[0]!.values).toEqual(expect.arrayContaining([false, ['granted-1']]));
        expect(guest.sent[0]!.values).not.toContain(true);
    });

    it(`is bounded: the limit is the last argument, capped at ${cap}`, async () => {
        const { db, sent } = recorder();
        await run(db, ALL, QUERY, 1_000_000);
        expect(sent[0]!.values.at(-1)).toBe(cap);
    });
});

describe('WorkItemRepository.searchTitleIds', () => {
    it('binds the escaped patterns and the key hit', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitleIds(db, ctx, ALL, '100%_x', { limit: 15, keyHitId: 'w-key' });
        expect(sent[0]!.values.slice(0, 4)).toEqual(['100%_x', '%100\\%\\_x%', '100\\%\\_x%', 'w-key']);
        expect(text(sent[0]!)).toMatch(/ORDER BY t\."ordinal"$/);
    });

    it('a missing key hit is a NULL argument', async () => {
        const { db, sent } = recorder();
        await WorkItemRepository.searchTitleIds(db, ctx, ALL, 'login', { limit: 15 });
        expect(sent[0]!.values[3]).toBeNull();
    });
});

describe('projectVisibilityArgs', () => {
    it('is two bind parameters, never SQL from the caller', () => {
        expect(projectVisibilityArgs(ALL).values).toEqual([true, []]);
        expect(projectVisibilityArgs({ kind: 'GRANTED', projectIds: [] }).values).toEqual([false, []]);
        expect(projectVisibilityArgs(GUEST).text).toBe('$1::boolean, $2::text[]');
    });
});

describe('the rebuild\'s pages (issue #79)', () => {
    it.each([
        ['staleDescriptionPage', 'WorkItem', 'w', 'workItemId'],
        ['staleCommentPage', 'Comment', 'c', 'commentId'],
    ] as const)('%s: the workspace in both reads, a keyset page of the sources, each probed by its own key', async (method, table, alias, column) => {
        const { db, sent } = recorder();
        await SearchVectorRepository[method](db, ctx, 'cursor-1', { force: false });
        const sql = text(sent[0]!);
        expect(sql).toContain(`FROM "${table}" ${alias} WHERE ${alias}."tenantId" = $`);
        expect(sql).toContain(`AND ${alias}."id" > $`);
        expect(sql).toMatch(new RegExp(`ORDER BY ${alias}\\."id" ASC LIMIT \\$\\d+ \\) page`));
        expect(sql).toContain(`LEFT JOIN LATERAL ( SELECT v."revision", v."configName" FROM "SearchVector" v WHERE v."tenantId" = $`);
        expect(sql).toContain(`AND v."${column}" = page."id"`);
        expect(sent[0]!.values).toEqual(expect.arrayContaining(['tenant-1', 'cursor-1', REBUILD_PAGE_SIZE]));
    });

    it('the first page has no cursor predicate (the index range starts at the workspace)', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.staleDescriptionPage(db, ctx, null, { force: true });
        expect(text(sent[0]!)).not.toContain('"id" >');
    });

    it('returns the stale ids of the page and the cursor of the next, null when the page was short', async () => {
        const full = Array.from({ length: REBUILD_PAGE_SIZE }, (_, i) => ({ id: `w${String(i).padStart(4, '0')}`, stale: i % 2 === 0 }));
        const db = { $queryRaw: jest.fn(async () => full) } as unknown as PrismaTx;
        const page = await SearchVectorRepository.staleDescriptionPage(db, ctx, null, { force: false });
        expect(page.ids).toHaveLength(REBUILD_PAGE_SIZE / 2);
        expect(page.next).toBe(full.at(-1)!.id);
        const shortDb = { $queryRaw: jest.fn(async () => full.slice(0, 3)) } as unknown as PrismaTx;
        expect(await SearchVectorRepository.staleCommentPage(shortDb, ctx, 'x', { force: false })).toEqual({ ids: ['w0000', 'w0002'], next: null });
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

describe('SearchVectorRepository.matchItems: the candidate bound (decision 250)', () => {
    function answering(rows: unknown[]) {
        return { $queryRaw: jest.fn(async () => rows) } as unknown as PrismaTx;
    }

    it('reads the function\'s bounded column with its ids and ranks', async () => {
        const { db, sent } = recorder();
        await SearchVectorRepository.matchItems(db, ctx, ALL, 'фактура', 20);
        expect(text(sent[0]!)).toMatch(/^ SELECT m\."workItemId", m\."commentId", m\."rank", m\."bounded" FROM search_item_contents\(/);
    });

    it('is bounded when the function says the walk was cut, with every match kept in rank order', async () => {
        const db = answering([
            { workItemId: 'w2', commentId: null, rank: '0.5', bounded: true },
            { workItemId: 'w1', commentId: 'c1', rank: 0.25, bounded: true },
        ]);
        await expect(SearchVectorRepository.matchItems(db, ctx, ALL, 'фактура', 20)).resolves.toEqual({
            matches: [
                { workItemId: 'w2', commentId: null, rank: 0.5 },
                { workItemId: 'w1', commentId: 'c1', rank: 0.25 },
            ],
            bounded: true,
        });
    });

    it('is not bounded when every candidate was ranked, nor when nothing matched', async () => {
        await expect(SearchVectorRepository.matchItems(answering([{ workItemId: 'w1', commentId: null, rank: 0.1, bounded: false }]), ctx, ALL, 'x', 20)).resolves.toMatchObject({ bounded: false });
        await expect(SearchVectorRepository.matchItems(answering([]), ctx, ALL, 'x', 20)).resolves.toEqual({ matches: [], bounded: false });
    });

    it('matchesOf reads a NULL flag as not bounded', () => {
        expect(matchesOf([{ workItemId: 'w1', commentId: null, rank: 1, bounded: null }]).bounded).toBe(false);
    });

    it('names the bound the function walks', () => {
        expect(CONTENT_CANDIDATE_BOUND).toBe(2000);
    });
});

describe('SearchVectorRepository.replaceForSource: the row\'s time (decision 250)', () => {
    it('a write of the text stamps the row now; the rebuild keeps an existing row\'s time', async () => {
        const write = recorder();
        await SearchVectorRepository.replaceForSource(write.db, ctx, { workItemId: 'w1', commentId: null }, 'Body');
        expect(text(write.sent[0]!)).toContain('"updatedAt" = EXCLUDED."updatedAt"');
        const rebuild = recorder();
        await SearchVectorRepository.replaceForSource(rebuild.db, ctx, { workItemId: 'w1', commentId: 'c1' }, 'Body', { keepTime: true });
        expect(text(rebuild.sent[0]!)).toContain('"updatedAt" = "SearchVector"."updatedAt"');
        expect(text(rebuild.sent[0]!)).toMatch(/VALUES \(.*now\(\)\)/);
    });
});
