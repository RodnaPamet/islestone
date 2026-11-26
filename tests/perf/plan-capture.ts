/**
 * Query plans captured as they run (Hardening H2a, docs/performance.md).
 *
 * The plan checks connect DIRECTLY to Postgres (never through PgBouncer, which
 * would refuse the startup options) with `auto_explain` loaded for the
 * session: every planned statement the application runs is explained with
 * `ANALYZE` and `BUFFERS` after it executes, in JSON, and sent to the client as
 * a NOTICE (`auto_explain.log_level = notice`). The real repository method
 * runs with its real parameters, as `app_user` under row-level security,
 * inside `runInTenantContext`; nothing is re-planned from a copied SQL string.
 *
 * The pure half (parsing a notice, walking a plan) is unit-tested in
 * `tests/unit/perf/plan-capture.test.ts`.
 */

/** The tables no checked query may read with a sequential scan (map part 1.2). */
export const GUARDED_TABLES: readonly string[] = ['WorkItem', 'Comment', 'SearchVector', 'WorkItemTransition', 'AuditLog'];

/** The session settings that turn every statement's plan into a NOTICE. */
export const AUTO_EXPLAIN_SETTINGS: ReadonlyArray<readonly [string, string]> = [
    ['session_preload_libraries', 'auto_explain'],
    ['auto_explain.log_min_duration', '0'],
    ['auto_explain.log_analyze', 'on'],
    ['auto_explain.log_buffers', 'on'],
    ['auto_explain.log_timing', 'off'],
    ['auto_explain.log_triggers', 'off'],
    ['auto_explain.log_format', 'json'],
    // The search functions' own statements (owner decision 245): a function
    // scan's plan says nothing about the index its body searched.
    ['auto_explain.log_nested_statements', 'on'],
    ['auto_explain.log_level', 'notice'],
];

/** A connection string with the settings above as libpq startup options. */
export function withAutoExplain(url: string): string {
    const options = AUTO_EXPLAIN_SETTINGS.map(([k, v]) => `-c ${k}=${v}`).join(' ');
    const u = new URL(url);
    u.searchParams.set('options', options);
    return u.toString();
}

export interface PlanNode {
    'Node Type': string;
    'Relation Name'?: string;
    'Index Name'?: string;
    'Shared Hit Blocks'?: number;
    'Shared Read Blocks'?: number;
    Plans?: PlanNode[];
    [key: string]: unknown;
}

export interface CapturedPlan {
    query: string;
    plan: PlanNode;
}

/** One auto_explain NOTICE (`duration: … ms  plan:\n{…}`) as a plan, or null for any other notice. */
export function parseAutoExplainNotice(message: string): CapturedPlan | null {
    if (!/^duration: [\d.]+ ms\s+plan:/.test(message)) return null;
    const at = message.indexOf('{');
    if (at < 0) return null;
    const doc = JSON.parse(message.slice(at)) as { 'Query Text'?: string; Plan?: PlanNode };
    if (!doc.Plan) return null;
    return { query: doc['Query Text'] ?? '', plan: doc.Plan };
}

/** Every node of a plan, the root first. */
export function planNodes(root: PlanNode): PlanNode[] {
    const out: PlanNode[] = [];
    const visit = (n: PlanNode) => {
        out.push(n);
        for (const child of n.Plans ?? []) visit(child);
    };
    visit(root);
    return out;
}

/** The guarded tables a plan reads with a sequential scan. */
export function seqScansOn(plan: PlanNode, guarded: readonly string[] = GUARDED_TABLES): string[] {
    return planNodes(plan)
        .filter((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] !== undefined && guarded.includes(n['Relation Name']))
        .map((n) => n['Relation Name']!);
}

/** Every index a plan reads. */
export function indexesUsed(plan: PlanNode): string[] {
    return planNodes(plan)
        .map((n) => n['Index Name'])
        .filter((name): name is string => typeof name === 'string');
}

/**
 * The marker every search function's one statement carries in a block
 * comment (migration
 * `20261214120000_search_definer_functions`): a plan whose query text holds it
 * ran NESTED, inside the function scan of a statement the application sent,
 * whose buffers already include it.
 */
export const NESTED_SEARCH_MARKER = 'islestone:search-definer';

/** Whether a captured plan ran inside a search function (its buffers are its caller's). */
export function isNestedSearchPlan(p: CapturedPlan): boolean {
    return p.query.includes(NESTED_SEARCH_MARKER);
}

/** Shared buffers a statement touched (hit plus read): the root's totals include its children. */
export function sharedBuffers(plan: PlanNode): number {
    return (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);
}

export interface PlanVerdict {
    /** Statements the application sent (a search function's own statement is not one). */
    statements: number;
    seqScans: string[];
    indexes: string[];
    buffers: number;
    missingIndexes: string[];
}

/**
 * The verdict on one named query's statements: the guarded tables read by a
 * sequential scan, the indexes used, the buffers touched, and the expected
 * indexes that no statement used. `expected` lists alternatives per entry,
 * `a|b` meaning either. A search function's nested statement counts for its
 * scans and indexes, but not for buffers or statements: the function scan of
 * the statement that called it already counted them.
 */
export function judgePlans(plans: readonly CapturedPlan[], expected: readonly string[], guarded: readonly string[] = GUARDED_TABLES): PlanVerdict {
    const seqScans = plans.flatMap((p) => seqScansOn(p.plan, guarded));
    const indexes = [...new Set(plans.flatMap((p) => indexesUsed(p.plan)))].sort();
    const top = plans.filter((p) => !isNestedSearchPlan(p));
    const buffers = top.reduce((s, p) => s + sharedBuffers(p.plan), 0);
    const missingIndexes = expected.filter((alts) => !alts.split('|').some((name) => indexes.includes(name)));
    return { statements: top.length, seqScans, indexes, buffers, missingIndexes };
}

/** An index that must be searched with a condition on its searched column, not only its leading `tenantId`. */
export interface IndexCondition {
    /** The index (`a|b` for either). */
    index: string;
    /** A text the node's `Index Cond` must contain: the operator (`@@`, `~~*`). */
    operator: string;
}

/**
 * The conditions no statement met: a GIN index read on its `tenantId` alone
 * returns every row of the workspace, so "the index was used" says nothing;
 * the operator must be part of the index condition.
 */
export function conditionMisses(plans: readonly CapturedPlan[], conditions: readonly IndexCondition[]): string[] {
    const nodes = plans.flatMap((p) => planNodes(p.plan));
    return conditions
        .filter((c) => {
            const names = c.index.split('|');
            return !nodes.some((n) => names.includes(n['Index Name'] ?? '') && typeof n['Index Cond'] === 'string' && (n['Index Cond'] as string).includes(c.operator));
        })
        .map((c) => `${c.index} with ${c.operator}`);
}
