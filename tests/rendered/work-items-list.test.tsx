/** @jest-environment jsdom */

/**
 * The work-item list (sub-phase 2.3) on `EntityListPage`: rows from the
 * shared list query, the row opening the detail sheet over the same read,
 * the create dialog (refusal shown with the text kept; discard asks first),
 * the role-gated create and Deleted view, restore from the Deleted view,
 * the layout toggle, and no axe violations.
 *
 * Copied in intent from inflect-compliance's `tasks-list-role-surface`,
 * `tasks-list-refusals` and `new-task-modal-links-and-refusals` rendered
 * tests at 5528464fc54a8681956f3b9ce23ca9c075f0420e (queries converted to
 * roles and labels; the compliance cases dropped).
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { WorkItemsView } from '@/components/work-items/WorkItemsView';

import { detail, installFetch, MEMBERS, page, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

function routes(extra: Record<string, Parameters<typeof installFetch>[0][string]> = {}) {
    return installFetch({
        'GET /work-items': { body: page([row(1, { assigneeId: 'u-bob', priority: 'HIGH' }), row(2)]) },
        'GET /users/assignable': { body: MEMBERS },
        'GET /work-items/wi-1': { body: detail(row(1)) },
        'GET /work-items/wi-1/comments': { body: { items: [], pageInfo: { hasNextPage: false } } },
        'GET /work-items/wi-1/watchers': { body: [] },
        'GET /work-items/wi-1/activity': { body: page([]) },
        ...extra,
    });
}

function renderList(role: Role = 'OWNER') {
    return renderWorkspace(<WorkItemsView scope={{ projectId: PROJECT, teamId: TEAM }} title="Islands" viewKey="test" />, { role });
}

beforeEach(() => {
    window.localStorage.clear();
});

describe('the work-item list', () => {
    it('lists the rows from the shared query, with no axe violations', async () => {
        routes();
        const { container } = renderList();
        expect(await screen.findByRole('link', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Item 2' })).toBeInTheDocument();
        expect(screen.getAllByText('Bob Builder').length).toBeGreaterThan(0);
        expect(screen.getAllByText('High').length).toBeGreaterThan(0);
        // The row chevron's empty header cell is the mirrored DataTable's
        // (src/components/ui/table, never edited here); every other rule runs.
        expect(await axe(container, { rules: { 'empty-table-header': { enabled: false } } })).toHaveNoViolations();
    });

    it('reads the list with the view\'s project and the manual order', async () => {
        const { calls } = routes();
        renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        const read = calls.find((c) => c.method === 'GET' && c.path === '/work-items');
        expect(read?.search.get('projectId')).toBe(PROJECT);
        expect(read?.search.get('order')).toBe('manual');
    });

    it('opens the detail sheet from a row (a double click: a single click selects, the table convention)', async () => {
        routes();
        renderList();
        const title = await screen.findByText('Item 1', { selector: 'a' });
        fireEvent.doubleClick(title.closest('td')!);
        const body = await screen.findByTestId('work-item-sheet-body');
        expect(within(body).getByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(within(body).getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/t/acme/work-items/ISL-1');
    });

    it('offers create and the Deleted view to an owner, and neither to a viewer', async () => {
        routes();
        const { unmount } = renderList('OWNER');
        expect(await screen.findByRole('button', { name: 'Work item' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Deleted' })).toBeInTheDocument();
        unmount();
        routes();
        renderList('VIEWER');
        await screen.findByRole('link', { name: 'Item 1' });
        expect(screen.queryByRole('button', { name: 'Work item' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Deleted' })).toBeNull();
    });

    it('shows a refused create in the dialog and keeps what was typed', async () => {
        routes({ 'POST /work-items': { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'The project is archived.' } } } });
        renderList();
        fireEvent.click(await screen.findByRole('button', { name: 'Work item' }));
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'A new item' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create work item' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('The project is archived.');
        expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('A new item');
    });

    it('creates with the view\'s project and the team\'s default state', async () => {
        const { calls } = routes({ 'POST /work-items': { status: 201, body: detail(row(3, { title: 'A new item' })) } });
        renderList();
        fireEvent.click(await screen.findByRole('button', { name: 'Work item' }));
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'A new item' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create work item' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ projectId: PROJECT, stateId: 'st-todo', title: 'A new item', priority: 'NONE' });
    });

    it('asks before discarding a typed work item', async () => {
        routes();
        renderList();
        fireEvent.click(await screen.findByRole('button', { name: 'Work item' }));
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Half written' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByRole('dialog', { name: 'Discard this work item?' })).toBeInTheDocument();
    });

    it('restores an item from the Deleted view', async () => {
        const { calls } = routes({
            'GET /work-items/deleted': { body: { rows: [{ ...row(9, { title: 'Gone' }), deletedAt: '2026-11-10T10:00:00.000Z' }], truncated: false } },
            'POST /work-items/wi-9/restore': { body: { restored: true, count: 1 } },
        });
        renderList();
        fireEvent.click(await screen.findByRole('button', { name: 'Deleted' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Restore ISL-9' }));
        expect(await screen.findByText('ISL-9 restored')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'POST' && c.path === '/work-items/wi-9/restore')).toBe(true);
    });

    it('switches to the board and remembers the choice', async () => {
        routes();
        renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
        expect(await screen.findByRole('region', { name: 'Board' })).toBeInTheDocument();
        expect(window.localStorage.getItem('islestone:work-items:layout:test')).toBe('"board"');
    });
});
