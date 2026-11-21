/**
 * Repeats, made by the nightly job (sub-phase 2.5d; docs/porting/maps/2.5.md,
 * "The recurrence job in detail"; owner decisions 68 to 70).
 *
 * For each running rule whose next occurrence is due within its lead days:
 *
 *   1. Re-resolve the rule's owner (`resolveMemberContext`). No longer an
 *      active member: the rule goes on hold (`OWNER_NOT_ACTIVE`). No
 *      `work_items.create`, or the item's project out of their sight: on
 *      hold (`OWNER_NOT_PERMITTED`). Never a fallback to the system user.
 *   2. As the owner, in ONE transaction: read the source (deleted: on hold
 *      `SOURCE_DELETED`; archived project: `PROJECT_ARCHIVED`), plan the run
 *      (`planDue`: only the latest due occurrence, the others counted),
 *      claim the stamped date (a conditional update: a second or concurrent
 *      run changes nothing; the occurrence unique is the backstop), and make
 *      the copy through the request's own create (`createWorkItemInTx`),
 *      projected by `templateToCreateInput`, the one projection from a
 *      source to a new item.
 *   3. After the commit, the create's bells (`emitCreatedItemBells`).
 *
 * A hold is written as the workspace system user, naming the owner and the
 * reason; a departed person is never named as the actor. Pattern only, no
 * code copied: inflect-compliance `src/app-layer/jobs/control-test-scheduler.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1; the claim on the
 * stamped date). Written fresh for Islestone.
 */
import type { RecurrenceHold } from '@prisma/client';

import { logEvent } from '../events/audit';
import { resolveMemberContext } from '../context-system';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { RecurrenceRepository, type RecurrenceRow } from '../repositories/RecurrenceRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { mayCreateWorkItems } from '../policies/recurrence.policies';
import { visibleProjects } from '../policies/project-visibility';
import { addDays, dayKey, daysBetween } from '../domain/cycle';
import { numberOf, planDue, RECURRENCE_LIMITS } from '../domain/recurrence';
import { templateToCreateInput } from '../domain/work-item-template';
import { createWorkItemInTx, emitCreatedItemBells } from './work-item';
import { isFieldSetRefusal } from './field-set';
import { peopleNamedBy, templateUseContextInTx } from './work-item-template';
import { ruleOf } from './recurrence';
import { toWorkItemDto } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { logger } from '@/lib/observability/logger';
import { TEMPLATE_LIMITS } from '@/lib/schemas/template';

export interface RecurrenceRunResult {
    rules: number;
    created: number;
    held: number;
    raced: number;
    skippedOccurrences: number;
    failed: number;
}

type CreatedItem = Awaited<ReturnType<typeof createWorkItemInTx>>;
type RuleOutcome = { kind: 'created'; item: CreatedItem; owner: RequestContext; skipped: number } | { kind: 'hold'; reason: RecurrenceHold } | { kind: 'none' };

async function holdRule(sys: RequestContext, rule: RecurrenceRow, reason: RecurrenceHold): Promise<boolean> {
    return runInTenantContext(sys, async (db) => {
        if ((await RecurrenceRepository.hold(db, sys, rule.id, rule.nextOccurrenceOn, reason, new Date())) === 0) return false;
        await logEvent(db, sys, {
            action: 'RECURRENCE_HELD',
            entityType: 'WorkItemRecurrence',
            entityId: rule.id,
            details: `Put a repeat on hold: ${reason}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemRecurrence', operation: 'updated', summary: 'RECURRENCE_HELD' },
            metadata: { sourceWorkItemId: rule.sourceWorkItemId, reason, ownerUserId: rule.ownerUserId },
        });
        return true;
    });
}

/** As the owner, in one transaction: check the source, plan, claim, and make the copy. */
async function makeOccurrenceInTx(db: PrismaTx, owner: RequestContext, rule: RecurrenceRow, today: Date): Promise<RuleOutcome> {
    const v = await visibleProjects(owner, db);
    const found = await WorkItemRepository.recurrenceSource(db, owner, v, rule.sourceWorkItemId);
    if (!found) return { kind: 'hold', reason: 'OWNER_NOT_PERMITTED' };
    if (found.deletedAt) return { kind: 'hold', reason: 'SOURCE_DELETED' };
    if (found.project.archivedAt) return { kind: 'hold', reason: 'PROJECT_ARCHIVED' };

    const domainRule = ruleOf(rule);
    const stamped = rule.nextOccurrenceOn!;
    const number = numberOf(domainRule, stamped);
    if (number === null) return { kind: 'none' };
    const plan = planDue(domainRule, { on: stamped, number }, today, rule.leadDays);
    if (!plan) return { kind: 'none' };
    const claimed = await RecurrenceRepository.claim(db, owner, rule.id, stamped, {
        nextOccurrenceOn: plan.following?.on ?? null,
        ended: plan.following === null,
        at: new Date(),
    });
    if (claimed === 0) return { kind: 'none' };
    // Made already (before a hold and a resume): the claim moved the rule on; make nothing.
    if (await WorkItemRepository.occurrenceExists(db, owner, rule.id, plan.make.on)) return { kind: 'none' };

    // The source as it is now, projected like a template (decision 69).
    const sourceRow = (await WorkItemRepository.getById(db, owner, v, found.id))!;
    const source = toWorkItemDto(sourceRow);
    const subRows = await WorkItemRepository.listSubItems(db, owner, v, found.id, { limit: TEMPLATE_LIMITS.subItems });
    const itemSource = {
        templateId: null,
        title: source.title,
        description: sourceRow.description,
        typeId: source.typeId,
        priority: source.priority,
        labelIds: source.labelIds,
        assigneeId: source.assigneeId,
        dueInDays: null,
        milestoneId: source.milestoneId,
        customFields: source.customFields,
        subItems: subRows.slice(0, TEMPLATE_LIMITS.subItems).map((s) => ({ title: s.title })),
    };
    const occurrenceOn = dayKey(plan.make.on);
    const projected = templateToCreateInput(itemSource, { dueDate: occurrenceOn }, await templateUseContextInTx(db, owner, { id: found.projectId, teamId: found.teamId }, peopleNamedBy(itemSource)));
    // A start date keeps its distance from the due date. A source whose start
    // is after its due date (written before 3.1a) gives the copy no start, so
    // the copy is never refused as START_AFTER_DUE; it is named in `skipped`.
    const lead = source.startDate && source.dueDate ? daysBetween(new Date(`${source.startDate}T00:00:00Z`), new Date(`${source.dueDate}T00:00:00Z`)) : null;
    const startDate = lead !== null && lead >= 0 ? dayKey(addDays(plan.make.on, -lead)) : null;
    const startSkipped = lead !== null && lead < 0 ? ['startDate:afterDue'] : [];
    // Waiting on (2.4b, owner decision 106): the copy takes its source's,
    // while that person is an active member; otherwise none, named in `skipped`.
    const waiting = source.waitingOnUserId;
    const waitingActive = waiting ? (await MembershipRepository.listActiveUserIds(db, owner, [waiting])).has(waiting) : false;
    const skipped = [...(waiting && !waitingActive ? [...projected.skipped, `waitingOn:${waiting}`] : projected.skipped), ...startSkipped];
    const item = await createWorkItemInTx(
        db,
        owner,
        {
            projectId: found.projectId,
            typeId: projected.typeId ?? source.typeId,
            title: projected.title,
            description: projected.description,
            priority: projected.priority,
            labelIds: projected.labelIds,
            assigneeId: projected.assigneeId,
            dueDate: projected.dueDate,
            startDate,
            milestoneId: projected.milestoneId,
            customFields: projected.customFields,
            waitingOnUserId: waitingActive ? waiting : null,
        },
        {
            // Every value is the source's (2.4b-b, decision 111): a hidden one is skipped and named.
            projected: 'all',
            recurrenceId: rule.id,
            occurrenceOn,
            subItems: projected.subItems,
            metadata: {
                recurrenceId: rule.id,
                occurrenceOn,
                ...(skipped.length ? { skipped: [...skipped] } : {}),
                ...(plan.skipped ? { skippedOccurrences: plan.skipped } : {}),
            },
        },
    );
    if (plan.following === null) {
        await logEvent(db, owner, {
            action: 'RECURRENCE_ENDED',
            entityType: 'WorkItemRecurrence',
            entityId: rule.id,
            details: `A repeat made its last occurrence (${occurrenceOn})`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemRecurrence', operation: 'updated', summary: 'RECURRENCE_ENDED' },
            metadata: { sourceWorkItemId: rule.sourceWorkItemId, occurrenceOn },
        });
    }
    return { kind: 'created', item, owner, skipped: plan.skipped };
}

/** One rule, end to end: resolve the owner, then make the occurrence or hold the rule. */
export async function runRecurrenceRule(sys: RequestContext, rule: RecurrenceRow, today: Date): Promise<RuleOutcome> {
    const owner = await resolveMemberContext({ tenantId: sys.tenantId, userId: rule.ownerUserId, job: 'work-item-recurrence', discriminator: rule.id });
    let outcome: RuleOutcome;
    if (!owner) outcome = { kind: 'hold', reason: 'OWNER_NOT_ACTIVE' };
    else if (!mayCreateWorkItems(owner)) outcome = { kind: 'hold', reason: 'OWNER_NOT_PERMITTED' };
    // The copy's sub-items (up to 50) are made in the claim's transaction.
    else {
        try {
            outcome = await runInTenantContext(owner, (db) => makeOccurrenceInTx(db, owner, rule, today), { timeout: 20_000 });
        } catch (err) {
            // A copy that would break its type's field set holds the repeat with
            // its reason (2.4b-b, decision 111) instead of failing every night;
            // the claim rolled back with it, so a resume makes this occurrence.
            if (!isFieldSetRefusal(err)) throw err;
            outcome = { kind: 'hold', reason: 'FIELD_SET_UNMET' };
        }
    }
    if (outcome.kind === 'hold') await holdRule(sys, rule, outcome.reason);
    if (outcome.kind === 'created') await emitCreatedItemBells(outcome.owner, outcome.item);
    return outcome;
}

/** Every due rule of one workspace; `sys` is its system user, which only reads and holds. */
export async function runWorkspaceRecurrences(sys: RequestContext, today: Date): Promise<RecurrenceRunResult> {
    const result: RecurrenceRunResult = { rules: 0, created: 0, held: 0, raced: 0, skippedOccurrences: 0, failed: 0 };
    const horizon = addDays(today, RECURRENCE_LIMITS.leadDays.max);
    const rules = await runInTenantContext(sys, (db) => RecurrenceRepository.due(db, sys, horizon));
    for (const rule of rules) {
        if (addDays(rule.nextOccurrenceOn!, -rule.leadDays).getTime() > today.getTime()) continue;
        result.rules += 1;
        let outcome: RuleOutcome;
        try {
            // guardrail-allow: n+1 — one transaction per rule, as its own owner, so one rule's failure leaves the others' copies committed.
            outcome = await runRecurrenceRule(sys, rule, today);
        } catch (err) {
            // The claim rolled back with the copy: the next run tries again.
            result.failed += 1;
            logger.error('a repeat could not make its occurrence', {
                component: 'jobs',
                tenantId: sys.tenantId,
                recurrenceId: rule.id,
                error: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        if (outcome.kind === 'created') {
            result.created += 1;
            result.skippedOccurrences += outcome.skipped;
        } else if (outcome.kind === 'hold') result.held += 1;
        else result.raced += 1;
    }
    return result;
}
