/**
 * Teams (sub-phase 2.1, ADR 0002 §3). Creating a team seeds its workflow in
 * the same transaction (Backlog; Todo, the default; In progress; In review;
 * Done; Cancelled), so a team always has one default state and at least one
 * DONE and one CANCELLED. Deleting a team is refused while it has projects.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { TeamRepository } from '../repositories/TeamRepository';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { DEFAULT_TEAM_WORKFLOW } from '../domain/workflow-state';
import { keysBetween } from '../domain/fractional-index';
import { ensureDefaultWorkItemTypes } from './work-item-type';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { ConflictError, notFound } from '@/lib/errors/types';
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
    assertCanManageWorkConfig(ctx);
    const name = sanitizePlainText(input.name).trim();
    return runInTenantContext(ctx, async (db) => {
        const result = await TeamRepository.rename(db, ctx, teamId, name);
        if (result.count === 0) throw notFound('Team not found');
        await logEvent(db, ctx, {
            action: 'TEAM_UPDATED',
            entityType: 'Team',
            entityId: teamId,
            details: `Renamed team to ${name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'Team', operation: 'updated', changedFields: ['name'] },
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
