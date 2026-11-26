/**
 * What the Roadmap entry's pages read on the server (sub-phase 3.2b;
 * docs/porting/maps/3.2.md, "The pages and navigation"; owner decisions 221
 * and 222): the request context (`getTenantCtx`, the gates the API asks), the
 * goals or initiatives, one goal or initiative, and the writes each page
 * offers (`goalAffordances`, the predicates the usecases assert; whether a
 * project may be linked or created, `mayEditProject` / `mayCreateProject`).
 * A viewer without `goals.view`, or a goal or initiative that is missing or
 * deleted, is a 404.
 *
 * Written fresh for Islestone.
 */
import { notFound } from 'next/navigation';

import { getTenantCtx } from '@/app-layer/context';
import { goalAffordances, mayReadGoals } from '@/app-layer/policies/goal.policies';
import { mayCreateProject, mayReadWorkConfig } from '@/app-layer/policies/work-config.policies';
import { mayReadWorkItems } from '@/app-layer/policies/work-item.policies';
import type { RequestContext } from '@/app-layer/types';
import { getGoal, listGoals, listViewGoals } from '@/app-layer/usecases/goal';
import { getInitiative, listInitiatives } from '@/app-layer/usecases/initiative';
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
    return { ...goals, createProject: mayCreateProject(ctx) && goals.view };
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

export async function goalPageContext(tenantSlug: string, goalId: string): Promise<{ detail: GoalDetail; options: { goals: ViewGoal[] }; affordances: RoadmapAffordances }> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [detail, view] = await Promise.all([getGoal(ctx, goalId), listViewGoals(ctx)]);
        return { detail, options: { goals: view.goals }, affordances: affordancesOf(ctx) };
    });
}

export async function initiativePageContext(
    tenantSlug: string,
    initiativeId: string,
): Promise<{
    detail: InitiativeDetail;
    options: { goals: ViewGoal[]; initiatives: ViewInitiative[]; projects: ViewProject[]; teams: Array<{ id: string; name: string }> };
    affordances: RoadmapAffordances;
}> {
    return or404(async () => {
        const ctx = await goalsCtx(tenantSlug);
        const [detail, view, workspace] = await Promise.all([getInitiative(ctx, initiativeId), listViewGoals(ctx), projectsAndTeams(ctx)]);
        return { detail, options: { goals: view.goals, initiatives: view.initiatives, ...workspace }, affordances: affordancesOf(ctx) };
    });
}
