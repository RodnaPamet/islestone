'use client';

/**
 * A page tree, one parent's children at a time (sub-phase 4.1a; decision
 * 341): each row links to its page, shows "Expand" when it has subpages (read
 * when opened, a page at a time with "Load more"), and, where the server
 * offered the writes, "New subpage", "Rename", "Move…", "Move up", "Move
 * down" and "Delete" (through the undo toast). Nested lists with disclosure
 * buttons: every control is a button or a link the keyboard reaches.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { PAGE_MAX_DEPTH, type PageAffordances, type PageChildren, type PageData, type PageNode } from '@/lib/pages/types';

import { usePageChildren, usePageWrites, type PageTreeKey } from './use-pages';

export interface PageTreeActions {
    onNewSubpage: (parent: PageData) => void;
    onRename: (page: PageData) => void;
    onMove: (page: PageData) => void;
}

interface Props {
    tree: PageTreeKey;
    parentId: string | null;
    /** The parent's level in its tree: 0 for a tree's top level (rows below it are one deeper). */
    level: number;
    affordances: PageAffordances;
    actions: PageTreeActions;
    /** The server's first page, for the top list. */
    fallback?: PageChildren;
    /** The accessible name of the list. */
    label: string;
}

export function PageTreeList({ tree, parentId, level, affordances, actions, fallback, label }: Props) {
    // One cursor per loaded page of children: the first is null, each later one the previous page's last row.
    const [cursors, setCursors] = useState<Array<string | null>>([null]);
    return (
        <ul aria-label={label} className={level === 0 ? 'space-y-px' : 'ml-5 space-y-px border-l border-border-subtle pl-3'}>
            {cursors.map((after, i) => (
                <PageTreeChunk
                    key={after ?? 'first'}
                    after={after}
                    tree={tree}
                    parentId={parentId}
                    level={level}
                    affordances={affordances}
                    actions={actions}
                    fallback={i === 0 ? fallback : undefined}
                    onMore={i === cursors.length - 1 ? (next) => setCursors((c) => [...c, next]) : undefined}
                />
            ))}
        </ul>
    );
}

/** One page of a parent's children: the first, or the one after `after`. */
function PageTreeChunk({
    after,
    tree,
    parentId,
    level,
    affordances,
    actions,
    fallback,
    onMore,
}: Omit<Props, 'label'> & { after: string | null; onMore?: (next: string) => void }) {
    const tChunk = useTranslations('pages.tree');
    const { data, isLoading } = usePageChildren(tree, parentId, { fallback, after });
    const rows = data?.pages ?? [];
    if (after === null && !isLoading && rows.length === 0 && level === 0) {
        return <li className="py-2 text-sm text-content-muted">{affordances.create ? tChunk('emptyEditable') : tChunk('empty')}</li>;
    }
    const nextAfter = data?.nextAfter ?? null;
    return (
        <>
            {rows.map((page, i) => (
                <PageTreeRow
                    key={page.id}
                    tree={tree}
                    page={page}
                    level={level + 1}
                    affordances={affordances}
                    actions={actions}
                    previous={rows[i - 1] ?? null}
                    next={rows[i + 1] ?? null}
                />
            ))}
            {onMore && nextAfter && (
                <li>
                    <Button variant="ghost" size="sm" text={tChunk('loadMore')} onClick={() => onMore(nextAfter)} />
                </li>
            )}
        </>
    );
}

function PageTreeRow({
    tree,
    page,
    level,
    affordances,
    actions,
    previous,
    next,
}: {
    tree: PageTreeKey;
    page: PageNode;
    level: number;
    affordances: PageAffordances;
    actions: PageTreeActions;
    previous: PageNode | null;
    next: PageNode | null;
}) {
    const tRow = useTranslations('pages.tree');
    const tenantHref = useTenantHref();
    const writes = usePageWrites();
    const [open, setOpen] = useState(false);
    const hasChildren = page.childCount > 0;
    return (
        <li data-testid={`page-row-${page.id}`}>
            <div className="group flex flex-wrap items-center gap-tight rounded-md px-1 py-1 hover:bg-bg-muted">
                {hasChildren ? (
                    <button
                        type="button"
                        className="h-6 w-6 rounded text-content-muted hover:text-content-emphasis"
                        aria-expanded={open}
                        aria-label={open ? tRow('collapseNamed', { title: page.title }) : tRow('expandNamed', { title: page.title, count: page.childCount })}
                        onClick={() => setOpen((o) => !o)}
                    >
                        {open ? '▾' : '▸'}
                    </button>
                ) : (
                    <span className="inline-block h-6 w-6" aria-hidden="true" />
                )}
                <Link href={tenantHref(`/pages/${page.id}`)} className="min-w-0 flex-1 truncate text-sm text-content-emphasis hover:underline">
                    {page.title}
                </Link>
                {(affordances.create || affordances.edit || affordances.delete) && (
                    <div className="flex flex-wrap items-center gap-tight">
                        {affordances.create && level < PAGE_MAX_DEPTH && (
                            <Button variant="ghost" size="sm" text={tRow('newSubpage')} aria-label={tRow('newSubpageNamed', { title: page.title })} onClick={() => actions.onNewSubpage(page)} />
                        )}
                        {affordances.edit && (
                            <>
                                <Button variant="ghost" size="sm" text={tRow('rename')} aria-label={tRow('renameNamed', { title: page.title })} onClick={() => actions.onRename(page)} />
                                <Button variant="ghost" size="sm" text={tRow('move')} aria-label={tRow('moveNamed', { title: page.title })} onClick={() => actions.onMove(page)} />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    text={tRow('moveUp')}
                                    aria-label={tRow('moveUpNamed', { title: page.title })}
                                    disabled={previous === null}
                                    onClick={() => previous && void writes.reorder(page, { beforeId: previous.id })}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    text={tRow('moveDown')}
                                    aria-label={tRow('moveDownNamed', { title: page.title })}
                                    disabled={next === null}
                                    onClick={() => next && void writes.reorder(page, { afterId: next.id })}
                                />
                            </>
                        )}
                        {affordances.delete && (
                            <Button variant="ghost" size="sm" text={tRow('delete')} aria-label={tRow('deleteNamed', { title: page.title })} onClick={() => writes.remove(page)} />
                        )}
                    </div>
                )}
            </div>
            {open && hasChildren && (
                <PageTreeList tree={tree} parentId={page.id} level={level} affordances={affordances} actions={actions} label={tRow('subpagesOf', { title: page.title })} />
            )}
        </li>
    );
}
