/**
 * Repeats, set by a person (sub-phase 2.5d; docs/porting/maps/2.5.md; owner
 * decisions 67 to 70).
 *
 * - One repeat per item, set on an item with a due date: the series' first
 *   date is that due date (occurrence 1 is the item itself). Setting,
 *   changing, holding or resuming takes `work_items.create` and
 *   `work_items.edit`; stopping takes `work_items.edit`.
 * - Whoever sets or resumes a running repeat becomes its owner: the nightly
 *   `work-item-recurrence` job makes each copy as them, re-resolved
 *   (`recurrence-run.ts`). The request never makes an occurrence; it stamps
 *   the next one, after the first date and not before today (in
 *   `NOTIFICATIONS_TZ`), so resuming skips what fell due while on hold.
 * - Stopping a repeat deletes the rule; its earlier items stay (the item's
 *   link is `ON DELETE SET NULL ("recurrenceId")`).
 *
 * Every write is audited. Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { RecurrenceRepository, type RecurrenceRow } from '../repositories/RecurrenceRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { assertCanSetRepeats } from '../policies/recurrence.policies';
import { assertCanEditWorkItems, assertCanReadWorkItems } from '../policies/work-item.policies';
import { visibleProjects } from '../policies/project-visibility';
import { dayKey, fromDayKey } from '../domain/cycle';
import { nextOccurrenceFrom, type RecurrenceRule } from '../domain/recurrence';
import { formatKey } from '../domain/work-item-key';
import { todayInTz } from '../notifications/work-item-due';
import { keyOf, loadWritableItem, notificationsTz } from './work-item-shared';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import type { SetRecurrenceInput } from '@/lib/schemas/recurrence';
import type { RecurrenceData, WorkItemSeriesData } from '@/lib/work-items/types';

export function toRecurrenceData(row: RecurrenceRow): RecurrenceData {
    return {
        id: row.id,
        frequency: row.frequency,
        interval: row.interval,
        weekdays: [...row.weekdays].sort((a, b) => a - b),
        firstOn: dayKey(row.firstOn),
        endsOn: row.endsOn ? dayKey(row.endsOn) : null,
        maxOccurrences: row.maxOccurrences,
        leadDays: row.leadDays,
        nextOccurrenceOn: row.nextOccurrenceOn ? dayKey(row.nextOccurrenceOn) : null,
        occurrenceCount: row.occurrenceCount,
        ownerUserId: row.ownerUserId,
        heldAt: row.heldAt ? row.heldAt.toISOString() : null,
        heldReason: row.heldReason,
    };
}

/** The domain rule of a stored row. */
export function ruleOf(row: Pick<RecurrenceRow, 'frequency' | 'interval' | 'weekdays' | 'firstOn' | 'endsOn' | 'maxOccurrences'>): RecurrenceRule {
    return { frequency: row.frequency, interval: row.interval, weekdays: row.weekdays, firstOn: row.firstOn, endsOn: row.endsOn, maxOccurrences: row.maxOccurrences };
}

/** An item's place in a series: the repeat set on it, and the series it is an occurrence of. */
export async function getWorkItemSeries(ctx: RequestContext, itemId: string): Promise<WorkItemSeriesData> {
    assertCanReadWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await WorkItemRepository.getById(db, ctx, await visibleProjects(ctx, db), itemId);
        if (!item) throw notFound('Work item not found');
        const rule = await RecurrenceRepository.getBySource(db, ctx, item.id);
        let occurrenceOf: WorkItemSeriesData['occurrenceOf'] = null;
        if (item.recurrenceId) {
            const series = await RecurrenceRepository.sourceOf(db, ctx, item.recurrenceId);
            if (series && !series.source.deletedAt) {
                occurrenceOf = {
                    id: series.source.id,
                    key: formatKey(series.source.project.keyPrefix, series.source.number),
                    occurrenceOn: item.occurrenceOn ? dayKey(item.occurrenceOn) : null,
                };
            }
        }
        return { rule: rule ? toRecurrenceData(rule) : null, occurrenceOf };
    });
}

/**
 * Set, change, hold or resume the repeat on an item. A running repeat's
 * owner becomes the caller and its next date is recomputed from the item's
 * due date and today; a hold keeps the owner. Never makes an occurrence.
 */
export async function setWorkItemRecurrence(ctx: RequestContext, itemId: string, input: SetRecurrenceInput): Promise<RecurrenceData> {
    assertCanSetRepeats(ctx);
    if (input.endsOn && input.maxOccurrences) throw badRequest('Give an end date or a number of times, not both.');
    const today = todayInTz(new Date(), notificationsTz());
    return runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), itemId);
        if (!item.dueDate) {
            throw new ConflictError('Give the work item a due date first: a repeat counts from it.', { reason: 'RECURRENCE_NEEDS_DUE_DATE' });
        }
        const firstOn = item.dueDate;
        const endsOn = input.endsOn ? fromDayKey(input.endsOn) : null;
        if (endsOn && endsOn.getTime() <= firstOn.getTime()) throw badRequest('A repeat ends after the work item is due.');
        const weekdays = input.frequency === 'WEEKLY' ? [...new Set(input.weekdays)].sort((a, b) => a - b) : [];
        const rule: RecurrenceRule = { frequency: input.frequency, interval: input.interval, weekdays, firstOn, endsOn, maxOccurrences: input.maxOccurrences ?? null };
        const existing = await RecurrenceRepository.getBySource(db, ctx, item.id);
        const hold = input.onHold === true;
        const now = new Date();
        const next = nextOccurrenceFrom(rule, today);
        const data = {
            frequency: rule.frequency,
            interval: rule.interval,
            weekdays,
            firstOn,
            endsOn,
            maxOccurrences: rule.maxOccurrences,
            leadDays: input.leadDays,
            nextOccurrenceOn: next?.on ?? null,
            // A hold keeps the rule's owner; running it again makes the caller its owner (decision 70).
            ownerUserId: hold && existing ? existing.ownerUserId : ctx.userId,
            heldAt: hold ? (existing?.heldAt ?? now) : next ? null : now,
            heldReason: hold ? (existing?.heldReason === 'HELD_BY_MEMBER' || !existing?.heldReason ? ('HELD_BY_MEMBER' as const) : existing.heldReason) : next ? null : ('ENDED' as const),
        };
        let row: RecurrenceRow;
        if (existing) {
            await RecurrenceRepository.update(db, ctx, existing.id, data);
            row = (await RecurrenceRepository.getById(db, ctx, existing.id))!;
        } else {
            row = await RecurrenceRepository.create(db, ctx, item.id, data);
        }
        const action = !existing ? 'RECURRENCE_SET' : hold && !existing.heldAt ? 'RECURRENCE_HELD' : !hold && existing.heldAt && row.heldAt === null ? 'RECURRENCE_RESUMED' : 'RECURRENCE_UPDATED';
        await logEvent(db, ctx, {
            action,
            entityType: 'WorkItemRecurrence',
            entityId: row.id,
            details: `${action === 'RECURRENCE_SET' ? 'Set a repeat on' : action === 'RECURRENCE_HELD' ? 'Put on hold the repeat of' : action === 'RECURRENCE_RESUMED' ? 'Resumed the repeat of' : 'Changed the repeat of'} ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemRecurrence', operation: existing ? 'updated' : 'created', summary: action },
            metadata: {
                sourceWorkItemId: item.id,
                frequency: row.frequency,
                interval: row.interval,
                nextOccurrenceOn: row.nextOccurrenceOn ? dayKey(row.nextOccurrenceOn) : null,
                ownerUserId: row.ownerUserId,
                ...(row.heldReason ? { heldReason: row.heldReason } : {}),
            },
        });
        return toRecurrenceData(row);
    });
}

/** Stop a repeat: the rule goes; the items it made stay, no longer linked to it. */
export async function removeWorkItemRecurrence(ctx: RequestContext, itemId: string): Promise<{ removed: true }> {
    assertCanEditWorkItems(ctx);
    return runInTenantContext(ctx, async (db) => {
        const item = await loadWritableItem(db, ctx, await visibleProjects(ctx, db), itemId);
        const rule = await RecurrenceRepository.getBySource(db, ctx, item.id);
        if (!rule) throw notFound('This work item does not repeat.');
        await RecurrenceRepository.delete(db, ctx, rule.id);
        await logEvent(db, ctx, {
            action: 'RECURRENCE_REMOVED',
            entityType: 'WorkItemRecurrence',
            entityId: rule.id,
            details: `Stopped the repeat of ${keyOf(item)}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkItemRecurrence', operation: 'deleted', summary: 'RECURRENCE_REMOVED' },
            metadata: { sourceWorkItemId: item.id, occurrenceCount: rule.occurrenceCount },
        });
        return { removed: true as const };
    });
}
