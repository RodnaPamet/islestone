/**
 * Teams (sub-phase 2.1, ADR 0002 §3). Creating a team seeds its workflow in
 * the same transaction (Backlog; Todo, the default; In progress; In review;
 * Done; Cancelled), so a team always has one default state and at least one
 * DONE and one CANCELLED. Deleting a team is refused while it has projects.
 *
 * Written fresh for Islestone.
 */
import type { EstimateUnit } from '@prisma/client';

import { logEvent } from '../events/audit';
import { TeamRepository } from '../repositories/TeamRepository';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { DEFAULT_TEAM_WORKFLOW } from '../domain/workflow-state';
import { keysBetween } from '../domain/fractional-index';
import { ensureDefaultWorkItemTypes } from './work-item-type';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, badRequest, notFound } from '@/lib/errors/types';
import { sanitizePlainText } from '@/lib/security/sanitize';

export async function listTeams(ctx: RequestContext) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, (db) => TeamRepository.list(db, ctx));
}

export async function getTeam(ctx: RequestContext, teamId: string) {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const team = await TeamRepository.getById(db, ctx, teamId);
        if (!team) throw notFound('Team not found');
        const states = await TeamRepository.listStates(db, ctx, teamId, { includeArchived: true });
        return { ...team, workflowStates: states };
    });
}

export async function createTeam(ctx: RequestContext, input: { name: string }) {
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name).trim();
    return runInTenantContext(ctx, async (db) => {
        const team = await TeamRepository.create(db, ctx, name);
        const keys = keysBetween(null, null, DEFAULT_TEAM_WORKFLOW.length);
        await TeamRepository.createStates(
            db,
            ctx,
            DEFAULT_TEAM_WORKFLOW.map((s, i) => ({ teamId: team.id, name: s.name, category: s.category, isDefault: s.isDefault, sortKey: keys[i]! })),
        );
        await ensureDefaultWorkItemTypes(db, ctx);
        await logEvent(db, ctx, {
            action: 'TEAM_CREATED',
            entityType: 'Team',
            entityId: team.id,
            details: `Created team ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Team', operation: 'created', summary: 'TEAM_CREATED' },
            metadata: { seededStates: DEFAULT_TEAM_WORKFLOW.length },
        });
        const workflowStates = await TeamRepository.listStates(db, ctx, team.id);
        return { ...team, workflowStates };
    });
}

export async function renameTeam(ctx: RequestContext, teamId: string, input: { name: string }) {
    return updateTeam(ctx, teamId, input);
}

/**
 * Rename a team and/or set its estimate unit (3.4a, decision 257; ADR 0002
 * §18): `POINTS`, `HOURS`, or `null` (the team stops estimating). Changing the
 * unit moves no value: its items keep both columns, and only the current
 * unit's is shown, written and counted. Audited `TEAM_UPDATED` naming the
 * fields that changed (the unit's old and new values, which are not text).
 */
export async function updateTeam(ctx: RequestContext, teamId: string, input: { name?: string; estimateUnit?: EstimateUnit | null }) {
    assertCanManageWorkConfig(ctx);
    const name = input.name !== undefined ? sanitizePlainText(input.name).trim() : undefined;
    if (name === '') throw badRequest('A team needs a name.');
    return runInTenantContext(ctx, async (db) => {
        const before = await TeamRepository.getById(db, ctx, teamId);
        if (!before) throw notFound('Team not found');
        const data: { name?: string; estimateUnit?: EstimateUnit | null } = {};
        if (name !== undefined && name !== before.name) data.name = name;
        if (input.estimateUnit !== undefined && input.estimateUnit !== before.estimateUnit) data.estimateUnit = input.estimateUnit;
        const changedFields = Object.keys(data);
        if (changedFields.length === 0) return before;
        const result = await TeamRepository.update(db, ctx, teamId, data);
        if (result.count === 0) throw notFound('Team not found');
        await logEvent(db, ctx, {
            action: 'TEAM_UPDATED',
            entityType: 'Team',
            entityId: teamId,
            details: data.name !== undefined ? `Renamed team to ${data.name}` : `Changed how team ${before.name} estimates`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Team', operation: 'updated', changedFields },
            ...(data.estimateUnit !== undefined ? { metadata: { fromEstimateUnit: before.estimateUnit, toEstimateUnit: data.estimateUnit } } : {}),
        });
        return TeamRepository.getById(db, ctx, teamId);
    });
}

export async function deleteTeam(ctx: RequestContext, teamId: string) {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const team = await TeamRepository.getById(db, ctx, teamId);
        if (!team) throw notFound('Team not found');
        if ((await TeamRepository.countProjects(db, ctx, teamId)) > 0) {
            throw new ConflictError('A team with projects cannot be deleted. Move or delete its projects first.', {
                reason: 'TEAM_HAS_PROJECTS',
            });
        }
        await TeamRepository.delete(db, ctx, teamId);
        await logEvent(db, ctx, {
            action: 'TEAM_DELETED',
            entityType: 'Team',
            entityId: teamId,
            details: `Deleted team ${team.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Team', operation: 'deleted' },
        });
        return { deleted: true };
    });
}
