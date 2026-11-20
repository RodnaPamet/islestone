/** @jest-environment jsdom */

/**
 * The Projects page's create (owner decision 57): anyone who holds
 * `projects.create` creates a project there, outside Settings. The server
 * page hands `ProjectsList` exactly `mayCreateProject(ctx)`, the predicate
 * the usecase asserts; the list shows the button only when it is true and
 * opens the dialog shared with Settings → Projects; a created project shows
 * at once and the server's list is read again; with no team, the dialog
 * links to Settings → Teams only for a viewer who may open Settings. Queries
 * by role and label; jest-axe on the page and the dialog.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Role } from '@prisma/client';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: mockRefresh, back: jest.fn() }),
    usePathname: () => '/t/acme/projects',
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

const mockTenantCtx = jest.fn();
jest.mock('@/app-layer/context', () => ({ getTenantCtx: (...args: unknown[]) => mockTenantCtx(...args) }));
const mockViewConfig = jest.fn();
jest.mock('@/app-layer/usecases/work-item-views', () => ({ getWorkItemViewConfig: (...args: unknown[]) => mockViewConfig(...args) }));

import ProjectsPage from '@/app/t/[tenantSlug]/(app)/projects/page';
import { mayCreateProject } from '@/app-layer/policies/work-config.policies';
import type { RequestContext } from '@/app-layer/types';
import { ProjectsList } from '@/components/work-items/ProjectsList';
import { getPermissionsForRole } from '@/lib/permissions';

import { makeRequestContext } from '../helpers/make-context';
import { CONFIG, deferred, installFetch, renderWorkspace } from '../helpers/work-items-harness';

const TEAMS = [
    { id: 'team-1', name: 'Core' },
    { id: 'team-2', name: 'Growth' },
];

/** Run the table's axe pass; the empty header cell of the mirrored DataTable is upstream's. */
const axeTable = (container: Element) => axe(container, { rules: { 'empty-table-header': { enabled: false } } });

const list = (allowed: boolean) => <ProjectsList title="Projects" projects={CONFIG.projects} teams={CONFIG.teams} mayCreateProject={allowed} />;

beforeEach(() => mockRefresh.mockReset());

describe('the Projects page server function', () => {
    const params = Promise.resolve({ tenantSlug: 'acme' });

    function adminWithoutCreate(): RequestContext {
        const perms = getPermissionsForRole('ADMIN');
        perms.projects.create = false;
        return makeRequestContext('ADMIN', { appPermissions: perms });
    }

    const CASES: Array<[string, () => RequestContext, boolean]> = [
        ['an Owner', () => makeRequestContext('OWNER'), true],
        ['an Admin', () => makeRequestContext('ADMIN'), true],
        ['a Member', () => makeRequestContext('MEMBER'), true],
        ['a Viewer', () => makeRequestContext('VIEWER'), false],
        ['an Admin whose custom role withholds projects.create', adminWithoutCreate, false],
    ];

    beforeEach(() => {
        mockTenantCtx.mockReset();
        mockViewConfig.mockReset().mockResolvedValue(CONFIG);
    });

    it.each(CASES)('hands %s exactly mayCreateProject(ctx)', async (_name, makeCtx, expected) => {
        const ctx = makeCtx();
        mockTenantCtx.mockResolvedValue(ctx);
        const element = (await ProjectsPage({ params })) as ReactElement<{ mayCreateProject: boolean }>;
        expect(mockTenantCtx).toHaveBeenCalledWith({ tenantSlug: 'acme' });
        expect(element.props.mayCreateProject).toBe(mayCreateProject(ctx));
        expect(element.props.mayCreateProject).toBe(expected);
    });

    it('renders the button for a Member and not for a Viewer', async () => {
        installFetch({ 'GET /teams': { body: TEAMS } });
        mockTenantCtx.mockResolvedValue(makeRequestContext('MEMBER'));
        const { unmount } = renderWorkspace(await ProjectsPage({ params }), { role: 'MEMBER' });
        expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument();
        unmount();
        mockTenantCtx.mockResolvedValue(makeRequestContext('VIEWER'));
        renderWorkspace(await ProjectsPage({ params }), { role: 'VIEWER' });
        expect(screen.getByRole('link', { name: 'Islands' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
    });
});

describe('the Projects page list', () => {
    it('offers the create button only when the server allows it, with no axe violations', async () => {
        installFetch({ 'GET /teams': { body: TEAMS } });
        const { container, unmount } = renderWorkspace(list(true), { role: 'MEMBER' });
        expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
        unmount();
        renderWorkspace(list(false), { role: 'MEMBER' });
        expect(screen.getByRole('link', { name: 'Islands' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
    });

    it('creates a project with the first team, shows it at once and reads the server list again', async () => {
        const { calls } = installFetch({
            'GET /teams': { body: TEAMS },
            'POST /projects': { status: 201, body: { id: 'p-3', teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG', archivedAt: null } },
        });
        renderWorkspace(list(true), { role: 'MEMBER' });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled());
        expect(await axe(dialog)).toHaveNoViolations();
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Engine' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'eng' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG' }));
        expect(calls.find((c) => c.method === 'POST')?.path).toBe('/projects');
        const engine = (await screen.findByRole('link', { name: 'Engine' })).closest('tr')!;
        expect(within(engine).getByText('ENG')).toBeInTheDocument();
        expect(within(engine).getByText('Core')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Islands' })).toBeInTheDocument();
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New project' })).toBeNull());
    });

    it('takes the first team when the teams arrive after the dialog opened', async () => {
        const teamsAnswer = deferred<{ body: unknown }>();
        const { calls } = installFetch({
            'GET /teams': () => teamsAnswer.promise,
            'POST /projects': { status: 201, body: { id: 'p-3', teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG', archivedAt: null } },
        });
        renderWorkspace(list(true), { role: 'MEMBER' });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Engine' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'ENG' } });
        expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
        await act(async () => teamsAnswer.resolve({ body: TEAMS }));
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled());
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ teamId: 'team-1', name: 'Engine', keyPrefix: 'ENG' }));
    });

    it('shows a refused prefix in the dialog and adds nothing to the list', async () => {
        installFetch({
            'GET /teams': { body: TEAMS },
            'POST /projects': {
                status: 409,
                body: { error: { code: 'CONFLICT', message: 'The key prefix ISL is or was used in this workspace; prefixes are never reused.' } },
            },
        });
        renderWorkspace(list(true), { role: 'MEMBER' });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeEnabled());
        fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Again' } });
        fireEvent.change(within(dialog).getByLabelText(/^Key prefix/), { target: { value: 'ISL' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('prefixes are never reused');
        expect(screen.queryByRole('link', { name: 'Again' })).toBeNull();
        expect(mockRefresh).not.toHaveBeenCalled();
    });

    it.each<[Role, boolean]>([
        ['ADMIN', true],
        ['MEMBER', false],
    ])('with no team, a %s is sent to Settings → Teams only if they may open Settings (%s)', async (role, link) => {
        installFetch({ 'GET /teams': { body: [] } });
        renderWorkspace(list(true), { role });
        fireEvent.click(screen.getByRole('button', { name: 'Project' }));
        const dialog = await screen.findByRole('dialog', { name: 'New project' });
        const status = await within(dialog).findByRole('status');
        expect(status).toHaveTextContent('A project belongs to a team, and this workspace has none yet.');
        if (link) {
            expect(within(status).getByRole('link', { name: 'Create a team first' })).toHaveAttribute('href', '/t/acme/settings/teams');
            expect(status).not.toHaveTextContent('Ask a workspace admin');
        } else {
            expect(within(dialog).queryByRole('link')).toBeNull();
            expect(status).toHaveTextContent('Ask a workspace admin to create one.');
        }
        expect(within(dialog).getByRole('button', { name: 'Create project' })).toBeDisabled();
        expect(await axe(dialog)).toHaveNoViolations();
    });
});
