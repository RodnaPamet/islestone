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
import type { ColumnDef } from '@/components/ui/table/types';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { workItemPath } from '@/lib/work-item-paths';
import type { WorkItemRow } from '@/lib/work-items/types';

import { PriorityBadge, StateBadge } from './badges';
import { memberLabel, useMembers, useWorkConfig } from './data/use-work-config';
import { customFieldText } from './fields/custom-field-format';

/** `extended` (the list with its column gear, 2.4) adds created, updated, type and the page's custom fields. */
export function useWorkItemColumns(extended = false) {
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
            // Sub-phase 2.4: hidden until the column gear (or a saved view) shows them.
            ...(extended ? extendedColumns() : []),
        ]);
        function extendedColumns(): Array<ColumnDef<WorkItemRow>> {
            return [
            { id: 'created', header: tCols('col.created'), cell: ({ row }) => row.original.createdAt.slice(0, 10) },
            { id: 'updated', header: tCols('col.updated'), cell: ({ row }) => row.original.updatedAt.slice(0, 10) },
            { id: 'type', header: tCols('col.type'), cell: ({ row }) => config.typeById.get(row.original.typeId)?.name ?? '' },
            ...(config.customFields ?? [])
                .filter((f) => !f.archived)
                .map((field): ColumnDef<WorkItemRow> => ({
                    id: `cf:${field.id}`,
                    header: field.name,
                    cell: ({ row }) => {
                        const value = row.original.customFields?.[field.id];
                        const text = customFieldText(field, value, (id) => memberLabel(memberById.get(id)), tCols('customFields.checked'));
                        if (field.type === 'URL' && typeof value === 'string' && /^https?:\/\//.test(value)) {
                            return (
                                <a href={value} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline" onClick={(e) => e.stopPropagation()}>
                                    {text}
                                </a>
                            );
                        }
                        return text;
                    },
                })),
            ];
        }
    }, [tCols, config, router, tenantHref, memberById, extended]);
}

/** The column gear's columns for the list: the 2.3 six by default, the rest hidden until chosen. */
export function useWorkItemColumnChoices() {
    const tChoice = useTranslations('workItems');
    const config = useWorkConfig();
    return useMemo(
        () => [
            { id: 'key', label: tChoice('col.key') },
            { id: 'title', label: tChoice('col.title'), alwaysVisible: true },
            { id: 'state', label: tChoice('col.state') },
            { id: 'priority', label: tChoice('col.priority') },
            { id: 'assignee', label: tChoice('col.assignee') },
            { id: 'due', label: tChoice('col.dueDate') },
            { id: 'created', label: tChoice('col.created'), defaultVisible: false },
            { id: 'updated', label: tChoice('col.updated'), defaultVisible: false },
            { id: 'type', label: tChoice('col.type'), defaultVisible: false },
            ...(config.customFields ?? []).filter((f) => !f.archived).map((f) => ({ id: `cf:${f.id}`, label: f.name, defaultVisible: false })),
        ],
        [tChoice, config],
    );
}
