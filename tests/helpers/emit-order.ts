/**
 * Where a call sits relative to a usecase's transaction: is `callee` called
 * in `body`, and is any call to it inside a `runInTenantContext(...)` call?
 * Used by the guards that pin the post-commit notification order (sub-phase
 * 2.2). `allCallExpressionsOf` masks comments, so a mention is not a call.
 */
import { allCallExpressionsOf } from './source-blocks';

export function emittedAfterCommit(body: string, callee: string): { called: boolean; insideTransaction: boolean } {
    const call = new RegExp(`\\b${callee}\\s*\\(`);
    const called = call.test(body);
    const transactions = called && /\brunInTenantContext\s*\(/.test(body) ? allCallExpressionsOf(body, 'runInTenantContext') : [];
    return { called, insideTransaction: transactions.some((t) => call.test(t)) };
}
