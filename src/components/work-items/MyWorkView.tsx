'use client';

/**
 * My Work (owner decisions 54, 76 and 152): six sections over the shared
 * list query, one filter toolbar for all of them, the create dialog and the
 * detail sheet.
 *
 *   0. To review       — `reviewerId=me` (2.8b; the server reads the caller:
 *                        items whose OPEN review step still asks them, not
 *                        yet responded, not withdrawn)
 *   1. Assigned to me  — `assigneeId=<me>`
 *   2. Waiting on me   — `waitingOnId=me` (2.7a; the server reads the caller;
 *                        open items only, by the 2.4b CHECK)
 *   3. Created by me   — `createdById=<me>`
 *   4. Watching        — `watching=me` (the server reads the caller)
 *   5. Due soon        — `assigneeId=<me>&due=soon`: open, overdue or due
 *                        within `DUE_SOON_DAYS` (the server's window)
 *
 * An item may sit in several sections. Each section is a `useWorkItemList`
 * read (so a write anywhere places the row here too, `work-item-cache.ts`),
 * with its count of loaded rows ("N+" while more pages exist), an empty
 * state and an explicit "Load more": stacked sections would keep pushing the
 * next one away under load-on-scroll. Closed categories are hidden unless the
 * category filter names some (a My Work default; the Work items page shows
 * every category). Sections are lists only; the board is the Work items and
 * project pages' (decisions recorded with decision 54).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { FilterProvider, useFilters } from '@/components/ui/filter';
import { DataTable } from '@/components/ui/table';
import { usePermissions } from '@/lib/tenant-context-provider';
import type { WorkItemRow } from '@/lib/work-items/types';
import { DUE_SOON_DAYS } from '@/app-layer/domain/work-item-due';
import { OPEN_CATEGORIES } from '@/app-layer/domain/workflow-state';

import type { WorkItemListFilters } from './data/list-filters';
import { useWorkItemList } from './data/use-work-item-list';
import { NewWorkItemModal } from './NewWorkItemModal';
import { useWorkItemColumns } from './use-work-item-columns';
import { useListFiltersFromContext, useWorkItemFilterContext } from './use-work-item-filter-context';
import { WorkItemSheet } from './WorkItemSheet';

/** Rows per page in each section. */
export const MY_WORK_PAGE_SIZE = 25;

export type MyWorkSectionId = 'toReview' | 'assigned' | 'waitingOn' | 'created' | 'watching' | 'dueSoon';

/** Each section's fixed filters for the person `userId`. */
export function myWorkSectionFilters(userId: string): Record<MyWorkSectionId, WorkItemListFilters> {
    return {
        toReview: { reviewerId: 'me' },
        assigned: { assigneeId: userId },
        waitingOn: { waitingOnId: 'me' },
        created: { createdById: userId },
        watching: { watching: 'me' },
        dueSoon: { assigneeId: userId, due: 'soon' },
    };
}

/** "To review" first (the 2.8 map): the person's move on someone else's work. */
const SECTION_ORDER: readonly MyWorkSectionId[] = ['toReview', 'assigned', 'waitingOn', 'created', 'watching', 'dueSoon'];

/** The filter scope: My Work fixes the person, so no assignee facet. */
const FILTER_SCOPE = { fixedAssignee: true } as const;

export interface MyWorkViewProps {
    /** The signed-in member, from the server page's context. */
    userId: string;
    title: string;
}

export function MyWorkView(props: MyWorkViewProps) {
    const { filterCtx } = useWorkItemFilterContext(FILTER_SCOPE);
    return (
        <FilterProvider value={filterCtx}>
            <MyWorkBody {...props} />
        </FilterProvider>
    );
}

function MyWorkBody({ userId, title }: MyWorkViewProps) {
    const tMyWork = useTranslations('workItems');
    const perms = usePermissions().work_items;
    const [sheetId, setSheetId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const fromContext = useListFiltersFromContext();
    const { filters: filterDefs } = useFilters();

    // The person's filters, the closed categories hidden unless chosen, and
    // the manual order (other sorts wait for 2.4). The section's own filters
    // are applied last, so they win (a `due` facet never widens "Due soon").
    const shared = useMemo<WorkItemListFilters>(
        () => ({
            ...fromContext,
            stateCategory: fromContext.stateCategory || OPEN_CATEGORIES.join(','),
            order: 'manual',
        }),
        [fromContext],
    );
    const sectionFilters = useMemo(() => myWorkSectionFilters(userId), [userId]);

    return (
        <DashboardLayout
            header={{
                title,
                description: tMyWork('myWork.description'),
                actions: perms.create ? (
                    <Button id="new-work-item-btn" variant="primary" icon={<Plus />} text={tMyWork('list.create')} onClick={() => setCreating(true)} />
                ) : undefined,
            }}
            data-testid="my-work"
        >
            <div className="space-y-tight">
                <FilterToolbar
                    filters={filterDefs}
                    searchId="work-items-search"
                    searchPlaceholder={tMyWork('list.searchPlaceholder')}
                />
                {!fromContext.stateCategory && <p className="text-xs text-content-muted">{tMyWork('myWork.closedHidden')}</p>}
            </div>
            {SECTION_ORDER.map((id) => (
                <MyWorkSection key={id} id={id} filters={{ ...shared, ...sectionFilters[id] }} onOpen={(row) => setSheetId(row.id)} />
            ))}
            <WorkItemSheet workItemId={sheetId} onClose={() => setSheetId(null)} onOpenItem={(r) => setSheetId(r.id)} />
            <NewWorkItemModal open={creating} onOpenChange={setCreating} onCreated={(item) => setSheetId(item.id)} />
        </DashboardLayout>
    );
}

function MyWorkSection({ id, filters, onOpen }: { id: MyWorkSectionId; filters: WorkItemListFilters; onOpen: (row: WorkItemRow) => void }) {
    const tSection = useTranslations('workItems');
    const headingId = useId();
    // Every section shows where an item's review stands (2.8b).
    const columns = useWorkItemColumns(false, { review: true });
    const list = useWorkItemList(filters, { limit: MY_WORK_PAGE_SIZE });
    const count = list.items.length;
    const days = { days: DUE_SOON_DAYS };
    const sectionTitle = tSection(`myWork.sections.${id}.title`);

    return (
        <section aria-labelledby={headingId} className="space-y-tight" data-testid={`my-work-${id}`}>
            <div className="flex flex-wrap items-baseline gap-tight">
                <h2 id={headingId} className="text-sm font-semibold text-content-emphasis">
                    {sectionTitle}
                </h2>
                {!list.isLoading && !list.error && (
                    <span className="text-xs text-content-muted">
                        <span className="sr-only">{tSection('myWork.countHint')} </span>
                        {list.hasMore ? tSection('myWork.countMore', { count }) : tSection('myWork.count', { count })}
                    </span>
                )}
            </div>
            {id === 'dueSoon' && <p className="text-xs text-content-muted">{tSection('myWork.sections.dueSoon.description', days)}</p>}
            {id === 'toReview' && <p className="text-xs text-content-muted">{tSection('myWork.sections.toReview.description')}</p>}
            <DataTable<WorkItemRow>
                data={list.items}
                columns={columns}
                loading={list.isLoading}
                error={list.error ? tSection('list.loadFailed') : undefined}
                getRowId={(r) => r.id}
                onRowClick={(row) => onOpen(row.original)}
                selectionEnabled={false}
                emptyState={tSection(`myWork.sections.${id}.empty`, days)}
                resourceName={(plural) => (plural ? tSection('list.resourcePlural') : tSection('list.resource'))}
                data-testid={`my-work-${id}-table`}
            />
            {list.hasMore && (
                <Button
                    variant="secondary"
                    size="sm"
                    text={tSection('list.loadMore')}
                    aria-label={tSection('myWork.loadMoreIn', { section: sectionTitle })}
                    loading={list.isLoadingMore}
                    onClick={list.loadMore}
                />
            )}
        </section>
    );
}
