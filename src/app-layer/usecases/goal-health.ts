/**
 * A goal's and an initiative's health, set by a person (sub-phase 3.2b;
 * docs/porting/maps/3.2.md, "Health, set by a person"; ADR 0002 §17; owner
 * decisions 205, 206, 207 and 214).
 *
 *   - On track, At risk, Off track or Completed, or `null`: "No health set".
 *   - **A person's act only** (decision 214): an API key, an agent and a job
 *     are refused with the same hash-chained `AUTHZ_DENIED` entry a
 *     `requirePermission` denial writes, then a 403 (`NOT_A_PERSON`).
 *   - **Never computed and never tied to the status** (decision 205):
 *     setting health changes nothing else, and nothing else changes health.
 *     No combination of status and health is refused.
 *   - Recorded on the row (`health`, `healthSetAt`, `healthSetByUserId`) and
 *     audited `GOAL_HEALTH_SET` / `INITIATIVE_HEALTH_SET` with the old and new
 *     values; the page's history reads those entries (decision 207: no
 *     written update). Setting the value it already has records it again, a
 *     person confirming it.
 *   - Archived: 409 `ARCHIVED`; deleted: 404.
 *
 * Written fresh for Islestone.
 */
import type { Health } from '@prisma/client';

import { logEvent } from '../events/audit';
import { ActivityRepository } from '../repositories/ActivityRepository';
import { GoalRepository } from '../repositories/GoalRepository';
import { InitiativeRepository } from '../repositories/InitiativeRepository';
import { assertCanManageGoals, setsHealthAsPerson } from '../policies/goal.policies';
import { NOT_A_PERSON } from '../policies/person-only.policies';
import { goalNotFound, initiativeNotFound, refuseArchived, toGoalDto, toInitiativeDto } from './goal-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';
import { appendAuditEntryOrQueue } from '@/lib/audit';
import { ConflictError, forbidden } from '@/lib/errors/types';
import { HEALTH_VALUES } from '@/lib/schemas/goal';
import type { GoalData, HealthHistoryEntry, HealthValue, InitiativeData } from '@/lib/goals/types';

/** The health history a page shows, newest first. */
export const HEALTH_HISTORY_TAKE = 50;

async function refuseNotAPerson(ctx: RequestContext, entity: 'Goal' | 'Initiative', id: string): Promise<never> {
    await appendAuditEntryOrQueue({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        actorType: ctx.apiKeyId ? 'API_KEY' : (ctx.actorType ?? 'USER'),
        entity,
        entityId: id,
        action: 'AUTHZ_DENIED',
        details: `${entity} health refused: not a person`,
        detailsJson: { category: 'access', event: 'authz_denied', reason: NOT_A_PERSON, role: ctx.role },
        requestId: ctx.requestId,
        metadataJson: { role: ctx.role, verb: 'set_health', reason: NOT_A_PERSON },
    });
    throw forbidden('Health is set by a signed-in person, never by an API key, an agent or a job.', { reason: NOT_A_PERSON });
}

function healthOf(raw: unknown): HealthValue | null {
    return typeof raw === 'string' && (HEALTH_VALUES as readonly string[]).includes(raw) ? (raw as HealthValue) : null;
}

/** The audit entries of `GOAL_HEALTH_SET` / `INITIATIVE_HEALTH_SET` as history rows (values only). */
export async function healthHistoryInTx(db: PrismaTx, ctx: RequestContext, entity: 'Goal' | 'Initiative', id: string): Promise<HealthHistoryEntry[]> {
    const rows = await ActivityRepository.healthHistory(db, ctx, entity, id, HEALTH_HISTORY_TAKE);
    return rows.map((r) => {
        const m = (r.metadataJson ?? {}) as Record<string, unknown>;
        return { id: r.id, health: healthOf(m.toHealth), previous: healthOf(m.fromHealth), setByUserId: r.userId, setAt: r.createdAt };
    });
}

function versionConflict(entity: 'goal' | 'initiative', current: GoalData | InitiativeData): never {
    throw new ConflictError(`The ${entity} changed since you read it.`, { reason: 'VERSION_CONFLICT', version: current.version, [entity]: current });
}

/** Set (or clear) a goal's health: a person holding `goals.manage` (decision 214). */
export async function setGoalHealth(ctx: RequestContext, id: string, health: Health | null, expectedVersion?: number): Promise<GoalData> {
    assertCanManageGoals(ctx);
    if (!setsHealthAsPerson(ctx)) await refuseNotAPerson(ctx, 'Goal', id);
    return runInTenantContext(ctx, async (db) => {
        const goal = await GoalRepository.getAny(db, ctx, id);
        if (!goal || goal.deletedAt) goalNotFound();
        if (goal.archivedAt) refuseArchived('goal');
        const count = await GoalRepository.updateVersioned(db, ctx, goal.id, expectedVersion, { health, healthSetAt: new Date(), healthSetByUserId: ctx.userId });
        if (count === 0) {
            const current = await GoalRepository.getAny(db, ctx, goal.id);
            if (!current || current.deletedAt) goalNotFound();
            versionConflict('goal', toGoalDto(current));
        }
        await logEvent(db, ctx, {
            action: 'GOAL_HEALTH_SET',
            entityType: 'Goal',
            entityId: goal.id,
            details: `Set the health of goal ${goal.title}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Goal', operation: 'updated', changedFields: ['health'] },
            metadata: { fromHealth: goal.health, toHealth: health },
        });
        return toGoalDto((await GoalRepository.getAny(db, ctx, goal.id))!);
    });
}

/** Set (or clear) an initiative's health: a person holding `goals.manage` (decisions 206, 214). */
export async function setInitiativeHealth(ctx: RequestContext, id: string, health: Health | null, expectedVersion?: number): Promise<InitiativeData> {
    assertCanManageGoals(ctx);
    if (!setsHealthAsPerson(ctx)) await refuseNotAPerson(ctx, 'Initiative', id);
    return runInTenantContext(ctx, async (db) => {
        const row = await InitiativeRepository.getAny(db, ctx, id);
        if (!row || row.deletedAt) initiativeNotFound();
        if (row.archivedAt) refuseArchived('initiative');
        const count = await InitiativeRepository.updateVersioned(db, ctx, row.id, expectedVersion, { health, healthSetAt: new Date(), healthSetByUserId: ctx.userId });
        if (count === 0) {
            const current = await InitiativeRepository.getAny(db, ctx, row.id);
            if (!current || current.deletedAt) initiativeNotFound();
            versionConflict('initiative', toInitiativeDto(current));
        }
        await logEvent(db, ctx, {
            action: 'INITIATIVE_HEALTH_SET',
            entityType: 'Initiative',
            entityId: row.id,
            details: `Set the health of initiative ${row.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Initiative', operation: 'updated', changedFields: ['health'] },
            metadata: { fromHealth: row.health, toHealth: health },
        });
        return toInitiativeDto((await InitiativeRepository.getAny(db, ctx, row.id))!);
    });
}
