'use client';

/**
 * The Projects page's list: each visible project, its key prefix, its team
 * and whether it is archived, linking to the project's work items. Written
 * fresh for Islestone (sub-phase 2.3); it replaces 1.7's placeholder.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EntityListPage } from '@/components/layout/EntityListPage';
import { createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { ViewProject } from '@/lib/work-items/types';

export function ProjectsList({ title, projects, teams }: { title: string; projects: ViewProject[]; teams: Array<{ id: string; name: string }> }) {
    const t = useTranslations('workItems');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const teamName = useMemo(() => new Map(teams.map((x) => [x.id, x.name])), [teams]);
    const columns = useMemo(
        () =>
            createColumns<ViewProject>([
                {
                    id: 'name',
                    header: t('projects.col.name'),
                    cell: ({ row }) => (
                        <a href={tenantHref(`/projects/${row.original.keyPrefix}`)} className="text-content-emphasis hover:underline">
                            {row.original.name}
                        </a>
                    ),
                },
                { id: 'key', header: t('projects.col.key'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.keyPrefix}</span> },
                { id: 'team', header: t('projects.col.team'), cell: ({ row }) => teamName.get(row.original.teamId) ?? '' },
                { id: 'status', header: t('projects.col.status'), cell: ({ row }) => (row.original.archived ? t('projects.archived') : t('projects.active')) },
            ]),
        [t, tenantHref, teamName],
    );
    return (
        <EntityListPage<ViewProject>
            header={{ title }}
            table={{
                data: projects,
                columns,
                getRowId: (r) => r.id,
                onRowClick: (row) => router.push(tenantHref(`/projects/${row.original.keyPrefix}`)),
                selectionEnabled: false,
                emptyState: t('projects.empty'),
                'data-testid': 'projects-table',
            }}
        />
    );
}
