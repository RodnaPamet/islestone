/** @jest-environment jsdom */

/**
 * The Settings pages (decision 55): the landing page's sections and
 * first-project steps; teams, a team's workflow states, work item types,
 * labels and projects, each offering exactly the writes the server's
 * `workConfigAffordances` hands it; refusals shown as the server words them;
 * deletes through the undo toast; archiving a project behind a typed
 * confirmation. The server pages' gate (`mayOpenSettings`) is driven here
 * too, with the session and the tenant context mocked. Queries by role and
 * label; jest-axe on each page.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/settings/teams',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
    notFound: () => {
        throw new Error('NEXT_NOT_FOUND');
    },
}));

jest.mock('next-intl/server', () => {
    const catalog = jest.requireActual('../../messages/en.json');
    return {
        getTranslations: async (ns: string) => (key: string) =>
            `${ns}.${key}`.split('.').reduce((o: Record<string, unknown>, k) => o?.[k] as Record<string, unknown>, catalog) ?? key,
    };
});

const mockSession = { userId: 'u-ada', tenantId: 't1', email: 'ada@example.com', role: 'OWNER', membershipTenantIds: ['t1'], mfaPendingTenantIds: [] };
jest.mock('@/lib/auth/session', () => ({ getSessionOrThrow: async () => mockSession }));

const mockContext = jest.fn();
jest.mock('@/lib/server/tenant-context.server', () => ({ getTenantServerContext: (...args: unknown[]) => mockContext(...args) }));

import SettingsPage from '@/app/t/[tenantSlug]/(app)/settings/page';
import LabelsSettingsPage from '@/app/t/[tenantSlug]/(app)/settings/labels/page';
import ProjectsSettingsPage from '@/app/t/[tenantSlug]/(app)/settings/projects/page';
import TeamWorkflowSettingsPage from '@/app/t/[tenantSlug]/(app)/settings/teams/[teamId]/page';
import TeamsSettingsPage from '@/app/t/[tenantSlug]/(app)/settings/teams/page';
import WorkItemTypesSettingsPage from '@/app/t/[tenantSlug]/(app)/settings/work-item-types/page';
import { LabelsSettings } from '@/components/settings/LabelsSettings';
import { ProjectsSettings } from '@/components/settings/ProjectsSettings';
import { SettingsOverview } from '@/components/settings/SettingsOverview';
import { TeamsSettings } from '@/components/settings/TeamsSettings';
import { WorkflowStatesSettings } from '@/components/settings/WorkflowStatesSettings';
import { WorkItemTypesSettings } from '@/components/settings/WorkItemTypesSettings';
import { NewWorkItemModal } from '@/components/work-items/NewWorkItemModal';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { getPermissionsForRole } from '@/lib/permissions';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { CONFIG, deferred, installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ALL: WorkConfigAffordances = { manageWorkConfig: true, createProject: true, editProject: true, archiveProject: true, manageCustomFields: true };
const NONE: WorkConfigAffordances = { manageWorkConfig: false, createProject: false, editProject: false, archiveProject: false, manageCustomFields: false };

const TEAMS = [
    { id: 'team-1', name: 'Core' },
    { id: 'team-2', name: 'Growth' },
];

const STATES = [
    { id: 'st-backlog', teamId: 'team-1', name: 'Backlog', category: 'BACKLOG', sortKey: 'a0', isDefault: false, archivedAt: null },
    { id: 'st-todo', teamId: 'team-1', name: 'Todo', category: 'UNSTARTED', sortKey: 'a1', isDefault: true, archivedAt: null },
    { id: 'st-progress', teamId: 'team-1', name: 'In progress', category: 'STARTED', sortKey: 'a2', isDefault: false, archivedAt: null },
    { id: 'st-review', teamId: 'team-1', name: 'In review', category: 'STARTED', sortKey: 'a3', isDefault: false, archivedAt: null },
    { id: 'st-done', teamId: 'team-1', name: 'Done', category: 'DONE', sortKey: 'a4', isDefault: false, archivedAt: null },
    { id: 'st-cancelled', teamId: 'team-1', name: 'Cancelled', category: 'CANCELLED', sortKey: 'a5', isDefault: false, archivedAt: null },
];

const TYPES = [
    { id: 'ty-feature', name: 'Feature', archivedAt: null },
    { id: 'ty-old', name: 'Epic', archivedAt: '2026-11-01T00:00:00.000Z' },
];

const LABELS = [
    { id: 'lb-ui', teamId: null, name: 'UI' },
    { id: 'lb-api', teamId: 'team-1', name: 'API' },
];

const PROJECTS = [
    { id: 'p-1', teamId: 'team-1', name: 'Islands', keyPrefix: 'ISL', archivedAt: null },
    { id: 'p-2', teamId: 'team-2', name: 'Old', keyPrefix: 'OLD', archivedAt: '2026-11-01T00:00:00.000Z' },
];

/** Run the table's axe pass; the empty header cell of the mirrored DataTable is upstream's. */
const axeTable = (container: Element) => axe(container, { rules: { 'empty-table-header': { enabled: false } } });

beforeEach(() => __resetPendingUndoToastsForTest());
afterEach(() => __resetPendingUndoToastsForTest());

describe('the landing page', () => {
    it('lists the four sections under the page heading, with counts and links, and no axe violations', async () => {
        installFetch({
            'GET /teams': { body: TEAMS },
            'GET /work-item-types': { body: TYPES },
            'GET /labels': { body: LABELS },
            'GET /projects': { body: PROJECTS },
        });
        const { container } = renderWorkspace(<SettingsOverview title="Settings" affordances={ALL} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
        const nav = screen.getByRole('navigation', { name: 'Settings sections' });
        for (const name of ['Teams', 'Work item types', 'Labels', 'Projects']) {
            expect(within(nav).getByRole('heading', { level: 2, name })).toBeInTheDocument();
        }
        expect(within(nav).getByRole('link', { name: 'Manage teams' })).toHaveAttribute('href', '/t/acme/settings/teams');
        expect(within(nav).getByRole('link', { name: 'Manage projects' })).toHaveAttribute('href', '/t/acme/settings/projects');
        expect(await screen.findByTestId('settings-count-teams')).toHaveTextContent('2 in this workspace');
        // Archived types and projects are not counted.
        expect(screen.getByTestId('settings-count-workItemTypes')).toHaveTextContent('1 in this workspace');
        expect(screen.getByTestId('settings-count-projects')).toHaveTextContent('1 in this workspace');
        // A workspace with an open project is past the first-project steps.
        expect(screen.queryByRole('heading', { name: 'Your first project' })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('on a fresh workspace, walks the admin to a team first, then a project', async () => {
        installFetch({ 'GET /teams': { body: [] }, 'GET /work-item-types': { body: [] }, 'GET /labels': { body: [] }, 'GET /projects': { body: [] } });
        const { container } = renderWorkspace(<SettingsOverview title="Settings" affordances={ALL} />);
        const steps = await screen.findByRole('region', { name: 'Your first project' });
        expect(within(steps).getByRole('link', { name: 'Go to Teams' })).toHaveAttribute('href', '/t/acme/settings/teams');
        expect(within(steps).getByRole('link', { name: 'Go to Projects' })).toHaveAttribute('href', '/t/acme/settings/projects');
        expect(within(steps).getAllByText('(To do)')).toHaveLength(3);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('marks the team step done once a team exists', async () => {
        installFetch({ 'GET /teams': { body: TEAMS }, 'GET /work-item-types': { body: [] }, 'GET /labels': { body: [] }, 'GET /projects': { body: [] } });
        renderWorkspace(<SettingsOverview title="Settings" affordances={ALL} />);
        const steps = await screen.findByRole('region', { name: 'Your first project' });
        expect(within(steps).queryByRole('link', { name: 'Go to Teams' })).toBeNull();
        expect(within(steps).getByText('(Done)')).toBeInTheDocument();
    });

    it('tells a viewer who may change nothing so, and offers no steps', async () => {
        installFetch({ 'GET /teams': { body: [] }, 'GET /work-item-types': { body: [] }, 'GET /labels': { body: [] }, 'GET /projects': { body: [] } });
        renderWorkspace(<SettingsOverview title="Settings" affordances={NONE} />);
        expect(screen.getByText(/You can read these settings/)).toBeInTheDocument();
        await screen.findByTestId('settings-count-teams');
        expect(screen.queryByRole('region', { name: 'Your first project' })).toBeNull();
    });
});

describe('Teams', () => {
    it('lists the teams, each linking to its workflow, with no axe violations', async () => {
        installFetch({ 'GET /teams': { body: TEAMS } });
        const { container } = renderWorkspace(<TeamsSettings affordances={ALL} />);
        expect(await screen.findByRole('link', { name: 'Core' })).toHaveAttribute('href', '/t/acme/settings/teams/team-1');
        expect(screen.getByRole('link', { name: 'Edit the workflow of Growth' })).toHaveAttribute('href', '/t/acme/settings/teams/team-2');
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('creates a team and reads the list again', async () => {
        let created = false;
        const { calls } = installFetch({
            'GET /teams': () => ({ body: created ? [...TEAMS, { id: 'team-3', name: 'Platform' }] : TEAMS }),
            'GET /work-item-types': { body: [] },
            'POST /teams': () => {
                created = true;
                return { status: 201, body: { id: 'team-3', name: 'Platform', workflowStates: [] } };
            },
        });
        renderWorkspace(<TeamsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Team' }));
        const dialog = await screen.findByRole('dialog', { name: 'New team' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Platform' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }));
        expect(await screen.findByRole('link', { name: 'Platform' })).toBeInTheDocument();
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Platform' });
    });

    it('shows a refused create in the dialog and keeps the name', async () => {
        installFetch({
            'GET /teams': { body: TEAMS },
            'POST /teams': { status: 403, body: { error: { code: 'FORBIDDEN', message: 'You do not have permission to change the workspace settings.' } } },
        });
        renderWorkspace(<TeamsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Team' }));
        const dialog = await screen.findByRole('dialog', { name: 'New team' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Platform' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create team' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('You do not have permission to change the workspace settings.');
        expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Platform');
    });

    it('renames a team', async () => {
        const { calls } = installFetch({ 'GET /teams': { body: TEAMS }, 'GET /work-item-types': { body: [] }, 'PATCH /teams/team-1': { body: { id: 'team-1', name: 'Kernel' } } });
        renderWorkspace(<TeamsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Rename Core' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rename team' });
        expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Core');
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Kernel' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Kernel' }));
    });

    it('hides a deleted team at once, and Undo brings it back without sending anything', async () => {
        const { calls } = installFetch({ 'GET /teams': { body: TEAMS } });
        renderWorkspace(<TeamsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete Growth' }));
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Growth' })).toBeNull());
        expect(await screen.findByText('Team Growth deleted')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(await screen.findByRole('link', { name: 'Growth' })).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('sends the delete when the window closes; a refusal brings the team back with the reason', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                'GET /teams': { body: TEAMS },
                'DELETE /teams/team-2': {
                    status: 409,
                    body: { error: { code: 'CONFLICT', message: 'A team with projects cannot be deleted.', details: { reason: 'TEAM_HAS_PROJECTS' } } },
                },
            });
            renderWorkspace(<TeamsSettings affordances={ALL} />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            fireEvent.click(await screen.findByRole('button', { name: 'Delete Growth' }));
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/teams/team-2']);
            expect(await screen.findByText('A team with projects cannot be deleted.')).toBeInTheDocument();
            expect(await screen.findByRole('link', { name: 'Growth' })).toBeInTheDocument();
        } finally {
            jest.useRealTimers();
        }
    });

    it('offers no write to a viewer the server says may not manage', async () => {
        installFetch({ 'GET /teams': { body: TEAMS } });
        renderWorkspace(<TeamsSettings affordances={NONE} />);
        expect(await screen.findByRole('link', { name: 'Core' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Team' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Rename Core' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete Core' })).toBeNull();
    });
});

describe('a team\'s workflow', () => {
    const routes = (extra: Parameters<typeof installFetch>[0] = {}) =>
        installFetch({ 'GET /teams/team-1': { body: { id: 'team-1', name: 'Core', workflowStates: STATES } }, ...extra });

    function rowOf(name: string) {
        return screen.getByRole('cell', { name: new RegExp(`^${name}`) }).closest('tr')!;
    }

    it('lists the states by category, the default marked, with no axe violations', async () => {
        routes();
        const { container } = renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
        expect(await screen.findByRole('heading', { level: 1, name: 'Core: workflow' })).toBeInTheDocument();
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([
            'Backlog',
            'Todo(Default)',
            'In progress',
            'In review',
            'Done',
            'Cancelled',
        ]);
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('creates a state with the category chosen once', async () => {
        const { calls } = routes({ 'POST /teams/team-1/workflow-states': { status: 201, body: { id: 'st-new' } } });
        renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'State' }));
        const dialog = await screen.findByRole('dialog', { name: 'New workflow state' });
        expect(within(dialog).getByText('The category cannot be changed later.')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Triage' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create state' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Triage', category: 'UNSTARTED' }));
    });

    it('renames a state without offering its category', async () => {
        const { calls } = routes({ 'PATCH /teams/team-1/workflow-states/st-review': { body: {} } });
        renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Rename In review' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rename state' });
        expect(within(dialog).getByText('Category: Started. It cannot be changed.')).toBeInTheDocument();
        expect(within(dialog).queryByRole('combobox')).toBeNull();
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Review' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Review' }));
    });

    it('moves a state within its category only', async () => {
        const { calls } = routes({
            'PATCH /teams/team-1/workflow-states/st-progress': { body: {} },
            'PATCH /teams/team-1/workflow-states/st-review': { body: {} },
        });
        renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
        await screen.findByRole('button', { name: 'Move In progress down' });
        // The first and last of a category cannot leave it.
        expect(screen.getByRole('button', { name: 'Move In progress up' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move In review down' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move Todo up' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Move In progress down' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ position: { afterId: 'st-review' } }]));
        fireEvent.click(screen.getByRole('button', { name: 'Move In review up' }));
        await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)[1]).toEqual({ position: { beforeId: 'st-progress' } }));
    });

    it('makes a state the default, and shows the server\'s refusal of an archive', async () => {
        const { calls } = routes({
            'PATCH /teams/team-1/workflow-states/st-backlog': { body: {} },
            'PATCH /teams/team-1/workflow-states/st-done': {
                status: 409,
                body: { error: { code: 'CONFLICT', message: 'A team keeps at least one live DONE state.' } },
            },
        });
        renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
        // The default state cannot be archived, deleted or made default again.
        await screen.findByRole('button', { name: 'Rename Todo' });
        expect(screen.queryByRole('button', { name: 'Make Todo the default state' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Archive Todo' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete Todo' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Make Backlog the default state' }));
        await waitFor(() => expect(calls.find((c) => c.path.endsWith('st-backlog'))?.body).toEqual({ isDefault: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Archive Done' }));
        expect(await screen.findByText('A team keeps at least one live DONE state.')).toBeInTheDocument();
    });

    it('deletes a state through the undo toast, moving its items to the state chosen', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = routes({ 'DELETE /teams/team-1/workflow-states/st-review': { body: { deleted: true, movedItems: 2 } } });
            renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={ALL} />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            fireEvent.click(await screen.findByRole('button', { name: 'Delete In review' }));
            const dialog = await screen.findByRole('dialog', { name: 'Delete In review?' });
            // The same category's other live state is offered first.
            expect(within(dialog).getByText('In progress (Started)')).toBeInTheDocument();
            fireEvent.click(within(dialog).getByRole('button', { name: 'Delete state' }));
            await waitFor(() => expect(screen.queryByRole('button', { name: 'Rename In review' })).toBeNull());
            expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            const del = calls.find((c) => c.method === 'DELETE');
            expect(del?.path).toBe('/teams/team-1/workflow-states/st-review');
            expect(del?.search.get('moveToStateId')).toBe('st-progress');
        } finally {
            jest.useRealTimers();
        }
    });

    it('lists the workflow read-only for a viewer the server says may not manage', async () => {
        routes();
        renderWorkspace(<WorkflowStatesSettings teamId="team-1" affordances={NONE} />);
        await screen.findByRole('heading', { level: 1, name: 'Core: workflow' });
        expect(rowOf('In review')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'State' })).toBeNull();
        expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull();
    });
});

describe('Work item types', () => {
    it('lists the types with their status, creates and archives, with no axe violations', async () => {
        const { calls } = installFetch({
            'GET /work-item-types': { body: TYPES },
            'POST /work-item-types': { status: 201, body: { id: 'ty-new', name: 'Spike' } },
            'PATCH /work-item-types/ty-feature': { body: {} },
            'PATCH /work-item-types/ty-old': { body: {} },
        });
        const { container } = renderWorkspace(<WorkItemTypesSettings affordances={ALL} />);
        expect(await screen.findByText('Feature')).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
        fireEvent.click(screen.getByRole('button', { name: 'Archive Feature' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unarchive Epic' }));
        await waitFor(() =>
            expect(calls.filter((c) => c.method === 'PATCH').map((c) => [c.path, c.body])).toEqual([
                ['/work-item-types/ty-feature', { archived: true }],
                ['/work-item-types/ty-old', { archived: false }],
            ]),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        const dialog = await screen.findByRole('dialog', { name: 'New work item type' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Spike' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create type' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Spike' }));
    });

    it('offers no write to a viewer the server says may not manage', async () => {
        installFetch({ 'GET /work-item-types': { body: TYPES } });
        renderWorkspace(<WorkItemTypesSettings affordances={NONE} />);
        await screen.findByText('Feature');
        expect(screen.queryByRole('button', { name: 'Type' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Archive Feature' })).toBeNull();
    });
});

describe('Labels', () => {
    it('lists each label with its scope, creates a team label, with no axe violations', async () => {
        const { calls } = installFetch({
            'GET /labels': { body: LABELS },
            'GET /teams': { body: TEAMS },
            'POST /labels': { status: 201, body: { id: 'lb-new', teamId: 'team-2', name: 'Growth bugs' } },
        });
        const { container } = renderWorkspace(<LabelsSettings affordances={ALL} />);
        const ui = (await screen.findByText('UI')).closest('tr')!;
        expect(within(ui).getByText('The whole workspace')).toBeInTheDocument();
        await waitFor(() => expect(within(screen.getByText('API').closest('tr')!).getByText('Core')).toBeInTheDocument());
        expect(await axeTable(container)).toHaveNoViolations();

        fireEvent.click(screen.getByRole('button', { name: 'Label' }));
        const dialog = await screen.findByRole('dialog', { name: 'New label' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Growth bugs' } });
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'The whole workspace' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Growth' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create label' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Growth bugs', teamId: 'team-2' }));
    });

    it('deletes a label through the undo toast', async () => {
        const { calls } = installFetch({ 'GET /labels': { body: LABELS }, 'GET /teams': { body: TEAMS } });
        renderWorkspace(<LabelsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Delete UI' }));
        await waitFor(() => expect(screen.queryByText('UI')).toBeNull());
        expect(await screen.findByText('Label UI deleted')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

describe('Projects', () => {
    it('lists every project, archived ones marked, with no axe violations', async () => {
        installFetch({ 'GET /projects': { body: PROJECTS }, 'GET /teams': { body: TEAMS } });
        const { container } = renderWorkspace(<ProjectsSettings affordances={ALL} />);
        const islands = (await screen.findByRole('link', { name: 'Islands' })).closest('tr')!;
        expect(within(islands).getByText('ISL')).toBeInTheDocument();
        expect(within(islands).getByText('Active')).toBeInTheDocument();
        expect(within(screen.getByRole('link', { name: 'Old' }).closest('tr')!).getByText('Archived')).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('creates a project with its team and an upper-case key prefix', async () => {
        const { calls } = installFetch({
            'GET /projects': { body: PROJECTS },
            'GET /teams': { body: TEAMS },
            'POST /projects': { status: 201, body: { id: 'p-3' } },
        });
        renderWorkspace(<ProjectsSettings affordances={ALL} />);
        await screen.findByRole('link', { name: 'Islands' });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Engine' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'eng' } });
        expect(within(dialog).getByLabelText(/^Key prefix/)).toHaveValue('ENG');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG' }));
    });

    it('takes the first team when the teams arrive after the dialog opened', async () => {
        const teamsAnswer = deferred<{ body: unknown }>();
        const { calls } = installFetch({
            'GET /projects': { body: [] },
            'GET /teams': () => teamsAnswer.promise,
            'POST /projects': { status: 201, body: { id: 'p-3' } },
        });
        renderWorkspace(<ProjectsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Engine' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'ENG' } });
        expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
        await act(async () => teamsAnswer.resolve({ body: TEAMS }));
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled());
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG' }));
    });

    it('shows a refused prefix in the dialog', async () => {
        installFetch({
            'GET /projects': { body: PROJECTS },
            'GET /teams': { body: TEAMS },
            'POST /projects': {
                status: 409,
                body: { error: { code: 'CONFLICT', message: 'The key prefix ISL is or was used in this workspace; prefixes are never reused.' } },
            },
        });
        renderWorkspace(<ProjectsSettings affordances={ALL} />);
        await screen.findByRole('link', { name: 'Islands' });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Again' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'ISL' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('prefixes are never reused');
    });

    it('with no team, sends the admin to Teams and refuses to submit', async () => {
        installFetch({ 'GET /projects': { body: [] }, 'GET /teams': { body: [] } });
        renderWorkspace(<ProjectsSettings affordances={ALL} />);
        await screen.findByText('No projects yet.');
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        expect(within(dialog).getByRole('link', { name: 'Create a team first' })).toHaveAttribute('href', '/t/acme/settings/teams');
        expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
    });

    it('archives only after the key prefix is typed, and unarchives at once', async () => {
        const { calls } = installFetch({
            'GET /projects': { body: PROJECTS },
            'GET /teams': { body: TEAMS },
            'POST /projects/p-1/archive': { body: {} },
            'POST /projects/p-2/archive': { body: {} },
        });
        renderWorkspace(<ProjectsSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Archive Islands' }));
        const dialog = await screen.findByRole('dialog', { name: 'Archive Islands?' });
        const confirm = within(dialog).getByRole('button', { name: 'Archive project' });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText(/^Type ISL to confirm/), { target: { value: 'IS' } });
        expect(confirm).toBeDisabled();
        fireEvent.change(within(dialog).getByLabelText(/^Type ISL to confirm/), { target: { value: 'ISL' } });
        expect(confirm).toBeEnabled();
        fireEvent.click(confirm);
        await waitFor(() => expect(calls.find((c) => c.path === '/projects/p-1/archive')?.body).toEqual({ archived: true }));
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Archive Islands?' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Unarchive Old' }));
        await waitFor(() => expect(calls.find((c) => c.path === '/projects/p-2/archive')?.body).toEqual({ archived: false }));
    });

    it('offers each project write only where the server does', async () => {
        installFetch({ 'GET /projects': { body: PROJECTS }, 'GET /teams': { body: TEAMS } });
        renderWorkspace(<ProjectsSettings affordances={{ ...NONE, editProject: true }} />);
        await screen.findByRole('link', { name: 'Islands' });
        expect(screen.getByRole('button', { name: 'Rename Islands' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Archive Islands' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
    });
});

describe('the new-work-item dialog with no open project', () => {
    const NO_PROJECTS = { ...CONFIG, projects: [] };

    it('sends a member who may open Settings to Settings → Projects', async () => {
        installFetch({ 'GET /users/assignable': { body: [] } });
        renderWorkspace(<NewWorkItemModal open onOpenChange={() => {}} />, { role: 'ADMIN', config: NO_PROJECTS });
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        expect(within(dialog).getByRole('link', { name: 'Set up a project in Settings' })).toHaveAttribute('href', '/t/acme/settings/projects');
    });

    it('names no Settings link to a member who may not open it', async () => {
        installFetch({ 'GET /users/assignable': { body: [] } });
        renderWorkspace(<NewWorkItemModal open onOpenChange={() => {}} />, { role: 'MEMBER', config: NO_PROJECTS });
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        expect(within(dialog).getByText('There is no open project to add a work item to.')).toBeInTheDocument();
        expect(within(dialog).queryByRole('link', { name: 'Set up a project in Settings' })).toBeNull();
    });
});

describe('the server pages', () => {
    const params = Promise.resolve({ tenantSlug: 'acme' });
    const teamParams = Promise.resolve({ tenantSlug: 'acme', teamId: 'team-1' });

    function contextFor(role: Role, appPermissions = getPermissionsForRole(role)) {
        return {
            tenant: { id: 't1', slug: 'acme', name: 'Acme' },
            role,
            membershipRole: role,
            permissions: { canRead: true, canWrite: role !== 'VIEWER' && role !== 'GUEST', canAdmin: role === 'OWNER' || role === 'ADMIN', canExport: false },
            appPermissions,
        };
    }

    const PAGES = [
        ['Settings', () => SettingsPage({ params })],
        ['Teams', () => TeamsSettingsPage({ params })],
        ['a team\'s workflow', () => TeamWorkflowSettingsPage({ params: teamParams })],
        ['Work item types', () => WorkItemTypesSettingsPage({ params })],
        ['Labels', () => LabelsSettingsPage({ params })],
        ['Projects', () => ProjectsSettingsPage({ params })],
    ] as const;

    beforeEach(() => mockContext.mockReset());

    it.each(PAGES)('%s is a 404 for a Member, a Viewer and a Guest, and for a Member whose custom role grants admin.view', async (_name, page) => {
        for (const role of ['MEMBER', 'VIEWER', 'GUEST'] as Role[]) {
            mockContext.mockResolvedValue(contextFor(role));
            await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
        }
        const member = getPermissionsForRole('MEMBER');
        mockContext.mockResolvedValue(contextFor('MEMBER', { ...member, admin: { ...member.admin, view: true } }));
        await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it.each(PAGES)('%s asks the workspace context with the session', async (_name, page) => {
        mockContext.mockResolvedValue(contextFor('ADMIN'));
        await page();
        expect(mockContext).toHaveBeenCalledWith(expect.objectContaining({ tenantSlug: 'acme', userId: 'u-ada' }));
    });

    it('the landing page renders its heading for an Owner', async () => {
        mockContext.mockResolvedValue(contextFor('OWNER'));
        installFetch({ 'GET /teams': { body: [] }, 'GET /work-item-types': { body: [] }, 'GET /labels': { body: [] }, 'GET /projects': { body: [] } });
        renderWorkspace(await SettingsPage({ params }));
        expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    });

    it('hands an Admin whose custom role withholds admin.manage a read-only Teams page', async () => {
        const admin = getPermissionsForRole('ADMIN');
        mockContext.mockResolvedValue(contextFor('ADMIN', { ...admin, admin: { ...admin.admin, manage: false } }));
        installFetch({ 'GET /teams': { body: TEAMS } });
        renderWorkspace(await TeamsSettingsPage({ params }));
        expect(await screen.findByRole('link', { name: 'Core' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Team' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete Core' })).toBeNull();
    });
});
