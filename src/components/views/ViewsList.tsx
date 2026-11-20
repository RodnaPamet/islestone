'use client';

/**
 * The Views page (sub-phase 2.4; 1.7's placeholder replaced): every saved
 * view the member can see, their own personal ones and every shared one in
 * a scope they see, each linking to its page with `?view=<id>`, which applies
 * it. Saving, changing and deleting a view happen on its page (the views
 * menu); this list reads.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { EntityListPage } from '@/components/layout/EntityListPage';
import { createColumns } from '@/components/ui/table';
import { useSavedViews } from '@/components/work-items/data/use-saved-views';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { SavedViewData } from '@/lib/work-items/types';

/** The page a view applies to, with the view named in the query. */
export function savedViewHref(view: Pick<SavedViewData, 'id' | 'project'>): string {
    const base = view.project ? `/projects/${encodeURIComponent(view.project.keyPrefix)}` : '/work-items';
    return `${base}?view=${encodeURIComponent(view.id)}`;
}

export function ViewsList({ title }: { title: string }) {
    const tList = useTranslations('views');
    const tenantHref = useTenantHref();
    const { views, truncated, error, isLoading } = useSavedViews(undefined);
    const columns = useMemo(
        () =>
            createColumns<SavedViewData>([
                {
                    id: 'name',
                    header: tList('col.name'),
                    cell: ({ row }) => (
                        <a href={tenantHref(savedViewHref(row.original))} className="text-content-emphasis hover:underline">
                            {row.original.name}
                        </a>
                    ),
                },
                { id: 'scope', header: tList('col.scope'), cell: ({ row }) => row.original.project?.name ?? tList('scopeWorkspace') },
                { id: 'layout', header: tList('col.layout'), cell: ({ row }) => tList(`layout.${row.original.layout}`) },
                {
                    id: 'visibility',
                    header: tList('col.visibility'),
                    cell: ({ row }) => (row.original.visibility === 'SHARED' ? tList('shared') : tList('personal')),
                },
            ]),
        [tList, tenantHref],
    );
    return (
        <EntityListPage<SavedViewData>
            header={{ title, description: truncated ? tList('truncated') : tList('description') }}
            table={{
                data: views,
                columns,
                loading: isLoading,
                error: error ? tList('loadFailed') : undefined,
                getRowId: (r) => r.id,
                selectionEnabled: false,
                emptyState: tList('empty'),
                resourceName: (plural: boolean) => (plural ? tList('resourcePlural') : tList('resource')),
                'data-testid': 'saved-views-table',
            }}
        />
    );
}
