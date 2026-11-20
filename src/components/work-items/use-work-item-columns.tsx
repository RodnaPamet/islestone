'use client';

/**
 * The work-item list's columns (key, title linking to the item's page, state,
 * priority, assignee, due date), shared by the list layout and My Work's
 * sections so every list reads the same.
 *
 * Written fresh for Islestone (sub-phase 2.3; shared with My Work by owner
 * decision 54).
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { createColumns } from '@/components/ui/table';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { workItemPath } from '@/lib/work-item-paths';
import type { WorkItemRow } from '@/lib/work-items/types';

import { PriorityBadge, StateBadge } from './badges';
import { memberLabel, useMembers, useWorkConfig } from './data/use-work-config';

export function useWorkItemColumns() {
    const tCols = useTranslations('workItems');
    const config = useWorkConfig();
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { byId: memberById } = useMembers();

    return useMemo(() => {
        const memberName = (id: string | null) => (id ? memberLabel(memberById.get(id)) : null);
        const openPage = (row: WorkItemRow) => router.push(tenantHref(workItemPath(row.key)));
        return createColumns<WorkItemRow>([
            { id: 'key', header: tCols('col.key'), cell: ({ row }) => <span className="font-mono text-xs text-content-muted">{row.original.key}</span> },
            {
                id: 'title',
                header: tCols('col.title'),
                cell: ({ row }) => (
                    <a
                        href={tenantHref(workItemPath(row.original.key))}
                        className="text-content-emphasis hover:underline"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openPage(row.original);
                        }}
                    >
                        {row.original.title}
                    </a>
                ),
            },
            {
                id: 'state',
                header: tCols('col.state'),
                cell: ({ row }) => <StateBadge name={config.stateById.get(row.original.stateId)?.name} category={row.original.stateCategory} />,
            },
            { id: 'priority', header: tCols('col.priority'), cell: ({ row }) => <PriorityBadge priority={row.original.priority} /> },
            {
                id: 'assignee',
                header: tCols('col.assignee'),
                cell: ({ row }) => memberName(row.original.assigneeId) ?? <span className="text-content-muted">{tCols('detail.unassigned')}</span>,
            },
            { id: 'due', header: tCols('col.dueDate'), cell: ({ row }) => row.original.dueDate ?? '' },
        ]);
    }, [tCols, config, router, tenantHref, memberById]);
}
