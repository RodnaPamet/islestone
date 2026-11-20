/** @jest-environment jsdom */

/**
 * Recipient lists in the browser (sub-phase 2.7e; owner decisions 138 to
 * 142): a scope's lists with their people; the writes offered only where the
 * server's affordance says so; creating sends the name and description;
 * removing a person goes through the undo toast (nothing is sent until the
 * window closes, Undo puts them back); archiving is sent at once and an
 * archived list offers only Restore; the watchers panel's "Add recipient
 * list" copies a list onto the item; Settings → Intake names a list. Queries
 * by role and label; jest-axe on the page.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/settings/recipient-lists',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { RecipientListsView } from '@/components/recipient-lists/RecipientListsView';
import { IntakeSettings } from '@/components/settings/IntakeSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { WatchersPanel } from '@/components/work-items/detail/collab-panels';
import type { IntakeAffordances, ProjectIntakeSettings } from '@/lib/intake/types';
import type { RecipientListData } from '@/lib/recipient-lists/types';

import { installFetch, MEMBERS, renderWorkspace } from '../helpers/work-items-harness';

const LEADS: RecipientListData = {
    id: 'rl-1',
    projectId: null,
    name: 'Leads',
    description: 'Team leads',
    archived: false,
    memberUserIds: ['u-ada', 'u-bob'],
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-20T10:00:00.000Z',
};
const OLD: RecipientListData = { ...LEADS, id: 'rl-2', name: 'Old crew', description: null, archived: true, memberUserIds: [] };
const DESK: RecipientListData = { ...LEADS, id: 'rl-3', projectId: 'proj-1', name: 'Support desk', description: null, memberUserIds: ['u-bob'] };

const routes = () => ({
    'GET /recipient-lists': { body: [LEADS, OLD] },
    'GET /users/assignable': { body: MEMBERS },
});

beforeEach(() => __resetPendingUndoToastsForTest());
afterEach(() => __resetPendingUndoToastsForTest());

describe('a scope\'s recipient lists', () => {
    it('lists each live list with its people, archived ones folded away, with no axe violations', async () => {
        installFetch(routes());
        const { container } = renderWorkspace(<RecipientListsView owner={{ kind: 'workspace' }} title="Recipient lists" description="d" canManage />);
        const leads = await screen.findByRole('region', { name: 'Leads' });
        expect(within(leads).getByText('Team leads')).toBeInTheDocument();
        const people = within(leads).getByRole('list', { name: 'People on Leads' });
        expect(await within(people).findByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Restore Old crew' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Edit Old crew' })).toBeNull();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('offers no write to a viewer the server does not let manage the scope', async () => {
        installFetch(routes());
        renderWorkspace(<RecipientListsView owner={{ kind: 'workspace' }} title="Recipient lists" description="d" canManage={false} readOnlyReason="Read only." />);
        await screen.findByRole('region', { name: 'Leads' });
        expect(screen.getByText('Read only.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Recipient list' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Archive Leads' })).toBeNull();
        expect(screen.queryByRole('combobox', { name: 'Add a person to Leads' })).toBeNull();
    });

    it('creates a list in its own scope with the name and description', async () => {
        const { calls } = installFetch({
            'GET /projects/proj-1/recipient-lists': { body: [DESK] },
            'GET /users/assignable': { body: MEMBERS },
            'POST /projects/proj-1/recipient-lists': { status: 201, body: { ...DESK, id: 'rl-9', name: 'Escalations' } },
        });
        renderWorkspace(<RecipientListsView owner={{ kind: 'project', projectId: 'proj-1' }} title="Support" description="d" canManage />);
        await screen.findByRole('region', { name: 'Support desk' });
        fireEvent.click(screen.getByRole('button', { name: 'Recipient list' }));
        const dialog = await screen.findByRole('dialog', { name: 'New recipient list' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Escalations' } });
        fireEvent.change(within(dialog).getByLabelText(/^Description/), { target: { value: 'Who handles the worst' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Escalations', description: 'Who handles the worst' }));
    });

    it('adds a person, and removes one through the undo toast', async () => {
        const { calls } = installFetch({ ...routes(), 'GET /recipient-lists': { body: [{ ...LEADS, memberUserIds: ['u-bob'] }] }, 'PATCH /recipient-lists/rl-1/members': { body: LEADS } });
        renderWorkspace(<RecipientListsView owner={{ kind: 'workspace' }} title="Recipient lists" description="d" canManage />);
        const leads = await screen.findByRole('region', { name: 'Leads' });
        fireEvent.click(within(leads).getByRole('combobox', { name: 'Add a person to Leads' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Ada Lovelace' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ add: ['u-ada'] }));

        calls.length = 0;
        fireEvent.click(within(leads).getByRole('button', { name: 'Remove Bob Builder from Leads' }));
        await waitFor(() => expect(within(leads).queryByText('Bob Builder')).toBeNull());
        expect(await screen.findByText('Removed Bob Builder from Leads.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(await within(leads).findByText('Bob Builder')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
    });

    it('sends the removal when the window closes', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({ ...routes(), 'PATCH /recipient-lists/rl-1/members': { body: LEADS } });
            renderWorkspace(<RecipientListsView owner={{ kind: 'workspace' }} title="Recipient lists" description="d" canManage />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            fireEvent.click(await screen.findByRole('button', { name: 'Remove Bob Builder from Leads' }));
            expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ remove: ['u-bob'] }]);
        } finally {
            jest.useRealTimers();
        }
    });

    it('archives at once and restores', async () => {
        const { calls } = installFetch({
            ...routes(),
            'POST /recipient-lists/rl-1/archive': { body: { ...LEADS, archived: true } },
            'POST /recipient-lists/rl-2/restore': { body: { ...OLD, archived: false } },
        });
        renderWorkspace(<RecipientListsView owner={{ kind: 'workspace' }} title="Recipient lists" description="d" canManage />);
        fireEvent.click(await screen.findByRole('button', { name: 'Archive Leads' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/recipient-lists/rl-1/archive')).toBe(true));
        fireEvent.click(screen.getByRole('button', { name: 'Restore Old crew' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/recipient-lists/rl-2/restore')).toBe(true));
    });
});

describe('the watchers panel', () => {
    it('adds a recipient list usable on the item, workspace lists marked', async () => {
        const { calls } = installFetch({
            'GET /work-items/wi-1/watchers': { body: [] },
            'GET /users/assignable': { body: MEMBERS },
            'GET /recipient-lists': { body: [LEADS, DESK] },
            'POST /work-items/wi-1/watchers/recipient-list': { body: { listId: 'rl-3', added: ['u-bob'], alreadyWatching: [], skipped: 1 } },
        });
        renderWorkspace(<WatchersPanel workItemId="wi-1" projectId="proj-1" />);
        fireEvent.click(await screen.findByRole('combobox', { name: 'Add recipient list' }));
        expect(await screen.findByRole('option', { name: 'Leads (workspace)' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: 'Support desk' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ listId: 'rl-3' }));
        expect(calls.find((c) => c.path === '/recipient-lists')?.search.get('projectId')).toBe('proj-1');
        // The jest mock of next-intl leaves ICU plurals as written; the list's name is interpolated.
        expect(await screen.findByText(/from Support desk\./)).toBeInTheDocument();
    });

    it('offers no list to a Viewer', async () => {
        installFetch({ 'GET /work-items/wi-1/watchers': { body: [] }, 'GET /users/assignable': { body: MEMBERS }, 'GET /recipient-lists': { body: [LEADS] } });
        renderWorkspace(<WatchersPanel workItemId="wi-1" projectId="proj-1" />, { role: 'VIEWER' });
        await screen.findByRole('button', { name: 'Watch' });
        expect(screen.queryByRole('combobox', { name: 'Add recipient list' })).toBeNull();
    });
});

describe('Settings → Intake', () => {
    const ALL: IntakeAffordances = { view: true, triage: true, createItems: true, manage: true };
    const project: ProjectIntakeSettings = {
        projectId: 'proj-1',
        projectName: 'Support',
        keyPrefix: 'SUP',
        enabled: true,
        notifyUserIds: [],
        recipientListId: null,
        pendingCount: 0,
        emailEnabled: false,
        emailAddress: null,
    };

    it("names a recipient list of the workspace or the project, beside the notify list", async () => {
        const ops: RecipientListData = { ...DESK, id: 'rl-4', projectId: 'proj-2', name: 'Ops desk' };
        const { calls } = installFetch({
            'GET /intake/projects': { body: [project] },
            'GET /intake/forms': { body: [] },
            'GET /intake/blocked-senders': { body: [] },
            'GET /users/assignable': { body: MEMBERS },
            'GET /recipient-lists': { body: [LEADS, DESK, ops] },
            'PUT /projects/proj-1/intake': { body: { ...project, recipientListId: 'rl-3' } },
        });
        renderWorkspace(<IntakeSettings affordances={ALL} />);
        fireEvent.click(await screen.findByRole('combobox', { name: 'Recipient list for Support' }));
        expect(await screen.findByRole('option', { name: 'Leads (workspace)' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Ops desk' })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'Support desk' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ enabled: true, recipientListId: 'rl-3' }));
        expect(calls.find((c) => c.path === '/recipient-lists')?.search.get('usable')).toBe('1');
    });
});
