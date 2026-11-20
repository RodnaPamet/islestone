/**
 * Work item types (sub-phase 2.1, ADR 0002 §1). A workspace is seeded with
 * Feature, Bug and Chore (ADR 0006 open question 6) the first time it
 * creates a team or a project, so every existing workspace gets them without
 * a hook into workspace creation. An archived type is refused for new items
 * and kept on existing ones.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { FieldSetRepository } from '../repositories/FieldSetRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { keyBetween, keysBetween } from '../domain/fractional-index';
import { DEFAULT_WORK_ITEM_TYPES } from '../domain/workflow-state';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest, ConflictError, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { defaultRequirement } from '@/lib/work-items/field-sets';
import { QUESTION_TYPE_PRESET } from '@/lib/work-items/question-preset';

/** Seed the default types when the workspace has none (idempotent). */
export async function ensureDefaultWorkItemTypes(db: PrismaTx, ctx: RequestContext): Promise<void> {
    if ((await WorkItemTypeRepository.count(db, ctx)) > 0) return;
    const keys = keysBetween(null, null, DEFAULT_WORK_ITEM_TYPES.length);
    await WorkItemTypeRepository.createMany(
        db,
        ctx,
        DEFAULT_WORK_ITEM_TYPES.map((name, i) => ({ name, sortKey: keys[i]! })),
    );
}

export async function listWorkItemTypes(ctx: RequestContext, opts: { includeArchived?: boolean } = {}) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, (db) => WorkItemTypeRepository.list(db, ctx, opts));
}

export async function createWorkItemType(ctx: RequestContext, input: { name: string; icon?: string | null; color?: string | null }) {
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name).trim();
    return runInTenantContext(ctx, async (db) => {
        const sortKey = keyBetween(await WorkItemTypeRepository.lastSortKey(db, ctx), null);
        const type = await WorkItemTypeRepository.create(db, ctx, { name, icon: input.icon ?? null, color: input.color ?? null, sortKey });
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_CREATED',
            entityType: 'WorkItemType',
            entityId: type.id,
            details: `Created work item type ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemType', operation: 'created' },
        });
        return type;
    });
}

export async function updateWorkItemType(
    ctx: RequestContext,
    typeId: string,
    input: { name?: string; icon?: string | null; color?: string | null; archived?: boolean; position?: { afterId?: string; beforeId?: string } },
) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const type = await WorkItemTypeRepository.getById(db, ctx, typeId);
        if (!type) throw notFound('Work item type not found');
        const data: { name?: string; icon?: string | null; color?: string | null; sortKey?: string; archivedAt?: Date | null } = {};
        if (input.name !== undefined) data.name = sanitizePlainText(input.name).trim();
        if (input.icon !== undefined) data.icon = input.icon;
        if (input.color !== undefined) data.color = input.color;
        if (input.archived === true && !type.archivedAt) data.archivedAt = new Date();
        if (input.archived === false && type.archivedAt) data.archivedAt = null;
        if (input.position && (input.position.afterId || input.position.beforeId)) {
            const all = (await WorkItemTypeRepository.list(db, ctx, { includeArchived: true })).filter((t) => t.id !== typeId);
            const at = (id: string) => {
                const i = all.findIndex((t) => t.id === id);
                if (i === -1) throw badRequest('The position names an unknown type.');
                return i;
            };
            if (input.position.afterId) {
                const i = at(input.position.afterId);
                data.sortKey = keyBetween(all[i]!.sortKey, all[i + 1]?.sortKey ?? null);
            } else {
                const j = at(input.position.beforeId!);
                data.sortKey = keyBetween(all[j - 1]?.sortKey ?? null, all[j]!.sortKey);
            }
        }
        const changed = Object.keys(data);
        if (changed.length === 0) return type;
        await WorkItemTypeRepository.update(db, ctx, typeId, data);
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_UPDATED',
            entityType: 'WorkItemType',
            entityId: typeId,
            details: `Updated work item type ${type.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemType', operation: 'updated', changedFields: changed },
        });
        return WorkItemTypeRepository.getById(db, ctx, typeId);
    });
}

/**
 * "Add the Question type" (2.4b-c, decision 116): a type, named Question
 * unless the admin gives another name, with its field set (due date and
 * waiting on required, the answer shown), in one transaction under
 * `admin.manage`. Nothing is seeded; a name already taken is a 409
 * `TYPE_NAME_TAKEN`, so the admin can choose another.
 */
export async function addQuestionType(ctx: RequestContext, input: { name?: string } = {}) {
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name ?? QUESTION_TYPE_PRESET.name).trim();
    if (!name) throw badRequest('The type needs a name.');
    return runInTenantContext(ctx, async (db) => {
        const taken = (await WorkItemTypeRepository.list(db, ctx, { includeArchived: true })).some((t) => t.name.toLowerCase() === name.toLowerCase());
        if (taken) throw new ConflictError(`A type named ${name} already exists. Give the new type another name.`, { reason: 'TYPE_NAME_TAKEN' });
        const sortKey = keyBetween(await WorkItemTypeRepository.lastSortKey(db, ctx), null);
        const type = await WorkItemTypeRepository.create(db, ctx, { name, icon: null, color: null, sortKey });
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_TYPE_CREATED',
            entityType: 'WorkItemType',
            entityId: type.id,
            details: `Created work item type ${name} from the Question preset`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemType', operation: 'created' },
            metadata: { preset: 'question' },
        });
        for (const { field, requirement } of QUESTION_TYPE_PRESET.fields) {
            // guardrail-allow: n+1 — the preset's three rules, each a delete-then-insert.
            await FieldSetRepository.setBuiltIn(db, ctx, type.id, field, requirement === defaultRequirement(field) ? null : requirement);
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_TYPE_FIELD_SET',
                entityType: 'WorkItemType',
                entityId: type.id,
                details: `Set ${field} to ${requirement} for the type ${name}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemTypeField', operation: 'updated', changedFields: ['requirement'] },
                metadata: { field, requirement, preset: 'question' },
            });
        }
        return type;
    });
}
