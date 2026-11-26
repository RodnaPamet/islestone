/**
 * The pure half of the plan checks (Hardening H2a, `tests/perf/plan-capture.ts`):
 * reading an auto_explain NOTICE, walking a plan, and judging it. The perf
 * project trusts these to say "no sequential scan" and "the index was
 * searched on its column", so each is shown to refuse.
 */
import {
    AUTO_EXPLAIN_SETTINGS,
    conditionMisses,
    isNestedSearchPlan,
    judgePlans,
    NESTED_SEARCH_MARKER,
    parseAutoExplainNotice,
    seqScansOn,
    withAutoExplain,
    type CapturedPlan,
    type PlanNode,
} from '../../perf/plan-capture';

const notice = (plan: PlanNode, query = 'SELECT 1') => `duration: 0.412 ms  plan:\n${JSON.stringify({ 'Query Text': query, Plan: plan }, null, 2)}`;

const indexScan = (index: string, cond: string, buffers = 4): PlanNode => ({
    'Node Type': 'Bitmap Index Scan',
    'Index Name': index,
    'Index Cond': cond,
    'Shared Hit Blocks': buffers,
});

const listPlan: PlanNode = {
    'Node Type': 'Limit',
    'Shared Hit Blocks': 30,
    'Shared Read Blocks': 2,
    Plans: [
        { 'Node Type': 'Index Scan', 'Relation Name': 'WorkItem', 'Index Name': 'WorkItem_tenantId_projectId_sortKey_id_idx' },
        { 'Node Type': 'Seq Scan', 'Relation Name': 'Project' },
    ],
};

describe('parseAutoExplainNotice', () => {
    it('reads the query and the plan of an auto_explain notice', () => {
        const captured = parseAutoExplainNotice(notice(listPlan, 'SELECT "id" FROM "WorkItem"'));
        expect(captured?.query).toBe('SELECT "id" FROM "WorkItem"');
        expect(captured?.plan['Node Type']).toBe('Limit');
    });

    it('ignores every other notice', () => {
        expect(parseAutoExplainNotice('relation "x" already exists, skipping')).toBeNull();
        expect(parseAutoExplainNotice('duration: 1 ms  statement: SELECT 1')).toBeNull();
    });
});

describe('seqScansOn', () => {
    it('names a sequential scan on a guarded table, at any depth, and not on others', () => {
        const plan: PlanNode = { 'Node Type': 'Hash Join', Plans: [{ 'Node Type': 'Hash', Plans: [{ 'Node Type': 'Seq Scan', 'Relation Name': 'Comment' }] }, ...listPlan.Plans!] };
        expect(seqScansOn(plan)).toEqual(['Comment']);
        expect(seqScansOn(listPlan)).toEqual([]);
    });
});

describe('judgePlans', () => {
    const plans: CapturedPlan[] = [
        { query: 'a', plan: listPlan },
        { query: 'b', plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'AuditLog', 'Shared Hit Blocks': 100 } },
    ];

    it('sums the buffers of every statement, lists their indexes, and names the guarded seq scans', () => {
        const v = judgePlans(plans, ['WorkItem_tenantId_projectId_sortKey_id_idx']);
        expect(v).toEqual({
            statements: 2,
            seqScans: ['AuditLog'],
            indexes: ['WorkItem_tenantId_projectId_sortKey_id_idx'],
            buffers: 132,
            missingIndexes: [],
        });
    });

    it("counts a search function's nested statement for its scans and indexes, not its buffers or as a statement", () => {
        const nested: CapturedPlan = {
            query: `SELECT /* ${NESTED_SEARCH_MARKER} */ w."id" FROM public."WorkItem" w`,
            plan: { 'Node Type': 'Bitmap Heap Scan', Plans: [{ 'Node Type': 'Bitmap Index Scan', 'Index Name': 'WorkItem_search_title_fts' }], 'Shared Hit Blocks': 40 },
        };
        const caller: CapturedPlan = { query: 'SELECT t."id" FROM search_work_item_title_words($1, $2, $3, $4) t', plan: { 'Node Type': 'Function Scan', 'Shared Hit Blocks': 41 } };
        expect(isNestedSearchPlan(nested)).toBe(true);
        expect(isNestedSearchPlan(caller)).toBe(false);
        expect(judgePlans([nested, caller], ['WorkItem_search_title_fts'])).toEqual({
            statements: 1,
            seqScans: [],
            indexes: ['WorkItem_search_title_fts'],
            buffers: 41,
            missingIndexes: [],
        });
        expect(AUTO_EXPLAIN_SETTINGS).toContainEqual(['auto_explain.log_nested_statements', 'on']);
    });

    it('names an expected index no statement used, accepting either of `a|b`', () => {
        expect(judgePlans(plans, ['WorkItem_tenantId_sortKey_id_idx']).missingIndexes).toEqual(['WorkItem_tenantId_sortKey_id_idx']);
        expect(judgePlans(plans, ['WorkItem_tenantId_sortKey_id_idx|WorkItem_tenantId_projectId_sortKey_id_idx']).missingIndexes).toEqual([]);
    });
});

describe('conditionMisses', () => {
    it('refuses a GIN index read on its tenantId alone, and accepts it searched with the operator', () => {
        const tenantOnly: CapturedPlan = { query: 'q', plan: indexScan('SearchVector_search_lexemes', `("tenantId" = 't1'::text)`) };
        const searched: CapturedPlan = { query: 'q', plan: indexScan('SearchVector_search_lexemes', `(("tenantId" = 't1'::text) AND (lexemes @@ '''задача'''::tsquery))`) };
        const wanted = [{ index: 'SearchVector_search_lexemes', operator: '@@' }];
        expect(conditionMisses([tenantOnly], wanted)).toEqual(['SearchVector_search_lexemes with @@']);
        expect(conditionMisses([searched], wanted)).toEqual([]);
    });
});

describe('withAutoExplain', () => {
    it('adds the startup options and keeps the rest of the URL', () => {
        const url = new URL(withAutoExplain('postgresql://u:p@127.0.0.1:5432/db?sslmode=disable')); // pragma: allowlist secret
        expect(url.pathname).toBe('/db');
        expect(url.searchParams.get('sslmode')).toBe('disable');
        const options = url.searchParams.get('options') ?? '';
        expect(options).toContain('-c session_preload_libraries=auto_explain');
        expect(options).toContain('-c auto_explain.log_level=notice');
        expect(options).toContain('-c auto_explain.log_buffers=on');
    });
});
