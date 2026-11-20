/** @jest-environment jsdom */

/**
 * Intake in the browser (sub-phase 2.6a): the form renderer (react-hook-form
 * with the server's compiled schema: errors at their fields, the send's
 * body), the Intake page (the selected request, the actions offered from
 * the server's affordances, an accept sending the version in `If-Match`),
 * the builder (adding, reordering and saving fields), and the sidebar's
 * Intake entry for readers only. Sub-phase 2.6c: an emailed request's sender
 * check and follow-ups, "Block this sender" on a spam decline (offered only
 * under `intake.manage`), and Settings' email address and blocked senders.
 * Queries by role and label; jest-axe.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const mockReplace = jest.fn();
let mockSearch = new URLSearchParams();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: mockReplace, prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/intake',
    useSearchParams: () => mockSearch,
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { IntakeFormRenderer } from '@/components/intake/IntakeFormRenderer';
import { IntakeView } from '@/components/intake/IntakeView';
import { IntakeFormBuilder } from '@/components/settings/IntakeFormBuilder';
import { IntakeSettings } from '@/components/settings/IntakeSettings';
import { useNavSections } from '@/components/layout/nav-config';
import type { IntakeFormDefinition } from '@/lib/intake/form-definition';
import type { IntakeAffordances, IntakeBlockedSenderView, IntakeRequestDetail, ProjectIntakeSettings } from '@/lib/intake/types';

import { installFetch, MEMBERS, renderWorkspace } from '../helpers/work-items-harness';

const DEFINITION: IntakeFormDefinition = {
    intro: 'Tell us what broke.',
    confirmation: '',
    fields: [
        { id: 'f1', kind: 'SELECT', label: 'Area', required: true, options: ['Billing', 'Search'] },
        { id: 'f2', kind: 'CHECKBOX', label: 'Urgent', required: false },
    ],
    requester: { name: 'OFF', email: 'OFF' },
};

const ALL: IntakeAffordances = { view: true, triage: true, createItems: true, manage: true };
const READ_ONLY: IntakeAffordances = { view: true, triage: false, createItems: false, manage: false };

function detail(over: Partial<IntakeRequestDetail> = {}): IntakeRequestDetail {
    return {
        id: 'r1',
        projectId: 'proj-1',
        channel: 'INTERNAL_FORM',
        formId: 'f-bugs',
        formName: 'Bugs',
        status: 'PENDING',
        title: 'Printer on fire',
        requesterUserId: 'u-bob',
        snoozedUntil: null,
        decidedAt: null,
        declineReason: null,
        workItemId: null,
        mergedIntoWorkItemId: null,
        mergedIntoRequestId: null,
        version: 4,
        createdAt: '2026-11-20T10:00:00.000Z',
        body: 'It smokes.',
        answers: [{ fieldId: 'f1', label: 'Area', kind: 'SELECT', value: 'Billing' }],
        snoozedByUserId: null,
        decidedByUserId: null,
        declineExplanation: null,
        internalRemark: null,
        workItemKey: null,
        mergedIntoWorkItemKey: null,
        mergedRequestCount: 0,
        requesterName: null,
        requesterEmail: null,
        requesterUpdates: 'NONE',
        senderCheck: null,
        attachmentsDropped: 0,
        followUps: [],
        senderBlockable: false,
        ...over,
    };
}

beforeEach(() => {
    mockReplace.mockReset();
    mockSearch = new URLSearchParams();
});

describe('the form renderer', () => {
    it('refuses at the field for the server\'s reasons, sends the answers, and has no axe violations', async () => {
        const onSubmit = jest.fn(async (_input: unknown) => null as string | null);
        const { container } = renderWorkspace(<IntakeFormRenderer definition={DEFINITION} formKey="f-bugs" onSubmit={onSubmit} />);
        expect(screen.getByText('Tell us what broke.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        expect(await screen.findByText('Give a title.')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Printer on fire' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());

        fireEvent.click(screen.getByRole('combobox', { name: 'Area' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Billing' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent' }));
        fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]![0]).toMatchObject({ title: 'Printer on fire', answers: { f1: 'Billing', f2: true } });
        expect(await axe(container)).toHaveNoViolations();
    });

    it('a preview renders no form element and no send button', () => {
        const { container } = renderWorkspace(<IntakeFormRenderer definition={DEFINITION} formKey="preview" preview />);
        expect(container.querySelector('form')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Send request' })).not.toBeInTheDocument();
    });
});

describe('the Intake page', () => {
    const routes = (d: IntakeRequestDetail) => ({
        'GET /intake/requests': { body: { items: [d], pageInfo: { hasNextPage: false } } },
        'GET /intake/requests/r1': { body: d },
        'GET /users/assignable': { body: MEMBERS },
    });

    it('shows the selected request with its answers and the triage actions; an accept sends the version', async () => {
        const { calls } = installFetch({
            ...routes(detail()),
            'POST /intake/requests/r1/accept': { body: detail({ status: 'ACCEPTED', workItemId: 'wi-9', workItemKey: 'ISL-9', version: 5 }) },
        });
        const { container } = renderWorkspace(<IntakeView title="Intake" affordances={ALL} />);
        const panel = await screen.findByTestId('intake-request-detail');
        expect(within(panel).getByRole('heading', { level: 2, name: 'Printer on fire' })).toBeInTheDocument();
        expect(within(panel).getByText('Billing')).toBeInTheDocument();
        expect(await within(panel).findByText('Bob Builder')).toBeInTheDocument();
        const actions = within(panel).getByRole('group', { name: 'Triage' });
        expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Accept', 'Decline', 'Merge', 'Snooze', 'Move']);
        expect(await axe(container)).toHaveNoViolations();

        fireEvent.click(within(actions).getByRole('button', { name: 'Accept' }));
        const dialog = await screen.findByRole('dialog');
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
        });
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/intake/requests/r1/accept')).toBe(true));
        const accept = calls.find((c) => c.path === '/intake/requests/r1/accept')!;
        expect(accept.ifMatch).toBe('"4"');
        expect(accept.body).toMatchObject({ typeId: 'ty-feature' });
    });

    it('offers no action to a reader who may not triage, and Reopen on a declined request', async () => {
        installFetch(routes(detail()));
        const { unmount } = renderWorkspace(<IntakeView title="Intake" affordances={READ_ONLY} />);
        await screen.findByTestId('intake-request-detail');
        expect(screen.queryByRole('group', { name: 'Triage' })).not.toBeInTheDocument();
        unmount();
        installFetch(routes(detail({ status: 'DECLINED', declineReason: 'OUT_OF_SCOPE', decidedAt: '2026-11-20T11:00:00.000Z' })));
        renderWorkspace(<IntakeView title="Intake" affordances={ALL} />);
        const panel = await screen.findByTestId('intake-request-detail');
        expect(within(panel).getByText('Declined: Out of scope.')).toBeInTheDocument();
        expect(within(within(panel).getByRole('group', { name: 'Triage' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reopen']);
    });
});

describe('an emailed request (2.6c)', () => {
    const emailed = (over: Partial<IntakeRequestDetail> = {}) =>
        detail({
            channel: 'EMAIL',
            formId: null,
            formName: null,
            requesterUserId: null,
            answers: [],
            requesterEmail: 'ada@sender.example',
            senderCheck: 'NONE',
            attachmentsDropped: 2,
            senderBlockable: true,
            followUps: [{ id: 'fu1', body: 'Still smoking.', attachmentsDropped: 0, createdAt: '2026-11-20T12:00:00.000Z' }],
            ...over,
        });
    const routes = (d: IntakeRequestDetail) => ({
        'GET /intake/requests': { body: { items: [d], pageInfo: { hasNextPage: false } } },
        'GET /intake/requests/r1': { body: d },
        'GET /users/assignable': { body: MEMBERS },
    });

    it('shows the sender check, the dropped attachments and the follow-ups', async () => {
        installFetch(routes(emailed()));
        const { container } = renderWorkspace(<IntakeView title="Intake" affordances={ALL} />);
        const panel = await screen.findByTestId('intake-request-detail');
        expect(within(panel).getByText('Not checked: the sender could not be verified')).toBeInTheDocument();
        // The Jest next-intl mock does not expand plurals: match the catalogue's text.
        expect(within(panel).getByText(/attachments were not kept/)).toBeInTheDocument();
        expect(within(panel).getByRole('heading', { level: 3, name: /follow-up/ })).toBeInTheDocument();
        expect(within(panel).getByText('Still smoking.')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('a spam decline offers "Block this sender" to a manager and sends it; never for another reason, nor to a triager who may not manage', async () => {
        const { calls } = installFetch({ ...routes(emailed()), 'POST /intake/requests/r1/decline': { body: emailed({ status: 'DECLINED', declineReason: 'SPAM', version: 5 }) } });
        const { unmount } = renderWorkspace(<IntakeView title="Intake" affordances={ALL} />);
        const panel = await screen.findByTestId('intake-request-detail');
        fireEvent.click(within(within(panel).getByRole('group', { name: 'Triage' })).getByRole('button', { name: 'Decline' }));
        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByLabelText('Block this sender')).toBeNull();
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Not planned' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Spam' }));
        fireEvent.click(within(dialog).getByLabelText('Block this sender'));
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
        });
        await waitFor(() => expect(calls.some((c) => c.path === '/intake/requests/r1/decline')).toBe(true));
        expect(calls.find((c) => c.path === '/intake/requests/r1/decline')!.body).toMatchObject({ reason: 'SPAM', blockSender: true });
        unmount();

        installFetch(routes(emailed()));
        renderWorkspace(<IntakeView title="Intake" affordances={{ ...ALL, manage: false }} />);
        const panel2 = await screen.findByTestId('intake-request-detail');
        fireEvent.click(within(within(panel2).getByRole('group', { name: 'Triage' })).getByRole('button', { name: 'Decline' }));
        const dialog2 = await screen.findByRole('dialog');
        fireEvent.click(within(dialog2).getByRole('combobox', { name: 'Not planned' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Spam' }));
        expect(within(dialog2).queryByLabelText('Block this sender')).toBeNull();
    });
});

describe('Settings → Intake: the email address and blocked senders (2.6c)', () => {
    const project: ProjectIntakeSettings = {
        projectId: 'proj-1',
        projectName: 'Support',
        keyPrefix: 'SUP',
        enabled: true,
        notifyUserIds: [],
        pendingCount: 0,
        emailEnabled: true,
        emailAddress: 'abcdefghjkmn@in.islestone.cloud',
    };
    const blocked: IntakeBlockedSenderView[] = [{ id: 'bs-1', projectId: null, createdByUserId: 'u-ada', createdAt: '2026-11-20T10:00:00.000Z' }];
    const routes = () => ({
        'GET /intake/projects': { body: [project] },
        'GET /intake/forms': { body: [] },
        'GET /intake/blocked-senders': { body: blocked },
        'GET /users/assignable': { body: MEMBERS },
    });

    it('shows the address, generates a new one only after the inline confirmation, and blocks an address on the chosen scope', async () => {
        const { calls } = installFetch({
            ...routes(),
            'POST /projects/proj-1/intake/email-address': { body: { ...project, emailAddress: 'pqrstuvwxyz2@in.islestone.cloud' } },
            'POST /intake/blocked-senders': { status: 201, body: blocked[0] },
            'POST /intake/blocked-senders/find': { body: [] },
        });
        const { container } = renderWorkspace(<IntakeSettings affordances={ALL} inboundEmail />);
        expect(await screen.findByText('abcdefghjkmn@in.islestone.cloud')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy the email address of Support' })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();

        fireEvent.click(screen.getByRole('button', { name: 'Generate a new email address for Support' }));
        expect(calls.some((c) => c.path === '/projects/proj-1/intake/email-address')).toBe(false);
        const confirm = screen.getByRole('group', { name: 'Confirm a new address' });
        await act(async () => {
            fireEvent.click(within(confirm).getByRole('button', { name: 'Replace the address' }));
        });
        await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.path === '/projects/proj-1/intake/email-address')).toHaveLength(1));

        const section = screen.getByTestId('intake-blocked-senders');
        expect(within(within(section).getByRole('list', { name: 'Every block' })).getByText('The whole workspace')).toBeInTheDocument();
        fireEvent.change(within(section).getByLabelText('Email address'), { target: { value: 'spam@example.test' } });
        await act(async () => {
            fireEvent.click(within(section).getByRole('button', { name: 'Find' }));
        });
        await waitFor(() => expect(calls.find((c) => c.path === '/intake/blocked-senders/find')?.body).toEqual({ email: 'spam@example.test' }));
        expect(await within(section).findByText('spam@example.test is not blocked.')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(within(section).getByRole('button', { name: 'Block' }));
        });
        await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.path === '/intake/blocked-senders')?.body).toEqual({ email: 'spam@example.test', projectId: null }));
    });

    it('unblocks through the undo toast: nothing is sent until the window closes', async () => {
        const { calls } = installFetch(routes());
        renderWorkspace(<IntakeSettings affordances={ALL} inboundEmail />);
        fireEvent.click(await screen.findByRole('button', { name: 'Unblock on The whole workspace' }));
        expect(await screen.findByText('Unblocked on The whole workspace.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('with inbound email closed, an address that is off cannot be turned on; a reader sees no write', async () => {
        installFetch({ ...routes(), 'GET /intake/projects': { body: [{ ...project, emailEnabled: false, emailAddress: null }] } });
        const { unmount } = renderWorkspace(<IntakeSettings affordances={ALL} />);
        expect(await screen.findByRole('switch', { name: 'Take requests by email for Support' })).toBeDisabled();
        expect(screen.getByText('Inbound email is switched off on this deployment, so an address cannot be turned on.')).toBeInTheDocument();
        unmount();
        installFetch(routes());
        renderWorkspace(<IntakeSettings affordances={READ_ONLY} inboundEmail />);
        expect(await screen.findByText('You can see these settings but not change them.')).toBeInTheDocument();
        expect(screen.queryByTestId('intake-blocked-senders')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Generate a new email address for Support' })).toBeNull();
    });
});

describe('the form builder', () => {
    it('adds and reorders fields and saves the definition', async () => {
        const { calls } = installFetch({
            'GET /projects/proj-1/custom-fields': { body: [] },
            'POST /intake/forms': { status: 201, body: {} },
        });
        renderWorkspace(<IntakeFormBuilder open onOpenChange={() => undefined} projectId="proj-1" form={null} />);
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Bugs' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add a field' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add a field' }));
        const labels = within(dialog).getAllByLabelText(/^Label/);
        fireEvent.change(labels[0]!, { target: { value: 'First' } });
        fireEvent.change(labels[1]!, { target: { value: 'Second' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Move Second up' }));
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Create form' }));
        });
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/intake/forms')).toBe(true));
        const body = calls.find((c) => c.path === '/intake/forms')!.body as { name: string; definition: IntakeFormDefinition };
        expect(body.name).toBe('Bugs');
        expect(body.definition.fields.map((f) => [f.id, f.label])).toEqual([
            ['f2', 'Second'],
            ['f1', 'First'],
        ]);
    });
});

describe('the sidebar', () => {
    function Sections() {
        const sections = useNavSections();
        return (
            <ul>
                {sections.flatMap((s) => s.items).map((i) => (
                    <li key={i.key}>{i.label}</li>
                ))}
            </ul>
        );
    }

    it('lists Intake for a reader of intake and not for a Viewer; Forms for both', async () => {
        installFetch({ 'GET /intake/requests/count': { body: { total: 0, byProject: {} } } });
        const { unmount } = renderWorkspace(<Sections />, { role: 'MEMBER' });
        expect(screen.getByText('Intake')).toBeInTheDocument();
        expect(screen.getByText('Forms')).toBeInTheDocument();
        unmount();
        renderWorkspace(<Sections />, { role: 'VIEWER' });
        expect(screen.queryByText('Intake')).not.toBeInTheDocument();
        expect(screen.getByText('Forms')).toBeInTheDocument();
    });
});
