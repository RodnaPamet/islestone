/** @jest-environment jsdom */

/**
 * Public intake forms in the browser (sub-phase 2.6b): the public page's form
 * (the requester's name and address as the form's rules ask, the update
 * opt-in, the trap a person never reaches, errors at their fields, no axe
 * violations), the send (the proof-of-work's counter and the trap beside the
 * request, no credentials), the success screen with the reference, the
 * confirmation page's button, and the builder offering public access only
 * while public forms are open.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/settings/intake',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));
jest.mock('@/lib/intake/pow', () => ({ ...jest.requireActual('@/lib/intake/pow'), solveProofOfWork: jest.fn(async () => 4242) }));

import { ConfirmAddress } from '@/components/intake/public/ConfirmAddress';
import { PublicIntakeForm } from '@/components/intake/public/PublicIntakeForm';
import { IntakeFormBuilder } from '@/components/settings/IntakeFormBuilder';
import type { IntakeFormDefinition } from '@/lib/intake/form-definition';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';
const DEFINITION: IntakeFormDefinition = {
    intro: 'Tell us what broke.',
    confirmation: 'We read every request.',
    fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'Where', required: false }],
    requester: { name: 'OPTIONAL', email: 'REQUIRED' },
};

describe('the public form', () => {
    it("asks for the requester as the rules say, keeps the trap out of reach, and has no axe violations", async () => {
        installFetch({});
        const { container } = render(<PublicIntakeForm publicId={ID} name="Report a problem" definition={DEFINITION} token="tok" />);
        expect(screen.getByRole('heading', { level: 1, name: 'Report a problem' })).toBeInTheDocument();
        expect(screen.getByLabelText(/^Your name/)).toBeInTheDocument();
        expect(screen.getByLabelText(/^Your email address/)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Email me about this request' })).toBeInTheDocument();
        const trap = screen.getByLabelText('Leave this field empty');
        expect(trap).toHaveAttribute('tabindex', '-1');
        expect(trap).toHaveAttribute('autocomplete', 'off');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('refuses a missing required address at its field, and sends nothing', async () => {
        const { calls } = installFetch({});
        render(<PublicIntakeForm publicId={ID} name="Report a problem" definition={DEFINITION} token="tok" />);
        fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Broken' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        });
        expect(await screen.findByText('Give your email address.')).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('sends the token, the proof and the trap beside the request without credentials, then shows the reference', async () => {
        const { calls } = installFetch({
            [`POST /api/intake/forms/${ID}`]: { status: 201, body: { reference: 'ABCD1234', confirmation: 'We read every request.', updates: 'CONFIRM_PENDING' } },
        });
        const fetchSpy = global.fetch as jest.Mock;
        render(<PublicIntakeForm publicId={ID} name="Report a problem" definition={DEFINITION} token="tok" />);
        fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Broken' } });
        fireEvent.change(screen.getByLabelText(/^Your email address/), { target: { value: 'ada@example.com' } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Email me about this request' }));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        });
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]!.body).toMatchObject({
            token: 'tok',
            proof: 4242,
            website: '',
            request: { title: 'Broken', requesterEmail: 'ada@example.com', wantsUpdates: true },
        });
        expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' });
        expect(await screen.findByRole('heading', { name: 'Your request was sent.' })).toBeInTheDocument();
        expect(screen.getByText('Reference: ABCD1234')).toBeInTheDocument();
        expect(screen.getByText(/We sent you an email/)).toBeInTheDocument();
    });

    it('a busy form says so in words', async () => {
        installFetch({ [`POST /api/intake/forms/${ID}`]: { status: 429, body: { error: { code: 'FORM_RESTING', message: 'x' } } } });
        render(<PublicIntakeForm publicId={ID} name="Report a problem" definition={{ ...DEFINITION, requester: { name: 'OFF', email: 'OFF' } }} token="tok" />);
        fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: 'Broken' } });
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('This form is not taking requests right now.');
    });
});

describe('the confirmation page', () => {
    it('confirms only when the button is pressed', async () => {
        const { calls } = installFetch({ 'POST /api/intake/confirm': { body: { confirmed: true } } });
        const { container } = render(<ConfirmAddress token="t0k3n" />);
        expect(calls).toHaveLength(0);
        expect(await axe(container)).toHaveNoViolations();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm my address' }));
        });
        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0]!.body).toEqual({ token: 't0k3n' });
        expect(await screen.findByRole('status')).toHaveTextContent('Your address is confirmed');
    });

    it('says a spent link is not valid', async () => {
        installFetch({ 'POST /api/intake/confirm': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } } });
        render(<ConfirmAddress token="t0k3n" />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Confirm my address' }));
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('This link is not valid or has expired.');
    });
});

describe('the builder', () => {
    it('offers public access only while public forms are open, and saves the requester rules', async () => {
        const { calls } = installFetch({
            'GET /projects/proj-1/custom-fields': { body: [] },
            'POST /intake/forms': { status: 201, body: {} },
        });
        const { unmount } = renderWorkspace(<IntakeFormBuilder open onOpenChange={() => undefined} projectId="proj-1" form={null} />);
        let dialog = await screen.findByRole('dialog');
        expect(within(dialog).queryByRole('combobox', { name: 'Who can send requests' })).not.toBeInTheDocument();
        unmount();

        renderWorkspace(<IntakeFormBuilder open onOpenChange={() => undefined} projectId="proj-1" form={null} publicForms />);
        dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Outside' } });
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Who can send requests' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Anyone with the link' }));
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Ask for their email address' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Required' }));
        await act(async () => {
            fireEvent.click(within(dialog).getByRole('button', { name: 'Create form' }));
        });
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/intake/forms')).toBe(true));
        const body = calls.find((c) => c.path === '/intake/forms')!.body as { access: string; definition: IntakeFormDefinition };
        expect(body.access).toBe('PUBLIC');
        expect(body.definition.requester).toEqual({ name: 'OFF', email: 'REQUIRED' });
    });
});
