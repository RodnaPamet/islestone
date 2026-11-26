'use client';

/**
 * The item's ancestry as a breadcrumb above its title (sub-phase 3.2a,
 * decision 220): "Goal › Initiative › Project › parents", and, when the item
 * names a goal directly that is not already one of that path's goals, a
 * second line, "Also serves: Goal › Goal" (decision 211). Levels the caller
 * may not read are counted, never named. Read from
 * `GET /work-items/:id/ancestry` (`useWorkItemAncestry`); never a description.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';

import type { AncestryGoal, WorkItemAncestry } from '@/lib/goals/types';

import { useWorkItemAncestry } from '../data/use-work-item-collab';

function GoalTrail({ goals, archivedLabel }: { goals: readonly AncestryGoal[]; archivedLabel: string }) {
    return (
        <>
            {goals.map((g, n) => (
                <span key={g.id}>
                    {n > 0 && <span aria-hidden="true"> › </span>}
                    <span>{g.title}</span>
                    {g.archived && <span className="text-content-subtle"> ({archivedLabel})</span>}
                </span>
            ))}
        </>
    );
}

/** Should the item's own goal chain be shown on a second line (it ends on a goal the path does not hold)? */
export function showsDirectLine(a: Pick<WorkItemAncestry, 'goals' | 'directGoals'>): boolean {
    if (!a.directGoals || a.directGoals.length === 0) return false;
    const own = a.directGoals[a.directGoals.length - 1]!;
    return !a.goals.some((g) => g.id === own.id);
}

export function AncestryBreadcrumb({ workItemId, onOpenItem }: { workItemId: string; onOpenItem: (target: { id: string; key: string }) => void }) {
    const tAncestry = useTranslations('workItems.ancestry');
    const { data } = useWorkItemAncestry(workItemId);
    if (!data) return null;
    const hasPath = data.goals.length > 0 || data.initiative !== null || data.parents.length > 0;
    const direct = showsDirectLine(data);
    if (!hasPath && !direct && data.hiddenLevels === 0) return null;
    const archived = tAncestry('archived');
    return (
        <nav aria-label={tAncestry('label')} className="space-y-tight text-xs text-content-muted">
            <p>
                {data.goals.length > 0 && (
                    <>
                        <GoalTrail goals={data.goals} archivedLabel={archived} />
                        <span aria-hidden="true"> › </span>
                    </>
                )}
                {data.initiative && (
                    <>
                        <span>{data.initiative.name}</span>
                        {data.initiative.archived && <span className="text-content-subtle"> ({archived})</span>}
                        <span aria-hidden="true"> › </span>
                    </>
                )}
                <span>{data.project.name}</span>
                {data.parents.map((p) => (
                    <span key={p.id}>
                        <span aria-hidden="true"> › </span>
                        <button type="button" className="underline" onClick={() => onOpenItem(p)}>
                            {p.key}
                        </button>
                    </span>
                ))}
                {data.hiddenLevels > 0 && <span className="text-content-subtle"> · {tAncestry('hidden', { count: data.hiddenLevels })}</span>}
            </p>
            {direct && (
                <p>
                    <span>{tAncestry('alsoServes')} </span>
                    <GoalTrail goals={data.directGoals ?? []} archivedLabel={archived} />
                </p>
            )}
        </nav>
    );
}
