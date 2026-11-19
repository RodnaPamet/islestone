/**
 * A small work-item world in one workspace, written with the raw test client
 * (the login role, so RLS does not apply and no audit row is written): a
 * team with the default workflow, a type, a project with its prefix and
 * sequence, and optionally items. For integration suites; usecase suites
 * build through the usecases instead.
 *
 * Written fresh for Islestone (sub-phases 2.1–2.2).
 */
import type { PrismaClient, WorkflowStateCategory } from '@prisma/client';

import { DEFAULT_TEAM_WORKFLOW } from '@/app-layer/domain/workflow-state';
import { keysBetween } from '@/app-layer/domain/fractional-index';

export interface WorkWorld {
    teamId: string;
    states: Record<string, { id: string; category: WorkflowStateCategory }>;
    defaultStateId: string;
    typeId: string;
    projectId: string;
    keyPrefix: string;
}

export async function seedWorkWorld(
    prisma: PrismaClient,
    tenantId: string,
    opts: { keyPrefix: string; teamName?: string; typeName?: string },
): Promise<WorkWorld> {
    const team = await prisma.team.create({ data: { tenantId, name: opts.teamName ?? `Team ${opts.keyPrefix}` } });
    const keys = keysBetween(null, null, DEFAULT_TEAM_WORKFLOW.length);
    const states: WorkWorld['states'] = {};
    let defaultStateId = '';
    for (const [i, s] of DEFAULT_TEAM_WORKFLOW.entries()) {
        const row = await prisma.workflowState.create({
            data: { tenantId, teamId: team.id, name: s.name, category: s.category, isDefault: s.isDefault, sortKey: keys[i]! },
        });
        states[s.name] = { id: row.id, category: s.category };
        if (s.isDefault) defaultStateId = row.id;
    }
    const type =
        (await prisma.workItemType.findFirst({ where: { tenantId, name: opts.typeName ?? 'Feature' } })) ??
        (await prisma.workItemType.create({ data: { tenantId, name: opts.typeName ?? 'Feature', sortKey: 'V' } }));
    const project = await prisma.project.create({
        data: { tenantId, teamId: team.id, name: `Project ${opts.keyPrefix}`, keyPrefix: opts.keyPrefix },
    });
    await prisma.projectKeyPrefix.create({ data: { tenantId, prefix: opts.keyPrefix, projectId: project.id } });
    await prisma.projectKeySequence.create({ data: { tenantId, projectId: project.id, lastValue: 0 } });
    return { teamId: team.id, states, defaultStateId, typeId: type.id, projectId: project.id, keyPrefix: opts.keyPrefix };
}

/** One raw item in the world (its number claimed from the sequence). */
export async function seedWorkItem(
    prisma: PrismaClient,
    tenantId: string,
    world: WorkWorld,
    data: { title: string; createdByUserId: string; sortKey: string; parentId?: string | null; assigneeId?: string | null; dueDate?: Date | null; stateName?: string },
) {
    const seq = await prisma.projectKeySequence.update({
        where: { projectId: world.projectId },
        data: { lastValue: { increment: 1 } },
    });
    const state = data.stateName ? world.states[data.stateName]! : { id: world.defaultStateId, category: 'UNSTARTED' as const };
    return prisma.workItem.create({
        data: {
            tenantId,
            teamId: world.teamId,
            projectId: world.projectId,
            number: seq.lastValue,
            typeId: world.typeId,
            title: data.title,
            stateId: state.id,
            stateCategory: state.category,
            createdByUserId: data.createdByUserId,
            sortKey: data.sortKey,
            parentId: data.parentId ?? null,
            assigneeId: data.assigneeId ?? null,
            dueDate: data.dueDate ?? null,
        },
    });
}
