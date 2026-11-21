'use client';

/**
 * The Projects page's list: each visible project, its key prefix, its team
 * and whether it is archived, linking to the project's work items. Written
 * fresh for Islestone (sub-phase 2.3); it replaces 1.7's placeholder.
 *
 * Anyone who may create a project (`mayCreateProject`, the server's answer
 * from the predicate the usecase asserts; owner decision 57) gets a header
 * button opening the same dialog as Settings → Projects. A created project
 * shows at once and the server's list is read again (`router.refresh()`).
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { EntityListPage } from '@/components/layout/EntityListPage';
import { ProjectCreateDialog } from '@/components/settings/ProjectCreateDialog';
import type { SettingsProject } from '@/components/settings/settings-data';
import { createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { ViewProject } from '@/lib/work-items/types';

export function ProjectsList({
    title,
    projects,
    teams,
    mayCreateProject,
}: {
    title: string;
    projects: ViewProject[];
    teams: Array<{ id: string; name: string }>;
    /** Whether the viewer may create a project, asked on the server. */
    mayCreateProject: boolean;
}) {
    const t = useTranslations('workItems');
    const tSettings = useTranslations('settings');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const [creating, setCreating] = useState(false);
    // Projects created here, shown until the refreshed server list has them.
    const [created, setCreated] = useState<ViewProject[]>([]);
    const shown = useMemo(() => {
        const known = new Set(projects.map((p) => p.id));
        return [...projects, ...created.filter((p) => !known.has(p.id))];
    }, [projects, created]);
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
                { id: 'dueDate', header: t('projects.col.dueDate'), cell: ({ row }) => <span className="tabular-nums">{row.original.dueDate ?? ''}</span> },
            ]),
        [t, tenantHref, teamName],
    );
    return (
        <EntityListPage<ViewProject>
            header={{
                title,
                actions: mayCreateProject ? (
                    <Button id="new-project-btn" variant="primary" icon={<Plus />} text={tSettings('projects.create')} onClick={() => setCreating(true)} />
                ) : undefined,
            }}
            table={{
                data: shown,
                columns,
                getRowId: (r) => r.id,
                onRowClick: (row) => router.push(tenantHref(`/projects/${row.original.keyPrefix}`)),
                selectionEnabled: false,
                emptyState: t('projects.empty'),
                'data-testid': 'projects-table',
            }}
        >
            {mayCreateProject && (
                <ProjectCreateDialog
                    open={creating}
                    onOpenChange={setCreating}
                    onCreated={(project: SettingsProject) => {
                        setCreated((prev) => [
                            ...prev,
                            { id: project.id, teamId: project.teamId, name: project.name, keyPrefix: project.keyPrefix, archived: project.archivedAt !== null, dueDate: project.dueDate ?? null },
                        ]);
                        router.refresh();
                    }}
                />
            )}
        </EntityListPage>
    );
}
