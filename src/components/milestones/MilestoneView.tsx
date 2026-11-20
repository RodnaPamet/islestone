'use client';

/**
 * One milestone's page (sub-phase 2.5b): its due date and progress, and its
 * work items in the shared list and board (`WorkItemsView` scoped to the
 * project and the milestone, so writes flow through the one cache and an
 * item whose milestone changes leaves or joins this list). A viewer the
 * server offers `manageMilestones` may rename it, change its date, and
 * delete it (through the undo toast, back to the project's milestones).
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "UI touch points").
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { MilestoneAffordances, MilestoneData, SavedViewAffordances } from '@/lib/work-items/types';

import { MilestoneDialog } from './MilestoneDialog';
import { MilestoneProgressBar, milestonePercent } from './MilestonesView';
import { useMilestones, useMilestoneWrites } from './use-milestones';

function MilestoneSummary({
    milestone,
    projectId,
    milestonesHref,
    editable,
}: {
    milestone: MilestoneData;
    projectId: string;
    milestonesHref: string;
    editable: boolean;
}) {
    const tSummary = useTranslations('milestones');
    const router = useRouter();
    const writes = useMilestoneWrites(projectId);
    const [editing, setEditing] = useState(false);
    return (
        <div className="space-y-default" data-testid="milestone-summary">
            <div className="flex flex-wrap items-start justify-between gap-default">
                <dl className="grid grid-cols-2 gap-default sm:grid-cols-4" aria-label={tSummary('stats.label')}>
                    <div>
                        <dt className="text-xs text-content-muted">{tSummary('stats.dueDate')}</dt>
                        <dd className="text-lg font-semibold tabular-nums text-content-emphasis">
                            {milestone.dueDate ?? tSummary('noDueDate')}
                            {milestone.late && <span className="ml-2 text-sm font-medium text-content-error">{tSummary('late')}</span>}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tSummary('stats.scope')}</dt>
                        <dd className="text-lg font-semibold tabular-nums text-content-emphasis">{milestone.progress.scope}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tSummary('stats.done')}</dt>
                        <dd className="text-lg font-semibold tabular-nums text-content-emphasis">{milestone.progress.done}</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-content-muted">{tSummary('stats.percent')}</dt>
                        <dd className="text-lg font-semibold tabular-nums text-content-emphasis">{`${milestonePercent(milestone)}%`}</dd>
                    </div>
                </dl>
                {editable && (
                    <div className="flex items-center gap-tight">
                        <Button variant="secondary" text={tSummary('edit')} onClick={() => setEditing(true)} />
                        <Button
                            variant="ghost"
                            text={tSummary('delete')}
                            onClick={() => {
                                writes.remove(milestone);
                                router.push(milestonesHref);
                            }}
                        />
                    </div>
                )}
            </div>
            <MilestoneProgressBar milestone={milestone} />
            {editable && <MilestoneDialog open={editing} onOpenChange={setEditing} projectId={projectId} milestone={milestone} />}
        </div>
    );
}

export function MilestoneView({
    project,
    initialMilestone,
    affordances,
    savedViews,
}: {
    project: { id: string; teamId: string; name: string; keyPrefix: string; archived: boolean };
    initialMilestone: MilestoneData;
    affordances: MilestoneAffordances;
    savedViews: SavedViewAffordances;
}) {
    const tView = useTranslations('milestones');
    const tenantHref = useTenantHref();
    // The project's list is the one read the milestone pages share.
    const { data } = useMilestones(project.id);
    const milestone = data?.find((m) => m.id === initialMilestone.id) ?? initialMilestone;
    return (
        <WorkItemsView
            scope={{ projectId: project.id, teamId: project.teamId, milestoneId: milestone.id }}
            title={milestone.name}
            description={tView('subtitle', { project: project.name })}
            viewKey={`milestone:${milestone.id}`}
            savedViews={savedViews}
            summary={
                <MilestoneSummary
                    milestone={milestone}
                    projectId={project.id}
                    milestonesHref={tenantHref(`/projects/${encodeURIComponent(project.keyPrefix)}/milestones`)}
                    editable={affordances.manageMilestones && !project.archived}
                />
            }
        />
    );
}
