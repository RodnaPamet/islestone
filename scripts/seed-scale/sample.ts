/**
 * The 1 % sample of the scale seed (Hardening H2a; owner decision 171): the
 * last items of each project's plan, written through the usecases as their
 * planned creators, so they carry what only the application writes: audit
 * entries in the hash chain, search vectors through the seam, transitions,
 * watchers, notifications and the Activity feed's history. The plan is the
 * bulk items' plan, so the sample looks like the rest.
 *
 * Where a usecase refuses what the bulk writer may store (a closed cycle, a
 * deleted parent), the sample leaves the field out rather than bypass the
 * rule; a refusal of anything else fails the seed.
 */
import { createWorkItem } from '../../src/app-layer/usecases/work-item';
import { addComment } from '../../src/app-layer/usecases/work-item-collab';
import { addWorkItemRelation } from '../../src/app-layer/usecases/work-item-relations';
import { sendWorkItemReview, setWorkItemReviewSteps } from '../../src/app-layer/usecases/review';

import type { BulkResult } from './bulk';
import type { FieldValue, ItemPlan } from './plan';
import { isClosedState } from './plan';
import { stream } from './random';
import { RATIOS } from './shapes';
import type { SeedEnv, SeedProject, SeedWorkspace } from './workspace';
import { contextOf } from './workspace';
import { estimateFor } from './workload';

export interface SampleResult {
    ids: string[];
    comments: number;
    relations: number;
    reviews: number;
}

function fieldInput(ws: SeedWorkspace, project: SeedProject, fields: ItemPlan['fields']): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    fields.forEach((value: FieldValue | undefined, f) => {
        if (value === undefined) return;
        const field = project.fields[f]!;
        if ('optionIndex' in value) out[field.id] = field.options[value.optionIndex]!;
        else if ('number' in value) out[field.id] = value.number;
        else if ('date' in value) out[field.id] = value.date;
        else if ('memberIndex' in value) out[field.id] = ws.writers[value.memberIndex]!.userId;
        else out[field.id] = value.text;
    });
    return out;
}

/** Write the planned items from `from` on through the usecases. */
export async function seedProjectSample(
    env: SeedEnv,
    ws: SeedWorkspace,
    project: SeedProject,
    plans: readonly ItemPlan[],
    from: number,
    bulk: BulkResult,
): Promise<SampleResult> {
    const team = ws.teams.find((t) => t.id === project.teamId)!;
    const live = bulk.ids.filter((_, i) => !bulk.deleted[i]);
    const ids: string[] = [];
    let comments = 0;
    let relations = 0;
    let reviews = 0;
    const reviewRng = stream(env.seed, `${ws.slug}:reviews:${project.keyPrefix}`);
    for (const plan of plans.slice(from)) {
        const creator = await contextOf(ws, ws.writers[plan.creator]!);
        const state = team.states[plan.state]!;
        const cycle = plan.cycle === null ? null : team.cycles[plan.cycle]!;
        const parent = plan.parent !== null && plan.parent < from && !bulk.deleted[plan.parent] ? bulk.ids[plan.parent]! : null;
        const item = await createWorkItem(creator, {
            projectId: project.id,
            typeId: ws.typeIds[plan.type % ws.typeIds.length]!,
            title: plan.title,
            description: plan.description,
            stateId: state.id,
            priority: plan.priority,
            assigneeId: plan.assignee === null ? null : ws.writers[plan.assignee]!.userId,
            parentId: parent,
            labelIds: plan.labels.map((l) => ws.labelIds[l]!),
            startDate: plan.startDate,
            dueDate: plan.dueDate,
            // Sub-phase 3.5b: an estimate in the team's unit, from its own stream.
            ...estimateFor(env.seed, ws.slug, project.keyPrefix, plan.index, team.estimateUnit),
            customFields: fieldInput(ws, project, plan.fields),
            // A completed cycle takes no new items (2.5a).
            cycleId: cycle && !cycle.past ? cycle.id : null,
            milestoneId: plan.milestone === null ? null : project.milestones[plan.milestone]!,
            waitingOnUserId: plan.waitingOn === null || isClosedState(plan.state) ? null : ws.members[plan.waitingOn]!.userId,
        });
        ids.push(item.id);
        for (const c of plan.comments) {
            await addComment(await contextOf(ws, ws.writers[c.author]!), item.id, { body: c.body });
            comments++;
        }
        // The sample blocks earlier bulk items only, so no edge can close a cycle
        // (bulk edges run from an earlier item to a later one, never into the sample).
        const targets = new Set<string>();
        for (const to of plan.blocks) {
            if (live.length === 0) break;
            const toId = live[to % live.length]!;
            if (targets.has(toId)) continue;
            targets.add(toId);
            await addWorkItemRelation(creator, item.id, { type: 'BLOCKS', toId });
            relations++;
        }
        // Some open items are out for review (2.8): one step, two reviewers who are not
        // the assignee, the heavy member among them half the time ("To review").
        if (!isClosedState(plan.state) && reviewRng.chance(RATIOS.inReview)) {
            const assignee = plan.assignee === null ? null : ws.writers[plan.assignee]!.userId;
            const pool = ws.writers.filter((m) => m.userId !== assignee);
            const heavy = ws.writers[0]!;
            const reviewers = new Set<string>(reviewRng.sample(pool, 2).map((m) => m.userId));
            if (heavy.userId !== assignee && reviewRng.chance(0.5)) reviewers.add(heavy.userId);
            await setWorkItemReviewSteps(creator, item.id, {
                steps: [{ name: 'Review', mode: 'ALL', dueInWorkingDays: reviewRng.int(1, 5), memberIds: [...reviewers], recipientListIds: [] }],
            });
            await sendWorkItemReview(creator, item.id);
            reviews++;
        }
    }
    env.log(`    ${project.keyPrefix}: ${ids.length} items, ${comments} comments, ${relations} relations, ${reviews} reviews sent (usecases)`);
    return { ids, comments, relations, reviews };
}
