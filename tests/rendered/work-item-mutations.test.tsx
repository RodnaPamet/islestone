/** @jest-environment jsdom */

/**
 * The work-item writes the views share (sub-phase 2.3), driven through a
 * small view over the real list query and the real mutation hook:
 *
 *   - a write shows at once and rolls back, with the server's reason, when
 *     the server refuses it;
 *   - every versioned write sends `If-Match`; a 409 whose fields did not move
 *     is retried once with the current version; a real conflict shows the
 *     server's row and tells the person the item changed;
 *   - a delete leaves the view at once and is sent only when the undo window
 *     closes; Undo brings the row back and sends nothing;
 *   - a bulk change that fails rolls every selected row back.
 *
 * Written fresh for Islestone; it covers what inflect-compliance's
 * `tasks-bulk-mutation.test.tsx` and `task-detail-mutation-failures.test.tsx`
 * covered for the tasks client (5528464fc54a8681956f3b9ce23ca9c075f0420e).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { useWorkConfig } from '@/components/work-items/data/use-work-config';
import { useWorkItemList } from '@/components/work-items/data/use-work-item-list';
import { useWorkItemMutations } from '@/components/work-items/data/use-work-item-mutations';
import { useWorkItem } from '@/components/work-items/data/use-work-item-collab';

import { deferred, detail, installFetch, page, PROJECT, renderWorkspace, row } from '../helpers/work-items-harness';

function Items() {
    const list = useWorkItemList({ projectId: PROJECT, order: 'manual' });
    const m = useWorkItemMutations();
    const config = useWorkConfig();
    return (
        <>
            <button type="button" onClick={() => void m.bulkState(list.items, { stateCategory: 'STARTED' })}>
                Start all
            </button>
            <ul aria-label="Items">
                {list.items.map((r) => (
                    <li key={r.id} aria-label={r.key}>
                        <span>{r.title}</span> <span>{config.stateById.get(r.stateId)?.name}</span>
                        <button type="button" onClick={() => void m.setState(r, 'st-progress')}>
                            Start {r.key}
                        </button>
                        <button type="button" onClick={() => void m.updateFields(r, { title: 'Renamed' })}>
                            Rename {r.key}
                        </button>
                        <button type="button" onClick={() => m.remove(r)}>
                            Delete {r.key}
                        </button>
                    </li>
                ))}
            </ul>
        </>
    );
}

const item = (key: string) => screen.getByRole('listitem', { name: key });

beforeEach(() => {
    __resetPendingUndoToastsForTest();
});

afterEach(() => {
    __resetPendingUndoToastsForTest();
});

describe('an optimistic write', () => {
    it('shows the new state at once and rolls back with the server reason on refusal', async () => {
        const answer = deferred<{ status: number; body: unknown }>();
        installFetch({
            'GET /work-items': { body: page([row(1)]) },
            'POST /work-items/wi-1/state': () => answer.promise,
        });
        renderWorkspace(<Items />);
        await screen.findByText('Item 1');

        fireEvent.click(screen.getByRole('button', { name: 'Start ISL-1' }));
        await waitFor(() => expect(within(item('ISL-1')).getByText('In progress')).toBeInTheDocument());

        await act(async () => {
            answer.resolve({ status: 400, body: { error: { code: 'BAD_REQUEST', message: 'In progress is archived and takes no work items.' } } });
        });
        await waitFor(() => expect(within(item('ISL-1')).getByText('Todo')).toBeInTheDocument());
        expect(await screen.findByText('In progress is archived and takes no work items.')).toBeInTheDocument();
    });

    it('takes the server row (version and order) when the write succeeds', async () => {
        const { calls } = installFetch({
            'GET /work-items': { body: page([row(1)]) },
            'POST /work-items/wi-1/state': { body: detail(row(1, { stateId: 'st-progress', stateCategory: 'STARTED', version: 2 })) },
        });
        renderWorkspace(<Items />);
        await screen.findByText('Item 1');
        fireEvent.click(screen.getByRole('button', { name: 'Start ISL-1' }));
        await waitFor(() => expect(within(item('ISL-1')).getByText('In progress')).toBeInTheDocument());
        const sent = calls.find((c) => c.method === 'POST');
        expect(sent?.ifMatch).toBe('"1"');
        expect(sent?.body).toEqual({ stateId: 'st-progress' });
    });
});

describe('a 409 version conflict', () => {
    it('is retried once with the current version when the edited fields did not move', async () => {
        let attempts = 0;
        const { calls } = installFetch({
            'GET /work-items': { body: page([row(1)]) },
            'PATCH /work-items/wi-1': () => {
                attempts += 1;
                if (attempts === 1) {
                    return {
                        status: 409,
                        body: {
                            error: {
                                code: 'CONFLICT',
                                message: 'The work item changed since you read it.',
                                details: { reason: 'VERSION_CONFLICT', version: 2, item: row(1, { priority: 'HIGH', version: 2 }) },
                            },
                        },
                    };
                }
                return { body: detail(row(1, { title: 'Renamed', priority: 'HIGH', version: 3 })) };
            },
        });
        renderWorkspace(<Items />);
        await screen.findByText('Item 1');
        fireEvent.click(screen.getByRole('button', { name: 'Rename ISL-1' }));
        await waitFor(() => expect(attempts).toBe(2));
        expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.ifMatch)).toEqual(['"1"', '"2"']);
        expect(within(item('ISL-1')).getByText('Renamed')).toBeInTheDocument();
    });

    it('shows the server row and says the item changed when the same field moved', async () => {
        const { calls } = installFetch({
            'GET /work-items': { body: page([row(1)]) },
            'PATCH /work-items/wi-1': {
                status: 409,
                body: {
                    error: {
                        code: 'CONFLICT',
                        message: 'The work item changed since you read it.',
                        details: { reason: 'VERSION_CONFLICT', version: 2, item: row(1, { title: 'Changed by Bob', version: 2 }) },
                    },
                },
            },
        });
        renderWorkspace(<Items />);
        await screen.findByText('Item 1');
        fireEvent.click(screen.getByRole('button', { name: 'Rename ISL-1' }));
        await waitFor(() => expect(within(item('ISL-1')).getByText('Changed by Bob')).toBeInTheDocument());
        expect(await screen.findByText('Someone else changed this work item. You are now seeing their version.')).toBeInTheDocument();
        expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    });
});

describe('a delete through the undo toast', () => {
    it('hides the row at once, and Undo brings it back without sending the delete', async () => {
        const { calls } = installFetch({ 'GET /work-items': { body: page([row(1), row(2)]) } });
        renderWorkspace(<Items />);
        await screen.findByText('Item 1');
        fireEvent.click(screen.getByRole('button', { name: 'Delete ISL-1' }));
        await waitFor(() => expect(screen.queryByRole('listitem', { name: 'ISL-1' })).toBeNull());
        expect(await screen.findByText('ISL-1 deleted')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(item('ISL-1')).toBeInTheDocument());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('sends the delete when the window closes', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                'GET /work-items': { body: page([row(1)]) },
                'DELETE /work-items/wi-1': { body: { deleted: true } },
            });
            renderWorkspace(<Items />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            await screen.findByText('Item 1');
            fireEvent.click(screen.getByRole('button', { name: 'Delete ISL-1' }));
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/work-items/wi-1']);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('a bulk change', () => {
    it('rolls every selected row back when the server refuses', async () => {
        installFetch({
            'GET /work-items': { body: page([row(1), row(2)]) },
            'POST /work-items/bulk/state': { status: 500, body: { error: { code: 'INTERNAL', message: 'Something broke.' } } },
        });
        renderWorkspace(<Items />);
        await screen.findByText('Item 2');
        fireEvent.click(screen.getByRole('button', { name: 'Start all' }));
        expect(await screen.findByText('Something broke.')).toBeInTheDocument();
        await waitFor(() => {
            expect(within(item('ISL-1')).getByText('Todo')).toBeInTheDocument();
            expect(within(item('ISL-2')).getByText('Todo')).toBeInTheDocument();
        });
    });
});

describe('a write while a detail is still loading', () => {
    function Detail() {
        const { data } = useWorkItem('wi-1');
        return <p>{data ? `Detail: ${data.title}` : 'Detail loading'}</p>;
    }

    it('does not strand the detail: its first read still lands', async () => {
        const read = deferred<{ body: unknown }>();
        installFetch({
            'GET /work-items': { body: page([row(1)]) },
            'GET /work-items/wi-1': () => read.promise,
            'POST /work-items/wi-1/state': { body: detail(row(1, { stateId: 'st-progress', stateCategory: 'STARTED', version: 2 })) },
        });
        renderWorkspace(
            <>
                <Items />
                <Detail />
            </>,
        );
        await screen.findByText('Item 1');
        expect(screen.getByText('Detail loading')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Start ISL-1' }));
        await waitFor(() => expect(within(item('ISL-1')).getByText('In progress')).toBeInTheDocument());
        await act(async () => {
            read.resolve({ body: detail(row(1, { title: 'Item 1 in full', stateId: 'st-progress', stateCategory: 'STARTED', version: 2 })) });
        });
        expect(await screen.findByText('Detail: Item 1 in full')).toBeInTheDocument();
    });
});
