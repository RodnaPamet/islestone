/** @jest-environment jsdom */

/**
 * A work item's detail (sub-phase 2.3), as the full page and as the sheet:
 * both render the same body from the same reads; the comment buttons follow
 * the owner's rule (decision 53) through the server's own functions; a
 * delete goes through the undo toast; the comment text is kept when the
 * server refuses it; a member who may not edit gets no editing controls; and
 * neither variant has axe violations. Since 2.7d: the description is shown
 * with its chips and key links and edited on request; a `<@userId>` token is
 * a chip only for a person its source's `Mention` rows name (the authority
 * rule), and the comment box's `@` picker puts a person's token in the text.
 *
 * Written fresh for Islestone, after inflect-compliance's
 * `task-detail-mutation-failures.test.tsx` (comments kept on refusal,
 * per-key gates) at 5528464fc54a8681956f3b9ce23ca9c075f0420e.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';

import { CONFIG, detail, installFetch, MEMBERS, page, renderWorkspace, row } from '../helpers/work-items-harness';

const COMMENTS = {
    items: [
        { id: 'c-ada', workItemId: 'wi-1', authorUserId: 'u-ada', body: 'Ada wrote this.', editedAt: null, createdAt: '2026-11-02T10:00:00.000Z' },
        { id: 'c-bob', workItemId: 'wi-1', authorUserId: 'u-bob', body: 'Bob wrote this.', editedAt: null, createdAt: '2026-11-01T10:00:00.000Z' },
    ],
    pageInfo: { hasNextPage: false },
};

function routes(extra: Record<string, Parameters<typeof installFetch>[0][string]> = {}) {
    return installFetch({
        'GET /work-items/wi-1': { body: detail(row(1), { counts: { subItems: 0, comments: 2, watchers: 0 } }) },
        'GET /work-items/wi-1/comments': { body: COMMENTS },
        'GET /work-items/wi-1/watchers': { body: [] },
        'GET /work-items/wi-1/relations': { body: { outgoing: [], incoming: [] } },
        'GET /work-items/wi-1/links': { body: [] },
        'GET /work-items/wi-1/activity': { body: page([]) },
        'GET /work-items': { body: page([]) },
        'GET /users/assignable': { body: MEMBERS },
        ...extra,
    });
}

function renderDetail(variant: 'page' | 'sheet', role: Role = 'OWNER', userId = 'u-ada') {
    return renderWorkspace(<WorkItemDetail workItemId="wi-1" variant={variant} />, { role, userId });
}

async function openComments(variant: 'page' | 'sheet') {
    if (variant === 'page') fireEvent.click(await screen.findByRole('tab', { name: /Comments/ }));
    else fireEvent.click(await screen.findByRole('radio', { name: 'Comments' }));
    return screen.findByRole('list', { name: 'Comments' });
}

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    mockPush.mockReset();
});

describe('the detail as a page and as a sheet', () => {
    it.each(['page', 'sheet'] as const)('the %s shows the item from the shared read, with no axe violations', async (variant) => {
        routes();
        const { container } = renderDetail(variant);
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.getByText('ISL-1')).toBeInTheDocument();
        expect(screen.getByText('The description.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
        expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('The description.');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('the page offers no editing controls to a viewer', async () => {
        routes();
        renderDetail('page', 'VIEWER', 'u-viewer');
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit description' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete work item' })).toBeNull();
        expect(screen.getByLabelText('State')).toBeDisabled();
    });
});

describe('waiting on (2.4b)', () => {
    it('an open item offers the picker to an editor', async () => {
        routes();
        renderDetail('page', 'MEMBER', 'u-ada');
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.getByLabelText('Waiting on')).toBeEnabled();
    });

    it('a viewer sees it disabled', async () => {
        routes();
        renderDetail('page', 'VIEWER', 'u-viewer');
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.getByLabelText('Waiting on')).toBeDisabled();
    });

    it('a closed item says it waits on nobody and offers no picker', async () => {
        routes({ 'GET /work-items/wi-1': { body: detail(row(1, { stateId: 'st-done', stateCategory: 'DONE' })) } });
        renderDetail('page', 'MEMBER', 'u-ada');
        expect(await screen.findByText('A closed item waits on nobody.')).toBeInTheDocument();
        expect(screen.queryByLabelText('Waiting on')).toBeNull();
    });
});

describe('the field set (2.4b-b)', () => {
    const withEntries = {
        ...CONFIG,
        fieldSetEntries: [
            { typeId: 'ty-feature', projectId: null, builtInField: 'dueDate', customFieldId: null, requirement: 'REQUIRED' as const },
            { typeId: 'ty-feature', projectId: null, builtInField: 'priority', customFieldId: null, requirement: 'HIDDEN' as const },
        ],
    };

    it('marks a required field, leaves out a hidden empty one, and lists what an open item lacks', async () => {
        routes();
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="page" />, { role: 'MEMBER', userId: 'u-ada', config: withEntries });
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.getByLabelText(/Due date/)).toBeInTheDocument();
        expect(screen.getByText('(required)', { exact: false })).toBeInTheDocument();
        expect(screen.queryByLabelText('Priority')).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Required fields not filled yet: Due date.');
    });

    it('a closed item lists nothing missing', async () => {
        routes({ 'GET /work-items/wi-1': { body: detail(row(1, { stateId: 'st-done', stateCategory: 'DONE' })) } });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="page" />, { role: 'MEMBER', userId: 'u-ada', config: withEntries });
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        expect(screen.queryByText(/Required fields not filled yet/)).toBeNull();
    });
});

describe('comments (decision 53: the author edits; the author or an admin deletes)', () => {
    it('offers the author edit and delete on their own comment only', async () => {
        routes();
        renderDetail('page', 'MEMBER', 'u-ada');
        const list = await openComments('page');
        await within(list).findByText('Ada wrote this.');
        expect(within(list).getByRole('button', { name: 'Edit the comment by Ada Lovelace' })).toBeInTheDocument();
        expect(within(list).getByRole('button', { name: 'Delete the comment by Ada Lovelace' })).toBeInTheDocument();
        expect(within(list).queryByRole('button', { name: 'Edit the comment by Bob Builder' })).toBeNull();
        expect(within(list).queryByRole('button', { name: 'Delete the comment by Bob Builder' })).toBeNull();
    });

    it('offers an admin delete, never edit, on someone else\'s comment', async () => {
        routes();
        renderDetail('page', 'ADMIN', 'u-ada');
        const list = await openComments('page');
        await within(list).findByText('Bob wrote this.');
        expect(within(list).getByRole('button', { name: 'Delete the comment by Bob Builder' })).toBeInTheDocument();
        expect(within(list).queryByRole('button', { name: 'Edit the comment by Bob Builder' })).toBeNull();
    });

    it('keeps the comment text when the server refuses it', async () => {
        routes({ 'POST /work-items/wi-1/comments': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'You cannot comment here.' } } } });
        renderDetail('sheet', 'OWNER', 'u-ada');
        await openComments('sheet');
        const box = screen.getByRole('textbox', { name: 'New comment' });
        fireEvent.change(box, { target: { value: 'Keep me' } });
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
        expect(await screen.findByText('You cannot comment here.')).toBeInTheDocument();
        expect(box).toHaveValue('Keep me');
    });

    it('deletes a comment through the undo toast, and Undo keeps it', async () => {
        const { calls } = routes();
        renderDetail('page', 'OWNER', 'u-ada');
        const list = await openComments('page');
        await within(list).findByText('Ada wrote this.');
        fireEvent.click(within(list).getByRole('button', { name: 'Delete the comment by Ada Lovelace' }));
        await waitFor(() => expect(within(list).queryByText('Ada wrote this.')).toBeNull());
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await within(list).findByText('Ada wrote this.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

describe('delete', () => {
    it('leaves the page for the project and offers Undo before anything is sent', async () => {
        const { calls } = routes();
        renderDetail('page');
        fireEvent.click(await screen.findByRole('button', { name: 'Delete work item' }));
        expect(mockPush).toHaveBeenCalledWith('/t/acme/projects/ISL');
        expect(await screen.findByText('ISL-1 deleted')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

describe('mentions and key links (2.7d)', () => {
    const DESCRIPTION = 'Over to <@u-bob> and <@u-eve>, see ISL-7 and UTF-8.';

    it('a token is a chip only for a recorded person; any other stays text; a known key links', async () => {
        routes({ 'GET /work-items/wi-1': { body: detail(row(1), { description: DESCRIPTION, descriptionMentions: ['u-bob'] }) } });
        const { container } = renderDetail('page', 'VIEWER', 'u-viewer');
        expect(await screen.findByRole('heading', { name: 'Item 1' })).toBeInTheDocument();
        const section = screen.getByRole('heading', { name: 'Description' }).closest('section')!;
        expect(await within(section).findByText('@Bob Builder')).toBeInTheDocument();
        expect(within(section).getByText(/<@u-eve>/)).toBeInTheDocument();
        expect(within(section).getByRole('link', { name: 'ISL-7' })).toHaveAttribute('href', '/t/acme/work-items/ISL-7');
        expect(within(section).queryByRole('link', { name: 'UTF-8' })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('a token with no row names nobody, even when it names a real member', async () => {
        routes({ 'GET /work-items/wi-1': { body: detail(row(1), { description: 'From the form: <@u-bob>', descriptionMentions: [] }) } });
        renderDetail('page', 'VIEWER', 'u-viewer');
        expect(await screen.findByText('From the form: <@u-bob>')).toBeInTheDocument();
        expect(screen.queryByText('@Bob Builder')).toBeNull();
    });

    it("a comment's chips come from its own rows", async () => {
        routes({
            'GET /work-items/wi-1/comments': {
                body: {
                    items: [{ id: 'c-1', workItemId: 'wi-1', authorUserId: 'u-ada', body: 'Thanks <@u-bob>, ask <@u-ada>', editedAt: null, createdAt: '2026-11-02T10:00:00.000Z', mentions: ['u-bob'] }],
                    pageInfo: { hasNextPage: false },
                },
            },
        });
        renderDetail('page');
        const list = await openComments('page');
        expect(await within(list).findByText('@Bob Builder')).toBeInTheDocument();
        expect(within(list).getByText(/ask <@u-ada>/)).toBeInTheDocument();
    });

    it('the comment box offers members after @ and puts the chosen token in the text', async () => {
        routes();
        renderDetail('page');
        await openComments('page');
        const box = screen.getByRole('textbox', { name: 'New comment' });
        fireEvent.change(box, { target: { value: 'Hi @bo', selectionStart: 6, selectionEnd: 6 } });
        const picker = await screen.findByRole('listbox', { name: 'Mention a member' });
        expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Bob Builder']);
        expect(box).toHaveAttribute('aria-activedescendant', within(picker).getByRole('option').id);
        fireEvent.keyDown(box, { key: 'Enter' });
        expect(box).toHaveValue('Hi <@u-bob> ');
        expect(screen.queryByRole('listbox', { name: 'Mention a member' })).toBeNull();
    });

    it('Escape closes the picker and leaves the text as typed', async () => {
        routes();
        renderDetail('page');
        await openComments('page');
        const box = screen.getByRole('textbox', { name: 'New comment' });
        fireEvent.change(box, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } });
        expect(within(await screen.findByRole('listbox', { name: 'Mention a member' })).getAllByRole('option')).toHaveLength(2);
        fireEvent.keyDown(box, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Mention a member' })).toBeNull());
        expect(box).toHaveValue('@');
    });
});
