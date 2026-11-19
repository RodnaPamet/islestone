/**
 * Project visibility: which projects' work items a caller may read and write
 * (docs/porting/maps/2.1-2.2.md, "project-visibility.ts"; roadmap H2).
 *
 * OWNER, ADMIN, MEMBER and VIEWER see every live project in the workspace.
 * GUEST sees only the projects granted to them, and there is no grant table
 * until sub-phase 8.4, so a guest sees none. An unknown role fails closed to
 * the same empty grant. (Kaneo's `workspace_member_project` rows with
 * `workspace_member_access.projectAccess = 'all' | 'selected'`, at
 * fb890b4974e6dd6c232f1de6a6b70a591dfca0a3, is the shape to consider in 8.4;
 * pattern only, nothing copied.)
 *
 * Visibility is a PREDICATE, not a check: `projectVisibilityWhere` is the
 * Prisma fragment every `WorkItem` read and write carries (list, get, key
 * lookup, metrics, activity, sub-items, relations, comments, watchers, links,
 * bulk), so no surface can leak what another refuses. A deleted project hides
 * its items everywhere; an archived one keeps them readable but out of the
 * default list and refuses writes (the usecases ask `assertProjectWritable`).
 *
 * Written fresh for Islestone.
 */
import type { Prisma, Role } from '@prisma/client';

import type { PrismaTx } from '@/lib/db-context';

import type { RequestContext } from '../types';

export type ProjectVisibility = { kind: 'ALL' } | { kind: 'GRANTED'; projectIds: readonly string[] };

/** The built-in roles that see every live project. */
const ALL_PROJECT_ROLES: ReadonlySet<Role> = new Set<Role>(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

/**
 * The caller's visibility. Both the effective role (a custom role's base) and
 * the membership's own role must be workspace-wide: a GUEST membership never
 * widens through a custom role, and anything unrecognised gets no projects.
 *
 * Takes the transaction client so 8.4 can read the grant table here without
 * changing a caller.
 */
export async function visibleProjects(ctx: RequestContext, _db?: PrismaTx): Promise<ProjectVisibility> {
    return resolveProjectVisibility(ctx);
}

/** The synchronous part of {@link visibleProjects}, for tests and pure callers. */
export function resolveProjectVisibility(ctx: Pick<RequestContext, 'role' | 'membershipRole'>): ProjectVisibility {
    const own = ctx.membershipRole ?? ctx.role;
    if (ALL_PROJECT_ROLES.has(ctx.role) && ALL_PROJECT_ROLES.has(own)) return { kind: 'ALL' };
    // GUEST, or a role this code does not know: the granted projects only.
    // No grant table exists before 8.4, so the grant is empty.
    return { kind: 'GRANTED', projectIds: [] };
}

export interface VisibilityOptions {
    /** Include archived projects' items (reads only; writes never pass it). */
    includeArchived?: boolean;
}

/** The `Project` fragment a visible project satisfies. */
export function projectRowVisibilityWhere(v: ProjectVisibility, opts: VisibilityOptions = {}): Prisma.ProjectWhereInput {
    const base: Prisma.ProjectWhereInput = { deletedAt: null, ...(opts.includeArchived ? {} : { archivedAt: null }) };
    if (v.kind === 'ALL') return base;
    return { ...base, id: { in: [...v.projectIds] } };
}

/** The `WorkItem` fragment: the item's project is visible. */
export function projectVisibilityWhere(v: ProjectVisibility, opts: VisibilityOptions = {}): Prisma.WorkItemWhereInput {
    const where: Prisma.WorkItemWhereInput = { project: projectRowVisibilityWhere({ kind: 'ALL' }, opts) };
    if (v.kind === 'GRANTED') where.projectId = { in: [...v.projectIds] };
    return where;
}

/**
 * The job form: a job acts for nobody, so it sees every live, unarchived
 * project (the due reminder, the watcher fan-out).
 */
export const JOB_PROJECT_VISIBILITY_WHERE: Prisma.WorkItemWhereInput = {
    project: { deletedAt: null, archivedAt: null },
};
