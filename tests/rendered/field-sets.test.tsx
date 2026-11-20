/**
 * The field set in the forms (sub-phase 2.4b-b; ADR 0002 §1; owner decisions
 * 108 to 111): the create dialog reads the server's entries (in the view
 * configuration), leaves out a hidden field, marks a required one and stops
 * a create that leaves one empty, naming it, before anything is sent; and
 * Settings → a type's fields offers the change only to who may make it.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { WorkItemTypeFieldsSettings } from '@/components/settings/WorkItemTypeFieldsSettings';
import { NewWorkItemModal } from '@/components/work-items/NewWorkItemModal';
import type { WorkConfigAffordances } from '@/lib/work-items/types';

import { CONFIG, installFetch, MEMBERS, PROJECT, renderWorkspace } from '../helpers/work-items-harness';

const TYPE = CONFIG.types[0]!.id;
const ENTRIES = {
    ...CONFIG,
    fieldSetEntries: [
        { typeId: TYPE, projectId: null, builtInField: 'dueDate', customFieldId: null, requirement: 'REQUIRED' as const },
        { typeId: TYPE, projectId: null, builtInField: 'priority', customFieldId: null, requirement: 'HIDDEN' as const },
    ],
};

describe('the create dialog', () => {
    it('leaves out a hidden field, marks a required one, and stops a create that leaves it empty', async () => {
        const { calls } = installFetch({ [`GET /projects/${PROJECT}/work-item-templates`]: { body: [] }, 'GET /users/assignable': { body: MEMBERS } });
        renderWorkspace(<NewWorkItemModal open onOpenChange={() => {}} initial={{ projectId: PROJECT }} />, { config: ENTRIES });
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        expect(within(dialog).queryByText('Priority')).toBeNull();
        expect(within(dialog).getByText('Due date')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Needs a date' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create work item' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fill the required fields first: Due date.');
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(false));
    });
});

describe("Settings → a type's fields", () => {
    const fields = {
        typeId: TYPE,
        fields: [
            { field: 'dueDate', requirement: 'REQUIRED', allowed: ['REQUIRED', 'OPTIONAL', 'HIDDEN'] },
            { field: 'answer', requirement: 'HIDDEN', allowed: ['OPTIONAL', 'HIDDEN'] },
        ],
    };
    const affordances = (manage: boolean): WorkConfigAffordances => ({
        manageWorkConfig: manage,
        createProject: manage,
        editProject: manage,
        archiveProject: manage,
        manageCustomFields: manage,
    });
    const routes = () =>
        installFetch({
            [`GET /work-item-types/${TYPE}/fields`]: { body: fields },
            'GET /work-item-types': { body: [{ id: TYPE, name: 'Feature', icon: null, color: null, archivedAt: null }] },
        });

    it('offers a requirement per field to an admin, and the answer only Shown or Hidden', async () => {
        routes();
        renderWorkspace(<WorkItemTypeFieldsSettings typeId={TYPE} affordances={affordances(true)} />);
        fireEvent.click(await screen.findByRole('combobox', { name: 'Answer for Feature' }));
        expect(await screen.findByRole('option', { name: 'Shown' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Required' })).toBeNull();
    });

    it('shows the requirements as text to anyone else', async () => {
        routes();
        renderWorkspace(<WorkItemTypeFieldsSettings typeId={TYPE} affordances={affordances(false)} />);
        expect(await screen.findByText('Required')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).toBeNull();
    });
});
