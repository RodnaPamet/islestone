/**
 * A work item's estimate (sub-phase 3.4a; docs/porting/maps/3.4.md,
 * "Estimates (3.4a)"; ADR 0012 §1; ADR 0002 §18; owner decisions 257 to 259).
 *
 *   - The item's team's CURRENT unit decides the column: `estimatePoints`
 *     (whole points, 0 to 100) or `estimateMinutes` (0 to 60,000). A write
 *     sets only that column; the other is kept, hidden and uncounted, so a
 *     team that switches back finds its old values. A team that does not
 *     estimate takes no write (409 `ESTIMATES_OFF`, clearing included). A
 *     request may name the unit it means; another than the team's current
 *     one is 400 `ESTIMATE_UNIT`, so a value typed under one unit is never
 *     written under another after the team changed it.
 *   - A single-field change (`If-Match` optional, the version increases)
 *     under `work_items.edit`, on open and closed items alike, through the
 *     field set (a hidden estimate is 400 `FIELD_HIDDEN`, clearing a required
 *     one on an open item 400 `FIELD_SET_UNMET`).
 *   - Audited `WORK_ITEM_ESTIMATE_CHANGED` with the unit and the old and new
 *     values (numbers, never text); the transition trigger records the
 *     change (the burn-up's Points and Hours read it); after the commit, the
 *     watcher fan-out. Only a person writes it in 3.4: an agent may propose
 *     one from roadmap 6.2 (ADR 0003 §4).
 *
 * Written fresh for Islestone.
 */
import type { EstimateUnit } from '@prisma/client';

import { logEvent } from '../events/audit';
import { assertFieldWrite } from './field-set';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanEditWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { getWorkItem } from './work-item';
import { emitWatcherActivity, keyOf, loadWritableItem, throwWriteConflict } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest } from '@/lib/errors/types';
import { estimateColumnOf, formatDuration, isValidEstimate, type EstimateColumns } from '@/lib/work-items/estimate';

/** 409 `ESTIMATES_OFF`: the item's team does not estimate. */
export function estimatesOff(): ConflictError {
    return new ConflictError("This item's team does not estimate. An admin turns estimates on in Settings → Teams.", { reason: 'ESTIMATES_OFF' });
}

/** 400 `ESTIMATE_UNIT`: a value in a unit the team does not use now. */
export function estimateUnitRefused(teamUnit: EstimateUnit): Error {
    return badRequest(`This item's team estimates in ${teamUnit === 'POINTS' ? 'points' : 'hours'}.`, { reason: 'ESTIMATE_UNIT', estimateUnit: teamUnit });
}

/** 400: a value out of the unit's range or not whole. */
function estimateOutOfRange(unit: EstimateUnit): Error {
    return badRequest(unit === 'POINTS' ? 'An estimate in points is a whole number from 0 to 100.' : 'An estimate in hours is whole minutes from 0 to 60,000 (1,000 hours).', {
        reason: 'ESTIMATE_RANGE',
    });
}

/**
 * The columns a create or a write sets for `value` under the team's `unit`,
 * after every refusal: off (409), another unit named (400), out of range
 * (400). `null` clears the current unit's column only.
 */
export function estimateWriteFor(unit: EstimateUnit | null, value: number | null, namedUnit?: EstimateUnit): Partial<EstimateColumns> {
    if (!unit) throw estimatesOff();
    if (namedUnit && namedUnit !== unit) throw estimateUnitRefused(unit);
    if (value !== null && !isValidEstimate(unit, value)) throw estimateOutOfRange(unit);
    return { [estimateColumnOf(unit)]: value };
}

/** A value for an audit line ("5 points", "2h 30m"). */
export function describeEstimate(unit: EstimateUnit, value: number | null): string {
    if (value === null) return 'none';
    return unit === 'POINTS' ? `${value} point${value === 1 ? '' : 's'}` : formatDuration(value);
}

/** Set the item's estimate in its team's current unit, or clear it (`null`). */
export async function setWorkItemEstimate(
    ctx: RequestContext,
    id: string,
    input: { value: number | null; unit?: EstimateUnit },
    expectedVersion?: number,
) {
    assertCanEditWorkItems(ctx);
    const result = await runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const item = await loadWritableItem(db, ctx, v, id);
        const unit = (await TeamRepository.estimateUnitOf(db, ctx, item.teamId)) ?? null;
        const patch = estimateWriteFor(unit, input.value, input.unit);
        const column = estimateColumnOf(unit!);
        const before = item[column];
        if (before === input.value) return { changed: false as const };
        await assertFieldWrite(db, ctx, item, { estimate: input.value });
        const count = await WorkItemRepository.updateVersioned(db, ctx, v, id, expectedVersion, patch);
        if (count === 0) await throwWriteConflict(db, ctx, v, id);
        const detail = `estimate ${describeEstimate(unit!, input.value)}`;
        await logEvent(db, ctx, {
            action: 'WORK_ITEM_ESTIMATE_CHANGED',
            entityType: 'WorkItem',
            entityId: id,
            details: `Set the estimate of ${keyOf(item)} to ${describeEstimate(unit!, input.value)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItem', operation: 'updated', changedFields: [column] },
            metadata: { estimateUnit: unit, from: before, to: input.value },
        });
        return { changed: true as const, detail };
    });
    const after = await getWorkItem(ctx, id);
    if (result.changed) {
        await emitWatcherActivity(ctx, [{ workItemId: id, kind: 'updated', discriminator: `v${after.version}`, detail: result.detail }]);
    }
    return after;
}
