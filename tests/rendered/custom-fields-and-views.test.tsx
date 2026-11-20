/** @jest-environment jsdom */

/**
 * Custom fields and saved views in the views (sub-phase 2.4):
 *
 *   - the list sorts by a field and sends `order=cf:<id>`;
 *   - a saved view applies its filters (as `cf.<id>` conditions), sort,
 *     layout and visible columns, and a field column shows option names;
 *   - saving a view sends the page's state; deleting one goes through the
 *     undo toast;
 *   - the board groups by a select field;
 *   - the detail edits a field through the versioned write (`If-Match`);
 *   - the field manager creates a select field with its options and
 *     archives a field;
 *   - the Views page links each view to its page with `?view=<id>`.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const mockSearch = { current: new URLSearchParams() };
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => mockSearch.current,
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { stateColumns } from '@/components/work-items/board/board-model';
import { WorkItemBoard } from '@/components/work-items/board/WorkItemBoard';
import { useProjectCustomFields } from '@/components/work-items/data/use-custom-fields';
import { CustomFieldsManager } from '@/components/work-items/fields/CustomFieldsManager';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import { WorkItemsView } from '@/components/work-items/WorkItemsView';
import { ViewsList } from '@/components/views/ViewsList';
import { savedViewAffordances } from '@/app-layer/policies/saved-view.policies';
import { getPermissionsForRole } from '@/lib/permissions';
import type { SavedViewData, ViewCustomField, WorkItemViewConfig } from '@/lib/work-items/types';

import { makeRequestContext } from '../helpers/make-context';
import { CONFIG, detail, installFetch, MEMBERS, page, PROJECT, renderWorkspace, row, TEAM, type Recorded } from '../helpers/work-items-harness';

const STAGE: ViewCustomField = {
    id: 'f-stage',
    projectId: PROJECT,
    name: 'Stage',
    type: 'SELECT',
    archived: false,
    options: [
        { id: 'opt-a', name: 'Alpha', color: null, archived: false },
        { id: 'opt-b', name: 'Beta', color: null, archived: false },
    ],
};
const SIZE: ViewCustomField = { id: 'f-size', projectId: PROJECT, name: 'Size', type: 'NUMBER', archived: false, options: [] };
const WITH_FIELDS: WorkItemViewConfig = { ...CONFIG, customFields: [STAGE, SIZE] };
const ROWS = [row(1, { customFields: { 'f-stage': 'opt-a', 'f-size': 3 } }), row(2, { customFields: {} })];

const VIEW: SavedViewData = {
    id: 'v-1',
    name: 'Alpha items',
    visibility: 'PERSONAL',
    projectId: PROJECT,
    project: { keyPrefix: 'ISL', name: 'Islands' },
    layout: 'LIST',
    config: { filters: { 'cf.f-stage': ['opt-a'] }, sort: 'cf:f-size', laneBy: 'none', columns: ['key', 'title', 'cf:f-stage'] },
    createdByUserId: 'u-ada',
    mine: true,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
};

const managed = (f: ViewCustomField) => ({ ...f, sortKey: 'V', options: f.options.map((o) => ({ ...o, sortKey: 'V' })) });

function listRoutes(extra: Parameters<typeof installFetch>[0] = {}) {
    return installFetch({
        'GET /work-items': { body: page(ROWS) },
        'GET /users/assignable': { body: MEMBERS },
        'GET /views': { body: { views: [VIEW], truncated: false } },
        ...extra,
    });
}

function renderList() {
    return renderWorkspace(
        <WorkItemsView
            scope={{ projectId: PROJECT, teamId: TEAM }}
            title="Islands"
            viewKey="cf-test"
            savedViews={{ savePersonal: true, saveShared: true, moderate: false }}
            manageCustomFields
        />,
        { config: WITH_FIELDS },
    );
}

const lastListRead = (calls: Recorded[]) => [...calls].reverse().find((c) => c.method === 'GET' && c.path === '/work-items');

beforeEach(() => {
    window.localStorage.clear();
    mockSearch.current = new URLSearchParams();
});

describe('the list with custom fields and saved views', () => {
    it('sorts by a field: the list reads order=cf:<id>', async () => {
        const { calls } = listRoutes();
        renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Size' }));
        await waitFor(() => expect(lastListRead(calls)?.search.get('order')).toBe('cf:f-size'));
    });

    it('applies a saved view: its field filter, sort and columns', async () => {
        const { calls } = listRoutes();
        const { container } = renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        expect(screen.queryByRole('columnheader', { name: 'Stage' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('combobox', { name: 'Views' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Alpha items' }));
        await waitFor(() => {
            const read = lastListRead(calls);
            expect(read?.search.get('cf.f-stage')).toBe('any:opt-a');
            expect(read?.search.get('order')).toBe('cf:f-size');
        });
        expect(await screen.findByRole('columnheader', { name: 'Stage' })).toBeInTheDocument();
        expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
        expect(screen.queryByRole('columnheader', { name: 'Priority' })).not.toBeInTheDocument();
        // The row chevron's empty header and the active filter chip's remove
        // button are the mirrored DataTable's and filter list's
        // (src/components/ui, never edited here); every other rule runs.
        expect(await axe(container, { rules: { 'empty-table-header': { enabled: false }, 'button-name': { enabled: false } } })).toHaveNoViolations();
    });

    it('saves the current state as a shared view', async () => {
        const { calls } = listRoutes({ 'POST /views': { status: 201, body: { ...VIEW, id: 'v-2', name: 'Mine', visibility: 'SHARED' } } });
        renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
        const dialog = await screen.findByRole('dialog', { name: 'Save view' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Mine' } });
        fireEvent.click(within(dialog).getByRole('checkbox'));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/views')).toBe(true));
        expect(calls.find((c) => c.method === 'POST' && c.path === '/views')?.body).toMatchObject({
            name: 'Mine',
            visibility: 'SHARED',
            projectId: PROJECT,
            layout: 'LIST',
            config: { sort: 'manual', laneBy: 'none' },
        });
    });

    it('deletes the applied view through the undo toast: it leaves the menu at once, nothing is sent yet', async () => {
        const { calls } = listRoutes();
        renderList();
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('combobox', { name: 'Views' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Alpha items' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Delete view Alpha items' }));
        expect(await screen.findByText('View Alpha items deleted')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('a VIEWER is offered a personal save, never a share (decision 60): the dialog has no share box and posts PERSONAL', async () => {
        // The affordances a VIEWER's own permission set yields on the server.
        const viewerOffer = savedViewAffordances(makeRequestContext('VIEWER', { appPermissions: getPermissionsForRole('VIEWER') }));
        expect(viewerOffer).toEqual({ savePersonal: true, saveShared: false, moderate: false });
        const { calls } = listRoutes({ 'POST /views': { status: 201, body: { ...VIEW, id: 'v-3', name: 'Just mine' } } });
        renderWorkspace(<WorkItemsView scope={{ projectId: PROJECT, teamId: TEAM }} title="Islands" viewKey="cf-test-3" savedViews={viewerOffer} />, {
            config: WITH_FIELDS,
            role: 'VIEWER',
        });
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
        const dialog = await screen.findByRole('dialog', { name: 'Save view' });
        expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Just mine' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/views')).toBe(true));
        expect(calls.find((c) => c.method === 'POST' && c.path === '/views')?.body).toMatchObject({ name: 'Just mine', visibility: 'PERSONAL' });
        expect(screen.queryByRole('button', { name: 'Fields' })).not.toBeInTheDocument();
    });

    it('a VIEWER renames its own personal view without a share box', async () => {
        listRoutes();
        const viewerOffer = savedViewAffordances(makeRequestContext('VIEWER', { appPermissions: getPermissionsForRole('VIEWER') }));
        renderWorkspace(<WorkItemsView scope={{ projectId: PROJECT, teamId: TEAM }} title="Islands" viewKey="cf-test-4" savedViews={viewerOffer} />, {
            config: WITH_FIELDS,
            role: 'VIEWER',
        });
        await screen.findByRole('link', { name: 'Item 1' });
        fireEvent.click(screen.getByRole('combobox', { name: 'Views' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Alpha items' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Rename view' }));
        const dialog = await screen.findByRole('dialog', { name: 'Rename view' });
        expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('offers no save to a viewer who may not save views', async () => {
        listRoutes();
        renderWorkspace(<WorkItemsView scope={{ projectId: PROJECT, teamId: TEAM }} title="Islands" viewKey="cf-test-2" />, { config: WITH_FIELDS, role: 'VIEWER' });
        await screen.findByRole('link', { name: 'Item 1' });
        expect(screen.queryByRole('button', { name: 'Save view' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Fields' })).not.toBeInTheDocument();
    });
});

describe('the board grouped by a field', () => {
    it('has one lane per option present, and "No value" last', async () => {
        installFetch({
            'GET /work-items': (req: Recorded) => ({ body: page(ROWS.filter((r) => r.stateId === req.search.get('stateId'))) }),
            'GET /users/assignable': { body: MEMBERS },
        });
        renderWorkspace(
            <WorkItemBoard
                scope={{ projectId: PROJECT }}
                columns={stateColumns(CONFIG.states.filter((s) => s.teamId === TEAM))}
                laneBy="cf:f-stage"
                onOpen={jest.fn()}
                canEdit
                canAssign
            />,
            { config: WITH_FIELDS },
        );
        await screen.findByText('Item 2');
        const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent ?? '');
        const lanes = headings.filter((h) => h === 'Alpha' || h === 'Beta' || h === 'No value');
        expect(lanes).toEqual(['Alpha', 'No value']);
        expect(screen.getByRole('list', { name: 'Todo, Alpha' })).toHaveTextContent('Item 1');
        expect(screen.getByRole('list', { name: 'Todo, No value' })).toHaveTextContent('Item 2');
    });
});

describe('the detail edits a field', () => {
    it('sets a select value with If-Match and shows the server\'s answer', async () => {
        const item = row(1, { customFields: {} });
        const { calls } = installFetch({
            'GET /work-items/wi-1': { body: detail(item) },
            [`GET /projects/${PROJECT}/custom-fields`]: { body: [managed(STAGE)] },
            'GET /users/assignable': { body: MEMBERS },
            'GET /work-items/wi-1/watchers': { body: [] },
            'PUT /work-items/wi-1/custom-fields/f-stage': { body: detail(row(1, { customFields: { 'f-stage': 'opt-b' }, version: 2 })) },
        });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_FIELDS });
        fireEvent.click(await screen.findByRole('combobox', { name: 'Stage' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Beta' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.body).toEqual({ value: 'opt-b' });
        expect(put.ifMatch).toBe('"1"');
    });
});

describe('the field manager', () => {
    it('creates a select field with its options, and archives a field', async () => {
        const { calls } = installFetch({
            ['GET /projects/' + PROJECT + '/custom-fields']: { body: [managed(SIZE)] },
            ['POST /projects/' + PROJECT + '/custom-fields']: { status: 201, body: managed(STAGE) },
            ['PATCH /projects/' + PROJECT + '/custom-fields/f-size']: { body: { ...managed(SIZE), archived: true } },
        });
        renderWorkspace(<CustomFieldsManager projectId={PROJECT} projectName="Islands" open onOpenChange={jest.fn()} />);
        const dialog = await screen.findByRole('dialog', { name: 'Fields of Islands' });
        await within(dialog).findByRole('listitem', { name: 'Size' });
        fireEvent.change(within(dialog).getByLabelText(/^Name(?! of)/), { target: { value: 'Stage' } });
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Text' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Select' }));
        fireEvent.change(within(dialog).getByLabelText(/^Options/), { target: { value: 'Alpha\nBeta\n\n' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
        expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Stage', type: 'SELECT', options: [{ name: 'Alpha' }, { name: 'Beta' }] });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Archive Size' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ archived: true }));
    });

    it("refreshes the views' list of the project's fields after a write, so a reader mounted before it (the create dialog) never hands the detail a stale list", async () => {
        let fields = [managed(SIZE)];
        installFetch({
            ['GET /projects/' + PROJECT + '/custom-fields']: () => ({ body: fields }),
            ['POST /projects/' + PROJECT + '/custom-fields']: () => {
                fields = [managed(SIZE), managed(STAGE)];
                return { status: 201, body: managed(STAGE) };
            },
        });
        function Reader() {
            const live = useProjectCustomFields(PROJECT);
            return <p role="status" aria-label="Fields the views read">{live.map((f) => f.name).join(',')}</p>;
        }
        renderWorkspace(
            <>
                <Reader />
                <CustomFieldsManager projectId={PROJECT} projectName="Islands" open onOpenChange={jest.fn()} />
            </>,
        );
        await waitFor(() => expect(screen.getByRole('status', { name: 'Fields the views read', hidden: true })).toHaveTextContent('Size'));
        const dialog = await screen.findByRole('dialog', { name: 'Fields of Islands' });
        fireEvent.change(within(dialog).getByLabelText(/^Name(?! of)/), { target: { value: 'Stage' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Add field' }));
        await waitFor(() => expect(screen.getByRole('status', { name: 'Fields the views read', hidden: true })).toHaveTextContent('Size,Stage'));
    });
});

describe('the Views page', () => {
    it('lists the views, each linking to its page with the view applied', async () => {
        installFetch({ 'GET /views': { body: { views: [VIEW, { ...VIEW, id: 'v-ws', name: 'Everything', projectId: null, project: null, visibility: 'SHARED', mine: false }], truncated: false } } });
        const { container } = renderWorkspace(<ViewsList title="Views" />);
        expect(await screen.findByRole('link', { name: 'Alpha items' })).toHaveAttribute('href', '/t/acme/projects/ISL?view=v-1');
        expect(screen.getByRole('link', { name: 'Everything' })).toHaveAttribute('href', '/t/acme/work-items?view=v-ws');
        expect(screen.getByText('All work items')).toBeInTheDocument();
        expect(await axe(container, { rules: { 'empty-table-header': { enabled: false } } })).toHaveNoViolations();
    });
});
