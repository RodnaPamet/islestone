'use client';

/**
 * A goal's page (sub-phase 3.2b; docs/porting/maps/3.2.md, "The pages and
 * navigation"; owner decisions 205, 207, 211, 212, 214 and 218): its
 * ancestors, title and description, status and health shown with their
 * names, due date and lead, the health control and its history, progress
 * across its subtree and its direct items, its child goals and initiatives
 * (each with progress, health and dates), the items naming it directly,
 * "Add child goal" (refused past three levels, with the reason) and "Add
 * initiative", Archive (Completed or Cancelled only) and Delete through the
 * undo toast. Every write follows the server's `goalAffordances`.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { GoalDetail, GoalSummary, InitiativeSummary, RoadmapAffordances, ViewGoal } from '@/lib/goals/types';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { GoalDialog, InitiativeDialog } from './GoalDialogs';
import { HealthControl, HealthHistory, HealthText, ProgressCell, StatusAndHealth } from './goal-parts';
import { useGoalDetail, useGoalWrites } from './use-goals';

function RecordRow({ href, name, record }: { href: string; name: string; record: GoalSummary | InitiativeSummary }) {
    const tRow = useTranslations('roadmap');
    return (
        <li className="flex flex-wrap items-center justify-between gap-default border-t border-border-subtle py-3 first:border-t-0">
            <div className="min-w-0 space-y-1">
                <Link href={href} className="text-sm font-medium text-content-emphasis hover:underline">
                    {name}
                </Link>
                <p className="text-xs text-content-muted">
                    {tRow(`status.${record.status}`)} · <HealthText health={record.health} /> · {record.dueDate ? tRow('dueOn', { date: record.dueDate }) : tRow('noDueDate')}
                    {record.archived && <span className="ml-2">{tRow('archived')}</span>}
                    {record.late && <span className="ml-2 font-medium text-content-error">{tRow('late')}</span>}
                </p>
            </div>
            <ProgressCell name={name} summary={record} />
        </li>
    );
}

export function GoalView({ initialDetail, goalOptions, affordances }: { initialDetail: GoalDetail; goalOptions: ViewGoal[]; affordances: RoadmapAffordances }) {
    const t = useTranslations('goals');
    const tRoadmap = useTranslations('roadmap');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { byId: members } = useMembers();
    const writes = useGoalWrites();
    const { data } = useGoalDetail(initialDetail.goal.id, initialDetail);
    const detail = data ?? initialDetail;
    const goal = detail.goal;
    const [editing, setEditing] = useState(false);
    const [addingChild, setAddingChild] = useState(false);
    const [addingInitiative, setAddingInitiative] = useState(false);
    const editable = affordances.manage && !goal.archived;
    const finished = goal.status === 'COMPLETED' || goal.status === 'CANCELLED';
    const breadcrumbs = useMemo(
        () => [
            { label: t('title'), href: tenantHref('/roadmap/goals') },
            ...detail.ancestors.map((a) => ({ label: a.title, href: tenantHref(`/roadmap/goals/${encodeURIComponent(a.id)}`) })),
            { label: goal.title },
        ],
        [detail.ancestors, goal.title, t, tenantHref],
    );
    const lead = goal.leadUserId ? memberLabel(members.get(goal.leadUserId)) : null;

    return (
        <EntityDetailLayout
            back={{ smart: true }}
            breadcrumbs={breadcrumbs}
            title={goal.title}
            meta={
                <span className="flex flex-wrap items-center gap-tight">
                    <StatusAndHealth status={goal.status} health={goal.health} />
                    {goal.archived && <span className="text-xs text-content-muted">{tRoadmap('archived')}</span>}
                    {goal.late && <span className="text-xs font-medium text-content-error">{tRoadmap('late')}</span>}
                </span>
            }
            actions={
                affordances.manage ? (
                    <span className="flex flex-wrap gap-tight">
                        {editable && <Button variant="secondary" text={tRoadmap('edit')} onClick={() => setEditing(true)} />}
                        {(finished || goal.archived) && (
                            <Button variant="secondary" text={goal.archived ? tRoadmap('unarchive') : tRoadmap('archive')} onClick={() => void writes.setArchived('goal', goal.id, !goal.archived)} />
                        )}
                        <Button
                            variant="secondary"
                            text={tRoadmap('delete')}
                            onClick={() => writes.remove('goal', goal.id, { onLeave: () => router.push(tenantHref('/roadmap/goals')) })}
                        />
                    </span>
                ) : undefined
            }
        >
            <section aria-labelledby="goal-overview" className="space-y-default">
                <h2 id="goal-overview" className="text-lg font-semibold text-content-emphasis">
                    {t('detail.overview')}
                </h2>
                <p className="whitespace-pre-wrap text-sm">{goal.description ?? <span className="text-content-muted">{tRoadmap('noDescription')}</span>}</p>
                <dl className="grid grid-cols-1 gap-default text-sm sm:grid-cols-2">
                    <div>
                        <dt className="text-content-muted">{tRoadmap('dueDate')}</dt>
                        <dd className="tabular-nums">{goal.dueDate ?? tRoadmap('noDueDate')}</dd>
                    </div>
                    <div>
                        <dt className="text-content-muted">{tRoadmap('lead')}</dt>
                        <dd>{lead ?? tRoadmap('noLead')}</dd>
                    </div>
                </dl>
            </section>

            <section aria-labelledby="goal-health" className="space-y-default">
                <h2 id="goal-health" className="text-lg font-semibold text-content-emphasis">
                    {tRoadmap('health.label')}
                </h2>
                <HealthControl kind="goal" record={{ ...goal, name: goal.title }} editable={affordances.setHealth} members={members} />
                <h3 className="text-sm font-semibold text-content-emphasis">{tRoadmap('healthControl.history')}</h3>
                <HealthHistory entries={detail.healthHistory} members={members} />
            </section>

            <section aria-labelledby="goal-progress" className="space-y-default">
                <h2 id="goal-progress" className="text-lg font-semibold text-content-emphasis">
                    {t('detail.progressHeading')}
                </h2>
                <p className="text-xs text-content-muted">{t('detail.progressHint')}</p>
                <ProgressCell name={goal.title} summary={goal} />
            </section>

            <section aria-labelledby="goal-children" className="space-y-default">
                <div className="flex flex-wrap items-center justify-between gap-tight">
                    <h2 id="goal-children" className="text-lg font-semibold text-content-emphasis">
                        {t('detail.children')}
                    </h2>
                    {editable && detail.childFits && <Button variant="secondary" icon={<Plus />} text={t('detail.addChild')} onClick={() => setAddingChild(true)} />}
                </div>
                {editable && !detail.childFits && <p className="text-xs text-content-muted">{t('detail.childTooDeep')}</p>}
                {detail.children.length === 0 ? (
                    <p className="text-sm text-content-muted">{t('detail.childrenEmpty')}</p>
                ) : (
                    <ul>
                        {detail.children.map((c) => (
                            <RecordRow key={c.id} href={tenantHref(`/roadmap/goals/${encodeURIComponent(c.id)}`)} name={c.title} record={c} />
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="goal-initiatives" className="space-y-default">
                <div className="flex flex-wrap items-center justify-between gap-tight">
                    <h2 id="goal-initiatives" className="text-lg font-semibold text-content-emphasis">
                        {t('detail.initiatives')}
                    </h2>
                    {editable && <Button variant="secondary" icon={<Plus />} text={t('detail.addInitiative')} onClick={() => setAddingInitiative(true)} />}
                </div>
                {detail.initiatives.length === 0 ? (
                    <p className="text-sm text-content-muted">{t('detail.initiativesEmpty')}</p>
                ) : (
                    <ul>
                        {detail.initiatives.map((i) => (
                            <RecordRow key={i.id} href={tenantHref(`/roadmap/initiatives/${encodeURIComponent(i.id)}`)} name={i.name} record={i} />
                        ))}
                    </ul>
                )}
            </section>

            <section aria-labelledby="goal-direct" className="space-y-tight">
                <h2 id="goal-direct" className="text-lg font-semibold text-content-emphasis">
                    {t('detail.direct')}
                </h2>
                <p className="text-sm">{t('detail.directCount', { count: detail.directItems })}</p>
                <Link href={tenantHref(`/work-items?goalId=${encodeURIComponent(goal.id)}`)} className="text-sm text-content-emphasis underline">
                    {t('detail.directLink')}
                </Link>
            </section>

            {editable && (
                <>
                    <GoalDialog open={editing} onOpenChange={setEditing} goal={goal} goals={goalOptions} />
                    <GoalDialog open={addingChild} onOpenChange={setAddingChild} goals={goalOptions} presetParentId={goal.id} />
                    <InitiativeDialog open={addingInitiative} onOpenChange={setAddingInitiative} goals={goalOptions} presetGoalId={goal.id} />
                </>
            )}
        </EntityDetailLayout>
    );
}
