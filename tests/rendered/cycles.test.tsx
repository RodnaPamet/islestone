/** @jest-environment jsdom */

/**
 * The cycle UI (sub-phase 2.5a): the burn-up's table (what the chart draws,
 * for every reader), the Cycles page per team with its affordances, the
 * undo-toast delete of an upcoming cycle, the schedule dialog's save, and
 * the detail's cycle picker sending its versioned write.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/cycles',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { BurnUpChart } from '@/components/cycles/BurnUpChart';
import { CyclesView } from '@/components/cycles/CyclesView';
import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import type { CycleData, WorkItemViewConfig } from '@/lib/work-items/types';

import { CONFIG, detail, installFetch, MEMBERS, PROJECT, renderWorkspace, row, TEAM } from '../helpers/work-items-harness';

const counts = (scope: number, started: number, completed: number) => ({ scope, started, completed });

const CURRENT: CycleData = {
    id: 'cy-1',
    teamId: TEAM,
    number: 7,
    name: null,
    startsOn: '2026-11-16',
    endsOn: '2026-11-29',
    status: 'current',
    fromSchedule: true,
    completedAt: null,
    daysLeft: 10,
    counts: counts(4, 2, 1),
};
const NEXT: CycleData = { ...CURRENT, id: 'cy-2', number: 8, name: 'Launch', startsOn: '2026-11-30', endsOn: '2026-12-13', status: 'upcoming', daysLeft: 14, counts: counts(1, 0, 0) };
const DONE: CycleData = { ...CURRENT, id: 'cy-0', number: 6, startsOn: '2026-11-02', endsOn: '2026-11-15', status: 'completed', completedAt: '2026-11-16T00:10:00.000Z', daysLeft: 0, counts: counts(5, 5, 5) };
const TEAMS = [{ id: TEAM, name: 'Core' }];

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe('the burn-up', () => {
    it('lists every day it draws as a table, with no axe violations', async () => {
        const points = [
            { date: '2026-11-16', scope: 3, started: 0, completed: 0 },
            { date: '2026-11-17', scope: 4, started: 2, completed: 1 },
        ];
        const { container } = renderWorkspace(<BurnUpChart points={points} />);
        const table = screen.getByRole('table', { name: /at the end of each day/ });
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows.map((r) => Array.from(r.querySelectorAll('th, td')).map((c) => c.textContent))).toEqual([
            ['2026-11-16', '3', '0', '0'],
            ['2026-11-17', '4', '2', '1'],
        ]);
        fireEvent.click(screen.getByRole('button', { name: 'Show as table' }));
        expect(screen.getByRole('button', { name: 'Show as chart' })).toHaveAttribute('aria-expanded', 'true');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('says when it has nothing to draw and when it counted only the first items', () => {
        const { rerender } = renderWorkspace(<BurnUpChart points={[]} />);
        expect(screen.getByText("The burn-up starts on the cycle's first day.")).toBeInTheDocument();
        rerender(<BurnUpChart points={[{ date: '2026-11-16', scope: 1, started: 0, completed: 0 }]} truncated />);
        expect(screen.getByText(/counts the first 5,000/)).toBeInTheDocument();
    });
});

describe('the Cycles page', () => {
    it('shows each team\'s current cycle with its counts, and its upcoming and completed cycles', async () => {
        installFetch({ 'GET /cycles': { body: [NEXT, CURRENT, DONE] } });
        const { container } = renderWorkspace(
            <CyclesView title="Cycles" teams={TEAMS} initialCycles={[NEXT, CURRENT, DONE]} affordances={{ manageCycles: true, planItems: true }} />,
        );
        const section = screen.getByRole('region', { name: 'Core' });
        const current = within(section).getByTestId('current-cycle-cy-1');
        expect(within(current).getByRole('link', { name: 'Cycle 7' })).toHaveAttribute('href', '/t/acme/cycles/cy-1');
        expect(within(current).getByText(/Days left: 10/)).toBeInTheDocument();
        expect(within(current).getByRole('progressbar', { name: '25% of the scope is done' })).toBeInTheDocument();
        expect(within(section).getByRole('link', { name: 'Launch' })).toBeInTheDocument();
        expect(within(section).getByRole('link', { name: 'Cycle 6' })).toBeInTheDocument();
        // Only an upcoming cycle may be deleted.
        expect(within(section).getAllByRole('button', { name: /^Delete / })).toHaveLength(1);
        expect(await axe(container)).toHaveNoViolations();
    });

    it('offers no schedule, no new cycle and no delete to a viewer', () => {
        installFetch({ 'GET /cycles': { body: [NEXT, CURRENT] } });
        renderWorkspace(
            <CyclesView title="Cycles" teams={TEAMS} initialCycles={[NEXT, CURRENT]} affordances={{ manageCycles: false, planItems: false }} />,
            { role: 'VIEWER' },
        );
        expect(screen.queryByRole('button', { name: /Cycle schedule/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /New cycle/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    });

    it('deletes an upcoming cycle through the undo toast: nothing is sent until the window closes, and Undo sends nothing', async () => {
        const { calls } = installFetch({ 'GET /cycles': { body: [NEXT, CURRENT] }, 'DELETE /cycles/cy-2': { body: { deleted: true, clearedItems: 0 } } });
        renderWorkspace(<CyclesView title="Cycles" teams={TEAMS} initialCycles={[NEXT, CURRENT]} affordances={{ manageCycles: true, planItems: true }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Launch' }));
        await waitFor(() => expect(screen.queryByRole('link', { name: 'Launch' })).toBeNull());
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(screen.getByRole('link', { name: 'Launch' })).toBeInTheDocument());
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('saves the team\'s cycle schedule', async () => {
        const schedule = { teamId: TEAM, saved: false, enabled: false, lengthWeeks: 2, firstStartsOn: '2026-11-16', upcomingCount: 2, rollover: 'NEXT_CYCLE' };
        const { calls } = installFetch({
            'GET /cycles': { body: [CURRENT] },
            [`GET /teams/${TEAM}/cycle-schedule`]: { body: schedule },
            [`PUT /teams/${TEAM}/cycle-schedule`]: (req) => ({ body: { ...schedule, ...(req.body as object), saved: true, created: 2, replaced: 0 } }),
        });
        renderWorkspace(<CyclesView title="Cycles" teams={TEAMS} initialCycles={[CURRENT]} affordances={{ manageCycles: true, planItems: true }} />);
        fireEvent.click(screen.getByRole('button', { name: 'Cycle schedule for Core' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(await within(dialog).findByRole('combobox', { name: 'Move them to the next cycle' }));
        fireEvent.click(await screen.findByRole('option', { name: 'Take them out of cycles' }));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save schedule' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
            enabled: true,
            lengthWeeks: 2,
            firstStartsOn: '2026-11-16',
            upcomingCount: 2,
            rollover: 'NO_CYCLE',
        });
    });
});

describe('the detail\'s cycle picker', () => {
    const WITH_CYCLES: WorkItemViewConfig = {
        ...CONFIG,
        cycles: [NEXT, CURRENT, DONE].map(({ id, teamId, number, name, startsOn, endsOn, status }) => ({ id, teamId, number, name, startsOn, endsOn, status })),
    };

    it('offers the team\'s open cycles and sends the change with If-Match', async () => {
        const item = row(1);
        const { calls } = installFetch({
            'GET /work-items/wi-1': { body: detail(item) },
            'GET /users/assignable': { body: MEMBERS },
            'GET /work-items/wi-1/watchers': { body: [] },
            [`GET /projects/${PROJECT}/custom-fields`]: { body: [] },
            'PUT /work-items/wi-1/cycle': { body: detail(row(1, { cycleId: 'cy-1', version: 2 })) },
        });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_CYCLES });
        // The trigger is named by its selection, as every picker's is.
        fireEvent.click(await screen.findByRole('combobox', { name: 'No cycle' }));
        expect(await screen.findByRole('option', { name: 'Launch' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'Cycle 6' })).toBeNull();
        fireEvent.click(screen.getByRole('option', { name: 'Cycle 7 (current)' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.body).toEqual({ cycleId: 'cy-1' });
        expect(put.ifMatch).toBe('"1"');
    });
});
