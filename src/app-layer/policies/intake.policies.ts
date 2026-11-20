/**
 * Gates for intake (sub-phase 2.6a; owner decision 92). The `intake` domain
 * of the `PermissionSet`: `intake.view` reads requests (they hold
 * outsiders' personal data from 2.6b), `intake.triage` accepts, declines,
 * merges, snoozes, moves and reopens them, `intake.manage` turns a project's
 * intake on or off, builds its forms and sets its notify list. Accepting also
 * needs `work_items.create`. Sending a request through an internal form needs
 * only to see the project (`projects.view`).
 *
 * Same semantics as `cycle.policies.ts`: the coarse tier always applies, and
 * a present granular layer must also grant the key. Each gate is a predicate
 * and an assertion built on it, so the pages offer exactly the writes the
 * usecases admit (`intakeAffordances`, read on the server).
 *
 * Written fresh for Islestone.
 */
import type { RequestContext } from '../types';
import { forbidden } from '@/lib/errors/types';
import type { IntakeAffordances } from '@/lib/intake/types';

export type IntakeViewer = Pick<RequestContext, 'permissions' | 'appPermissions'>;

function granted(ctx: IntakeViewer, read: (p: NonNullable<RequestContext['appPermissions']>) => boolean | undefined): boolean {
    if (!ctx.appPermissions) return true;
    return read(ctx.appPermissions) === true;
}

export function mayReadIntake(ctx: IntakeViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.intake?.view);
}

export function mayTriageIntake(ctx: IntakeViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.intake?.view) && granted(ctx, (p) => p.intake?.triage);
}

export function mayManageIntake(ctx: IntakeViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.intake?.manage);
}

/** Accepting creates a work item: the create key, as `assertCanCreateWorkItem` reads it. */
export function mayCreateItemsOnAccept(ctx: IntakeViewer): boolean {
    return ctx.permissions.canWrite && granted(ctx, (p) => p.work_items?.create);
}

/** Send a request through an internal form: anyone who sees projects. */
export function maySendInternalRequests(ctx: IntakeViewer): boolean {
    return ctx.permissions.canRead && granted(ctx, (p) => p.projects?.view);
}

export function intakeAffordances(ctx: IntakeViewer): IntakeAffordances {
    return {
        view: mayReadIntake(ctx),
        triage: mayTriageIntake(ctx),
        createItems: mayCreateItemsOnAccept(ctx),
        manage: mayManageIntake(ctx),
    };
}

export function assertCanReadIntake(ctx: RequestContext) {
    if (!mayReadIntake(ctx)) throw forbidden('You do not have permission to view intake.');
}

export function assertCanTriageIntake(ctx: RequestContext) {
    if (!mayTriageIntake(ctx)) throw forbidden('You do not have permission to triage requests.');
}

export function assertCanAcceptIntake(ctx: RequestContext) {
    assertCanTriageIntake(ctx);
    if (!mayCreateItemsOnAccept(ctx)) throw forbidden('Accepting a request creates a work item, which you do not have permission to do.');
}

export function assertCanManageIntake(ctx: RequestContext) {
    if (!mayManageIntake(ctx)) throw forbidden('You do not have permission to manage intake.');
}

export function assertCanSendInternalRequests(ctx: RequestContext) {
    if (!maySendInternalRequests(ctx)) throw forbidden('You do not have permission to send requests.');
}
