/** @jest-environment jsdom */

/**
 * The board (sub-phase 2.3): columns by state grouped by category, keyboard
 * moves within and across columns announced through the live region, the
 * move API called with the neighbour and `If-Match`, a refused move rolled
 * back with the server's reason, a card opening the detail, a column's "+"
 * seeding its state, lanes, and no axe violations.
 *
 * Written fresh for Islestone: inflect-compliance has no board.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { stateColumns } from '@/components/work-items/board/board-model';
import { WorkItemBoard } from '@/components/work-items/board/WorkItemBoard';

import { CONFIG, deferred, detail, installFetch, MEMBERS, page, PROJECT, renderWorkspace, row, TEAM, type Recorded } from '../helpers/work-items-harness';

const columns = stateColumns(CONFIG.states.filter((s) => s.teamId === TEAM));

/** Answer each column's list read with the rows in that state. */
function columnsRoute(rows: ReturnType<typeof row>[]) {
    return (req: Recorded) => ({ body: page(rows.filter((r) => r.stateId === req.search.get('stateId'))) });
}

function renderBoard(props: Partial<Parameters<typeof WorkItemBoard>[0]> = {}) {
    const onOpen = jest.fn();
    const onCreate = jest.fn();
    const utils = renderWorkspace(
        <WorkItemBoard
            scope={{ projectId: PROJECT }}
            columns={columns}
            laneBy="none"
            onOpen={onOpen}
            onCreate={onCreate}
            canEdit
            canAssign
            {...props}
        />,
    );
    return { ...utils, onOpen, onCreate };
}

const column = (name: string) => screen.getByRole('region', { name });
const card = (key: string, title: string) => screen.getByRole('button', { name: `${key}: ${title}` });
const announcements = () => screen.getByRole('status', { name: 'Board announcements' });

describe('the board', () => {
    it('lays out one column per state, in category order', async () => {
        installFetch({ 'GET /work-items': columnsRoute([row(1)]), 'GET /users/assignable': { body: MEMBERS } });
        renderBoard();
        await screen.findByText('Item 1');
        const names = within(screen.getByRole('region', { name: 'Board' }))
            .getAllByRole('region')
            .map((r) => r.getAttribute('aria-label'));
        expect(names).toEqual(['Backlog', 'Todo', 'In progress', 'Done', 'Cancelled']);
        expect(within(column('Todo')).getByText('Item 1')).toBeInTheDocument();
    });

    it('marks a card with where its review stands (2.8b), and an item with none with nothing', async () => {
        installFetch({
            'GET /work-items': columnsRoute([
                row(1, { review: { state: 'returned', roundNumber: 1, step: null } }),
                row(2, { review: { state: 'open', roundNumber: 2, step: { name: 'Legal', dueOn: '2026-11-25', pendingCount: 1 } } }),
                row(3),
            ]),
            'GET /users/assignable': { body: MEMBERS },
        });
        const { container } = renderBoard();
        expect(await screen.findByText('Review: Returned')).toBeInTheDocument();
        expect(screen.getByText('Review: Open')).toBeInTheDocument();
        expect(screen.getAllByText(/^Review: /)).toHaveLength(2);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('has no axe violations', async () => {
        installFetch({ 'GET /work-items': columnsRoute([row(1), row(2)]), 'GET /users/assignable': { body: MEMBERS } });
        const { container } = renderBoard();
        await screen.findByText('Item 2');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('moves a card to the next column by keyboard, announcing each step, and calls the move API', async () => {
        const rows = [row(1), row(2)];
        const { calls } = installFetch({
            'GET /work-items': columnsRoute(rows),
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items/wi-1/move': { body: detail(row(1, { stateId: 'st-progress', stateCategory: 'STARTED', version: 2 })) },
        });
        renderBoard();
        await screen.findByText('Item 1');
        const c = card('ISL-1', 'Item 1');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        expect(announcements()).toHaveTextContent('Picked up ISL-1. Todo, position 1 of 2.');
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        expect(announcements()).toHaveTextContent('In progress, position 1 of 1.');
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
        await waitFor(() => expect(within(column('In progress')).getByText('Item 1')).toBeInTheDocument());
        expect(announcements()).toHaveTextContent('Dropped ISL-1 in In progress at position 1.');
        const move = calls.find((r) => r.method === 'POST');
        expect(move?.path).toBe('/work-items/wi-1/move');
        expect(move?.body).toEqual({ stateId: 'st-progress' });
        expect(move?.ifMatch).toBe('"1"');
        expect(card('ISL-1', 'Item 1')).toHaveFocus();
    });

    // Issue #41: a card dropped into a column whose first read is still in
    // flight must land in that column, whichever of the read and the move
    // answers first, and in no other column.
    describe('a drop into a column that is still loading', () => {
        /**
         * Todo answers at once; In progress answers only when the test says,
         * and with what the server held when its read began (before the move).
         * Reads that start after the move answer see the moved row.
         */
        function slowColumn() {
            const moved = row(1, { stateId: 'st-progress', stateCategory: 'STARTED', sortKey: 'a0', version: 2 });
            let committed = false;
            const firstProgressRead = deferred<void>();
            let progressReads = 0;
            const move = deferred<void>();
            const { calls } = installFetch({
                'GET /work-items': async (req) => {
                    const state = req.search.get('stateId');
                    const rows = committed ? [moved, row(2)] : [row(1), row(2)];
                    const answer = { body: page(rows.filter((r) => r.stateId === state)) };
                    if (state === 'st-progress' && progressReads++ === 0) await firstProgressRead.promise;
                    return answer;
                },
                'GET /users/assignable': { body: MEMBERS },
                'POST /work-items/wi-1/move': async () => {
                    await move.promise;
                    committed = true;
                    return { body: detail(moved) };
                },
            });
            return { calls, firstProgressRead, move };
        }

        async function dropIntoInProgress(calls: Recorded[]) {
            await screen.findByText('Item 1');
            // In progress's first read is still in flight.
            expect(screen.getByRole('list', { name: 'In progress' })).toBeEmptyDOMElement();
            expect(calls.some((r) => r.method === 'GET' && r.search.get('stateId') === 'st-progress')).toBe(true);
            const c = card('ISL-1', 'Item 1');
            c.focus();
            fireEvent.keyDown(c, { key: ' ' });
            fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
            await act(async () => {
                fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
            });
        }

        async function expectOnlyInProgress() {
            await waitFor(() => expect(within(column('In progress')).getByText('Item 1')).toBeInTheDocument());
            expect(screen.getAllByText('Item 1')).toHaveLength(1);
            expect(within(column('Todo')).queryByText('Item 1')).toBeNull();
        }

        it('lands when the column read answers before the move', async () => {
            const env = slowColumn();
            renderBoard();
            await dropIntoInProgress(env.calls);
            await act(async () => env.firstProgressRead.resolve());
            await act(async () => env.move.resolve());
            await expectOnlyInProgress();
        });

        it('lands when the move answers before the column read', async () => {
            const env = slowColumn();
            renderBoard();
            await dropIntoInProgress(env.calls);
            await act(async () => env.move.resolve());
            await act(async () => env.firstProgressRead.resolve());
            await expectOnlyInProgress();
        });
    });

    it('reorders within a column, sending the neighbour the card lands beside', async () => {
        const rows = [row(1), row(2), row(3)];
        const { calls } = installFetch({
            'GET /work-items': columnsRoute(rows),
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items/wi-3/move': { body: detail(row(3, { sortKey: 'a0', version: 1 })) },
        });
        renderBoard();
        await screen.findByText('Item 3');
        const c = card('ISL-3', 'Item 3');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        fireEvent.keyDown(card('ISL-3', 'Item 3'), { key: 'ArrowUp' });
        fireEvent.keyDown(card('ISL-3', 'Item 3'), { key: 'ArrowUp' });
        fireEvent.keyDown(card('ISL-3', 'Item 3'), { key: 'Enter' });
        await waitFor(() => {
            const order = within(column('Todo'))
                .getAllByRole('button', { name: /^ISL-\d/ })
                .map((b) => b.getAttribute('aria-label'));
            expect(order).toEqual(['ISL-3: Item 3', 'ISL-1: Item 1', 'ISL-2: Item 2']);
        });
        expect(calls.find((r) => r.method === 'POST')?.body).toEqual({ stateId: 'st-todo', position: { beforeId: 'wi-1' } });
    });

    it('cancels a move with Escape and sends nothing', async () => {
        const { calls } = installFetch({ 'GET /work-items': columnsRoute([row(1)]), 'GET /users/assignable': { body: MEMBERS } });
        renderBoard();
        await screen.findByText('Item 1');
        const c = card('ISL-1', 'Item 1');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'Escape' });
        expect(announcements()).toHaveTextContent('Move cancelled. ISL-1 is back where it was.');
        expect(within(column('Todo')).getByText('Item 1')).toBeInTheDocument();
        expect(calls.some((r) => r.method === 'POST')).toBe(false);
    });

    it('rolls a refused move back and shows the server reason', async () => {
        installFetch({
            'GET /work-items': columnsRoute([row(1)]),
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items/wi-1/move': {
                status: 400,
                body: { error: { code: 'BAD_REQUEST', message: 'Done is archived and takes no work items.', details: { reason: 'archived' } } },
            },
        });
        renderBoard();
        await screen.findByText('Item 1');
        const c = card('ISL-1', 'Item 1');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        await act(async () => {
            fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
        });
        expect(await screen.findByText('Done is archived and takes no work items.')).toBeInTheDocument();
        await waitFor(() => expect(within(column('Todo')).getByText('Item 1')).toBeInTheDocument());
        expect(within(column('Done')).queryByText('Item 1')).toBeNull();
    });

    it('rolls back a drop into Done that the review holds (2.8c), showing the server sentence, sent once', async () => {
        const message = 'ISL-1 cannot move to Done until its review is complete: round 1 is open at the step "Legal". Cancelling is always allowed.';
        const { calls } = installFetch({
            'GET /work-items': columnsRoute([row(1)]),
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items/wi-1/move': { status: 409, body: { error: { code: 'CONFLICT', message, details: { reason: 'REVIEW_INCOMPLETE' } } } },
        });
        renderBoard();
        await screen.findByText('Item 1');
        const c = card('ISL-1', 'Item 1');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowRight' });
        await act(async () => {
            fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
        });
        expect(await screen.findByText(message)).toBeInTheDocument();
        await waitFor(() => expect(within(column('Todo')).getByText('Item 1')).toBeInTheDocument());
        expect(within(column('Done')).queryByText('Item 1')).toBeNull();
        // Not a version conflict: never retried.
        expect(calls.filter((r) => r.method === 'POST')).toHaveLength(1);
    });

    it('opens a card with Enter or a click, and a column "+" seeds its state', async () => {
        installFetch({ 'GET /work-items': columnsRoute([row(1)]), 'GET /users/assignable': { body: MEMBERS } });
        const { onOpen, onCreate } = renderBoard();
        await screen.findByText('Item 1');
        fireEvent.click(card('ISL-1', 'Item 1'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'wi-1' }));
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'Enter' });
        expect(onOpen).toHaveBeenCalledTimes(2);
        fireEvent.click(screen.getByRole('button', { name: 'Add a work item to In progress' }));
        expect(onCreate).toHaveBeenCalledWith('st-progress');
    });

    it('does not pick a card up for a member who cannot edit', async () => {
        installFetch({ 'GET /work-items': columnsRoute([row(1)]), 'GET /users/assignable': { body: MEMBERS } });
        renderBoard({ canEdit: false });
        await screen.findByText('Item 1');
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
        expect(announcements()).toHaveTextContent('You cannot move work items.');
        expect(screen.queryByRole('combobox', { name: 'Move ISL-1 to another column' })).toBeNull();
    });

    it('groups cards into lanes, and a move into another assignee lane reassigns the card', async () => {
        const rows = [row(1, { assigneeId: 'u-ada' }), row(2, { assigneeId: 'u-bob' })];
        const { calls } = installFetch({
            'GET /work-items': columnsRoute(rows),
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items/wi-1/move': { body: detail(row(1, { assigneeId: 'u-ada', sortKey: 'a1' })) },
            'POST /work-items/wi-1/assign': { body: detail(row(1, { assigneeId: 'u-bob', version: 2 })) },
        });
        renderBoard({ laneBy: 'assignee' });
        await screen.findByText('Item 2');
        expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Bob Builder' })).toBeInTheDocument();
        expect(screen.getByRole('list', { name: 'Todo, Ada Lovelace' })).toHaveTextContent('Item 1');

        const c = card('ISL-1', 'Item 1');
        c.focus();
        fireEvent.keyDown(c, { key: ' ' });
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: 'ArrowDown' });
        expect(announcements()).toHaveTextContent('Lane Bob Builder.');
        fireEvent.keyDown(card('ISL-1', 'Item 1'), { key: ' ' });
        await waitFor(() => expect(calls.some((r) => r.path === '/work-items/wi-1/assign')).toBe(true));
        expect(calls.find((r) => r.path === '/work-items/wi-1/assign')?.body).toEqual({ assigneeId: 'u-bob' });
    });
});
