/** @jest-environment jsdom */

/**
 * The Roadmap entry's pages (sub-phase 3.2b; owner decisions 205, 207, 212,
 * 214, 218, 221 and 222): the goal tree with progress ("N of M done", "No
 * items", never 100 % of nothing), status and health shown with their names,
 * the Deleted view's restore, a goal's health control sending a versioned
 * write and its history, "Add child goal" refused past three levels with
 * the reason, deletes and a project's removal through the undo toast, the
 * initiative's projects table, and every write offered only where the
 * server said so. Each page is axe-clean.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

const push = jest.fn();
let pathname = '/t/acme/roadmap/goals';
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push, replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { GoalsView, nestRows } from '@/components/goals/GoalsView';
import { GoalView } from '@/components/goals/GoalView';
import { InitiativesView } from '@/components/goals/InitiativesView';
import { InitiativeView } from '@/components/goals/InitiativeView';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import type { GoalDetail, GoalSummary, InitiativeDetail, InitiativeSummary, RoadmapAffordances } from '@/lib/goals/types';

import { uiStorageKey } from '@/lib/ui-storage';
import { installFetch, MEMBERS, renderWorkspace, TEAM } from '../helpers/work-items-harness';

const MANAGER: RoadmapAffordances = { view: true, manage: true, setHealth: true, linkProject: true, setItemGoal: true, createProject: true };
const READER: RoadmapAffordances = { view: true, manage: false, setHealth: false, linkProject: false, setItemGoal: false, createProject: false };

const base = {
    description: null,
    dueDate: null,
    leadUserId: null,
    health: null,
    healthSetAt: null,
    healthSetByUserId: null,
    version: 3,
    archived: false,
    archivedAt: null,
    deletedAt: null,
    deletionId: null,
    createdByUserId: 'u-ada',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    late: false,
    tooManyProjects: null,
} as const;

const ROOT: GoalSummary = { ...base, id: 'g-root', parentId: null, title: 'Grow revenue', status: 'STARTED', health: 'COMPLETED', progress: { scope: 4, done: 2, started: 1 }, dueDate: '2026-12-31', leadUserId: 'u-bob' };
const CHILD: GoalSummary = { ...base, id: 'g-child', parentId: 'g-root', title: 'Win the enterprise segment', status: 'PLANNED', progress: { scope: 0, done: 0, started: 0 }, late: false };
const LATE: GoalSummary = { ...base, id: 'g-late', parentId: null, title: 'Cut churn', status: 'PLANNED', progress: { scope: 3, done: 1, started: 0 }, dueDate: '2026-01-01', late: true };
const ASSIGNABLE = { 'GET /users/assignable': { body: MEMBERS } };
/** The mirrored DataTable's row-chevron column has no header text (as every list page's test notes). */
const axeTable = (container: Element) => axe(container, { rules: { 'empty-table-header': { enabled: false } } });

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    push.mockReset();
    pathname = '/t/acme/roadmap/goals';
});

describe('nestRows', () => {
    it('nests each row under its nearest shown ancestor and keeps the order among siblings', () => {
        const rows = nestRows([
            { id: 'a', parentId: null },
            { id: 'c', parentId: 'b' },
            { id: 'd', parentId: 'a' },
        ], new Map([['b', 'a']]));
        // `b` is filtered out, so `c` hangs under `a`; siblings keep the order the server gave them.
        expect(rows.map((r) => [r.id, r.depth])).toEqual([
            ['a', 0],
            ['c', 1],
            ['d', 1],
        ]);
    });
});

describe('the Goals page', () => {
    it('shows the tree with progress, health and late marks, and the tab bar, with no axe violations', async () => {
        installFetch({ ...ASSIGNABLE, 'GET /goals': { body: { goals: [ROOT, CHILD, LATE] } } });
        const { container } = renderWorkspace(<GoalsView initialGoals={[ROOT, CHILD, LATE]} goalOptions={[]} affordances={MANAGER} />);
        const tabs = screen.getByRole('navigation', { name: 'Roadmap pages' });
        expect(within(tabs).getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page');
        expect(within(tabs).getByRole('link', { name: 'Initiatives' })).toHaveAttribute('href', '/t/acme/roadmap/initiatives');
        const table = screen.getByTestId('goals-table');
        expect(within(table).getByRole('link', { name: 'Grow revenue' })).toHaveAttribute('href', '/t/acme/roadmap/goals/g-root');
        expect(within(table).getByText('2 of 4 done')).toBeInTheDocument();
        expect(within(table).getByRole('progressbar', { name: 'Grow revenue: 50% done' })).toBeInTheDocument();
        // Zero items is "No items", never 100 %.
        expect(within(table).getByText('No items')).toBeInTheDocument();
        expect(within(table).getByText('Late')).toBeInTheDocument();
        // Health "Completed" on a Started goal shows as set.
        expect(within(table).getAllByText('Completed').length).toBeGreaterThan(0);
        expect(within(table).getAllByText('No health set').length).toBe(2);
        expect(screen.getByRole('button', { name: 'Goal' })).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('offers no create to a reader, and restores from the Deleted view', async () => {
        const gone = { ...CHILD, id: 'g-gone', title: 'Old outcome', deletedAt: '2026-11-20T10:00:00.000Z', progress: null };
        const { calls } = installFetch({
            ...ASSIGNABLE,
            'GET /goals': (req) => (req.search.get('deleted') === 'true' ? { body: { goals: [gone] } } : { body: { goals: [ROOT] } }),
            'POST /goals/g-gone/restore': { body: { ...gone, deletedAt: null } },
        });
        const { unmount } = renderWorkspace(<GoalsView initialGoals={[ROOT]} goalOptions={[]} affordances={READER} />, { role: 'VIEWER' });
        expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
        unmount();
        renderWorkspace(<GoalsView initialGoals={[ROOT]} goalOptions={[]} affordances={MANAGER} />);
        fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));
        expect(await screen.findByText('Old outcome')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/goals/g-gone/restore')).toBe(true));
    });
});

const DETAIL: GoalDetail = {
    goal: { ...ROOT, healthSetAt: '2026-11-20T10:00:00.000Z', healthSetByUserId: 'u-bob' },
    ancestors: [],
    children: [CHILD],
    initiatives: [],
    depth: 3,
    childFits: false,
    directItems: 2,
    healthHistory: [{ id: 'h1', health: 'COMPLETED', previous: 'AT_RISK', setByUserId: 'u-bob', setAt: '2026-11-20T10:00:00.000Z' }],
};

describe("a goal's page", () => {
    it('shows status and health with their names, progress, children, the direct items and the history, with no axe violations', async () => {
        pathname = '/t/acme/roadmap/goals/g-root';
        installFetch({ ...ASSIGNABLE, 'GET /goals/g-root': { body: DETAIL } });
        const { container } = renderWorkspace(<GoalView initialDetail={DETAIL} goalOptions={[]} affordances={MANAGER} />);
        expect(screen.getByRole('heading', { level: 1, name: 'Grow revenue' })).toBeInTheDocument();
        expect(screen.getByText('Status: Started · Health: Completed')).toBeInTheDocument();
        expect(screen.getByText('2 work items name this goal directly.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: "Show the goal's work items" })).toHaveAttribute('href', '/t/acme/work-items?goalId=g-root');
        expect(screen.getByRole('link', { name: 'Win the enterprise segment' })).toHaveAttribute('href', '/t/acme/roadmap/goals/g-child');
        expect(within(screen.getByTestId('health-history')).getByText(/At risk → Completed/)).toBeInTheDocument();
        // Third level: no child fits, and the page says why.
        expect(screen.queryByRole('button', { name: 'Add child goal' })).toBeNull();
        expect(screen.getByText('Goals nest at most three levels; this goal is on the third.')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
    });

    it('sets health with the version it read, and a reader sees it read-only', async () => {
        pathname = '/t/acme/roadmap/goals/g-root';
        const { calls } = installFetch({ ...ASSIGNABLE, 'GET /goals/g-root': { body: DETAIL }, 'PUT /goals/g-root/health': { body: { ...ROOT, health: 'AT_RISK' } } });
        const { unmount } = renderWorkspace(<GoalView initialDetail={DETAIL} goalOptions={[]} affordances={MANAGER} />);
        const control = screen.getByRole('radiogroup', { name: 'Health of Grow revenue' });
        fireEvent.click(within(control).getByRole('radio', { name: 'At risk' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put).toMatchObject({ path: '/goals/g-root/health', body: { health: 'AT_RISK' }, ifMatch: '"3"' });
        unmount();
        renderWorkspace(<GoalView initialDetail={DETAIL} goalOptions={[]} affordances={READER} />, { role: 'VIEWER' });
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('deletes through the undo toast: the page is left at once and nothing is sent before the window closes', async () => {
        pathname = '/t/acme/roadmap/goals/g-root';
        const { calls } = installFetch({ ...ASSIGNABLE, 'GET /goals/g-root': { body: DETAIL }, 'DELETE /goals/g-root': { body: { deleted: true } } });
        renderWorkspace(<GoalView initialDetail={DETAIL} goalOptions={[]} affordances={MANAGER} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(push).toHaveBeenCalledWith('/t/acme/roadmap/goals');
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });
});

const INITIATIVE: InitiativeSummary = { ...base, id: 'i-1', goalId: 'g-root', name: 'Self-serve checkout', status: 'STARTED', progress: { scope: 5, done: 1, started: 2 }, late: true, dueDate: '2026-02-01' };
const INITIATIVE_DETAIL: InitiativeDetail = {
    initiative: INITIATIVE,
    goal: { id: 'g-root', title: 'Grow revenue', status: 'STARTED', archived: false },
    goals: [{ id: 'g-root', title: 'Grow revenue' }],
    projects: [
        { id: 'p-1', name: 'Checkout', keyPrefix: 'CHK', teamId: TEAM, archived: false, dueDate: '2026-01-15', progress: { scope: 4, done: 1, started: 2 }, late: true, lateMilestones: 1 },
        { id: 'p-2', name: 'Old billing', keyPrefix: 'OBL', teamId: TEAM, archived: true, dueDate: null, progress: { scope: 1, done: 0, started: 0 }, late: false, lateMilestones: 0 },
    ],
    healthHistory: [],
};

describe('the Initiatives page and an initiative\'s page', () => {
    it('lists initiatives with the goal each serves, with no axe violations', async () => {
        pathname = '/t/acme/roadmap/initiatives';
        installFetch({ ...ASSIGNABLE, 'GET /initiatives': { body: { initiatives: [INITIATIVE] } } });
        const { container } = renderWorkspace(<InitiativesView initialInitiatives={[INITIATIVE]} goalOptions={[{ id: 'g-root', parentId: null, title: 'Grow revenue' }]} affordances={MANAGER} />);
        const table = screen.getByTestId('initiatives-table');
        expect(within(table).getByRole('link', { name: 'Grow revenue' })).toHaveAttribute('href', '/t/acme/roadmap/goals/g-root');
        expect(within(table).getByText('1 of 5 done')).toBeInTheDocument();
        expect(within(screen.getByRole('navigation', { name: 'Roadmap pages' })).getByRole('link', { name: 'Initiatives' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('button', { name: 'Initiative' })).toBeInTheDocument();
        expect(await axeTable(container)).toHaveNoViolations();
    });

    it('shows the projects table with progress, late and late milestones, and removes a project through the undo toast', async () => {
        pathname = '/t/acme/roadmap/initiatives/i-1';
        const { calls, container } = (() => {
            const f = installFetch({ ...ASSIGNABLE, 'GET /initiatives/i-1': { body: INITIATIVE_DETAIL }, 'PUT /projects/p-1/initiative': { body: {} } });
            const r = renderWorkspace(<InitiativeView initialDetail={INITIATIVE_DETAIL} goalOptions={[]} projects={[]} teams={[{ id: TEAM, name: 'Core' }]} affordances={MANAGER} />);
            return { ...f, container: r.container };
        })();
        expect(screen.getByRole('heading', { level: 1, name: 'Self-serve checkout' })).toBeInTheDocument();
        const table = screen.getByTestId('initiative-projects-table');
        expect(within(table).getByRole('link', { name: 'Checkout' })).toHaveAttribute('href', '/t/acme/projects/CHK');
        expect(within(table).getByText('1 late')).toBeInTheDocument();
        expect(within(table).getByText('archived')).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
        fireEvent.click(within(table).getByRole('button', { name: 'Remove Checkout from the initiative' }));
        await waitFor(() => expect(within(table).queryByRole('link', { name: 'Checkout' })).toBeNull());
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(within(screen.getByTestId('initiative-projects-table')).getByRole('link', { name: 'Checkout' })).toBeInTheDocument());
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('shows its slice of the roadmap (3.2c) and its projects\' planned dates, read with the initiative fixed and archived projects shown', async () => {
        pathname = '/t/acme/roadmap/initiatives/i-1';
        window.localStorage.setItem(uiStorageKey('roadmap', 'mode'), JSON.stringify('table'));
        const roadmap = {
            asOf: '2026-03-01',
            groupBy: 'initiative',
            goals: [],
            initiatives: [{ id: 'i-1', goalId: null, name: 'Self-serve checkout', status: 'STARTED', dueDate: null, health: null, leadUserId: null, archived: false, span: { start: '2026-01-05', end: '2026-02-20' }, progress: { scope: 5, done: 1, started: 2 }, late: false, finishesAfterDue: false }],
            projects: [
                { id: 'p-1', name: 'Checkout', keyPrefix: 'CHK', teamId: TEAM, initiativeId: 'i-1', dueDate: '2026-01-15', archived: false, span: { start: '2026-01-05', end: '2026-02-20' }, progress: { scope: 4, done: 1, started: 2 }, overdue: true, itemDueAfter: true, lateMilestones: 1, late: true, finishesAfterInitiativeDue: false, finishesAfterGoalDue: false },
                { id: 'p-2', name: 'Old billing', keyPrefix: 'OBL', teamId: TEAM, initiativeId: 'i-1', dueDate: null, archived: true, span: null, progress: { scope: 1, done: 0, started: 0 }, overdue: false, itemDueAfter: false, lateMilestones: 0, late: false, finishesAfterInitiativeDue: false, finishesAfterGoalDue: false },
            ],
            milestones: [],
            unlinked: { shown: false, span: null, progress: { scope: 0, done: 0, started: 0 } },
        };
        const { calls } = installFetch({ ...ASSIGNABLE, 'GET /initiatives/i-1': { body: INITIATIVE_DETAIL }, 'GET /roadmap': { body: roadmap } });
        renderWorkspace(<InitiativeView initialDetail={INITIATIVE_DETAIL} goalOptions={[]} projects={[]} teams={[{ id: TEAM, name: 'Core' }]} affordances={{ ...READER, roadmap: true }} />, { role: 'VIEWER' });
        expect(screen.getByRole('heading', { level: 2, name: 'Roadmap' })).toBeInTheDocument();
        const slice = await screen.findByTestId('initiative-roadmap-table');
        expect(within(slice).getByRole('link', { name: 'Open the timeline of Checkout' })).toHaveAttribute('href', '/t/acme/projects/CHK?layout=timeline');
        const table = screen.getByTestId('initiative-projects-table');
        await waitFor(() => expect(within(table).getByText(/Jan 5, 2026 – Feb 20, 2026|5 Jan 2026 – 20 Feb 2026/)).toBeInTheDocument());
        const read = calls.find((c) => c.path === '/roadmap')!;
        expect(Object.fromEntries(read.search)).toEqual({ initiativeId: 'i-1', archived: 'true' });
        window.localStorage.clear();
    });

    it('reads no roadmap for a caller the server offers none', () => {
        pathname = '/t/acme/roadmap/initiatives/i-1';
        const { calls } = installFetch({ ...ASSIGNABLE, 'GET /initiatives/i-1': { body: INITIATIVE_DETAIL } });
        renderWorkspace(<InitiativeView initialDetail={INITIATIVE_DETAIL} goalOptions={[]} projects={[]} teams={[]} affordances={READER} />, { role: 'VIEWER' });
        expect(screen.queryByRole('heading', { level: 2, name: 'Roadmap' })).toBeNull();
        expect(calls.some((c) => c.path === '/roadmap')).toBe(false);
    });

    it('offers no project link, removal or health control to a reader', () => {
        pathname = '/t/acme/roadmap/initiatives/i-1';
        installFetch({ ...ASSIGNABLE, 'GET /initiatives/i-1': { body: INITIATIVE_DETAIL } });
        renderWorkspace(<InitiativeView initialDetail={INITIATIVE_DETAIL} goalOptions={[]} projects={[]} teams={[]} affordances={READER} />, { role: 'VIEWER' });
        expect(screen.queryByRole('button', { name: 'Add project' })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
        expect(screen.queryByRole('radiogroup')).toBeNull();
    });
});
