/**
 * Who may do what with an item's review steps (sub-phase 2.8a; ADR 0009;
 * owner decisions 150, 158 and 160). The usecases assert these predicates and
 * the detail (2.8b) renders `reviewAffordances`, asked on the server: a
 * component never restates a rule.
 *
 *   - **Edit steps not yet opened, send a round, withdraw it, add a
 *     reviewer:** `work_items.edit` (decision 150).
 *   - **Skip a step, close one whose reviewers left, remove a pending
 *     reviewer from an open step:** the item's assignee, whoever sent the
 *     round, or an admin (`admin.manage`), audited (decision 150).
 *   - **Respond:** the person named as a reviewer of the open step, acting
 *     as themselves (`assertActingAsPerson`), with `work_items.view` (decision
 *     160), and never the item's assignee (decision 158: a person does not
 *     review their own work).
 *
 * Written fresh for Islestone. Separation of duties is inflect-compliance's
 * `decidePolicyApproval` rule (the requester may not approve their own
 * request), pattern only, no code copied.
 */
import type { RequestContext } from '../types';
import { mayManageWorkConfig } from './work-config.policies';
import { mayEditWorkItems, mayReadWorkItems } from './work-item.policies';

/** Why a person may skip a step or close one whose reviewers left. */
export type ReviewStandingBasis = 'assignee' | 'sender' | 'admin';

/** The assignee, whoever sent the round, or an admin (decision 150); `null` otherwise. */
export function reviewStandingBasis(
    ctx: RequestContext,
    item: { assigneeId: string | null },
    round: { startedByUserId: string | null } | null,
): ReviewStandingBasis | null {
    if (!mayEditWorkItems(ctx)) return null;
    if (item.assigneeId && item.assigneeId === ctx.userId) return 'assignee';
    if (round?.startedByUserId && round.startedByUserId === ctx.userId) return 'sender';
    if (mayManageWorkConfig(ctx)) return 'admin';
    return null;
}

/** Is this person the item's assignee, who may not review it (decision 158)? */
export function isOwnWork(userId: string, item: { assigneeId: string | null }): boolean {
    return Boolean(item.assigneeId) && item.assigneeId === userId;
}

/** May this caller respond to a step they are named on? */
export function mayRespondToReview(ctx: RequestContext, item: { assigneeId: string | null }, named: boolean): boolean {
    return named && !ctx.apiKeyId && mayReadWorkItems(ctx) && !isOwnWork(ctx.userId, item);
}

/** What the item's review section offers the viewer: the buttons, from the rules the usecases assert. */
export interface ReviewAffordances {
    /** Edit the planned round's steps, or an open round's steps not yet opened. */
    editSteps: boolean;
    /** "Send for review". */
    send: boolean;
    /** End the open round unfinished. */
    withdraw: boolean;
    /** Skip a step, close one whose reviewers left, remove a pending reviewer from an open step. */
    skip: boolean;
    /** The open step the viewer may respond to (or change their response on), or null. */
    respondStepId: string | null;
}

export function reviewAffordances(
    ctx: RequestContext,
    item: { assigneeId: string | null; closed: boolean; projectArchived: boolean },
    round: {
        status: string;
        startedByUserId: string | null;
        stepCount: number;
        openStep: { id: string; namesViewer: boolean } | null;
    } | null,
): ReviewAffordances {
    const writable = !item.projectArchived;
    const edit = writable && mayEditWorkItems(ctx);
    const live = round && (round.status === 'PLANNED' || round.status === 'OPEN');
    return {
        editSteps: edit && (!round || Boolean(live)),
        send: edit && !item.closed && round?.status === 'PLANNED' && round.stepCount > 0,
        withdraw: edit && round?.status === 'OPEN',
        skip: writable && round?.status === 'OPEN' && reviewStandingBasis(ctx, item, round) !== null,
        respondStepId:
            writable && round?.status === 'OPEN' && round.openStep && mayRespondToReview(ctx, item, round.openStep.namesViewer)
                ? round.openStep.id
                : null,
    };
}
