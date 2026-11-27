'use client';

/**
 * A page's own view (sub-phase 4.1a): the breadcrumb (its tree, then its
 * ancestors), the header with its title and, where the server offered them,
 * "New subpage", "Rename", "Move…" and "Delete" (through the undo toast),
 * the body area and the page's subpages. The body is written in 4.1b's
 * editor; until then the area shows that the page holds no content.
 *
 * Written fresh for Islestone.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { PageData, PageDetail } from '@/lib/pages/types';

import { MovePageDialog, type PageTreeOption } from './MovePageDialog';
import { PageTitleDialog, type PageTitleDialogTarget } from './PageTitleDialog';
import { PageTreeList } from './PageTree';
import { treeKeyOf } from './PageTreeView';
import { usePage, usePageWrites } from './use-pages';

export function PageView({ initialDetail, trees }: { initialDetail: PageDetail; trees: readonly PageTreeOption[] }) {
    const t = useTranslations('pages');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { data } = usePage(initialDetail.page.id, initialDetail);
    const detail = data ?? initialDetail;
    const { page, scope, affordances } = detail;
    const writes = usePageWrites();
    const [titleTarget, setTitleTarget] = useState<PageTitleDialogTarget | null>(null);
    const [moving, setMoving] = useState<PageData | null>(null);
    const tree = treeKeyOf(scope);
    const treeHref = scope.kind === 'project' ? tenantHref(`/projects/${encodeURIComponent(scope.keyPrefix)}/pages`) : tenantHref('/pages');

    const breadcrumbs = useMemo(
        () => [
            { label: scope.kind === 'project' ? t('projectTitle', { project: scope.name }) : t('workspaceTitle'), href: treeHref },
            ...detail.ancestors.map((a) => ({ label: a.title, href: tenantHref(`/pages/${encodeURIComponent(a.id)}`) })),
            { label: page.title },
        ],
        [detail.ancestors, page.title, scope, t, tenantHref, treeHref],
    );

    return (
        <EntityDetailLayout
            back={{ smart: true }}
            breadcrumbs={breadcrumbs}
            title={page.title}
            meta={scope.kind === 'project' && scope.archived ? <span className="text-xs text-content-muted">{t('archived')}</span> : undefined}
            actions={
                <span className="flex flex-wrap gap-tight">
                    {affordances.create && detail.subpageFits && (
                        <Button variant="secondary" text={t('tree.newSubpage')} onClick={() => setTitleTarget({ mode: 'create', tree, parentId: page.id })} />
                    )}
                    {affordances.edit && (
                        <>
                            <Button variant="secondary" text={t('tree.rename')} onClick={() => setTitleTarget({ mode: 'rename', page })} />
                            <Button variant="secondary" text={t('tree.move')} onClick={() => setMoving(page)} />
                        </>
                    )}
                    {affordances.delete && <Button variant="secondary" text={t('tree.delete')} onClick={() => writes.remove(page, () => router.push(treeHref))} />}
                </span>
            }
        >
            <section aria-labelledby="page-body-heading" className="space-y-default">
                <h2 id="page-body-heading" className="sr-only">
                    {t('bodyHeading')}
                </h2>
                <p className="rounded-md border border-dashed border-border-subtle p-6 text-sm text-content-muted" data-testid="page-body">
                    {t('bodyEmpty')}
                </p>
            </section>
            <section aria-labelledby="page-subpages-heading" className="space-y-default">
                <h2 id="page-subpages-heading" className="text-lg font-semibold text-content-emphasis">
                    {t('subpagesHeading')}
                </h2>
                {detail.children.pages.length === 0 ? (
                    <p className="text-sm text-content-muted">{t('noSubpages')}</p>
                ) : (
                    <PageTreeList
                        tree={tree}
                        parentId={page.id}
                        level={detail.level}
                        affordances={affordances}
                        fallback={detail.children}
                        label={t('tree.subpagesOf', { title: page.title })}
                        actions={{
                            onNewSubpage: (parent) => setTitleTarget({ mode: 'create', tree, parentId: parent.id }),
                            onRename: (p) => setTitleTarget({ mode: 'rename', page: p }),
                            onMove: (p) => setMoving(p),
                        }}
                    />
                )}
            </section>
            <PageTitleDialog target={titleTarget} onClose={() => setTitleTarget(null)} />
            <MovePageDialog page={moving} trees={trees} onClose={() => setMoving(null)} />
        </EntityDetailLayout>
    );
}
