/** @jest-environment jsdom */

/**
 * The template UI (sub-phase 2.5c): the create dialog's template picker
 * (it fills the form, and a create from a template sends the template and
 * only what the person changed), the project's item-templates manager (create
 * with sub-items, delete through the undo toast), the project create dialog's
 * template picker, and Settings → Project templates.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { ProjectCreateDialog } from '@/components/settings/ProjectCreateDialog';
import { ProjectTemplatesSettings } from '@/components/settings/ProjectTemplatesSettings';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { NewWorkItemModal } from '@/components/work-items/NewWorkItemModal';
import { ItemTemplatesManager } from '@/components/work-items/templates/ItemTemplatesManager';
import type { ProjectTemplateSummary, WorkItemTemplateData } from '@/lib/work-items/types';

import { CONFIG, detail, installFetch, MEMBERS, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

const TYPE = CONFIG.types[0]!.id;
const RELEASE: WorkItemTemplateData = {
    id: 'tpl-1',
    projectId: PROJECT,
    name: 'Release',
    title: 'Release checklist',
    description: 'Ship it',
    typeId: TYPE,
    priority: 'HIGH',
    labelIds: [],
    assigneeId: null,
    dueInDays: null,
    customFields: {},
    subItems: [{ title: 'Tag' }],
    archived: false,
};
const LIST = `GET /projects/${PROJECT}/work-item-templates`;

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe("the create dialog's template picker", () => {
    it('fills the form from a template and sends the template with only what the person changed', async () => {
        const { calls } = installFetch({
            [LIST]: { body: [RELEASE] },
            'GET /users/assignable': { body: MEMBERS },
            'POST /work-items': { status: 201, body: detail(row(9, { title: 'Release checklist' })) },
        });
        renderWorkspace(<NewWorkItemModal open onOpenChange={() => {}} initial={{ projectId: PROJECT }} />);
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        fireEvent.click(await within(dialog).findByRole('combobox', { name: 'No template' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Release' }));
        expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Release checklist');
        expect(within(dialog).getByLabelText(/^Description/)).toHaveValue('Ship it');
        expect(within(dialog).getByText(/sub-items and field values are added/)).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/^Description/), { target: { value: 'Ship it today' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create work item' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        const body = calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>;
        expect(body).toMatchObject({ projectId: PROJECT, templateId: 'tpl-1', description: 'Ship it today' });
        // Untouched template fields are left to the server, which applies (and checks) them.
        expect(body).not.toHaveProperty('title');
        expect(body).not.toHaveProperty('priority');
        expect(body).not.toHaveProperty('typeId');
    });

    it('offers no picker when the project has no templates', async () => {
        installFetch({ [LIST]: { body: [] }, 'GET /users/assignable': { body: MEMBERS } });
        renderWorkspace(<NewWorkItemModal open onOpenChange={() => {}} initial={{ projectId: PROJECT }} />);
        const dialog = await screen.findByRole('dialog', { name: 'New work item' });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 20));
        });
        expect(within(dialog).queryByRole('combobox', { name: 'No template' })).toBeNull();
    });
});

describe("the project's item-templates manager", () => {
    const manager = () => <ItemTemplatesManager open onOpenChange={() => {}} projectId={PROJECT} teamId={TEAM} projectName="Islands" />;
    const routes = (extra = {}) =>
        installFetch({
            [`${LIST}`]: { body: [RELEASE] },
            'GET /users/assignable': { body: MEMBERS },
            ...extra,
        });

    it('lists the templates and creates one with its sub-items, with no axe violations', async () => {
        const { calls } = routes({ [`POST /projects/${PROJECT}/work-item-templates`]: { status: 201, body: { ...RELEASE, id: 'tpl-2', name: 'Bug' } } });
        const { baseElement } = renderWorkspace(manager());
        const dialog = await screen.findByRole('dialog', { name: 'Item templates for Islands' });
        expect(await within(dialog).findByText('Release')).toBeInTheDocument();
        expect(within(dialog).getByText('Makes: Release checklist · sub-items: 1')).toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/^Template name/), { target: { value: 'Bug' } });
        fireEvent.change(within(dialog).getByLabelText(/^Work item title/), { target: { value: 'Bug report' } });
        fireEvent.change(within(dialog).getByLabelText(/^Due in days/), { target: { value: '7' } });
        fireEvent.change(within(dialog).getByLabelText(/^Sub-items/), { target: { value: 'Reproduce\n\nFix\n' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
            name: 'Bug',
            title: 'Bug report',
            dueInDays: 7,
            subItems: [{ title: 'Reproduce' }, { title: 'Fix' }],
        });
        expect(await axe(baseElement)).toHaveNoViolations();
    });

    it('refuses a due offset that is not a whole number, without sending', async () => {
        const { calls } = routes();
        renderWorkspace(manager());
        const dialog = await screen.findByRole('dialog', { name: 'Item templates for Islands' });
        fireEvent.change(within(dialog).getByLabelText(/^Template name/), { target: { value: 'X' } });
        fireEvent.change(within(dialog).getByLabelText(/^Work item title/), { target: { value: 'Y' } });
        fireEvent.change(within(dialog).getByLabelText(/^Due in days/), { target: { value: '-3' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create template' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Due in days is a whole number');
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('deletes through the undo toast: the row leaves at once, nothing is sent, and Undo sends nothing', async () => {
        const { calls } = routes({ [`DELETE /projects/${PROJECT}/work-item-templates/tpl-1`]: { body: { deleted: true } } });
        renderWorkspace(manager());
        const dialog = await screen.findByRole('dialog', { name: 'Item templates for Islands' });
        fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete Release' }));
        await waitFor(() => expect(within(dialog).queryByText('Release')).toBeNull());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await within(dialog).findByText('Release')).toBeInTheDocument();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

describe('project templates', () => {
    const STANDARD: ProjectTemplateSummary = { id: 'pt-1', name: 'Standard', archived: false, createdAt: '2026-11-20T00:00:00.000Z' };

    it('the project create dialog offers the templates and sends the chosen one', async () => {
        const { calls } = installFetch({
            'GET /teams': { body: [{ id: TEAM, name: 'Core' }] },
            'GET /project-templates': { body: [STANDARD] },
            'POST /projects': { status: 201, body: { id: 'p-new', teamId: TEAM, name: 'Next', keyPrefix: 'NXT', archivedAt: null, fromTemplate: { counts: {}, skipped: [] } } },
        });
        renderWorkspace(<ProjectCreateDialog open onOpenChange={() => {}} onCreated={() => {}} />);
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Next' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'nxt' } });
        fireEvent.click(await within(dialog).findByRole('combobox', { name: 'No template' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Standard' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ teamId: TEAM, name: 'Next', keyPrefix: 'NXT', templateId: 'pt-1' });
    });

    it('Settings → Project templates lists what each holds and deletes through the undo toast; a non-admin gets no actions', async () => {
        const withCounts = { ...STANDARD, counts: { customFields: 2, milestones: 1, itemTemplates: 3, items: 4 } };
        const { calls } = installFetch({ 'GET /project-templates': { body: [withCounts] }, 'DELETE /project-templates/pt-1': { body: { deleted: true } } });
        const { unmount } = renderWorkspace(<ProjectTemplatesSettings templates={{ manageItemTemplates: true, useProjectTemplates: true, manageProjectTemplates: true }} />);
        expect(await screen.findByText('Fields: 2 · milestones: 1 · item templates: 3 · work items: 4')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Delete Standard' }));
        await waitFor(() => expect(screen.queryByText('Standard')).toBeNull());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        unmount();
        installFetch({ 'GET /project-templates': { body: [withCounts] } });
        renderWorkspace(<ProjectTemplatesSettings templates={{ manageItemTemplates: true, useProjectTemplates: true, manageProjectTemplates: false }} />);
        expect(await screen.findByText('Standard')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^(Rename|Archive|Delete) / })).toBeNull();
    });
});
