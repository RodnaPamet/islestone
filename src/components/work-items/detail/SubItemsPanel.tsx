'use client';

/**
 * An item's sub-items: the shared list query scoped to `parentId`, in manual
 * order, with a progress line (done over total) and a tick per row. Ticking
 * moves the sub-item to its team's default DONE state, unticking to the
 * default UNSTARTED state, through the same optimistic state write the
 * detail uses.
 *
 * Copied from inflect-compliance `src/components/LinkedTasksPanel.tsx` and
 * `src/components/controls-shared/TaskChecklistPanel.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3) and rewritten:
 * ADR 0006 has no checklist (sub-items are work items with a parent); the
 * compliance link scope, severity and type label tables are cut; the create
 * button keeps its own key (`work_items.create`), separate from the edit key
 * the ticks need (inflect #4415).
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { WorkItemRow } from '@/lib/work-items/types';
import { isClosed } from '@/lib/work-items/presentation';

import { StateBadge } from '../badges';
import { useWorkConfig } from '../data/use-work-config';
import { useWorkItemList } from '../data/use-work-item-list';
import { useWorkItemMutations } from '../data/use-work-item-mutations';
import { NewWorkItemModal } from '../NewWorkItemModal';

export function SubItemsPanel({
    parent,
    canCreate,
    canEdit,
    onOpen,
}: {
    parent: WorkItemRow;
    canCreate: boolean;
    canEdit: boolean;
    onOpen: (row: WorkItemRow) => void;
}) {
    const t = useTranslations('workItems');
    const config = useWorkConfig();
    const mutations = useWorkItemMutations();
    const [creating, setCreating] = useState(false);
    const { items, error, hasMore, loadMore, isLoading } = useWorkItemList({ parentId: parent.id, order: 'manual' }, { limit: 100 });
    const done = items.filter((i) => i.stateCategory === 'DONE').length;

    const tick = (row: WorkItemRow, checked: boolean) => {
        const target = config.defaultStateOf(row.teamId, checked ? 'DONE' : 'UNSTARTED');
        if (target && target.id !== row.stateId) void mutations.setState(row, target.id);
    };

    return (
        <section aria-labelledby={`sub-items-${parent.id}`} className="space-y-default">
            <div className="flex items-center justify-between gap-2">
                <h3 id={`sub-items-${parent.id}`} className="text-sm font-semibold text-content-emphasis">
                    {t('subItems.title')}
                </h3>
                {canCreate && <Button variant="secondary" size="sm" text={t('subItems.add')} onClick={() => setCreating(true)} />}
            </div>
            {items.length > 0 && (
                <div>
                    <p className="text-xs text-content-muted">{t('subItems.progress', { done, total: items.length })}</p>
                    <div
                        role="progressbar"
                        aria-label={t('subItems.progressLabel')}
                        aria-valuemin={0}
                        aria-valuemax={items.length}
                        aria-valuenow={done}
                        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"
                    >
                        <div className="h-full bg-content-success" style={{ width: `${(done / items.length) * 100}%` }} />
                    </div>
                </div>
            )}
            {error && <p role="alert">{t('detail.loadFailed')}</p>}
            <ul className="space-y-tight" aria-label={t('subItems.title')}>
                {items.map((row) => {
                    const state = config.stateById.get(row.stateId);
                    return (
                        <li key={row.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                                checked={row.stateCategory === 'DONE'}
                                disabled={!canEdit || (isClosed(row.stateCategory) && row.stateCategory !== 'DONE')}
                                aria-label={t('subItems.markDone', { key: row.key })}
                                onCheckedChange={(v) => tick(row, v === true)}
                            />
                            <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => onOpen(row)}>
                                <span className="text-content-muted">{row.key}</span> {row.title}
                            </button>
                            <StateBadge name={state?.name} category={row.stateCategory} />
                        </li>
                    );
                })}
            </ul>
            {!isLoading && items.length === 0 && !error && <p className="text-sm text-content-muted">{t('subItems.empty')}</p>}
            {hasMore && <Button variant="ghost" size="sm" text={t('list.loadMore')} onClick={loadMore} />}
            <NewWorkItemModal
                open={creating}
                onOpenChange={setCreating}
                initial={{ projectId: parent.projectId, parentId: parent.id, parentKey: parent.key }}
            />
        </section>
    );
}
