/**
 * Permission-key lookup, with NO edge to the request stack.
 *
 * ═══ WHY THIS IS A SEPARATE MODULE ═══
 *
 * `hasPermission` is ten lines of pure logic over a plain object, and it lived
 * in `permission-middleware.ts` — which value-imports `getTenantCtx` from
 * `@/app-layer/context`, which imports `@/lib/auth`, which imports `@/auth`,
 * which builds the NextAuth provider array at module scope.
 *
 * That chain is fine in a Next request and FATAL in the BullMQ worker, a plain
 * Node process where `next/headers` does not resolve and
 * `next-auth/providers/google` interops to a namespace rather than a callable:
 *
 *     ERR_MODULE_NOT_FOUND  file:///app/node_modules/next/headers   (at boot)
 *     TypeError: Google is not a function                    (at job execution)
 *
 * A background job must never reach NextAuth: the worker's job-context
 * builder (`context-system.ts`, sub-phase 1.6) states the rule — "nothing here
 * may import `@/lib/auth`, `@/auth`, or anything else that reaches them" — and
 * a job that asks whether a member holds a key reaches this module, never the
 * middleware.
 *
 * ═══ WHY IT MATTERS MORE THAN IT LOOKS ═══
 *
 * The worker loads each job with a dynamic `await import(...)` at execution
 * time, not at boot. So this failure would not stop the worker starting and
 * would not fail CI. It would fail the first time the job actually runs, in
 * production, at whatever hour it is scheduled for.
 *
 * @module lib/security/permission-key
 */
import type { PermissionSet } from '@/lib/permissions';

/**
 * Dotted permission keys derived from `PermissionSet`, e.g.
 *   - "work_items.create"
 *   - "projects.edit"
 *   - "admin.members"
 *
 * Compile-time exhaustive — adding an entry to `PermissionSet` widens this
 * union automatically, and a misspelled key fails to compile.
 */
export type PermissionKey = {
    [Domain in keyof PermissionSet]: PermissionSet[Domain] extends Record<string, boolean>
        ? `${Domain & string}.${keyof PermissionSet[Domain] & string}`
        : never;
}[keyof PermissionSet];

/**
 * Look up a permission flag on a resolved `appPermissions` set.
 * Returns `false` for an unknown key — fail-closed.
 */
export function hasPermission(
    appPermissions: PermissionSet,
    key: PermissionKey,
): boolean {
    const [domain, action] = key.split('.') as [keyof PermissionSet, string];
    const bag = appPermissions[domain] as Record<string, boolean> | undefined;
    return Boolean(bag && bag[action] === true);
}
