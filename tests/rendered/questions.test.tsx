/** @jest-environment jsdom */

/**
 * Questions on the detail (sub-phase 2.4b-c; decisions 113 to 118):
 * "Mark as answer" follows the comment policy and the field set (shown only
 * where the type shows the answer, to someone who may edit); marking sends
 * the team's Done state, or the one chosen in the dialog when there are
 * several; the pinned answer, its locked comment and "Clear answer" through
 * the undo toast; and the item-templates manager's Question preset.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { ItemTemplatesManager } from '@/components/work-items/templates/ItemTemplatesManager';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

import { CONFIG, detail, installFetch, MEMBERS, page, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

const COMMENTS = {
    items: [
        { id: 'c-ada', workItemId: 'wi-1', authorUserId: 'u-ada', body: 'Ada asks.', editedAt: null, createdAt: '2026-11-02T10:00:00.000Z' },
        { id: 'c-bob', workItemId: 'wi-1', authorUserId: 'u-bob', body: 'Bob answers.', editedAt: null, createdAt: '2026-11-01T10:00:00.000Z' },
    ],
    pageInfo: { hasNextPage: false },
};

/** Feature shows the answer here, as the Question preset's type would. */
const SHOWN: WorkItemViewConfig = {
    ...CONFIG,
    fieldSetEntries: [{ typeId: 'ty-feature', projectId: null, builtInField: 'answer', customFieldId: null, requirement: 'OPTIONAL' }],
};
const SEVERAL_DONE: WorkItemViewConfig = {
    ...SHOWN,
    states: [...SHOWN.states, { id: 'st-released', teamId: TEAM, name: 'Released', category: 'DONE', isDefault: false }],
};

function routes(item = detail(row(1), { counts: { subItems: 0, comments: 2, watchers: 0 } }), extra: Parameters<typeof installFetch>[0] = {}) {
    return installFetch({
        'GET /work-items/wi-1': { body: item },
        'GET /work-items/wi-1/comments': { body: COMMENTS },
        'GET /work-items/wi-1/watchers': { body: [] },
        'GET /work-items/wi-1/relations': { body: { outgoing: [], incoming: [] } },
        'GET /work-items/wi-1/links': { body: [] },
        'GET /work-items/wi-1/activity': { body: page([]) },
        'GET /work-items': { body: page([]) },
        'GET /users/assignable': { body: MEMBERS },
        [`GET /projects/${PROJECT}/type-fields`]: { body: [] },
        [`GET /projects/${PROJECT}/custom-fields`]: { body: [] },
        ...extra,
    });
}

function renderDetail(config: WorkItemViewConfig, role: Role = 'MEMBER') {
    return renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="page" />, { role, userId: 'u-ada', config });
}

async function openComments() {
    fireEvent.click(await screen.findByRole('tab', { name: /Comments/ }));
    const list = await screen.findByRole('list', { name: 'Comments' });
    await within(list).findByText('Bob answers.');
    return list;
}

const markBob = 'Mark the comment by Bob Builder as the answer';

beforeEach(() => {
    __resetPendingUndoToastsForTest();
});

describe('"Mark as answer"', () => {
    it('is offered where the type shows the answer, to someone who may edit, and nowhere else', async () => {
        routes();
        const first = renderDetail(SHOWN);
        expect(within(await openComments()).getByRole('button', { name: markBob })).toBeInTheDocument();
        first.unmount();

        routes();
        const hidden = renderDetail(CONFIG);
        expect(within(await openComments()).queryByRole('button', { name: markBob })).toBeNull();
        hidden.unmount();

        routes();
        renderDetail(SHOWN, 'VIEWER');
        expect(within(await openComments()).queryByRole('button', { name: markBob })).toBeNull();
    });

    it('is not offered on a comment still being sent (it has no server id yet)', async () => {
        routes(undefined, {
            'GET /work-items/wi-1/comments': {
                body: { ...COMMENTS, items: [{ ...COMMENTS.items[1]!, id: 'pending-1' }] },
            },
        });
        renderDetail(SHOWN);
        expect(within(await openComments()).queryByRole('button', { name: markBob })).toBeNull();
    });

    it("marks at once when the team has one Done state, sending it with If-Match", async () => {
        const answered = detail(row(1, { stateId: 'st-done', stateCategory: 'DONE', answerCommentId: 'c-bob', version: 2 }));
        const { calls } = routes(undefined, { 'PUT /work-items/wi-1/answer': { body: answered } });
        renderDetail(SHOWN);
        fireEvent.click(within(await openComments()).getByRole('button', { name: markBob }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put).toMatchObject({ path: '/work-items/wi-1/answer', body: { commentId: 'c-bob', stateId: 'st-done' } });
        expect(put.ifMatch).toBe('"1"');
    });

    it('asks which Done state when the team has several, the first preselected, with no axe violations', async () => {
        const releasedRow = detail(row(1, { stateId: 'st-done', stateCategory: 'DONE' }));
        const { calls } = routes(undefined, { 'PUT /work-items/wi-1/answer': { body: { ...releasedRow, stateId: 'st-released', state: { id: 'st-released', name: 'Released', category: 'DONE' } } } });
        const { baseElement } = renderDetail(SEVERAL_DONE);
        fireEvent.click(within(await openComments()).getByRole('button', { name: markBob }));
        const dialog = await screen.findByRole('dialog', { name: 'Mark as answer' });
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
        expect(within(dialog).getByRole('combobox', { name: 'Done state' })).toHaveTextContent('Done');
        expect(await axe(baseElement)).toHaveNoViolations();
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Done state' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Released' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as answer' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ commentId: 'c-bob', stateId: 'st-released' }));
    });

    it('on a closed item sends no Done state (marking changes only the answer)', async () => {
        const closed = detail(row(1, { stateId: 'st-cancelled', stateCategory: 'CANCELLED' }), { counts: { subItems: 0, comments: 2, watchers: 0 } });
        const { calls } = routes(closed, { 'PUT /work-items/wi-1/answer': { body: closed } });
        renderDetail(SEVERAL_DONE);
        fireEvent.click(within(await openComments()).getByRole('button', { name: markBob }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ commentId: 'c-bob' }));
        expect(screen.queryByRole('dialog', { name: 'Mark as answer' })).toBeNull();
    });
});

describe('the marked answer', () => {
    const answered = detail(row(1, { stateId: 'st-done', stateCategory: 'DONE', answerCommentId: 'c-bob' }), {
        counts: { subItems: 0, comments: 2, watchers: 0 },
        answer: { id: 'c-bob', authorUserId: 'u-bob', body: 'Bob answers.', editedAt: null, createdAt: '2026-11-01T10:00:00.000Z' },
    });

    it('is pinned under the description; its comment is locked even for an admin', async () => {
        routes(answered);
        renderDetail(SHOWN, 'ADMIN');
        const pinned = await screen.findByRole('region', { name: 'Answer' });
        expect(within(pinned).getByText('Bob answers.')).toBeInTheDocument();
        expect(within(pinned).getByText(/Bob Builder/)).toBeInTheDocument();
        const list = await openComments();
        expect(within(list).getByText('This is the answer. Clear the answer to edit or delete it.')).toBeInTheDocument();
        expect(within(list).queryByRole('button', { name: 'Delete the comment by Bob Builder' })).toBeNull();
        expect(within(list).queryByRole('button', { name: markBob })).toBeNull();
        expect(within(list).getByRole('button', { name: 'Delete the comment by Ada Lovelace' })).toBeInTheDocument();
    });

    it('is cleared through the undo toast: it leaves the detail at once and nothing is sent yet', async () => {
        const { calls } = routes(answered);
        renderDetail(SHOWN);
        const pinned = await screen.findByRole('region', { name: 'Answer' });
        fireEvent.click(within(pinned).getByRole('button', { name: 'Clear answer' }));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Answer' })).toBeNull());
        expect(await screen.findByText('Answer of ISL-1 cleared')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

describe("the item-templates manager's Question preset (decision 116)", () => {
    const manager = () => <ItemTemplatesManager open onOpenChange={() => {}} projectId={PROJECT} teamId={TEAM} projectName="Islands" />;

    it('fills the form for a type that shows the answer, due in 5 days, and saves through the template route', async () => {
        const { calls } = installFetch({
            [`GET /projects/${PROJECT}/work-item-templates`]: { body: [] },
            [`POST /projects/${PROJECT}/work-item-templates`]: { status: 201, body: {} },
            [`GET /projects/${PROJECT}/type-fields`]: { body: [] },
            'GET /users/assignable': { body: MEMBERS },
        });
        renderWorkspace(manager(), { config: SHOWN });
        const dialog = await screen.findByRole('dialog', { name: 'Item templates for Islands' });
        fireEvent.click(await within(dialog).findByRole('button', { name: 'Add a Question template' }));
        expect(within(dialog).getByLabelText(/^Template name/)).toHaveValue('Question');
        expect(within(dialog).getByLabelText(/^Due in days/)).toHaveValue('5');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: 'Question', title: 'Question', typeId: 'ty-feature', dueInDays: 5 });
    });

    it('is not offered when no type shows the answer', async () => {
        installFetch({
            [`GET /projects/${PROJECT}/work-item-templates`]: { body: [] },
            [`GET /projects/${PROJECT}/type-fields`]: { body: [] },
            'GET /users/assignable': { body: MEMBERS },
        });
        renderWorkspace(manager(), { config: CONFIG });
        const dialog = await screen.findByRole('dialog', { name: 'Item templates for Islands' });
        await within(dialog).findByLabelText(/^Template name/);
        expect(within(dialog).queryByRole('button', { name: 'Add a Question template' })).toBeNull();
    });
});
