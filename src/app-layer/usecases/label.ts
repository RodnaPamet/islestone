/**
 * Labels (sub-phase 2.1): workspace labels, or labels limited to one team.
 *
 * Deleting a label marks it "being deleted" first, so a concurrent attach is
 * refused with 409, then detaches it from its items in batches, increasing
 * each item's version (a label is part of what an item shows, ADR 0002 §9),
 * then deletes it (Kaneo's resumable label deletion,
 * `apps/api/src/label/deletion-lock.ts` at
 * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3; pattern only).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { LabelRepository } from '../repositories/LabelRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { keyBetween } from '../domain/fractional-index';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

export async function listLabels(ctx: RequestContext, opts: { teamId?: string } = {}) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, (db) => LabelRepository.list(db, ctx, opts));
}

export async function createLabel(ctx: RequestContext, input: { name: string; teamId?: string | null; color?: string | null }) {
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name).trim();
    const teamId = input.teamId ?? null;
    return runInTenantContext(ctx, async (db) => {
        if (teamId && !(await TeamRepository.getById(db, ctx, teamId))) throw notFound('Team not found');
        if (await LabelRepository.nameTaken(db, ctx, teamId, name)) {
            throw new ConflictError(`A label named ${name} already exists here.`, { reason: 'LABEL_NAME_TAKEN' });
        }
        const sortKey = keyBetween(await LabelRepository.lastSortKey(db, ctx), null);
        const label = await LabelRepository.create(db, ctx, { teamId, name, color: input.color ?? null, sortKey });
        await logEvent(db, ctx, {
            action: 'LABEL_CREATED',
            entityType: 'Label',
            entityId: label.id,
            details: `Created label ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Label', operation: 'created' },
            metadata: { teamId },
        });
        return label;
    });
}

export async function updateLabel(ctx: RequestContext, labelId: string, input: { name?: string; color?: string | null }) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const label = await LabelRepository.getById(db, ctx, labelId);
        if (!label || label.deletionStartedAt) throw notFound('Label not found');
        const data: { name?: string; color?: string | null } = {};
        if (input.name !== undefined) {
            data.name = sanitizePlainText(input.name).trim();
            if (await LabelRepository.nameTaken(db, ctx, label.teamId, data.name, labelId)) {
                throw new ConflictError(`A label named ${data.name} already exists here.`, { reason: 'LABEL_NAME_TAKEN' });
            }
        }
        if (input.color !== undefined) data.color = input.color;
        await LabelRepository.update(db, ctx, labelId, data);
        await logEvent(db, ctx, {
            action: 'LABEL_UPDATED',
            entityType: 'Label',
            entityId: labelId,
            details: `Updated label ${label.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Label', operation: 'updated', changedFields: Object.keys(data) },
        });
        return LabelRepository.getById(db, ctx, labelId);
    });
}

export async function deleteLabel(ctx: RequestContext, labelId: string) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const label = await LabelRepository.getById(db, ctx, labelId);
        if (!label) throw notFound('Label not found');
        await LabelRepository.markDeleting(db, ctx, labelId);
        let detached = 0;
        for (;;) {
            // guardrail-allow: n+1 — a batched drain: each pass reads one bounded batch and deletes it.
            const ids = await LabelRepository.attachedItemIds(db, ctx, labelId);
            if (ids.length === 0) break;
            // The batch locked in id order (batches ascend, so the whole
            // drain does too; decision 173), then detached and bumped.
            const locked = await WorkItemRepository.lockForWrite(db, ctx, ids);
            await LabelRepository.detachFrom(db, ctx, labelId, ids);
            // Every item the label was on, in any project: the version follows the row.
            await WorkItemRepository.bumpVersion(db, ctx, { kind: 'ALL' }, locked);
            detached += ids.length;
        }
        await LabelRepository.delete(db, ctx, labelId);
        await logEvent(db, ctx, {
            action: 'LABEL_DELETED',
            entityType: 'Label',
            entityId: labelId,
            details: `Deleted label ${label.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Label', operation: 'deleted' },
            metadata: { detachedFrom: detached },
        });
        return { deleted: true, detachedFrom: detached };
    });
}
