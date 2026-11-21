/**
 * Imported FIRST by `plans.test.ts`, before anything loads `@/lib/prisma`:
 * the application's client connects directly to Postgres with auto_explain
 * loaded (`withAutoExplain`), and every pg client records the NOTICEs it
 * receives while a capture is open. One Jest module registry per test file,
 * so the statement-budget suite keeps its PgBouncer connection.
 */
import pg from 'pg';

import { parseAutoExplainNotice, withAutoExplain, type CapturedPlan } from './plan-capture';

const direct = process.env.DIRECT_DATABASE_URL;
if (!direct) throw new Error('perf: DIRECT_DATABASE_URL is not set (the plan checks connect directly)');
process.env.DATABASE_URL = withAutoExplain(direct);

let open: CapturedPlan[] | null = null;
const originalConnect = pg.Client.prototype.connect;
// Every client the adapter's pool makes listens for notices once.
pg.Client.prototype.connect = function connectWithNotices(this: pg.Client, ...args: unknown[]) {
    this.on('notice', (notice) => {
        if (!open || !notice.message) return;
        const plan = parseAutoExplainNotice(notice.message);
        if (plan) open.push(plan);
    });
    return (originalConnect as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.connect;

/** Run `fn` and return the plans of every statement it ran. */
export async function capturePlans(fn: () => Promise<unknown>): Promise<CapturedPlan[]> {
    if (open) throw new Error('perf: captures do not nest');
    const plans: CapturedPlan[] = [];
    open = plans;
    try {
        await fn();
    } finally {
        open = null;
    }
    return plans;
}
