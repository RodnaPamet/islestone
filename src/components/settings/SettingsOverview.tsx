'use client';

/**
 * Settings (decision 55): the landing page. One card per section, each with
 * its count and a link to its page, and, while the workspace has no open
 * project, the three steps to a first project (a team, then a project, then
 * work items) with each step's state read from the server. A viewer who may
 * not change anything is told so once; the section pages offer no writes to
 * them.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Card } from '@inflect/ui/components/ui/card';
import { Heading } from '@inflect/ui/components/ui/typography';
import { PageHeader } from '@/components/layout/PageHeader';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { useLabels, useProjects, useProjectTemplates, useTeams, useWorkItemTypes } from './settings-data';

const SECTIONS = ['teams', 'workItemTypes', 'labels', 'projects', 'projectTemplates', 'workingCalendars', 'intake', 'notifications', 'recipientLists', 'calendarSync', 'timeTracking', 'workload'] as const;
type SectionKey = (typeof SECTIONS)[number];

const SECTION_PATH: Record<SectionKey, string> = {
    teams: '/settings/teams',
    workItemTypes: '/settings/work-item-types',
    labels: '/settings/labels',
    projects: '/settings/projects',
    projectTemplates: '/settings/project-templates',
    workingCalendars: '/settings/working-calendars',
    intake: '/settings/intake',
    notifications: '/settings/notifications',
    recipientLists: '/settings/recipient-lists',
    calendarSync: '/settings/calendar-sync',
    timeTracking: '/settings/time-tracking',
    workload: '/settings/workload',
};

export function SettingsOverview({ title, affordances }: { title: string; affordances: WorkConfigAffordances }) {
    const t = useTranslations('settings');
    const tenantHref = useTenantHref();
    const teams = useTeams();
    const types = useWorkItemTypes();
    const labels = useLabels();
    const projects = useProjects();
    // The list takes `projects.create`; a viewer without it sees no count.
    const projectTemplates = useProjectTemplates(affordances.createProject);

    const counts: Record<SectionKey, number | undefined> = {
        teams: teams.data?.length,
        workItemTypes: types.data?.filter((x) => !x.archivedAt).length,
        labels: labels.data?.length,
        projects: projects.data?.filter((x) => !x.archivedAt).length,
        projectTemplates: projectTemplates.data?.length,
        workingCalendars: undefined,
        intake: undefined,
        notifications: undefined,
        recipientLists: undefined,
        calendarSync: undefined,
        timeTracking: undefined,
        workload: undefined,
    };
    const readOnly = !affordances.manageWorkConfig && !affordances.createProject;
    const hasTeam = (counts.teams ?? 0) > 0;
    const hasProject = (counts.projects ?? 0) > 0;
    const showFirstProject = !readOnly && teams.data !== undefined && projects.data !== undefined && !hasProject;

    const steps = [
        { key: 'team', done: hasTeam, text: t('firstProject.team'), href: SECTION_PATH.teams, link: t('firstProject.goTeams') },
        { key: 'project', done: hasProject, text: t('firstProject.project'), href: SECTION_PATH.projects, link: t('firstProject.goProjects') },
        { key: 'workItems', done: false, text: t('firstProject.workItems'), href: '/work-items', link: t('firstProject.goWorkItems') },
    ];

    return (
        <div className="space-y-section" data-testid="settings-overview">
            <PageHeader title={title} description={t('description')} />
            {readOnly && <p className="text-sm text-content-muted">{t('readOnly')}</p>}
            {showFirstProject && (
                <Card as="section" aria-labelledby="settings-first-project" className="space-y-default">
                    <Heading level={2} id="settings-first-project">
                        {t('firstProject.title')}
                    </Heading>
                    <p className="text-sm text-content-muted">{t('firstProject.body')}</p>
                    <ol className="list-decimal space-y-tight pl-5 text-sm">
                        {steps.map((step) => (
                            <li key={step.key}>
                                <span>{step.text}</span>{' '}
                                <span className="text-content-muted">({step.done ? t('firstProject.done') : t('firstProject.todo')})</span>{' '}
                                {!step.done && (
                                    <Link href={tenantHref(step.href)} className="text-content-emphasis underline">
                                        {step.link}
                                    </Link>
                                )}
                            </li>
                        ))}
                    </ol>
                </Card>
            )}
            <nav aria-label={t('sections.label')}>
                <ul className="grid grid-cols-1 gap-default md:grid-cols-2">
                    {SECTIONS.map((key) => (
                        <li key={key}>
                            <Card as="section" aria-labelledby={`settings-section-${key}`} className="h-full space-y-tight">
                                <Heading level={2} id={`settings-section-${key}`}>
                                    {t(`sections.${key}.title`)}
                                </Heading>
                                <p className="text-sm text-content-muted">{t(`sections.${key}.body`)}</p>
                                {counts[key] !== undefined && (
                                    <p className="text-sm" data-testid={`settings-count-${key}`}>
                                        {counts[key] === 0 ? t('sections.countNone') : t('sections.count', { count: counts[key] ?? 0 })}
                                    </p>
                                )}
                                <Link href={tenantHref(SECTION_PATH[key])} className="text-sm text-content-emphasis underline">
                                    {t(`sections.${key}.open`)}
                                </Link>
                            </Card>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    );
}
