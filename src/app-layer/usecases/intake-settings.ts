/**
 * A project's intake settings (sub-phase 2.6a; owner decisions 93 and 95):
 * whether it takes requests, and its notify list. Settings → Intake reads and
 * writes them under `intake.manage`. Turning intake on for the first time with
 * no notify list puts the person who turned it on on the list (decision 95).
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import { IntakeRepository } from '../repositories/IntakeRepository';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { assertCanManageIntake } from '../policies/intake.policies';
import { visibleProjects } from '../policies/project-visibility';
import type { RequestContext } from '../types';
import { runInTenantContext } from '@/lib/db-context';
import { badRequest, notFound } from '@/lib/errors/types';
import type { ProjectIntakeSettings } from '@/lib/intake/types';

/** Every visible, live project with its intake (off when it has none), its notify list and its new requests. */
export async function listProjectIntakeSettings(ctx: RequestContext): Promise<ProjectIntakeSettings[]> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const projects = await ProjectRepository.list(db, ctx, v);
        const ids = projects.map((p) => p.id);
        const [intakes, notify, pending] = await Promise.all([
            IntakeRepository.listProjectIntakes(db, ctx, ids),
            IntakeRepository.listNotifyMembers(db, ctx, ids),
            IntakeRepository.countPendingByProject(db, ctx, v, ids),
        ]);
        const enabled = new Map(intakes.map((i) => [i.projectId, i.enabled]));
        const pendingBy = new Map(pending.map((p) => [p.projectId, p._count._all]));
        return projects.map((p) => ({
            projectId: p.id,
            projectName: p.name,
            keyPrefix: p.keyPrefix,
            enabled: enabled.get(p.id) ?? false,
            notifyUserIds: notify.filter((n) => n.projectId === p.id).map((n) => n.userId),
            pendingCount: pendingBy.get(p.id) ?? 0,
        }));
    });
}

export interface SetProjectIntakeInput {
    enabled: boolean;
    /** The whole notify list; absent leaves it as it is (or seeds it, see above). */
    notifyUserIds?: string[];
}

export async function setProjectIntake(ctx: RequestContext, projectId: string, input: SetProjectIntakeInput): Promise<ProjectIntakeSettings> {
    assertCanManageIntake(ctx);
    return runInTenantContext(ctx, async (db) => {
        const v = await visibleProjects(ctx, db);
        const project = await ProjectRepository.getVisible(db, ctx, v, projectId);
        if (!project) throw notFound('Project not found');
        if (project.archivedAt && input.enabled) throw badRequest(`${project.name} is archived and takes no requests.`);
        const before = await IntakeRepository.getProjectIntake(db, ctx, project.id);
        const current = (await IntakeRepository.listNotifyMembers(db, ctx, [project.id])).map((n) => n.userId);

        let notify = input.notifyUserIds ? [...new Set(input.notifyUserIds)] : current;
        if (input.notifyUserIds) {
            const active = await MembershipRepository.listActiveUserIds(db, ctx, notify);
            const missing = notify.filter((id) => !active.has(id));
            if (missing.length > 0) throw badRequest('Only active members of the workspace can be on the notify list.');
        } else if (!before && input.enabled && current.length === 0) {
            notify = [ctx.userId];
        }

        const after = await IntakeRepository.upsertProjectIntake(db, ctx, project.id, input.enabled);
        if (notify !== current) await IntakeRepository.replaceNotifyMembers(db, ctx, project.id, notify);

        const changed: string[] = [];
        if ((before?.enabled ?? false) !== after.enabled) changed.push('enabled');
        if ([...notify].sort().join() !== [...current].sort().join()) changed.push('notifyList');
        if (changed.length > 0) {
            await logEvent(db, ctx, {
                action: 'PROJECT_INTAKE_UPDATED',
                entityType: 'Project',
                entityId: project.id,
                details: `Changed the intake of project ${project.keyPrefix}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'ProjectIntake', operation: before ? 'updated' : 'created', changedFields: changed, summary: 'PROJECT_INTAKE_UPDATED' },
                metadata: { projectId: project.id, enabled: after.enabled, notifyCount: notify.length },
            });
        }
        const [pending] = await IntakeRepository.countPendingByProject(db, ctx, v, [project.id]);
        return {
            projectId: project.id,
            projectName: project.name,
            keyPrefix: project.keyPrefix,
            enabled: after.enabled,
            notifyUserIds: notify,
            pendingCount: pending?._count._all ?? 0,
        };
    });
}
