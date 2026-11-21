/**
 * A workspace with an owner, a member, one team (with its seeded workflow)
 * and one project, for the integration suites that drive work-item usecases
 * (the concurrency suites of Hardening H2, `tests/integration/concurrency/`).
 */
import type { PrismaClient } from '@prisma/client';

import type { RequestContext } from '@/app-layer/types';
import { createProject } from '@/app-layer/usecases/project';
import { createTeam } from '@/app-layer/usecases/team';
import { listWorkItemTypes } from '@/app-layer/usecases/work-item-type';
import { createTenantWithDek } from '@/lib/security/tenant-key-manager';

import { makeRequestContext } from './make-context';

export interface WorkItemWorkspace {
    tenantId: string;
    owner: RequestContext;
    member: RequestContext;
    memberUserId: string;
    teamId: string;
    /** The team's states by name: Backlog, Todo, In progress, In review, Done, Cancelled. */
    states: Record<string, { id: string; category: string }>;
    projectId: string;
    typeId: string;
}

export async function createWorkItemWorkspace(prisma: PrismaClient, tag: string): Promise<WorkItemWorkspace> {
    const tenant = await createTenantWithDek({ name: tag, slug: tag });
    const ownerUser = await prisma.user.create({ data: { email: `owner-${tag}@example.test`, name: 'Olive Owner' } });
    const memberUser = await prisma.user.create({ data: { email: `member-${tag}@example.test`, name: 'Max Member' } });
    await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: ownerUser.id, role: 'OWNER' } });
    await prisma.tenantMembership.create({ data: { tenantId: tenant.id, userId: memberUser.id, role: 'MEMBER' } });
    const owner = makeRequestContext('OWNER', { tenantId: tenant.id, userId: ownerUser.id, tenantSlug: tag, requestId: `${tag}-o` });
    const member = makeRequestContext('MEMBER', { tenantId: tenant.id, userId: memberUser.id, tenantSlug: tag, requestId: `${tag}-m` });
    const team = await createTeam(owner, { name: 'Core' });
    const states = Object.fromEntries(team.workflowStates.map((s) => [s.name, { id: s.id, category: s.category }]));
    const project = await createProject(owner, { teamId: team.id, name: 'Concurrency', keyPrefix: 'CON' });
    const typeId = (await listWorkItemTypes(owner)).find((t) => t.name === 'Bug')!.id;
    return { tenantId: tenant.id, owner, member, memberUserId: memberUser.id, teamId: team.id, states, projectId: project.id, typeId };
}

/** Whether a settled promise failed with a Postgres deadlock (40P01; Prisma P2034). */
export function isDeadlock(reason: unknown): boolean {
    const text = reason instanceof Error ? `${reason.message} ${JSON.stringify(reason)}` : String(reason);
    return /40P01|deadlock|P2034/i.test(text);
}
