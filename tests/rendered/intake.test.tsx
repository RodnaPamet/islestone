/** @jest-environment jsdom */

/**
 * Intake in the browser (sub-phase 2.6a): the form renderer (react-hook-form
 * with the server's compiled schema: errors at their fields, the send's
 * body), the Intake page (the selected request, the actions offered from
 * the server's affordances, an accept sending the version in `If-Match`),
 * the builder (adding, reordering and saving fields), and the sidebar's
 * Intake entry for readers only. Queries by role and label; jest-axe.
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
import { useNavSections } from '@/components/layout/nav-config';
import type { IntakeFormDefinition } from '@/lib/intake/form-definition';
import type { IntakeAffordances, IntakeRequestDetail } from '@/lib/intake/types';

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
