/** @jest-environment jsdom */

/**
 * Changing dates and dependencies from the timeline (roadmap 3.1c; owner
 * decisions 194, 195, 197 and 203), through the schedule table, the
 * keyboard way:
 *
 *   - "Change dates" opens the confirmation with the product's date
 *     pickers; the preview names the items whose earliest start moves; with
 *     the option unticked, confirming sends the item's PATCH with If-Match;
 *   - ticked, the new bars show at once and the write is held behind the
 *     undo toast, then sent as `POST /work-items/bulk/dates` with every
 *     version; Undo sends nothing;
 *   - above 100 items the option is disabled with the count;
 *   - "Dependencies" lists and removes (through the undo toast) and adds
 *     through the relation route, whose refusal is shown;
 *   - a caller who does not edit work items is offered none of it;
 *   - the dialogs have no axe violations.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { ChangeDatesDialog } from '@/components/work-items/timeline/ChangeDatesDialog';
import { DEFAULT_TIMELINE_SETTINGS, TimelineView, type TimelineMode, type TimelineSettings } from '@/components/work-items/timeline/TimelineView';
import { fromEpochDay, toEpochDay } from '@/app-layer/domain/schedule/calendar';
import { computeTimelineSchedule, type TimelineData, type TimelineRow } from '@/lib/work-items/timeline';

import { detail, installFetch, PROJECT, renderWorkspace, row as listRow, TEAM } from '../helpers/work-items-harness';

function item(id: string, n: number, over: Partial<TimelineRow> = {}): TimelineRow {
    return {
        id,
        key: `ISL-${n}`,
        title: `Item ${n}`,
        projectId: PROJECT,
        teamId: TEAM,
        typeId: 'type-1',
        stateCategory: 'UNSTARTED',
        assigneeId: null,
        parentId: null,
        sortKey: `a${n}`,
        startDate: null,
        dueDate: null,
        actualStart: null,
        actualFinish: null,
        milestoneId: null,
        calendarId: 'cal-ws',
        version: 4,
        context: false,
        ...over,
    };
}

const DATA: TimelineData = {
    asOf: '2026-03-02',
    rows: [
        item('w1', 1, { startDate: '2026-03-02', dueDate: '2026-03-03' }),
        item('w2', 2, { startDate: '2026-03-04', dueDate: '2026-03-05', version: 7 }),
        item('w3', 3, { startDate: '2026-03-02', dueDate: '2026-03-02', stateCategory: 'DONE', actualStart: '2026-03-02', actualFinish: '2026-03-02' }),
    ],
    edges: [{ id: 'rel1', fromId: 'w1', toId: 'w2' }],
    calendars: [{ id: 'cal-ws', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
    milestones: [],
    projects: [{ id: PROJECT, name: 'Islestone', keyPrefix: 'ISL', dueDate: null, archived: false }],
    hiddenDependencies: 0,
    omittedContextRows: 0,
};
const RESPONSE = { ...DATA, schedule: computeTimelineSchedule(DATA) };
const ROUTE = 'GET /work-items/timeline';

function Harness({ canEdit = true }: { canEdit?: boolean }) {
    const [mode, setMode] = useState<TimelineMode>('table');
    const [settings, setSettings] = useState<TimelineSettings>(DEFAULT_TIMELINE_SETTINGS);
    return (
        <TimelineView
            filters={{ projectId: PROJECT }}
            scopeProjectId={PROJECT}
            settings={settings}
            onSettingsChange={setSettings}
            mode={mode}
            onModeChange={setMode}
            onOpen={onOpen}
            canEdit={canEdit}
        />
    );
}
const onOpen = jest.fn();
beforeEach(() => onOpen.mockReset());

/** Pick a day in the open date picker by its trigger's id (the picker opens on the value's month). */
async function pickDay(triggerId: string, day: RegExp) {
    fireEvent.click(document.getElementById(triggerId)!);
    const button = await screen.findByRole('button', { name: day });
    fireEvent.click(button);
}

async function openChangeDates(key: string) {
    const table = await screen.findByTestId('timeline-schedule-table');
    await within(table).findByText('Item 2');
    fireEvent.click(within(table).getByRole('button', { name: `Change dates for ${key}` }));
    return screen.findByTestId('change-dates-dialog');
}

describe('changing dates from the schedule table', () => {
    it('previews the change, offers the items it pushes later unticked, and sends the PATCH with If-Match', async () => {
        const saved = detail(listRow(1, { id: 'w1', startDate: '2026-03-02', dueDate: '2026-03-06', version: 5 }));
        const { calls } = installFetch({ [ROUTE]: { body: RESPONSE }, 'PATCH /work-items/w1': { body: saved } });
        renderWorkspace(<Harness />);
        const dialog = await openChangeDates('ISL-1');
        expect(screen.getAllByRole('heading', { name: 'Change dates for ISL-1' }).length).toBeGreaterThan(0);
        // Nothing changed yet: nothing to confirm.
        expect(screen.getByRole('button', { name: 'Change dates' })).toBeDisabled();
        await pickDay('change-dates-due', /^Friday, March 6th, 2026/);
        // ISL-2 now starts before ISL-1 finishes: it moves, and may be pushed later.
        const effects = await within(dialog).findByTestId('change-dates-effects');
        const moved = within(effects).getByRole('region', { name: 'Earliest start moves' });
        expect(within(moved).getByText('ISL-2')).toBeInTheDocument();
        expect(within(moved).getByText('3 working days later')).toBeInTheDocument();
        const also = within(dialog).getByRole('checkbox', { name: 'Also move the 1 item it pushes later' });
        expect(also).not.toBeChecked();
        expect(await axe(document.body)).toHaveNoViolations();
        fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
        const patch = calls.find((c) => c.method === 'PATCH')!;
        expect(patch.path).toBe('/work-items/w1');
        expect(patch.body).toEqual({ startDate: '2026-03-02', dueDate: '2026-03-06' });
        expect(patch.ifMatch).toBe('"4"');
        expect(calls.some((c) => c.path === '/work-items/bulk/dates')).toBe(false);
    });

    it('ticked, holds the change behind the undo toast and sends every version when the window closes', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const { calls } = installFetch({
                [ROUTE]: { body: RESPONSE },
                'POST /work-items/bulk/dates': {
                    body: { rescheduleId: 'r1', items: [{ id: 'w1', version: 5, startDate: '2026-03-02', dueDate: '2026-03-06' }, { id: 'w2', version: 8, startDate: '2026-03-09', dueDate: '2026-03-10' }] },
                },
            });
            renderWorkspace(<Harness />);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(50);
            });
            const dialog = await openChangeDates('ISL-1');
            await pickDay('change-dates-due', /^Friday, March 6th, 2026/);
            fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Also move the 1 item it pushes later' }));
            fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
            expect(await screen.findByText('Moving ISL-1 and 1 item.')).toBeInTheDocument();
            expect(calls.some((c) => c.method === 'POST')).toBe(false);
            await act(async () => {
                await jest.advanceTimersByTimeAsync(5_100);
            });
            const post = calls.filter((c) => c.method === 'POST' && c.path === '/work-items/bulk/dates');
            expect(post).toHaveLength(1);
            expect(post[0]!.body).toEqual({
                dragged: { id: 'w1', version: 4, startDate: '2026-03-02', dueDate: '2026-03-06' },
                pushed: [{ id: 'w2', version: 7, startDate: '2026-03-09', dueDate: '2026-03-10' }],
            });
        } finally {
            jest.useRealTimers();
        }
    });

    it('Undo sends nothing and puts the dates back', async () => {
        const { calls } = installFetch({ [ROUTE]: { body: RESPONSE } });
        renderWorkspace(<Harness />);
        const dialog = await openChangeDates('ISL-1');
        await pickDay('change-dates-due', /^Friday, March 6th, 2026/);
        fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Also move the 1 item it pushes later' }));
        fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
        const table = screen.getByTestId('timeline-schedule-table');
        // The new dates show at once.
        await waitFor(() => expect(within(within(table).getByText('Item 2').closest('tr')!).getAllByText(/^(9 Mar 2026|Mar 9, 2026)$/).length).toBeGreaterThan(0));
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(within(within(table).getByText('Item 2').closest('tr')!).queryAllByText(/^(9 Mar 2026|Mar 9, 2026)$/)).toHaveLength(0));
        expect(within(within(table).getByText('Item 2').closest('tr')!).getAllByText(/^(4 Mar 2026|Mar 4, 2026)$/).length).toBeGreaterThan(0);
        expect(calls.some((c) => c.method !== 'GET')).toBe(false);
    });

    it('refuses the option above 100 items, with the count, never cutting the set', () => {
        const n = 105;
        const rows = Array.from({ length: n }, (_, i) => item(`i${String(i).padStart(3, '0')}`, i + 1, { startDate: fromEpochDay(toEpochDay('2026-03-02') + i), dueDate: fromEpochDay(toEpochDay('2026-03-02') + i) }));
        const data: TimelineData = {
            ...DATA,
            rows,
            edges: rows.slice(1).map((r, i) => ({ id: `e${i}`, fromId: rows[i]!.id, toId: r.id })),
            calendars: [{ id: 'cal-ws', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5, 6, 7], holidays: [] }],
        };
        renderWorkspace(
            <ChangeDatesDialog
                data={{ ...data, schedule: computeTimelineSchedule(data) }}
                row={rows[0]!}
                proposed={{ startDate: '2026-03-04', dueDate: '2026-03-04' }}
                hiddenDates={() => ({ startDate: false, dueDate: false })}
                onCancel={() => {}}
                onConfirm={() => {}}
                onOpen={() => {}}
            />,
        );
        expect(screen.getByRole('checkbox', { name: 'Also move the 104 items it pushes later' })).toBeDisabled();
        expect(screen.getByTestId('change-dates-over-limit')).toHaveTextContent('105 items would move; move fewer at a time (at most 100 at once).');
    });

    it('offers no change to a caller who does not edit work items, nor on a done item', async () => {
        installFetch({ [ROUTE]: { body: RESPONSE } });
        const { unmount } = renderWorkspace(<Harness />);
        const table = await screen.findByTestId('timeline-schedule-table');
        await within(table).findByText('Item 3');
        expect(within(table).queryByRole('button', { name: 'Change dates for ISL-3' })).toBeNull();
        unmount();
        renderWorkspace(<Harness canEdit={false} />);
        const readOnly = await screen.findByTestId('timeline-schedule-table');
        await within(readOnly).findByText('Item 1');
        expect(within(readOnly).queryByRole('button', { name: /Change dates|Dependencies/ })).toBeNull();
    });
});

describe('dependencies from the schedule table', () => {
    it('lists them, removes one through the undo toast and adds one through the relation route', async () => {
        const { calls } = installFetch({
            [ROUTE]: { body: RESPONSE },
            'POST /work-items/w2/relations': { status: 201, body: { id: 'rel2', type: 'BLOCKS', fromId: 'w2', toId: 'w3' } },
        });
        renderWorkspace(<Harness />);
        const table = await screen.findByTestId('timeline-schedule-table');
        await within(table).findByText('Item 2');
        fireEvent.click(within(table).getByRole('button', { name: 'Dependencies of ISL-2' }));
        const dialog = await screen.findByTestId('dependencies-dialog');
        const blockedBy = within(dialog).getByRole('region', { name: 'Blocked by' });
        expect(within(blockedBy).getByText('ISL-1')).toBeInTheDocument();
        expect(await axe(document.body)).toHaveNoViolations();

        // Adding names the relation before it is sent, and shows the server's refusal.
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Relation' }));
        fireEvent.click(await screen.findByRole('option', { name: 'ISL-2 blocks' }));
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Work item' }));
        fireEvent.click(await screen.findByRole('option', { name: 'ISL-3 Item 3' }));
        expect(within(dialog).getByTestId('dependencies-question')).toHaveTextContent('ISL-2 blocks ISL-3?');
        fireEvent.click(screen.getByRole('button', { name: 'Add dependency' }));
        await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.path).toBe('/work-items/w2/relations'));
        expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ type: 'BLOCKS', toId: 'w3' });

        // Removal leaves through the undo toast: nothing is sent while it shows.
        fireEvent.click(within(blockedBy).getByRole('button', { name: 'Remove: ISL-1 blocks ISL-2' }));
        expect(await screen.findByText('Dependency removed: ISL-1 blocks ISL-2.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('shows the relation route\'s refusal of a cycle', async () => {
        installFetch({
            [ROUTE]: { body: RESPONSE },
            'POST /work-items/w3/relations': { status: 409, body: { error: { code: 'CONFLICT', message: 'That relation would create a dependency cycle.', details: { reason: 'RELATION_WOULD_CYCLE' } } } },
        });
        renderWorkspace(<Harness />);
        const table = await screen.findByTestId('timeline-schedule-table');
        await within(table).findByText('Item 1');
        fireEvent.click(within(table).getByRole('button', { name: 'Dependencies of ISL-1' }));
        const dialog = await screen.findByTestId('dependencies-dialog');
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Work item' }));
        fireEvent.click(await screen.findByRole('option', { name: 'ISL-3 Item 3' }));
        // ISL-1 is blocked by ISL-3 (the default direction).
        expect(within(dialog).getByTestId('dependencies-question')).toHaveTextContent('ISL-3 blocks ISL-1?');
        fireEvent.click(screen.getByRole('button', { name: 'Add dependency' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('That relation would create a dependency cycle.');
    });
});
