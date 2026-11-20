/** @jest-environment jsdom */

/**
 * The milestone UI (sub-phase 2.5b): a project's milestones with their
 * progress and "late" mark, the writes a viewer is offered, the undo-toast
 * delete, the reorder by neighbour, the create dialog, and the detail's
 * milestone picker sending its versioned write.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL/milestones',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { MilestonesView } from '@/components/milestones/MilestonesView';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import type { MilestoneData, WorkItemViewConfig } from '@/lib/work-items/types';

import { CONFIG, detail, installFetch, MEMBERS, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

const ALPHA: MilestoneData = { id: 'ms-1', projectId: PROJECT, name: 'Alpha', dueDate: '2026-11-01', progress: { scope: 4, done: 1 }, late: true };
const BETA: MilestoneData = { id: 'ms-2', projectId: PROJECT, name: 'Beta', dueDate: null, progress: { scope: 2, done: 2 }, late: false };
const GAMMA: MilestoneData = { id: 'ms-3', projectId: PROJECT, name: 'Gamma', dueDate: '2027-01-15', progress: { scope: 0, done: 0 }, late: false };
const LIST = `GET /projects/${PROJECT}/milestones`;
const PROJECT_ROW = { id: PROJECT, teamId: TEAM, name: 'Islestone', keyPrefix: 'ISL', archived: false };
const EDITOR = { manageMilestones: true, planItems: true };

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe("a project's milestones", () => {
    it('lists each milestone in order with its due date, progress and late mark, with no axe violations', async () => {
        installFetch({ [LIST]: { body: [ALPHA, BETA, GAMMA] } });
        const { container } = renderWorkspace(<MilestonesView project={PROJECT_ROW} initialMilestones={[ALPHA, BETA, GAMMA]} affordances={EDITOR} />);
        const list = screen.getByRole('region', { name: 'In order' });
        expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
        expect(within(list).getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/t/acme/projects/ISL/milestones/ms-1');
        const alpha = screen.getByTestId('milestone-ms-1');
        expect(within(alpha).getByText('Due 2026-11-01')).toBeInTheDocument();
        expect(within(alpha).getByText('Late')).toBeInTheDocument();
        expect(within(alpha).getByText('1 of 4 done')).toBeInTheDocument();
        expect(within(alpha).getByRole('progressbar', { name: 'Alpha: 25% done' })).toBeInTheDocument();
        const beta = screen.getByTestId('milestone-ms-2');
        expect(within(beta).getByText('No due date')).toBeInTheDocument();
        expect(within(beta).getByText('Complete')).toBeInTheDocument();
        expect(within(beta).queryByText('Late')).toBeNull();
        // The first cannot move up, the last cannot move down.
        expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move Gamma down' })).toBeDisabled();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('offers no create, edit, move or delete to a viewer, nor on an archived project', () => {
        installFetch({ [LIST]: { body: [ALPHA] } });
        const { unmount } = renderWorkspace(
            <MilestonesView project={PROJECT_ROW} initialMilestones={[ALPHA]} affordances={{ manageMilestones: false, planItems: false }} />,
            { role: 'VIEWER' },
        );
        expect(screen.queryByRole('button', { name: 'Milestone' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^(Edit|Delete|Move) / })).toBeNull();
        unmount();
        renderWorkspace(<MilestonesView project={{ ...PROJECT_ROW, archived: true }} initialMilestones={[ALPHA]} affordances={EDITOR} />);
        expect(screen.getByText('This project is archived: its milestones are read-only.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^(Edit|Delete|Move) / })).toBeNull();
    });

    it('deletes through the undo toast: the row leaves at once, nothing is sent, and Undo sends nothing', async () => {
        const { calls } = installFetch({ [LIST]: { body: [ALPHA, BETA] }, [`DELETE /projects/${PROJECT}/milestones/ms-2`]: { body: { deleted: true, clearedItems: 2 } } });
        renderWorkspace(<MilestonesView project={PROJECT_ROW} initialMilestones={[ALPHA, BETA]} affordances={EDITOR} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }));
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Beta' })).toBeNull());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(screen.getByRole('link', { name: 'Beta' })).toBeInTheDocument());
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('moves a milestone by naming its new neighbour', async () => {
        const { calls } = installFetch({
            [LIST]: { body: [ALPHA, BETA, GAMMA] },
            [`PATCH /projects/${PROJECT}/milestones/ms-1`]: { body: ALPHA },
            [`PATCH /projects/${PROJECT}/milestones/ms-3`]: { body: GAMMA },
        });
        renderWorkspace(<MilestonesView project={PROJECT_ROW} initialMilestones={[ALPHA, BETA, GAMMA]} affordances={EDITOR} />);
        fireEvent.click(screen.getByRole('button', { name: 'Move Alpha down' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
        fireEvent.click(screen.getByRole('button', { name: 'Move Gamma up' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
        expect(calls.filter((c) => c.method === 'PATCH').map((c) => [c.path.split('/').pop(), c.body])).toEqual([
            ['ms-1', { position: { afterId: 'ms-2' } }],
            ['ms-3', { position: { beforeId: 'ms-2' } }],
        ]);
    });

    it('creates a milestone with its due date and shows the server\'s refusal', async () => {
        const { calls } = installFetch({
            [LIST]: { body: [] },
            [`POST /projects/${PROJECT}/milestones`]: (req) =>
                (req.body as { name: string }).name === 'Alpha'
                    ? { status: 409, body: { error: { message: 'This project already has a milestone named Alpha.', code: 'CONFLICT' } } }
                    : { status: 201, body: { ...GAMMA, name: 'Launch' } },
        });
        renderWorkspace(<MilestonesView project={PROJECT_ROW} initialMilestones={[]} affordances={EDITOR} />);
        expect(screen.getByText('No milestones yet. Add one to group work towards a date.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Milestone' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Alpha' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create milestone' }));
        expect(await within(dialog).findByText('This project already has a milestone named Alpha.')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: 'Launch' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create milestone' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
        expect(calls.filter((c) => c.method === 'POST')[1]!.body).toEqual({ name: 'Launch', dueDate: null });
    });
});

describe("the detail's milestone picker", () => {
    const WITH_MILESTONES: WorkItemViewConfig = {
        ...CONFIG,
        milestones: [
            { id: 'ms-1', projectId: PROJECT, name: 'Alpha', dueDate: null },
            { id: 'ms-9', projectId: 'proj-other', name: 'Elsewhere', dueDate: null },
        ],
    };

    it("offers the project's milestones only and sends the change with If-Match", async () => {
        const { calls } = installFetch({
            'GET /work-items/wi-1': { body: detail(row(1)) },
            'GET /users/assignable': { body: MEMBERS },
            'GET /work-items/wi-1/watchers': { body: [] },
            [`GET /projects/${PROJECT}/custom-fields`]: { body: [] },
            'PUT /work-items/wi-1/milestone': { body: detail(row(1, { milestoneId: 'ms-1', version: 2 })) },
        });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_MILESTONES });
        // The trigger is named by its selection, as every picker's is.
        fireEvent.click(await screen.findByRole('combobox', { name: 'No milestone' }));
        expect(screen.queryByRole('option', { name: 'Elsewhere' })).toBeNull();
        fireEvent.click(await screen.findByRole('option', { name: 'Alpha' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.body).toEqual({ milestoneId: 'ms-1' });
        expect(put.ifMatch).toBe('"1"');
    });
});
