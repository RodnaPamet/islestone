/**
 * The configuration the work-item views render with (sub-phase 2.3): the
 * visible projects (archived ones included, so an archived project's items
 * still name it), the teams, every team's live workflow states, the live work
 * item types, the live labels, every team's cycles (2.5a) and the visible projects' milestones (2.5b). One transaction, read once by the server
 * page and handed to the client, so the list, the board and the detail never
 * derive a filter option from the rows they happen to have loaded (with
 * cursor pages the loaded rows are a subset).
 *
 * Every read is bounded by its repository's own cap. Written fresh for
 * Islestone.
 */
import { CustomFieldRepository } from '../repositories/CustomFieldRepository';
import { LabelRepository } from '../repositories/LabelRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkItemTypeRepository } from '../repositories/WorkItemTypeRepository';
import { viewCyclesInTx } from './cycle';
import { viewMilestonesInTx } from './milestone';
import { fieldSetEntriesForViewsInTx } from './field-set';
import { assertCanReadWorkItems } from '../policies/work-item.policies';
import { assertCanReadWorkConfig } from '../policies/work-config.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

/**
 * `projectId` or `projectKeyPrefix` (a project's page, 2.4) adds that project's live custom fields;
 * a project the caller cannot see adds none (the page itself answers 404).
 */
export async function getWorkItemViewConfig(
    ctx: RequestContext,
    opts: { projectId?: string; projectKeyPrefix?: string } = {},
): Promise<WorkItemViewConfig> {
    assertCanReadWorkItems(ctx);
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const [projects, teams, types, labels] = await Promise.all([
            ProjectRepository.list(db, ctx, v, { includeArchived: true }),
            TeamRepository.list(db, ctx),
            WorkItemTypeRepository.list(db, ctx),
            LabelRepository.list(db, ctx),
        ]);
        const fieldsOf = projects.find((p) => (opts.projectId && p.id === opts.projectId) || (opts.projectKeyPrefix && p.keyPrefix === opts.projectKeyPrefix));
        const fields = fieldsOf ? await CustomFieldRepository.listFields(db, ctx, fieldsOf.id) : [];
        const states = await TeamRepository.liveStatesOfTeams(db, ctx, teams.map((t) => t.id));
        const cycles = await viewCyclesInTx(db, ctx);
        const fieldSetEntries = await fieldSetEntriesForViewsInTx(db, ctx, fieldsOf?.id);
        const milestones = await viewMilestonesInTx(db, ctx, projects.map((p) => p.id));
        return {
            projects: projects.map((p) => ({
                id: p.id,
                teamId: p.teamId,
                name: p.name,
                keyPrefix: p.keyPrefix,
                archived: p.archivedAt !== null,
            })),
            teams: teams.map((t) => ({ id: t.id, name: t.name })),
            states: states.map((s) => ({ id: s.id, teamId: s.teamId, name: s.name, category: s.category, isDefault: s.isDefault })),
            types: types.map((t) => ({ id: t.id, name: t.name, icon: t.icon, color: t.color })),
            labels: labels.map((l) => ({ id: l.id, teamId: l.teamId, name: l.name, color: l.color })),
            customFields: fields.map((f) => ({
                id: f.id,
                projectId: f.projectId,
                name: f.name,
                type: f.type,
                archived: f.archivedAt !== null,
                options: f.options.map((o) => ({ id: o.id, name: o.name, color: o.color, archived: o.archivedAt !== null })),
            })),
            cycles,
            milestones,
            fieldSetEntries,
        };
    });
}
