/** @jest-environment jsdom */

/**
 * Settings → a work item type → Review steps (sub-phase 2.8c; decisions 149
 * and 159): the type's default steps with whom each names, the step editor
 * (workspace lists only), reordering, removal through the undo toast, and
 * "Review must finish before Done", each write the whole set; every write
 * offered only with the server's `manageWorkConfig`; refusals shown as the
 * server words them. Queries by role and label; jest-axe on each state.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/settings/work-item-types/ty-feature/review-steps',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { WorkItemTypeReviewStepsSettings } from '@/components/settings/WorkItemTypeReviewStepsSettings';
import { WorkItemTypeFieldsSettings } from '@/components/settings/WorkItemTypeFieldsSettings';
import { WorkItemTypesSettings } from '@/components/settings/WorkItemTypesSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { TypeReviewStepsData, WorkConfigAffordances } from '@/lib/work-items/types';

import { installFetch, MEMBERS, renderWorkspace, type Answer } from '../helpers/work-items-harness';

const ALL: WorkConfigAffordances = { manageWorkConfig: true, createProject: true, editProject: true, archiveProject: true, manageCustomFields: true };
const NONE: WorkConfigAffordances = { manageWorkConfig: false, createProject: false, editProject: false, archiveProject: false, manageCustomFields: false };

const TYPES = [
    { id: 'ty-feature', name: 'Feature', archivedAt: null, reviewRequiredForDone: true },
    { id: 'ty-bug', name: 'Bug', archivedAt: null, reviewRequiredForDone: false },
];
const PATH = '/work-item-types/ty-feature/review-steps';
const BOB = MEMBERS.find((m) => m.id === 'u-bob')!;

function data(over: Partial<TypeReviewStepsData> = {}): TypeReviewStepsData {
    return {
        typeId: 'ty-feature',
        reviewRequiredForDone: false,
        steps: [
            { id: 's-1', position: 1, name: 'Peer review', mode: 'ALL', dueInWorkingDays: 2, memberIds: ['u-bob'], recipientListIds: [], lists: [] },
            { id: 's-2', position: 2, name: 'Legal', mode: 'ANY', dueInWorkingDays: 3, memberIds: [], recipientListIds: ['rl-legal'], lists: [{ id: 'rl-legal', name: 'Legal', archived: false }] },
        ],
        ...over,
    };
}

function routes(answer: TypeReviewStepsData, more: Record<string, Answer> = {}) {
    return installFetch({
        [`GET ${PATH}`]: { body: answer },
        'GET /work-item-types': { body: TYPES },
        'GET /users/assignable': { body: MEMBERS },
        'GET /recipient-lists': { body: [{ id: 'rl-legal', name: 'Legal', projectId: null, archivedAt: null, memberUserIds: [] }] },
        ...more,
    });
}

/** The mirrored DataTable's empty header cell is upstream's. */
const axeTable = (container: Element) => axe(container, { rules: { 'empty-table-header': { enabled: false } } });

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe("a type's review steps", () => {
    it('lists the steps with whom each names and the Done switch; no axe violations', async () => {
        routes(data());
        const { container } = renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Feature review steps' })).toBeInTheDocument();
        const table = await screen.findByTestId('settings-type-review-steps-table');
        expect(await within(table).findByText('Peer review')).toBeInTheDocument();
        expect(within(table).getByText('All must sign off')).toBeInTheDocument();
        expect(within(table).getByText('Any one signs off')).toBeInTheDocument();
        expect(within(table).getByRole('columnheader', { name: 'Due in working days' })).toBeInTheDocument();
        expect(await within(table).findByText(BOB.name!)).toBeInTheDocument();
        expect(within(table).getByText('Legal (list)')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Review must finish before an item of the type Feature moves to Done' })).not.toBeChecked();
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('turns the Done check on with the whole set, and says when there are no default steps', async () => {
        const on = data({ reviewRequiredForDone: true });
        const { calls } = routes(data(), { [`PUT ${PATH}`]: { body: on } });
        renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        await screen.findByText('Peer review');
        fireEvent.click(screen.getByRole('switch', { name: /moves to Done/ }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
            reviewRequiredForDone: true,
            steps: [
                { name: 'Peer review', mode: 'ALL', dueInWorkingDays: 2, memberIds: ['u-bob'], recipientListIds: [] },
                { name: 'Legal', mode: 'ANY', dueInWorkingDays: 3, memberIds: [], recipientListIds: ['rl-legal'] },
            ],
        });
        expect(await screen.findByRole('switch', { name: /moves to Done/ })).toBeChecked();
    });

    it('names a required type with no default steps', async () => {
        routes(data({ reviewRequiredForDone: true, steps: [] }));
        const { container } = renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        expect(await screen.findByRole('note')).toHaveTextContent('This type has no default review steps');
        expect(screen.getByText('No default review steps. New items of this type start with none.')).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('adds a step through the editor, which offers the workspace lists only', async () => {
        const { calls } = routes(data({ steps: [] }), { [`PUT ${PATH}`]: { body: data() } });
        renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Review step' }));
        const dialog = await screen.findByRole('dialog', { name: 'New review step' });
        fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Sign-off' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save step' }));
        // Naming nobody is refused before anything is sent.
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Name at least one reviewer or recipient list.');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
        // A list is the only workspace list offered; there is no project query.
        expect(calls.some((c) => c.method === 'GET' && c.path === '/recipient-lists' && c.search.get('projectId'))).toBe(false);
    });

    it('moves a step down with the whole set in the new order', async () => {
        const { calls } = routes(data(), { [`PUT ${PATH}`]: { body: data() } });
        renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        expect(await screen.findByRole('button', { name: 'Move the review step Peer review down' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Move the review step Peer review up' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Move the review step Peer review down' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect((calls.find((c) => c.method === 'PUT')!.body as { steps: Array<{ name: string }> }).steps.map((s) => s.name)).toEqual(['Legal', 'Peer review']);
    });

    it('removes a step through the undo toast: nothing is sent, and Undo puts it back', async () => {
        const { calls } = routes(data(), { [`PUT ${PATH}`]: { body: data() } });
        renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Remove the review step Legal' }));
        await waitFor(() => expect(screen.queryByText('Legal (list)')).toBeNull());
        expect(await screen.findByText('Review step Legal removed')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(await screen.findByText('Legal (list)')).toBeInTheDocument();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it("shows a refusal as the server words it", async () => {
        routes(data(), {
            [`PUT ${PATH}`]: { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'A default reviewer must be an active member of the workspace.', reason: 'REVIEWER_NOT_ELIGIBLE' } } },
        });
        renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={ALL} />);
        await screen.findByText('Peer review');
        fireEvent.click(screen.getByRole('switch', { name: /moves to Done/ }));
        expect(await screen.findByText('A default reviewer must be an active member of the workspace.')).toBeInTheDocument();
    });

    it('offers no write to a viewer the server says may not manage; no axe violations', async () => {
        routes(data({ reviewRequiredForDone: true }));
        const { container } = renderWorkspace(<WorkItemTypeReviewStepsSettings typeId="ty-feature" affordances={NONE} />);
        await screen.findByText('Peer review');
        expect(screen.queryByRole('button', { name: 'Review step' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Remove the review step/ })).toBeNull();
        expect(screen.getByRole('switch', { name: /moves to Done/ })).toBeDisabled();
        expect(screen.getByRole('switch', { name: /moves to Done/ })).toBeChecked();
        expect(await axeTable(container)).toHaveNoViolations();
    });
});

describe('the way to a type\'s review steps', () => {
    it('the types list links each type to its review steps and marks the ones that hold Done', async () => {
        installFetch({ 'GET /work-item-types': { body: TYPES } });
        renderWorkspace(<WorkItemTypesSettings affordances={ALL} />);
        expect(await screen.findByRole('link', { name: 'Review steps of Feature' })).toHaveAttribute('href', '/t/acme/settings/work-item-types/ty-feature/review-steps');
        expect(screen.getByRole('link', { name: 'Review steps of Bug' })).toBeInTheDocument();
        expect(screen.getAllByText('Required before Done')).toHaveLength(1);
    });

    it("a type's fields page links to its review steps", async () => {
        installFetch({ 'GET /work-item-types': { body: TYPES }, 'GET /work-item-types/ty-feature/fields': { body: { typeId: 'ty-feature', fields: [] } } });
        renderWorkspace(<WorkItemTypeFieldsSettings typeId="ty-feature" affordances={NONE} />);
        expect(await screen.findByRole('link', { name: 'Review steps' })).toHaveAttribute('href', '/t/acme/settings/work-item-types/ty-feature/review-steps');
    });
});
