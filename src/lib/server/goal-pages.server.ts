/**
 * What the Roadmap entry's pages read on the server (sub-phase 3.2b;
 * docs/porting/maps/3.2.md, "The pages and navigation"; owner decisions 221
 * and 222): the request context (`getTenantCtx`, the gates the API asks), the
 * goals or initiatives, one goal or initiative, and the writes each page
 * offers (`goalAffordances`, the predicates the usecases assert; whether a
 * project may be linked or created, `mayEditProject` / `mayCreateProject`),
 * and the Roadmap page's filter options (3.2c).
 * A viewer without `goals.view`, or a goal or initiative that is missing or
 * deleted, is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { mayViewAnalytics } from '@/app-layer/policies/analytics.policies';
import { goalAffordances, mayReadGoals } from '@/app-layer/policies/goal.policies';
import { mayCreateProject, mayReadWorkConfig } from '@/app-layer/policies/work-config.policies';
import { mayReadWorkItems } from '@/app-layer/policies/work-item.policies';
import type { RequestContext } from '@/app-layer/types';
import { getGoal, listGoals, listViewGoals } from '@/app-layer/usecases/goal';
import { getInitiative, listInitiatives } from '@/app-layer/usecases/initiative';
import { listTeams } from '@/app-layer/usecases/team';
import { getWorkItemViewConfig } from '@/app-layer/usecases/work-item-views';
import { isAppError } from '@/lib/errors/types';
import type { GoalDetail, GoalSummary, InitiativeDetail, InitiativeSummary, RoadmapAffordances, ViewGoal, ViewInitiative } from '@/lib/goals/types';
import type { ViewProject } from '@/lib/work-items/types';

async function or404<T>(read: () => Promise<T>): Promise<T> {
    try {
        return await read();
    } catch (err) {
        if (isAppError(err) && (err.status === 404 || err.status === 403)) notFound();
        throw err;
    }
}

async function goalsCtx(tenantSlug: string): Promise<RequestContext> {
    const ctx = await getTenantCtx({ tenantSlug });
    if (!mayReadGoals(ctx)) notFound();
    return ctx;
}

/** The workspace's projects and teams, for a caller who reads them; empty otherwise (a custom role may read goals alone). */
async function projectsAndTeams(ctx: RequestContext): Promise<{ projects: ViewProject[]; teams: Array<{ id: string; name: string }> }> {
    if (!mayReadWorkItems(ctx) || !mayReadWorkConfig(ctx)) return { projects: [], teams: [] };
    const config = await getWorkItemViewConfig(ctx);
    return { projects: config.projects, teams: config.teams.map((t) => ({ id: t.id, name: t.name })) };
}

function affordancesOf(ctx: RequestContext): RoadmapAffordances {
    const goals = goalAffordances(ctx);
    return { ...goals, createProject: mayCreateProject(ctx) && goals.view, roadmap: mayReadWorkConfig(ctx) && goals.view };
}

export async function goalsPageContext(tenantSlug: string): Promise<{ goals: GoalSummary[]; options: { goals: ViewGoal[] }; affordances: RoadmapAffordances }> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [{ goals }, view] = await Promise.all([listGoals(ctx), listViewGoals(ctx)]);
        return { goals, options: { goals: view.goals }, affordances: affordancesOf(ctx) };
    });
}

export async function initiativesPageContext(tenantSlug: string): Promise<{ initiatives: InitiativeSummary[]; options: { goals: ViewGoal[] }; affordances: RoadmapAffordances }> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [{ initiatives }, view] = await Promise.all([listInitiatives(ctx), listViewGoals(ctx)]);
        return { initiatives, options: { goals: view.goals }, affordances: affordancesOf(ctx) };
    });
}

export async function goalPageContext(tenantSlug: string, goalId: string): Promise<{ detail: GoalDetail; options: { goals: ViewGoal[] }; affordances: RoadmapAffordances; forecast: boolean }> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [detail, view] = await Promise.all([getGoal(ctx, goalId), listViewGoals(ctx)]);
        return { detail, options: { goals: view.goals }, affordances: affordancesOf(ctx), forecast: mayViewAnalytics(ctx) };
    });
}

export async function initiativePageContext(
    tenantSlug: string,
    initiativeId: string,
): Promise<{
    detail: InitiativeDetail;
    options: { goals: ViewGoal[]; initiatives: ViewInitiative[]; projects: ViewProject[]; teams: Array<{ id: string; name: string }> };
    affordances: RoadmapAffordances;
    forecast: boolean;
}> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [detail, view, workspace] = await Promise.all([getInitiative(ctx, initiativeId), listViewGoals(ctx), projectsAndTeams(ctx)]);
        return { detail, options: { goals: view.goals, initiatives: view.initiatives, ...workspace }, affordances: affordancesOf(ctx), forecast: mayViewAnalytics(ctx) };
    });
}

/**
 * The Roadmap page (3.2c): the filters' options (the live, unarchived goals
 * and initiatives, the teams). The roadmap draws projects, so a viewer
 * without `projects.view` gets a 404, as the API's read refuses them.
 */
export async function roadmapPageContext(tenantSlug: string): Promise<{ options: { goals: ViewGoal[]; initiatives: ViewInitiative[]; teams: Array<{ id: string; name: string }> } }> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        if (!mayReadWorkConfig(ctx)) notFound();
        const [view, teams] = await Promise.all([listViewGoals(ctx), listTeams(ctx)]);
        return { options: { goals: view.goals, initiatives: view.initiatives, teams: teams.map((t) => ({ id: t.id, name: t.name })) } };
    });
}
