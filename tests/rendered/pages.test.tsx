/** @jest-environment jsdom */

/**
 * The page views (sub-phase 4.1a): a tree's top level with its links, the
 * expand button reading a page's subpages, the writes offered only where the
 * server said so (a viewer and an archived project see none), the undo-toast
 * delete, the reorder by neighbour, the create dialog, the rename sending its
 * version, and a page's breadcrumb, header and empty body.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const push = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/pages',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { PageTreeView } from '@/components/pages/PageTreeView';
import { PageView } from '@/components/pages/PageView';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { PageAffordances, PageChildren, PageDetail, PageNode, PageTreeOption } from '@/lib/pages/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const at = '2026-11-20T10:00:00.000Z';
const node = (id: string, title: string, childCount = 0, parentId: string | null = null): PageNode => ({
    id,
    projectId: null,
    parentId,
    title,
    version: 1,
    createdByUserId: 'u-ada',
    createdAt: at,
    updatedAt: at,
    contentUpdatedAt: null,
    childCount,
});
const SPEC = node('pg-1', 'Spec', 2);
const NOTES = node('pg-2', 'Meeting minutes');
const TOP: PageChildren = { pages: [SPEC, NOTES], nextAfter: null };
const UNDER_SPEC: PageChildren = { pages: [node('pg-3', 'Goals', 0, 'pg-1'), node('pg-4', 'Risks', 0, 'pg-1')], nextAfter: null };
const ALL: PageAffordances = { view: true, create: true, edit: true, delete: true };
const READ: PageAffordances = { view: true, create: false, edit: false, delete: false };
const TREES: PageTreeOption[] = [{ key: { kind: 'workspace' }, label: 'Workspace pages' }];
const TREE_GET = 'GET /pages';

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
    push.mockReset();
});

describe('a page tree', () => {
    it('lists the top level, links each page, reads subpages when expanded, with no axe violations', async () => {
        const { calls } = installFetch({
            [TREE_GET]: (rec) => ({ body: rec.search.get('parentId') === 'pg-1' ? UNDER_SPEC : TOP }),
        });
        const { container } = renderWorkspace(<PageTreeView scope={{ kind: 'workspace' }} initialChildren={TOP} affordances={ALL} trees={TREES} />);
        const list = screen.getByRole('list', { name: 'Workspace pages' });
        expect(within(list).getByRole('link', { name: 'Spec' })).toHaveAttribute('href', '/t/acme/pages/pg-1');
        expect(within(list).getByRole('link', { name: 'Meeting minutes' })).toBeInTheDocument();
        const expand = screen.getByRole('button', { name: 'Expand Spec (2 subpages)' });
        expect(expand).toHaveAttribute('aria-expanded', 'false');
        // A page without subpages offers no expand.
        expect(screen.queryByRole('button', { name: /Expand Meeting minutes/ })).toBeNull();
        fireEvent.click(expand);
        const sub = await screen.findByRole('list', { name: 'Subpages of Spec' });
        expect(within(sub).getAllByRole('link').map((a) => a.textContent)).toEqual(['Goals', 'Risks']);
        expect(calls.some((c) => c.path === '/pages' && c.search.get('parentId') === 'pg-1' && c.search.get('scope') === 'workspace')).toBe(true);
        expect(screen.getByRole('button', { name: 'Move Spec up' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move Meeting minutes down' })).toBeDisabled();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('offers no write to a viewer, nor in an archived project', () => {
        installFetch({ [TREE_GET]: { body: TOP } });
        const { unmount } = renderWorkspace(<PageTreeView scope={{ kind: 'workspace' }} initialChildren={TOP} affordances={READ} trees={TREES} />, { role: 'VIEWER' });
        expect(screen.queryByRole('button', { name: 'Page' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^(Rename|Move|Delete|New subpage) / })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Deleted pages' })).toBeNull();
        unmount();
        renderWorkspace(
            <PageTreeView
                scope={{ kind: 'project', projectId: 'p-1', keyPrefix: 'ISL', name: 'Islestone', archived: true }}
                initialChildren={TOP}
                affordances={READ}
                trees={TREES}
            />,
        );
        expect(screen.getByText('This project is archived: its pages can be read, not changed.')).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Islestone pages' })).toBeInTheDocument();
    });

    it('deletes through the undo toast: nothing is sent until the window closes, and Undo sends nothing', async () => {
        const { calls } = installFetch({ [TREE_GET]: { body: TOP }, 'DELETE /pages/pg-2': { body: { deleted: true, deletionId: 'd', pages: 1 } } });
        renderWorkspace(<PageTreeView scope={{ kind: 'workspace' }} initialChildren={TOP} affordances={ALL} trees={TREES} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Meeting minutes' }));
        expect(await screen.findByText('Deleted Meeting minutes and the pages below it')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('moves a page down by naming its neighbour, and creates a page then opens it', async () => {
        const { calls } = installFetch({
            [TREE_GET]: { body: TOP },
            'POST /pages/pg-1/move': { body: SPEC },
            'POST /pages': { status: 201, body: node('pg-9', 'Untitled') },
        });
        renderWorkspace(<PageTreeView scope={{ kind: 'workspace' }} initialChildren={TOP} affordances={ALL} trees={TREES} />);
        fireEvent.click(screen.getByRole('button', { name: 'Move Spec down' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/pages/pg-1/move')?.body).toEqual({ projectId: null, parentId: null, afterId: 'pg-2' }));
        fireEvent.click(screen.getByRole('button', { name: 'Page' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create page' }));
        await waitFor(() => expect(push).toHaveBeenCalledWith('/t/acme/pages/pg-9'));
        expect(calls.find((c) => c.method === 'POST' && c.path === '/pages')?.body).toEqual({ projectId: null, parentId: null });
    });
});

describe('a page', () => {
    const DETAIL: PageDetail = {
        page: { ...node('pg-3', 'Goals', 0, 'pg-1'), projectId: 'p-1', version: 4 },
        scope: { kind: 'project', projectId: 'p-1', keyPrefix: 'ISL', name: 'Islestone', archived: false },
        ancestors: [{ id: 'pg-1', title: 'Spec' }],
        level: 2,
        subpageFits: true,
        children: { pages: [], nextAfter: null },
        affordances: ALL,
    };

    it('shows its breadcrumb, header actions and empty body, and renames with its version', async () => {
        const { calls } = installFetch({ 'GET /pages/pg-3': { body: DETAIL }, 'PATCH /pages/pg-3': { body: { ...DETAIL.page, title: 'Aims', version: 5 } } });
        const { container } = renderWorkspace(<PageView initialDetail={DETAIL} trees={TREES} />);
        expect(screen.getByRole('link', { name: 'Islestone pages' })).toHaveAttribute('href', '/t/acme/projects/ISL/pages');
        expect(screen.getByRole('link', { name: 'Spec' })).toHaveAttribute('href', '/t/acme/pages/pg-1');
        expect(screen.getByTestId('page-body')).toHaveTextContent('This page has no content yet.');
        expect(screen.getByText('No subpages.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
        const dialog = await screen.findByRole('dialog');
        const input = within(dialog).getByLabelText(/Title/);
        fireEvent.change(input, { target: { value: 'Aims' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Rename page' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')).toBeDefined());
        const patch = calls.find((c) => c.method === 'PATCH')!;
        expect(patch.body).toEqual({ title: 'Aims' });
        expect(patch.ifMatch).toBe('"4"');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('offers nothing to change to a reader, and no subpage past ten levels', () => {
        installFetch({ 'GET /pages/pg-3': { body: { ...DETAIL, affordances: READ } } });
        const { unmount } = renderWorkspace(<PageView initialDetail={{ ...DETAIL, affordances: READ }} trees={TREES} />, { role: 'VIEWER' });
        expect(screen.queryByRole('button', { name: /^(Rename|Move…|Delete|New subpage)$/ })).toBeNull();
        unmount();
        const deep = { ...DETAIL, level: 10, subpageFits: false };
        installFetch({ 'GET /pages/pg-3': { body: deep } });
        renderWorkspace(<PageView initialDetail={deep} trees={TREES} />);
        expect(screen.queryByRole('button', { name: 'New subpage' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    });
});
