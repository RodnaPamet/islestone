/**
 * The search-index rebuild walks each kind of source in pages bounded to their
 * own rows (issue #79; docs/search.md, "Stored vectors"): it follows each
 * page's cursor until the walk is over, through pages with nothing stale,
 * rewrites only the stale sources of each page, and stops a kind at its write
 * cap, never at a count of pages read (or a run past fresh rows would never
 * reach the stale ones behind them).
 */
const calls: string[] = [];

jest.mock('@/lib/db-context', () => ({
    runInTenantContext: async (_ctx: unknown, cb: (db: unknown) => Promise<unknown>) => cb({}),
}));
jest.mock('@/app-layer/events/audit', () => ({ logEvent: jest.fn(async () => undefined) }));
jest.mock('@/app-layer/jobs/queue', () => ({ enqueue: jest.fn() }));

type Page = { ids: string[]; next: string | null };
let descriptionPages: Page[] = [];
let commentPages: Page[] = [];

jest.mock('@/app-layer/repositories/SearchVectorRepository', () => ({
    REBUILD_PAGE_SIZE: 500,
    SearchVectorRepository: {
        staleDescriptionPage: jest.fn(async (_db: unknown, _ctx: unknown, after: string | null) => {
            calls.push(`descriptions after ${after}`);
            return descriptionPages.shift()!;
        }),
        staleCommentPage: jest.fn(async (_db: unknown, _ctx: unknown, after: string | null) => {
            calls.push(`comments after ${after}`);
            return commentPages.shift()!;
        }),
        descriptionTexts: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => new Map(ids.map((id) => [id, `text ${id}`]))),
        commentTexts: jest.fn(async (_db: unknown, _ctx: unknown, ids: string[]) => ids.map((id) => ({ id, workItemId: `w-${id}`, body: `body ${id}` }))),
        replaceForSource: jest.fn(async (_db: unknown, _ctx: unknown, source: { workItemId: string; commentId: string | null }) => {
            calls.push(`write ${source.commentId ?? source.workItemId}`);
        }),
        removeDeletedCommentRows: jest.fn(async () => 0),
    },
}));

import { MAX_PAGES, rebuildSearchIndex } from '@/app-layer/usecases/search-index';

import { makeRequestContext } from '../../helpers/make-context';

const ctx = makeRequestContext('OWNER', { tenantId: 't1' });

beforeEach(() => {
    calls.length = 0;
});

it('follows every cursor through pages with nothing stale, and writes only the stale sources', async () => {
    descriptionPages = [
        { ids: [], next: 'w500' },
        { ids: ['w777'], next: 'w1000' },
        { ids: [], next: null },
    ];
    commentPages = [
        { ids: ['c1'], next: 'c500' },
        { ids: [], next: null },
    ];
    const result = await rebuildSearchIndex(ctx);
    expect(calls).toEqual([
        'descriptions after null',
        'descriptions after w500',
        'write w777',
        'descriptions after w1000',
        'comments after null',
        'write c1',
        'comments after c500',
    ]);
    expect(result).toEqual({ descriptions: 1, comments: 1, removed: 0, complete: true });
});

it('stops a kind once it has written its cap, and says the run is incomplete', async () => {
    const full = (n: number): Page => ({ ids: Array.from({ length: 500 }, (_, i) => `w${n}-${i}`), next: `w${n}` });
    descriptionPages = Array.from({ length: MAX_PAGES + 5 }, (_, n) => full(n));
    commentPages = [{ ids: [], next: null }];
    const result = await rebuildSearchIndex(ctx);
    expect(result.descriptions).toBe(MAX_PAGES * 500);
    expect(result.complete).toBe(false);
    expect(calls.filter((c) => c.startsWith('descriptions after'))).toHaveLength(MAX_PAGES);
});
