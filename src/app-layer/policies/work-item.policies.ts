import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';

/**
 * Custom-role-aware gates for the work-items domain.
 *
 * `requirePermission` (the HTTP guard) reads `ctx.appPermissions`, the set a
 * custom role resolves to, but a usecase is also reached by callers that are
 * not HTTP routes: jobs, automation rules (5.1) and agents (Phase 6). The
 * usecase layer is the one choke point every caller passes through, so each
 * usecase asks its gate here.
 *
 * Semantics — tighten, never loosen:
 *   - The coarse role check always applies.
 *   - When `appPermissions` is present, the matching granular flag must ALSO
 *     be granted, or the request is denied.
 *   - Defensive fallback: if `appPermissions` is entirely absent, fall back to
 *     the coarse check alone. A present-but-partial `work_items` object fails
 *     closed (`!== true` denies).
 *
 * Copied from inflect-compliance `src/app-layer/policies/task.policies.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the five asserts renamed, the
 * granular flags read from 1.4's `work_items` domain, the read-scope section
 * rewritten for project visibility, `assertCanDeleteWorkItems` added so a
 * delete is not borrowed from `assertCanAdmin`, and the comment gate reading
 * the `work_items.comment` key 1.4 created for it.
 *
 * @returns `true` when the granular layer denies the action.
 */
function granularWorkItemsDenied(
    ctx: RequestContext,
    flag: 'view' | 'create' | 'edit' | 'assign' | 'comment' | 'delete',
): boolean {
    // No granular layer at all → honor the coarse check only.
    if (!ctx.appPermissions) return false;
    // Granular layer present → the flag must be explicitly granted.
    return ctx.appPermissions.work_items?.[flag] !== true;
}

/**
 * Every role holding `work_items.view` may read work items.
 *
 * ── Read scope is PROJECT VISIBILITY, applied as a predicate ───────────
 *
 * This gate answers "may you read work items?", not "may you read THIS
 * item?". Which items a reader sees is decided by project visibility
 * (`src/app-layer/policies/project-visibility.ts`): every live project for
 * OWNER, ADMIN, MEMBER and VIEWER, and only the granted ones for GUEST (none
 * until sub-phase 8.4 adds project grants). That rule is a `where` fragment
 * every repository read and write carries, never a per-item check here: a
 * gate that denies detail reads while the list, the metrics, the activity
 * and the relation and sub-item listings still return titles would leak the
 * same information through a different door.
 */
export function assertCanReadWorkItems(ctx: RequestContext) {
    if (!ctx.permissions.canRead || granularWorkItemsDenied(ctx, 'view')) {
        throw forbidden('You do not have permission to view work items.');
    }
}

/** OWNER, ADMIN and MEMBER can create work items. */
export function assertCanCreateWorkItem(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || granularWorkItemsDenied(ctx, 'create')) {
        throw forbidden('You do not have permission to create work items.');
    }
}

/** OWNER, ADMIN and MEMBER can edit, relate, link, label and move work items. */
export function assertCanEditWorkItems(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || granularWorkItemsDenied(ctx, 'edit')) {
        throw forbidden('You do not have permission to modify work items.');
    }
}

/**
 * OWNER, ADMIN and MEMBER can (re)assign work items.
 *
 * Split out from `assertCanEditWorkItems` because `work_items.assign` is its
 * own granular flag: a custom role may grant edit while withholding the
 * ability to move work onto other people.
 */
export function assertCanAssignWorkItems(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || granularWorkItemsDenied(ctx, 'assign')) {
        throw forbidden('You do not have permission to assign work items.');
    }
}

/**
 * Commenting takes `work_items.comment`, the key the comments route takes,
 * and nothing else: the key a custom role grants is what decides, as the
 * route already says. With no granular layer at all (the defensive branch)
 * the coarse write tier stands in.
 *
 * Built-in roles: OWNER, ADMIN and MEMBER hold `work_items.comment`; VIEWER
 * does not. GUEST holds it, and reaches no item until 8.4 grants it projects.
 */
export function assertCanCommentOnWorkItems(ctx: RequestContext) {
    const allowed = ctx.appPermissions ? ctx.appPermissions.work_items?.comment === true : ctx.permissions.canWrite;
    if (!allowed) {
        throw forbidden('You do not have permission to comment on work items.');
    }
}

/**
 * Deleting and restoring work items takes `work_items.delete` (OWNER and
 * ADMIN among the built-in roles), the key the delete, bulk-delete and
 * restore routes take, so a refusal is the same decision at both layers.
 */
export function assertCanDeleteWorkItems(ctx: RequestContext) {
    if (!ctx.permissions.canWrite || granularWorkItemsDenied(ctx, 'delete')) {
        throw forbidden('You do not have permission to delete work items.');
    }
}
