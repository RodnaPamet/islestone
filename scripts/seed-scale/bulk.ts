/**
 * The bulk half of the scale seed (Hardening H2a; docs/porting/maps/H2.md
 * part 1.1; owner decision 171): every item but the 1 % sample, written as
 * the database superuser in batches of 5,000 multi-row inserts, each batch in
 * one transaction:
 *
 *   - the batch's numbers claimed from `ProjectKeySequence` in its own
 *     transaction (`lastValue + n … RETURNING`), so keys stay gapless and the
 *     sample created afterwards continues the sequence;
 *   - `sortKey` from `fractional-index.ts`, spread over the project;
 *   - descriptions and comment bodies sanitised as the usecases sanitise them
 *     and encrypted with the workspace's data key by the real field-encryption
 *     function (`encryptWithKey`, the `v2:` envelope the middleware writes); a
 *     plaintext row would make every read fail closed;
 *   - `SearchVector` rows computed by PostgreSQL through the search seam's bulk
 *     path (`SearchVectorRepository.insertBulkForSeed`: the same
 *     `searchableText`, the same `islestone_bg_en` configuration);
 *   - `WorkItemTransition` rows written by their trigger as the items land, and
 *     `priorityRank` by its trigger;
 *   - a BLOCKS edge into a later batch written with that batch, once its
 *     target exists (a parent is always in an earlier batch or the same one).
 *
 * No audit entries for these rows: the sample carries real ones (part 1.5 of
 * the map says what that leaves unmeasured). Every write inserts new rows;
 * nothing updates an existing item, so decision 173's lock order has nothing
 * to order (the sequence row is the only row updated, and it is taken first).
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { keysBetween } from '../../src/app-layer/domain/fractional-index';
import { SearchVectorRepository, SEED_BULK_MAX } from '../../src/app-layer/repositories/SearchVectorRepository';
import { encryptWithKey } from '../../src/lib/security/encryption';
import { sanitizePlainText } from '../../src/lib/security/sanitize';
import { getTenantDek } from '../../src/lib/security/tenant-key-manager';

import type { ItemPlan } from './plan';
import { isClosedState } from './plan';
import { stream } from './random';
import type { SeedEnv, SeedProject, SeedWorkspace } from './workspace';
import { DAY_MS } from './workspace';
import { estimateFor } from './workload';

export const BATCH_SIZE = 5_000;
const TX = { timeout: 600_000, maxWait: 60_000 } as const;

export interface BulkResult {
    /** Item id by plan index (bulk items only). */
    ids: string[];
    /** Whether the item at that index is deleted. */
    deleted: boolean[];
    items: number;
    comments: number;
    vectors: number;
}

const chunk = <T>(rows: readonly T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
    return out;
};

/** Write the first `count` planned items of a project in bulk. */
export async function seedProjectBulk(
    env: SeedEnv,
    bulk: PrismaClient,
    ws: SeedWorkspace,
    project: SeedProject,
    plans: readonly ItemPlan[],
    count: number,
): Promise<BulkResult> {
    const dek = await getTenantDek(ws.tenantId);
    const rng = stream(env.seed, `${ws.slug}:bulk:${project.keyPrefix}`);
    const team = ws.teams.find((t) => t.id === project.teamId)!;
    const sortKeys = keysBetween(null, null, count);
    const ids = plans.slice(0, count).map(() => rng.id());
    const deletionIds: Array<string | null> = [];
    const deleted: boolean[] = [];
    const enc = (text: string) => encryptWithKey(dek, text);
    let comments = 0;
    let vectors = 0;
    // An edge to a later batch's item waits until that item exists (its FK).
    let deferred: Prisma.WorkItemRelationCreateManyInput[] = [];
    const indexOf = new Map(ids.map((id, i) => [id, i] as const));

    for (const batch of chunk(plans.slice(0, count), env.batchSize)) {
        const batchEnd = batch[batch.length - 1]!.index;
        const items: Prisma.WorkItemCreateManyInput[] = [];
        const labels: Prisma.WorkItemLabelCreateManyInput[] = [];
        const watchers: Prisma.WorkItemWatcherCreateManyInput[] = [];
        const values: Prisma.CustomFieldValueCreateManyInput[] = [];
        const relations: Prisma.WorkItemRelationCreateManyInput[] = [];
        const commentRows: Prisma.CommentCreateManyInput[] = [];
        const sources: Array<{ workItemId: string; commentId: string | null; plaintext: string | null }> = [];

        // The batch's numbers, claimed from the project's sequence before its items.
        const claimed = await bulk.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
                UPDATE "ProjectKeySequence" SET "lastValue" = "lastValue" + ${batch.length}, "updatedAt" = now()
                 WHERE "projectId" = ${project.id} AND "tenantId" = ${ws.tenantId}
             RETURNING "lastValue"`;
            if (rows.length !== 1) throw new Error(`seed-scale: no key sequence for ${project.keyPrefix}`);
            return rows[0]!.lastValue - batch.length;
        }, TX);

        for (const [b, plan] of batch.entries()) {
            const i = plan.index;
            const id = ids[i]!;
            const state = team.states[plan.state]!;
            const creator = ws.writers[plan.creator]!.userId;
            const isDeleted = plan.deletedAt !== null;
            const deletionId = isDeleted ? (plan.parent !== null && deleted[plan.parent] ? deletionIds[plan.parent]! : rng.id()) : null;
            deletionIds.push(deletionId);
            deleted.push(isDeleted);
            const description = plan.description === null ? null : sanitizePlainText(plan.description);
            const startedAt = state.category === 'STARTED' || state.category === 'DONE' ? new Date(plan.createdAt.getTime() + DAY_MS) : null;
            items.push({
                id,
                tenantId: ws.tenantId,
                teamId: project.teamId,
                projectId: project.id,
                number: claimed + b + 1,
                typeId: ws.typeIds[plan.type % ws.typeIds.length]!,
                title: sanitizePlainText(plan.title),
                description: description === null ? null : enc(description),
                stateId: state.id,
                stateCategory: state.category,
                priority: plan.priority,
                assigneeId: plan.assignee === null ? null : ws.writers[plan.assignee]!.userId,
                waitingOnUserId: plan.waitingOn === null || isClosedState(plan.state) ? null : ws.members[plan.waitingOn]!.userId,
                createdByUserId: creator,
                parentId: plan.parent === null ? null : ids[plan.parent]!,
                sortKey: sortKeys[i]!,
                startDate: plan.startDate ? new Date(`${plan.startDate}T00:00:00Z`) : null,
                dueDate: plan.dueDate ? new Date(`${plan.dueDate}T00:00:00Z`) : null,
                // Sub-phase 3.5b: an estimate in the team's unit, from its own stream.
                ...estimateFor(env.seed, ws.slug, project.keyPrefix, plan.index, team.estimateUnit),
                startedAt: startedAt && startedAt.getTime() <= plan.updatedAt.getTime() ? startedAt : startedAt ? plan.updatedAt : null,
                completedAt: state.category === 'DONE' ? plan.updatedAt : null,
                cancelledAt: state.category === 'CANCELLED' ? plan.updatedAt : null,
                cycleId: plan.cycle === null ? null : team.cycles[plan.cycle]!.id,
                milestoneId: plan.milestone === null ? null : project.milestones[plan.milestone]!,
                createdAt: plan.createdAt,
                updatedAt: plan.updatedAt,
                deletedAt: plan.deletedAt,
                deletedByUserId: isDeleted ? creator : null,
                deletionId,
            });
            if (description) sources.push({ workItemId: id, commentId: null, plaintext: description });
            for (const l of plan.labels) labels.push({ tenantId: ws.tenantId, workItemId: id, labelId: ws.labelIds[l]!, createdAt: plan.createdAt });
            if (plan.watcher !== null) watchers.push({ tenantId: ws.tenantId, workItemId: id, userId: ws.members[plan.watcher]!.userId, createdAt: plan.createdAt });
            for (const [f, value] of plan.fields.entries()) {
                if (value === undefined) continue;
                const field = project.fields[f]!;
                const row: Prisma.CustomFieldValueCreateManyInput = {
                    id: rng.id(),
                    tenantId: ws.tenantId,
                    projectId: project.id,
                    workItemId: id,
                    fieldId: field.id,
                    fieldType: field.type,
                    createdAt: plan.createdAt,
                };
                if ('optionIndex' in value) row.optionId = field.options[value.optionIndex]!;
                else if ('number' in value) row.numberValue = value.number;
                else if ('date' in value) row.dateValue = new Date(`${value.date}T00:00:00Z`);
                else if ('memberIndex' in value) row.userId = ws.writers[value.memberIndex]!.userId;
                else row.textValue = sanitizePlainText(value.text);
                values.push(row);
            }
            for (const to of plan.blocks) {
                // Edges to the sample are the sample's to make (it is written after).
                if (to >= count) continue;
                relations.push({ id: rng.id(), tenantId: ws.tenantId, type: 'BLOCKS', fromId: id, toId: ids[to]!, createdByUserId: creator, createdAt: plan.createdAt });
            }
            for (const c of plan.comments) {
                const commentId = rng.id();
                const body = sanitizePlainText(c.body);
                commentRows.push({
                    id: commentId,
                    tenantId: ws.tenantId,
                    workItemId: id,
                    authorUserId: ws.writers[c.author]!.userId,
                    body: enc(body),
                    createdAt: c.createdAt,
                    updatedAt: c.createdAt,
                });
                sources.push({ workItemId: id, commentId, plaintext: body });
            }
        }

        const ready = [...deferred, ...relations].filter((r) => indexOf.get(r.toId)! <= batchEnd);
        deferred = [...deferred, ...relations].filter((r) => indexOf.get(r.toId)! > batchEnd);

        await bulk.$transaction(async (tx) => {
            await tx.workItem.createMany({ data: items });
            if (labels.length) await tx.workItemLabel.createMany({ data: labels });
            if (watchers.length) await tx.workItemWatcher.createMany({ data: watchers });
            if (values.length) await tx.customFieldValue.createMany({ data: values });
            if (ready.length) await tx.workItemRelation.createMany({ data: ready });
            if (commentRows.length) await tx.comment.createMany({ data: commentRows });
            for (const part of chunk(sources, SEED_BULK_MAX)) {
                vectors += await SearchVectorRepository.insertBulkForSeed(tx, ws.owner, part);
            }
        }, TX);
        comments += commentRows.length;
    }
    if (deferred.length) throw new Error(`seed-scale: ${deferred.length} relations of ${project.keyPrefix} point past its items`);
    env.log(`    ${project.keyPrefix}: ${count} items, ${comments} comments, ${vectors} vectors (bulk)`);
    return { ids, deleted, items: count, comments, vectors };
}
