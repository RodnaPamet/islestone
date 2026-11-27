'use client';

/**
 * A page tree's own view (sub-phase 4.1a; decision 341): Workspace pages, or
 * a project's Pages. Its top level, each page expandable, "New page" and the
 * row actions where the server offered them (`pageAffordances`, asked on the
 * server: never a role or a key here), and, for a holder of `pages.delete`,
 * the tree's Deleted list with "Restore" for each deleted group's root.
 *
 * Written fresh for Islestone.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { PageAffordances, PageChildren, PageData, PageScope } from '@/lib/pages/types';

import { MovePageDialog, type PageTreeOption } from './MovePageDialog';
import { PageTitleDialog, type PageTitleDialogTarget } from './PageTitleDialog';
import { PageTreeList } from './PageTree';
import { useDeletedPages, usePageWrites, type PageTreeKey } from './use-pages';

export function treeKeyOf(scope: PageScope): PageTreeKey {
    return scope.kind === 'project' ? { kind: 'project', projectId: scope.projectId } : { kind: 'workspace' };
}

export function PageTreeView({
    scope,
    initialChildren,
    affordances,
    trees,
}: {
    scope: PageScope;
    initialChildren: PageChildren;
    affordances: PageAffordances;
    trees: readonly PageTreeOption[];
}) {
    const t = useTranslations('pages');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const tree = treeKeyOf(scope);
    const [titleTarget, setTitleTarget] = useState<PageTitleDialogTarget | null>(null);
    const [moving, setMoving] = useState<PageData | null>(null);
    const [showDeleted, setShowDeleted] = useState(false);
    const title = scope.kind === 'project' ? t('projectTitle', { project: scope.name }) : t('workspaceTitle');

    return (
        <DashboardLayout
            header={{
                title,
                description: scope.kind === 'project' ? t('projectDescription', { project: scope.name }) : t('workspaceDescription'),
                actions: affordances.create ? (
                    <Button variant="primary" icon={<Plus />} text={t('new')} onClick={() => setTitleTarget({ mode: 'create', tree, parentId: null })} />
                ) : undefined,
            }}
            data-testid="page-tree"
        >
            <section aria-labelledby="page-tree-heading" className="space-y-default">
                <h2 id="page-tree-heading" className="text-lg font-semibold text-content-emphasis">
                    {t('treeHeading')}
                </h2>
                {scope.kind === 'project' && scope.archived && <p className="text-sm text-content-muted">{t('archived')}</p>}
                <PageTreeList
                    tree={tree}
                    parentId={null}
                    level={0}
                    affordances={affordances}
                    fallback={initialChildren}
                    label={title}
                    actions={{
                        onNewSubpage: (parent) => setTitleTarget({ mode: 'create', tree, parentId: parent.id }),
                        onRename: (page) => setTitleTarget({ mode: 'rename', page }),
                        onMove: (page) => setMoving(page),
                    }}
                />
            </section>
            {affordances.delete && (
                <section aria-labelledby="page-deleted-heading" className="space-y-default">
                    <h2 id="page-deleted-heading" className="text-lg font-semibold text-content-emphasis">
                        {t('deletedHeading')}
                    </h2>
                    <Button variant="secondary" size="sm" text={showDeleted ? t('hideDeleted') : t('showDeleted')} aria-expanded={showDeleted} onClick={() => setShowDeleted((s) => !s)} />
                    {showDeleted && <DeletedPages tree={tree} />}
                </section>
            )}
            <PageTitleDialog target={titleTarget} onClose={() => setTitleTarget(null)} onCreated={(page) => router.push(tenantHref(`/pages/${page.id}`))} />
            <MovePageDialog page={moving} trees={trees} onClose={() => setMoving(null)} />
        </DashboardLayout>
    );
}

function DeletedPages({ tree }: { tree: PageTreeKey }) {
    const tDeleted = useTranslations('pages.deleted');
    const { data, isLoading } = useDeletedPages(tree, true);
    const writes = usePageWrites();
    const rows = data?.pages ?? [];
    if (isLoading) return <p className="text-sm text-content-muted">{tDeleted('loading')}</p>;
    if (rows.length === 0) return <p className="text-sm text-content-muted">{tDeleted('empty')}</p>;
    return (
        <ul className="space-y-px" aria-label={tDeleted('listLabel')}>
            {rows.map((page) => (
                <li key={page.id} className="flex flex-wrap items-center justify-between gap-tight border-t border-border-subtle py-2 first:border-t-0">
                    <span className="min-w-0 text-sm text-content-default">
                        {page.title}
                        <span className="ml-2 text-xs text-content-muted">{tDeleted('meta', { date: page.deletedAt.slice(0, 10), count: page.groupSize })}</span>
                    </span>
                    <Button variant="ghost" size="sm" text={tDeleted('restore')} aria-label={tDeleted('restoreNamed', { title: page.title })} onClick={() => void writes.restore(page)} />
                </li>
            ))}
        </ul>
    );
}
