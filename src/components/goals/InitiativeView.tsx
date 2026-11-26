'use client';

/**
 * An initiative's page, the roadmap's "portfolio page" (sub-phase 3.2b;
 * docs/porting/maps/3.2.md, "The pages and navigation"; owner decisions 205,
 * 207, 212, 214 and 221): its goal breadcrumb, status and health shown with
 * their names, due date and lead, the health control and its history, its
 * progress, and a projects table (project, team, due date, progress,
 * "Late", late milestones, archived projects greyed). "Add project" links an
 * existing project (`projects.edit`, through the project's own route) or
 * opens the one project create dialog with the initiative chosen; taking a
 * project off goes through the undo toast. Its slice of the roadmap (3.2c,
 * `RoadmapView` with the initiative fixed, archived projects shown) sits
 * under the projects table, whose "Planned dates" column reads the same
 * answer. Every write follows the server's affordances.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { ProjectCreateDialog } from '@/components/settings/ProjectCreateDialog';
import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { useToast } from '@/components/ui/hooks';
import { DataTable, createColumns } from '@/components/ui/table';
import { formatDay } from '@/components/work-items/timeline/TimelineScheduleTable';
import type { RoadmapFilters } from '@/lib/goals/roadmap';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import type { InitiativeDetail, InitiativeProjectRow, RoadmapAffordances, ViewGoal } from '@/lib/goals/types';
import { useTenantApiUrl, useTenantHref } from '@/lib/tenant-context-provider';
import type { ViewProject } from '@/lib/work-items/types';

import { InitiativeDialog } from './GoalDialogs';
import { RoadmapView } from './RoadmapView';
import { useRoadmap } from './use-roadmap';
import { HealthControl, HealthHistory, ProgressCell, StatusAndHealth } from './goal-parts';
import { GOAL_PATHS, goalRefusal, useGoalWrites, useInitiativeDetail } from './use-goals';

function LinkProjectDialog({
    open,
    onOpenChange,
    initiative,
    projects,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initiative: { id: string; name: string };
    /** Visible projects not already in this initiative (the server's list). */
    projects: readonly ViewProject[];
}) {
    const tLink = useTranslations('initiatives');
    const tLinkRoadmap = useTranslations('roadmap');
    const toast = useToast();
    const writes = useGoalWrites();
    const [projectId, setProjectId] = useState('');
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setProjectId('');
    }
    const options: ComboboxOption[] = projects.map((p) => ({ value: p.id, label: `${p.name} (${p.keyPrefix})` }));
    const submit = async (): Promise<string | null> => {
        const chosen = projects.find((p) => p.id === projectId);
        if (!chosen) return tLink('detail.linkProject');
        try {
            await writes.linkProject(chosen.id, initiative.id);
            toast.success(tLink('detail.linked', { project: chosen.name }));
            return null;
        } catch (err) {
            return goalRefusal(err, tLinkRoadmap('failed'));
        }
    };
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tLink('detail.linkTitle', { name: initiative.name })}
            description={tLink('detail.linkHint')}
            submitLabel={tLink('detail.linkSubmit')}
            submitDisabled={!projectId}
            onSubmit={submit}
        >
            {options.length === 0 ? (
                <p className="text-sm text-content-muted">{tLink('detail.linkNone')}</p>
            ) : (
                <FormField label={tLink('detail.linkProject')} required>
                    <Combobox id="initiative-link-project-input" selected={options.find((o) => o.value === projectId) ?? null} setSelected={(o) => o && setProjectId(o.value)} options={options} caret />
                </FormField>
            )}
        </SettingsFormModal>
    );
}

export function InitiativeView({
    initialDetail,
    goalOptions,
    projects,
    teams,
    affordances,
}: {
    initialDetail: InitiativeDetail;
    goalOptions: ViewGoal[];
    /** The workspace's visible projects (to link one). */
    projects: ViewProject[];
    teams: Array<{ id: string; name: string }>;
    affordances: RoadmapAffordances;
}) {
    const t = useTranslations('initiatives');
    const tRoadmap = useTranslations('roadmap');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const apiUrl = useTenantApiUrl();
    const { mutate } = useSWRConfig();
    const { byId: members } = useMembers();
    const writes = useGoalWrites();
    const { data } = useInitiativeDetail(initialDetail.initiative.id, initialDetail);
    const detail = data ?? initialDetail;
    const initiative = detail.initiative;
    const [editing, setEditing] = useState(false);
    const [linking, setLinking] = useState(false);
    const [creatingProject, setCreatingProject] = useState(false);
    const editable = affordances.manage && !initiative.archived;
    const finished = initiative.status === 'COMPLETED' || initiative.status === 'CANCELLED';
    const teamName = useMemo(() => new Map(teams.map((x) => [x.id, x.name])), [teams]);
    const linkable = useMemo(() => {
        const mine = new Set(detail.projects.map((p) => p.id));
        return projects.filter((p) => !mine.has(p.id));
    }, [detail.projects, projects]);
    const detailUrl = apiUrl(GOAL_PATHS.initiative(initiative.id));
    const breadcrumbs = useMemo(
        () => [
            { label: t('title'), href: tenantHref('/roadmap/initiatives') },
            ...detail.goals.map((g) => ({ label: g.title, href: tenantHref(`/roadmap/goals/${encodeURIComponent(g.id)}`) })),
            { label: initiative.name },
        ],
        [detail.goals, initiative.name, t, tenantHref],
    );
    const lead = initiative.leadUserId ? memberLabel(members.get(initiative.leadUserId)) : null;

    const unlink = useCallback((row: InitiativeProjectRow) => {
        let before: InitiativeDetail | undefined;
        writes.unlinkProject(row, {
            onLeave: () => {
                void mutate<InitiativeDetail>(
                    detailUrl,
                    (current) => {
                        before = current ?? detail;
                        return before ? { ...before, projects: before.projects.filter((p) => p.id !== row.id) } : before;
                    },
                    { revalidate: false },
                );
            },
            onUndo: () => {
                void mutate<InitiativeDetail>(detailUrl, () => before, { revalidate: false });
            },
        });
    }, [detail, detailUrl, mutate, writes]);

    // The slice's read (3.2c): the projects' planned dates come from the roadmap's answer, the one the chart draws.
    const sliceFilters = useMemo<RoadmapFilters>(() => ({ initiativeId: initiative.id, archived: 'true' }), [initiative.id]);
    const slice = useRoadmap(sliceFilters, { enabled: affordances.roadmap === true });
    const spans = useMemo(() => new Map((slice.data?.projects ?? []).map((p) => [p.id, p.span])), [slice.data]);

    const columns = useMemo(
        () =>
            createColumns<InitiativeProjectRow>([
                {
                    id: 'project',
                    header: t('detail.col.project'),
                    cell: ({ row }) => (
                        <span className={row.original.archived ? 'text-content-muted' : undefined}>
                            <Link href={tenantHref(`/projects/${encodeURIComponent(row.original.keyPrefix)}`)} className="hover:underline">
                                {row.original.name}
                            </Link>
                            {row.original.archived && <span className="ml-2 text-xs">{t('detail.projectArchived')}</span>}
                        </span>
                    ),
                },
                { id: 'team', header: t('detail.col.team'), cell: ({ row }) => teamName.get(row.original.teamId) ?? '' },
                { id: 'dueDate', header: t('detail.col.dueDate'), cell: ({ row }) => <span className="tabular-nums">{row.original.dueDate ?? ''}</span> },
                {
                    id: 'span',
                    header: t('detail.col.span'),
                    cell: ({ row }) => {
                        const span = spans.get(row.original.id);
                        return span ? <span className="tabular-nums">{t('detail.span', { start: formatDay(span.start), end: formatDay(span.end) })}</span> : <span className="text-content-muted">{t('detail.noSpan')}</span>;
                    },
                },
                { id: 'progress', header: t('detail.col.progress'), cell: ({ row }) => <ProgressCell name={row.original.name} summary={{ progress: row.original.progress, late: row.original.late, tooManyProjects: null }} /> },
                { id: 'late', header: t('detail.col.late'), cell: ({ row }) => (row.original.late ? <span className="font-medium text-content-error">{tRoadmap('late')}</span> : '') },
                { id: 'lateMilestones', header: t('detail.col.lateMilestones'), cell: ({ row }) => t('detail.lateMilestones', { count: row.original.lateMilestones }) },
                {
                    id: 'actions',
                    header: t('detail.col.actions'),
                    cell: ({ row }) =>
                        affordances.linkProject ? (
                            <Button variant="ghost" size="sm" text={t('detail.unlink')} aria-label={t('detail.unlinkNamed', { project: row.original.name })} onClick={() => unlink(row.original)} />
                        ) : null,
                },
            ]),
        [affordances.linkProject, t, tRoadmap, teamName, tenantHref, unlink, spans],
    );

    return (
        <EntityDetailLayout
            back={{ smart: true }}
            breadcrumbs={breadcrumbs}
            title={initiative.name}
            meta={
                <span className="flex flex-wrap items-center gap-tight">
                    <StatusAndHealth status={initiative.status} health={initiative.health} />
                    {initiative.archived && <span className="text-xs text-content-muted">{tRoadmap('archived')}</span>}
                    {initiative.late && <span className="text-xs font-medium text-content-error">{tRoadmap('late')}</span>}
                </span>
            }
            actions={
                affordances.manage ? (
                    <span className="flex flex-wrap gap-tight">
                        {editable && <Button variant="secondary" text={tRoadmap('edit')} onClick={() => setEditing(true)} />}
                        {(finished || initiative.archived) && (
                            <Button
                                variant="secondary"
                                text={initiative.archived ? tRoadmap('unarchive') : tRoadmap('archive')}
                                onClick={() => void writes.setArchived('initiative', initiative.id, !initiative.archived)}
                            />
                        )}
                        <Button
                            variant="secondary"
                            text={tRoadmap('delete')}
                            onClick={() => writes.remove('initiative', initiative.id, { onLeave: () => router.push(tenantHref('/roadmap/initiatives')) })}
                        />
                    </span>
                ) : undefined
            }
        >
            <section aria-labelledby="initiative-overview" className="space-y-default">
                <h2 id="initiative-overview" className="text-lg font-semibold text-content-emphasis">
                    {tRoadmap('description')}
                </h2>
                <p className="whitespace-pre-wrap text-sm">{initiative.description ?? <span className="text-content-muted">{tRoadmap('noDescription')}</span>}</p>
                <dl className="grid grid-cols-1 gap-default text-sm sm:grid-cols-3">
                    <div>
                        <dt className="text-content-muted">{t('detail.goalLabel')}</dt>
                        <dd>
                            {detail.goal ? (
                                <Link href={tenantHref(`/roadmap/goals/${encodeURIComponent(detail.goal.id)}`)} className="hover:underline">
                                    {detail.goal.title}
                                </Link>
                            ) : (
                                t('noGoal')
                            )}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-content-muted">{tRoadmap('dueDate')}</dt>
                        <dd className="tabular-nums">{initiative.dueDate ?? tRoadmap('noDueDate')}</dd>
                    </div>
                    <div>
                        <dt className="text-content-muted">{tRoadmap('lead')}</dt>
                        <dd>{lead ?? tRoadmap('noLead')}</dd>
                    </div>
                </dl>
            </section>

            <section aria-labelledby="initiative-health" className="space-y-default">
                <h2 id="initiative-health" className="text-lg font-semibold text-content-emphasis">
                    {tRoadmap('health.label')}
                </h2>
                <HealthControl kind="initiative" record={initiative} editable={affordances.setHealth} members={members} />
                <h3 className="text-sm font-semibold text-content-emphasis">{tRoadmap('healthControl.history')}</h3>
                <HealthHistory entries={detail.healthHistory} members={members} />
            </section>

            <section aria-labelledby="initiative-progress" className="space-y-default">
                <h2 id="initiative-progress" className="text-lg font-semibold text-content-emphasis">
                    {t('detail.progressHeading')}
                </h2>
                <p className="text-xs text-content-muted">{t('detail.progressHint')}</p>
                <ProgressCell name={initiative.name} summary={initiative} />
            </section>

            <section aria-labelledby="initiative-projects" className="space-y-default">
                <div className="flex flex-wrap items-center justify-between gap-tight">
                    <h2 id="initiative-projects" className="text-lg font-semibold text-content-emphasis">
                        {t('detail.projects')}
                    </h2>
                    <span className="flex flex-wrap gap-tight">
                        {affordances.linkProject && !initiative.archived && <Button variant="secondary" icon={<Plus />} text={t('detail.addProject')} onClick={() => setLinking(true)} />}
                        {affordances.createProject && !initiative.archived && (
                            <Button variant="secondary" icon={<Plus />} text={t('detail.createProject')} onClick={() => setCreatingProject(true)} />
                        )}
                    </span>
                </div>
                <DataTable
                    data={detail.projects}
                    columns={columns}
                    getRowId={(r) => r.id}
                    emptyState={t('detail.projectsEmpty')}
                    data-testid="initiative-projects-table"
                />
            </section>

            {affordances.roadmap && (
                <section aria-labelledby="initiative-roadmap-section" className="space-y-default">
                    <h2 id="initiative-roadmap-section" className="text-lg font-semibold text-content-emphasis">
                        {t('detail.roadmap')}
                    </h2>
                    <div className="h-[30rem]">
                        <RoadmapView filters={sliceFilters} idPrefix="initiative-roadmap" labelledBy="initiative-roadmap-section" />
                    </div>
                </section>
            )}

            {editable && <InitiativeDialog open={editing} onOpenChange={setEditing} initiative={initiative} goals={goalOptions} />}
            {affordances.linkProject && <LinkProjectDialog open={linking} onOpenChange={setLinking} initiative={initiative} projects={linkable} />}
            {affordances.createProject && (
                <ProjectCreateDialog open={creatingProject} onOpenChange={setCreatingProject} offerInitiative presetInitiativeId={initiative.id} onCreated={() => void writes.revalidate()} />
            )}
        </EntityDetailLayout>
    );
}
