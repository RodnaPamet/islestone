/**
 * A work item type's default review steps and its Done check (sub-phase 2.8c;
 * ADR 0009 §14 and §15; owner decisions 149, 158, 159 and 160).
 *
 *   - **Defaults** belong to a type across the workspace, read under
 *     `projects.view` and replaced as a whole under `admin.manage` (decision
 *     160, as a type's built-in field rules, decision 112). A default step
 *     names ACTIVE members and the workspace's live recipient lists (a type
 *     spans projects, so never a project's list), and names somebody.
 *   - **Copying** (`copyTypeReviewDefaultsInTx`) is the one path from a
 *     type's defaults to an item: every create path calls it in the create's
 *     own transaction (`createWorkItemInTx`, `insertTemplateItemInTx`; the
 *     dialog and the API, template sub-items, project-template starter items,
 *     intake accept and repeat copies all go through those two), and
 *     `tests/guards/review-defaults-copy-paths.test.ts` holds every writer of
 *     a new item to it. The copy is round 1, PLANNED: nothing opens it
 *     (decision 155), and a later change to the defaults changes no item.
 *     Who is copied is decided when the item is made: the item's assignee is
 *     dropped (decision 158, as a list's resolution drops them), and so is a
 *     member who may not review the item now (not ACTIVE, or not seeing its
 *     project); an archived list is dropped. A step left naming nobody is
 *     kept, so the item still shows the review its type asks for and cannot
 *     be sent until somebody is named (`NO_REVIEWERS`). What was dropped is
 *     named in the create's audit entry, never silently.
 *   - **The Done check** (`assertReviewAllowsDone`, `assertReviewAllowsDoneInState`)
 *     runs in every state path into DONE before it writes:
 *     `tests/guards/review-done-paths.test.ts` holds every caller of
 *     `stateTransitionEffects` to it. A move into DONE of an item whose type
 *     requires review is refused, 409 `REVIEW_INCOMPLETE`, while the newest
 *     round with steps is not COMPLETED (`reviewHoldsDone`). Cancelling is
 *     never held, nor is a move between two Done states. A create into a Done
 *     state copies defaults it could not finish, so it is refused the same
 *     way. The check binds every caller alike (a person, an admin, a job):
 *     no path overrides it.
 *
 * Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { logEvent } from '../events/audit';
import { REVIEW_LIMITS, reviewHoldMessage, reviewHoldsDone, type DoneCheckRound, type ReviewHold } from '../domain/review-steps';
import { formatKey } from '../domain/work-item-key';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { RecipientListRepository } from '../repositories/RecipientListRepository';
import { ReviewRepository } from '../repositories/ReviewRepository';
import { TypeReviewStepRepository, type NewDefaultStep, type TypeReviewStepRow } from '../repositories/TypeReviewStepRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import type { RequestContext } from '../types';
import { eligibleReviewers } from './review-engine';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { badRequest, ConflictError, notFound } from '@/lib/errors/types';
import type { ReviewStepInput } from '@/lib/schemas/review';
import { sanitizePlainText } from '@/lib/security/sanitize';
import type { TypeReviewStepsData } from '@/lib/work-items/types';

// ─── A type's defaults (decision 159) ─────────────────────────────────────

function toDto(typeId: string, reviewRequiredForDone: boolean, rows: readonly TypeReviewStepRow[]): TypeReviewStepsData {
    return {
        typeId,
        reviewRequiredForDone,
        steps: rows.map((s) => ({
            id: s.id,
            position: s.position,
            name: s.name,
            mode: s.mode,
            dueInWorkingDays: s.dueInWorkingDays,
            memberIds: s.reviewers.flatMap((r) => (r.userId ? [r.userId] : [])),
            recipientListIds: s.reviewers.flatMap((r) => (r.recipientListId ? [r.recipientListId] : [])),
            lists: s.reviewers.flatMap((r) => (r.list ? [{ id: r.list.id, name: r.list.name, archived: r.list.archivedAt !== null }] : [])),
        })),
    };
}

async function loadType(db: PrismaTx, ctx: RequestContext, typeId: string) {
    const type = await WorkItemTypeRepository.getById(db, ctx, typeId);
    if (!type) throw notFound('Work item type not found');
    return type;
}

/** A type's default review steps and whether its review must finish before Done (`projects.view`). */
export async function getTypeReviewSteps(ctx: RequestContext, typeId: string): Promise<TypeReviewStepsData> {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const type = await loadType(db, ctx, typeId);
        return toDto(type.id, type.reviewRequiredForDone, await TypeReviewStepRepository.list(db, ctx, type.id));
    });
}

/** Check and clean the defaults an admin sends: names, active members, the workspace's live lists. */
async function cleanDefaultSteps(db: PrismaTx, ctx: RequestContext, input: readonly ReviewStepInput[]): Promise<NewDefaultStep[]> {
    const memberIds = [...new Set(input.flatMap((s) => s.memberIds))];
    // FOR KEY SHARE: a removal in flight is waited for and refused as naming a
    // non-member, never met by the reviewer rows' foreign key (H2, issue #109).
    const active = await MembershipRepository.lockActiveUserIds(db, ctx, memberIds);
    const inactive = memberIds.filter((id) => !active.has(id));
    if (inactive.length > 0) {
        throw badRequest('A default reviewer must be an active member of the workspace.', { reason: 'REVIEWER_NOT_ELIGIBLE', userIds: inactive });
    }
    const listIds = [...new Set(input.flatMap((s) => s.recipientListIds))];
    for (const id of listIds) {
        // guardrail-allow: n+1 — at most maxSteps × maxListsPerStep lists, read by id.
        const list = await RecipientListRepository.getById(db, ctx, id);
        if (!list || list.archivedAt || list.projectId !== null) {
            throw badRequest("A type's default steps name the workspace's live recipient lists only: a type spans every project.", {
                reason: 'RECIPIENT_LIST_NOT_USABLE',
                recipientListId: id,
            });
        }
    }
    return input.map((s, i) => {
        const name = sanitizePlainText(s.name).trim();
        if (!name || name.length > REVIEW_LIMITS.stepNameMax) {
            throw badRequest(`A review step needs a name of 1 to ${REVIEW_LIMITS.stepNameMax} characters.`, { reason: 'STEP_NAME_INVALID', index: i });
        }
        const members = [...new Set(s.memberIds)];
        const lists = [...new Set(s.recipientListIds)];
        if (members.length === 0 && lists.length === 0) {
            throw badRequest(`The step "${name}" names nobody: name a member or a recipient list.`, { reason: 'STEP_HAS_NO_REVIEWERS', index: i });
        }
        return { name, mode: s.mode, dueInWorkingDays: s.dueInWorkingDays, memberIds: members, recipientListIds: lists };
    });
}

/**
 * Replace a type's default review steps and its Done check (`admin.manage`,
 * decision 160). No item changes: items already made keep what they copied
 * (decision 159). Audited `WORK_ITEM_TYPE_REVIEW_STEPS_SET` with ids and
 * counts, never a step's name.
 */
export async function setTypeReviewSteps(
    ctx: RequestContext,
    typeId: string,
    input: { reviewRequiredForDone: boolean; steps: readonly ReviewStepInput[] },
): Promise<TypeReviewStepsData> {
    assertCanManageWorkConfig(ctx);
    if (input.steps.length > REVIEW_LIMITS.maxSteps) throw badRequest(`A type has at most ${REVIEW_LIMITS.maxSteps} default review steps.`, { reason: 'TOO_MANY_STEPS' });
    await runInTenantContext(ctx, async (db) => {
        const type = await loadType(db, ctx, typeId);
        await TypeReviewStepRepository.lockType(db, ctx, type.id);
        const steps = await cleanDefaultSteps(db, ctx, input.steps);
        const before = await TypeReviewStepRepository.list(db, ctx, type.id);
        await TypeReviewStepRepository.replace(db, ctx, type.id, steps);
        if (type.reviewRequiredForDone !== input.reviewRequiredForDone) {
            await TypeReviewStepRepository.setRequiredForDone(db, ctx, type.id, input.reviewRequiredForDone);
        }
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_REVIEW_STEPS_SET',
            entityType: 'WorkItemType',
            entityId: type.id,
            details: `Set the default review steps of the type ${type.name}`,
            detailsJson: {
                category: 'entity_lifecycle',
                entityName: 'WorkItemTypeReviewStep',
                operation: 'updated',
                changedFields: ['reviewSteps', ...(type.reviewRequiredForDone !== input.reviewRequiredForDone ? ['reviewRequiredForDone'] : [])],
            },
            metadata: {
                stepCountBefore: before.length,
                stepCount: steps.length,
                memberIds: [...new Set(steps.flatMap((s) => s.memberIds))],
                recipientListIds: [...new Set(steps.flatMap((s) => s.recipientListIds))],
                reviewRequiredForDone: input.reviewRequiredForDone,
            },
        });
    });
    return getTypeReviewSteps(ctx, typeId);
}

// ─── The Done check (decision 149) ────────────────────────────────────────

/** The refusal of a move into Done that the review holds. */
function refuseHeld(key: string, workItemId: string, hold: ReviewHold, extra: Record<string, unknown> = {}): ConflictError {
    return new ConflictError(reviewHoldMessage(key, hold), {
        reason: 'REVIEW_INCOMPLETE',
        workItemId,
        roundNumber: hold.roundNumber,
        roundStatus: hold.status,
        ...extra,
    });
}

/** What holds each of these items from Done, read under their row locks. */
async function holdsOf(db: PrismaTx, ctx: RequestContext, workItemIds: readonly string[]): Promise<Map<string, ReviewHold>> {
    await ReviewRepository.lockItems(db, ctx, workItemIds);
    const byItem = new Map<string, DoneCheckRound[]>();
    for (const r of await ReviewRepository.doneCheckRounds(db, ctx, workItemIds)) {
        byItem.set(r.workItemId, [...(byItem.get(r.workItemId) ?? []), r]);
    }
    const out = new Map<string, ReviewHold>();
    for (const id of workItemIds) {
        const hold = reviewHoldsDone(byItem.get(id) ?? []);
        if (hold) out.set(id, hold);
    }
    return out;
}

/** One state move a path is about to write. */
export interface DoneCheckMove {
    item: { id: string; typeId: string; number: number; project: { keyPrefix: string } };
    fromCategory: WorkflowStateCategory;
    toCategory: WorkflowStateCategory;
}

/**
 * Refuse a move into DONE that an item's review holds (decision 149): every
 * state path calls it before it writes (single, bulk, the board move, the
 * answer). One refusal refuses the batch, naming its item; the details list
 * every held item. Takes the items' row locks, as every review write does.
 */
export async function assertReviewAllowsDone(db: PrismaTx, ctx: RequestContext, moves: readonly DoneCheckMove[]): Promise<void> {
    const intoDone = moves.filter((m) => m.toCategory === 'DONE' && m.fromCategory !== 'DONE');
    if (intoDone.length === 0) return;
    const requiring = await TypeReviewStepRepository.requiringReview(db, ctx, intoDone.map((m) => m.item.typeId));
    const candidates = intoDone.filter((m) => requiring.has(m.item.typeId));
    if (candidates.length === 0) return;
    const holds = await holdsOf(db, ctx, candidates.map((m) => m.item.id));
    const held = candidates.filter((m) => holds.has(m.item.id));
    const first = held[0];
    if (!first) return;
    const key = formatKey(first.item.project.keyPrefix, first.item.number);
    throw refuseHeld(key, first.item.id, holds.get(first.item.id)!, held.length > 1 ? { heldCount: held.length, workItemIds: held.map((m) => m.item.id) } : {});
}

/**
 * A state's delete that moves its items into a Done state (2.2's
 * `moveItemsBetweenStates`): refused while any of them, deleted ones included
 * (a restore would bring one back into the target), is held by its review.
 * The admin names another target, or finishes the reviews first.
 */
export async function assertReviewAllowsDoneInState(
    db: PrismaTx,
    ctx: RequestContext,
    from: { id: string; category: WorkflowStateCategory },
    to: { category: WorkflowStateCategory },
): Promise<void> {
    if (to.category !== 'DONE' || from.category === 'DONE') return;
    const items = await ReviewRepository.itemsInStateRequiringReview(db, ctx, from.id);
    if (items.length === 0) return;
    const holds = await holdsOf(db, ctx, items.map((i) => i.id));
    const held = items.filter((i) => holds.has(i.id));
    if (held.length === 0) return;
    const keys = held.slice(0, 5).map((i) => formatKey(i.project.keyPrefix, i.number));
    throw new ConflictError(
        `${held.length === 1 ? 'A work item' : `${held.length} work items`} in this state cannot move to Done until ${held.length === 1 ? 'its review is' : 'their reviews are'} complete (${keys.join(', ')}${held.length > keys.length ? ', …' : ''}). Move them to another state.`,
        { reason: 'REVIEW_INCOMPLETE', itemCount: held.length, workItemIds: held.slice(0, 50).map((i) => i.id) },
    );
}

// ─── Copying onto a new item (decision 159) ───────────────────────────────

/** What a copy did, for the create's audit entry. */
export interface CopiedReviewDefaults {
    roundId: string;
    stepCount: number;
    /** Members not copied, and why (decision 158: the assignee; or not able to review the item now). */
    dropped: Array<{ userId: string; reason: 'BECAME_ASSIGNEE' | 'NOT_ELIGIBLE' }>;
    /** Archived lists not copied. */
    droppedListIds: string[];
}

/**
 * Copy the type's default review steps onto a new item as its round 1,
 * PLANNED (decision 159), in the create's transaction; null when the type has
 * none. Called by every create path once the item's row exists. A create into
 * a Done state of a type whose review must finish first is refused here, 409
 * `REVIEW_INCOMPLETE`: the round it copies has not been sent.
 */
export async function copyTypeReviewDefaultsInTx(
    db: PrismaTx,
    ctx: RequestContext,
    item: { id: string; typeId: string; projectId: string; assigneeId: string | null; stateCategory: WorkflowStateCategory; key: string },
): Promise<CopiedReviewDefaults | null> {
    const defaults = await TypeReviewStepRepository.list(db, ctx, item.typeId);
    if (defaults.length === 0) return null;
    if (item.stateCategory === 'DONE' && (await TypeReviewStepRepository.requiringReview(db, ctx, [item.typeId])).has(item.typeId)) {
        throw refuseHeld(item.key, item.id, { roundNumber: 1, status: 'PLANNED', openStepName: null }, { atCreate: true });
    }
    const named = [...new Set(defaults.flatMap((s) => s.reviewers.flatMap((r) => (r.userId ? [r.userId] : []))))];
    const eligible = await eligibleReviewers(db, ctx, item, { memberIds: named, listIds: [] });
    const allowed = new Set(eligible.userIds);
    const droppedListIds = new Set<string>();
    const steps = defaults.map((s, i) => ({
        position: i + 1,
        name: s.name,
        mode: s.mode,
        dueInWorkingDays: s.dueInWorkingDays,
        memberIds: s.reviewers.flatMap((r) => (r.userId && allowed.has(r.userId) ? [r.userId] : [])),
        recipientListIds: s.reviewers.flatMap((r) => {
            if (!r.recipientListId) return [];
            // Only the workspace's live lists (the defaults' own rule, re-read now).
            if (!r.list || r.list.archivedAt || r.list.projectId !== null) {
                droppedListIds.add(r.recipientListId);
                return [];
            }
            return [r.recipientListId];
        }),
    }));
    const number = (await ReviewRepository.lastRoundNumber(db, ctx, item.id)) + 1;
    const round = await ReviewRepository.createRound(db, ctx, item.id, number);
    await ReviewRepository.createSteps(db, ctx, { id: round.id, workItemId: item.id }, steps);
    return { roundId: round.id, stepCount: steps.length, dropped: eligible.dropped, droppedListIds: [...droppedListIds] };
}

/** The create's audit metadata for a copy: counts and ids, never a name. */
export function copiedReviewDefaultsMetadata(copied: CopiedReviewDefaults | null): Record<string, unknown> {
    if (!copied) return {};
    return {
        reviewStepsFromType: copied.stepCount,
        ...(copied.dropped.length ? { reviewDefaultsDropped: copied.dropped } : {}),
        ...(copied.droppedListIds.length ? { reviewDefaultListsDropped: copied.droppedListIds } : {}),
    };
}
