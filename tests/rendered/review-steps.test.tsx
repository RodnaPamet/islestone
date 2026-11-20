/** @jest-environment jsdom */

/**
 * The detail's review section (sub-phase 2.8b; ADR 0009; owner decisions 148
 * to 165): the live round's steps with their reviewers, due days and
 * responses; Sign off and Return for the named reviewer (text required to
 * Return), and changing a response while the step is open; nothing to answer
 * for anyone else; the step editor (members and lists, all or any, the
 * order) and "Send for review", each with the round's version as `If-Match`;
 * a reviewer removed through the undo toast; "changed since signed off"; the
 * earlier rounds read-only; every button from the server's `viewer`. Queries
 * are by role and label; jest-axe on each state.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { ReviewSteps } from '@/components/work-items/detail/ReviewSteps';
import type { ReviewerData, ReviewRoundData, ReviewStepData, ReviewViewerAffordances, WorkItemReviewData } from '@/lib/work-items/types';

import { detail, installFetch, MEMBERS, PROJECT, renderWorkspace, row, type Answer } from '../helpers/work-items-harness';

const ITEM = 'wi-1';
const BASE = `/work-items/${ITEM}/review`;
const PEOPLE = [...MEMBERS, { id: 'u-cy', name: 'Cy Reviewer', email: 'cy@example.com', image: null }];

const VIEWER: ReviewViewerAffordances = { editSteps: false, send: false, withdraw: false, skip: false, respondStepId: null };

function reviewer(userId: string, over: Partial<ReviewerData> = {}): ReviewerData {
    return {
        userId,
        viaRecipientListId: null,
        outcome: null,
        respondedAt: null,
        responseText: null,
        itemVersionAt: null,
        withdrawnAt: null,
        withdrawnReason: null,
        ...over,
    };
}

function step(id: string, name: string, over: Partial<ReviewStepData> = {}): ReviewStepData {
    const reviewers = over.reviewers ?? [];
    return {
        id,
        position: 1,
        name,
        mode: 'ALL',
        dueInWorkingDays: 3,
        status: 'PENDING',
        openedAt: null,
        dueOn: null,
        endedAt: null,
        skippedByUserId: null,
        skipReason: null,
        lists: [],
        reviewers,
        pendingUserIds: reviewers.filter((r) => !r.outcome && !r.withdrawnAt).map((r) => r.userId),
        noReviewersLeft: false,
        ...over,
    };
}

function round(id: string, number: number, status: ReviewRoundData['status'], steps: ReviewStepData[], over: Partial<ReviewRoundData> = {}): ReviewRoundData {
    return { id, number, status, version: 3, startedAt: null, startedByUserId: null, endedAt: null, endedByUserId: null, endReason: null, steps, ...over };
}

function review(rounds: ReviewRoundData[], viewer: Partial<ReviewViewerAffordances> = {}, over: Partial<WorkItemReviewData> = {}): WorkItemReviewData {
    return { workItemId: ITEM, itemVersion: 7, rounds, waitingOnReviewerIds: [], viewer: { ...VIEWER, ...viewer }, ...over };
}

function routes(answer: WorkItemReviewData, more: Record<string, Answer> = {}) {
    return installFetch({
        [`GET ${BASE}`]: { body: answer },
        'GET /users/assignable': { body: PEOPLE },
        [`GET /work-items/${ITEM}`]: { body: detail(row(1)) },
        'GET /recipient-lists': { body: [{ id: 'rl-legal', name: 'Legal', projectId: null, archived: false, memberUserIds: [] }] },
        ...more,
    });
}

const render = (userId = 'u-ada', role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'OWNER') =>
    renderWorkspace(<ReviewSteps workItemId={ITEM} projectId={PROJECT} viewerId={userId} />, { userId, role });

const openStep = (reviewers: ReviewerData[]) =>
    step('st-peer', 'Peer review', { status: 'OPEN', openedAt: '2026-11-20T09:00:00.000Z', dueOn: '2026-11-25', reviewers });

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe('the review section, for a named reviewer of the open step', () => {
    const answer = review([round('r-1', 1, 'OPEN', [openStep([reviewer('u-bob'), reviewer('u-cy')]), step('st-legal', 'Legal', { position: 2, mode: 'ANY' })])], { respondStepId: 'st-peer' }, { waitingOnReviewerIds: ['u-bob', 'u-cy'] });

    it('shows the steps with their reviewers, mode and due day, and offers Sign off and Return; no axe violations', async () => {
        routes(answer);
        const { container } = render('u-bob', 'MEMBER');
        expect(await screen.findByRole('heading', { level: 2, name: 'Review steps' })).toBeInTheDocument();
        expect(screen.getByText('Round 1: open')).toBeInTheDocument();
        const steps = screen.getByRole('list', { name: 'Review steps of round 1' });
        expect(within(steps).getByRole('heading', { level: 3, name: 'Peer review' })).toBeInTheDocument();
        expect(within(steps).getByText('Due 2026-11-25')).toBeInTheDocument();
        expect(within(steps).getByText('All must sign off')).toBeInTheDocument();
        expect(within(steps).getByText('Any one signs off')).toBeInTheDocument();
        expect(within(steps).getByText('Due 3 working day(s) after it opens')).toBeInTheDocument();
        const peer = screen.getByRole('list', { name: 'Reviewers of Peer review' });
        expect(within(peer).getByText('Bob Builder')).toBeInTheDocument();
        expect(within(peer).getAllByText('Pending')).toHaveLength(2);
        expect(screen.getByRole('button', { name: 'Sign off Peer review' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Return Peer review' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Send for review' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Add review step' })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('refuses a Return without text without sending, then returns with the text', async () => {
        const returned = review([round('r-2', 2, 'PLANNED', []), round('r-1', 1, 'RETURNED', [])]);
        const { calls } = routes(answer, { [`POST ${BASE}/steps/st-peer/respond`]: { body: returned } });
        render('u-bob', 'MEMBER');
        fireEvent.click(await screen.findByRole('button', { name: 'Return Peer review' }));
        const dialog = await screen.findByRole('dialog', { name: 'Return Peer review' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Return' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Say why you are returning it.');
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
        fireEvent.change(within(dialog).getByLabelText(/Why it is returned/), { target: { value: 'Clause 4 is missing.' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Return' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ outcome: 'RETURNED', text: 'Clause 4 is missing.' });
        // The answer replaces the section: the next round waits to be sent.
        expect(await screen.findByText('Round 1 was Returned. Revise the work, then send round 2 for review.')).toBeInTheDocument();
    });

    it('signs off with no text, and shows the server\'s refusal in the dialog', async () => {
        const { calls } = routes(answer, {
            [`POST ${BASE}/steps/st-peer/respond`]: { status: 409, body: { error: { code: 'CONFLICT', message: 'This review step is not open any more.', details: { reason: 'REVIEW_STEP_NOT_OPEN' } } } },
        });
        render('u-bob', 'MEMBER');
        fireEvent.click(await screen.findByRole('button', { name: 'Sign off Peer review' }));
        const dialog = await screen.findByRole('dialog', { name: 'Sign off Peer review' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('This review step is not open any more.');
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ outcome: 'SIGNED_OFF', text: null });
    });

    it('says the viewer already responded and lets them change it while the step is open (decision 162)', async () => {
        const mine = review(
            [round('r-1', 1, 'OPEN', [openStep([reviewer('u-bob', { outcome: 'SIGNED_OFF', respondedAt: '2026-11-20T10:00:00.000Z', responseText: 'Fine.', itemVersionAt: 7 }), reviewer('u-cy')])])],
            { respondStepId: 'st-peer' },
        );
        routes(mine);
        render('u-bob', 'MEMBER');
        expect(await screen.findByText('You responded: Signed off. You can change it while the step is open.')).toBeInTheDocument();
        expect(screen.getByText('Fine.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Sign off Peer review' }));
        const dialog = await screen.findByRole('dialog', { name: 'Sign off Peer review' });
        expect(within(dialog).getByText('Your response now: Signed off. This changes it.')).toBeInTheDocument();
        expect(within(dialog).getByLabelText(/Remark/)).toHaveValue('Fine.');
    });
});

describe('the review section, for anyone else', () => {
    it('offers no response to someone not named, and marks a sign-off given before the item changed (decision 163)', async () => {
        const answer = review([
            round('r-1', 1, 'OPEN', [openStep([reviewer('u-bob', { outcome: 'SIGNED_OFF', respondedAt: '2026-11-20T10:00:00.000Z', itemVersionAt: 5 }), reviewer('u-cy')])]),
        ]);
        routes(answer);
        const { container } = render('u-ada', 'VIEWER');
        const peer = await screen.findByRole('list', { name: 'Reviewers of Peer review' });
        expect(within(peer).getByText('Signed off')).toBeInTheDocument();
        expect(within(peer).getByText('Changed since signed off')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Sign off|Return|Skip|Remove|Edit/ })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('shows the earlier rounds read-only, with who returned and why', async () => {
        const answer = review(
            [
                round('r-2', 2, 'PLANNED', [step('st-2', 'Peer review', { reviewers: [reviewer('u-bob')] })]),
                round('r-1', 1, 'RETURNED', [
                    step('st-1', 'Peer review', {
                        status: 'RETURNED',
                        dueOn: '2026-11-25',
                        reviewers: [reviewer('u-bob', { outcome: 'RETURNED', respondedAt: '2026-11-21T10:00:00.000Z', responseText: 'Tests fail.' }), reviewer('u-cy', { withdrawnAt: '2026-11-21T10:00:00.000Z', withdrawnReason: 'STEP_ENDED' })],
                    }),
                ], { endedAt: '2026-11-21T10:00:00.000Z', endedByUserId: 'u-bob', endReason: 'RETURNED' }),
            ],
            { editSteps: true, send: true },
        );
        routes(answer);
        const { container } = render('u-ada', 'OWNER');
        expect(await screen.findByRole('status')).toHaveTextContent('Round 1 was Returned. Revise the work, then send round 2 for review.');
        expect(screen.getByRole('heading', { level: 3, name: 'Earlier rounds' })).toBeInTheDocument();
        const past = screen.getByRole('list', { name: 'Review steps of round 1' });
        expect(within(past).getByText('Tests fail.')).toBeInTheDocument();
        expect(within(past).getByText('Withdrawn: the step ended')).toBeInTheDocument();
        expect(screen.getByText(/Round 1: Returned by Bob Builder on/)).toBeInTheDocument();
        // Nothing in an ended round is offered for change.
        expect(within(past).queryByRole('button')).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });
});

describe('editing and sending', () => {
    it('adds a step through the editor with the round\'s version, then sends the round', async () => {
        const planned = review([round('r-1', 1, 'PLANNED', [step('st-1', 'Peer review', { reviewers: [reviewer('u-bob')] })])], { editSteps: true, send: true });
        const { calls } = routes(planned, {
            [`PUT ${BASE}/steps`]: { body: planned },
            [`POST ${BASE}/send`]: { body: review([round('r-1', 1, 'OPEN', [openStep([reviewer('u-bob')])], { version: 4 })], {}) },
        });
        const { baseElement } = render();
        fireEvent.click(await screen.findByRole('button', { name: 'Add review step' }));
        const dialog = await screen.findByRole('dialog', { name: 'New review step' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save step' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Give the review step a name.');
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Legal' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save step' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Name at least one reviewer or recipient list.');
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'All must sign off' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Any one signs off' }));
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'No member named' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Cy Reviewer' }));
        fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
        expect(await axe(baseElement, { rules: { region: { enabled: false } } })).toHaveNoViolations();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save step' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.ifMatch).toBe('"3"');
        expect(put.body).toEqual({
            steps: [
                { name: 'Peer review', mode: 'ALL', dueInWorkingDays: 3, memberIds: ['u-bob'], recipientListIds: [] },
                { name: 'Legal', mode: 'ANY', dueInWorkingDays: 3, memberIds: ['u-cy'], recipientListIds: [] },
            ],
        });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New review step' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `${BASE}/send`)).toBe(true));
        expect(calls.find((c) => c.path === `${BASE}/send`)!.ifMatch).toBe('"3"');
        expect(await screen.findByText('Round 1: open')).toBeInTheDocument();
    });

    it('reorders the steps not yet opened in one PUT', async () => {
        const planned = review(
            [round('r-1', 1, 'PLANNED', [step('st-1', 'Peer review', { reviewers: [reviewer('u-bob')] }), step('st-2', 'Legal', { position: 2, lists: [{ id: 'rl-legal', name: 'Legal', archived: false }] })])],
            { editSteps: true, send: true },
        );
        const { calls } = routes(planned, { [`PUT ${BASE}/steps`]: { body: planned } });
        render();
        expect(await screen.findByRole('button', { name: 'Move Peer review up' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Move Peer review down' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect((calls.find((c) => c.method === 'PUT')!.body as { steps: Array<{ name: string }> }).steps.map((s) => s.name)).toEqual(['Legal', 'Peer review']);
    });

    it('removes a step through the undo toast: nothing is sent, and Undo puts it back', async () => {
        const planned = review([round('r-1', 1, 'PLANNED', [step('st-1', 'Peer review', { reviewers: [reviewer('u-bob')] })])], { editSteps: true, send: true });
        const { calls } = routes(planned, { [`PUT ${BASE}/steps`]: { body: planned } });
        render();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove the review step Peer review' }));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'Peer review' })).toBeNull());
        expect(await screen.findByText('Removed the review step Peer review.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(await screen.findByRole('heading', { name: 'Peer review' })).toBeInTheDocument();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('removes a pending reviewer from the open step through the undo toast, with standing from the server', async () => {
        const answer = review([round('r-1', 1, 'OPEN', [openStep([reviewer('u-bob'), reviewer('u-cy')])])], { skip: true, withdraw: true, editSteps: true });
        const { calls } = routes(answer);
        render();
        fireEvent.click(await screen.findByRole('button', { name: 'Remove Cy Reviewer from Peer review' }));
        const peer = screen.getByRole('list', { name: 'Reviewers of Peer review' });
        await waitFor(() => expect(within(peer).queryByText('Cy Reviewer')).toBeNull());
        expect(await screen.findByText('Removed Cy Reviewer from Peer review.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(await within(peer).findByText('Cy Reviewer')).toBeInTheDocument();
        // The round's own buttons, from the server's answer.
        expect(screen.getByRole('button', { name: 'Skip the review step Peer review' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Withdraw the round' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Add a reviewer to Peer review' })).toBeInTheDocument();
    });

    it('skips a step with the round\'s version, and names a step nobody is left to answer', async () => {
        const answer = review([round('r-1', 1, 'OPEN', [step('st-peer', 'Peer review', { status: 'OPEN', dueOn: '2026-11-25', noReviewersLeft: true })])], { skip: true });
        const { calls } = routes(answer, { [`POST ${BASE}/steps/st-peer/skip`]: { body: answer } });
        render();
        expect(await screen.findByRole('status')).toHaveTextContent('Nobody is left to ask at this step.');
        fireEvent.click(screen.getByRole('button', { name: 'Close the review step Peer review' }));
        await waitFor(() => expect(calls.some((c) => c.path === `${BASE}/steps/st-peer/skip`)).toBe(true));
        expect(calls.find((c) => c.path === `${BASE}/steps/st-peer/skip`)!.ifMatch).toBe('"3"');
    });

    it('offers a first step on an item with no review to someone who edits work items', async () => {
        routes(review([], { editSteps: true }));
        render();
        expect(await screen.findByText('No review steps yet.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add review step' })).toBeInTheDocument();
    });
});
