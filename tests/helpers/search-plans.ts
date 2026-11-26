/**
 * The plans of what a search function runs INSIDE itself, as `app_user` in a
 * workspace (owner decision 245; docs/search.md, "The search functions"):
 * `auto_explain` with `log_nested_statements`, on a direct connection (its
 * session settings never reach PgBouncer's pool). Row-level security applies
 * to the caller exactly as in a request, so these are the plans a request
 * gets, which the superuser's own `EXPLAIN` never shows (finding F1).
 *
 * Written fresh for Islestone.
 */
import pg from 'pg';

import { NESTED_SEARCH_MARKER, parseAutoExplainNotice, type CapturedPlan } from '../perf/plan-capture';

import { getTestDirectDatabaseUrl } from './db';

export async function nestedSearchPlans(tenantId: string, sql: string, params: unknown[]): Promise<CapturedPlan[]> {
    const client = new pg.Client({ connectionString: getTestDirectDatabaseUrl() });
    const plans: CapturedPlan[] = [];
    client.on('notice', (n) => {
        const plan = n.message ? parseAutoExplainNotice(n.message) : null;
        if (plan && plan.query.includes(NESTED_SEARCH_MARKER)) plans.push(plan);
    });
    await client.connect();
    try {
        await client.query("LOAD 'auto_explain'");
        for (const [k, v] of [
            ['auto_explain.log_min_duration', '0'],
            ['auto_explain.log_nested_statements', 'on'],
            ['auto_explain.log_format', 'json'],
            ['auto_explain.log_level', 'notice'],
        ]) await client.query(`SET ${k} = '${v}'`);
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE app_user');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
        await client.query(sql, params);
        await client.query('COMMIT');
    } finally {
        await client.end();
    }
    return plans;
}
