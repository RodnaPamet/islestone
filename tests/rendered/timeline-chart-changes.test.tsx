/** @jest-environment jsdom */

/**
 * The chart's changes (roadmap 3.1c; decisions 194 and 195): the widget is
 * replaced by a stand-in that records what the adapter gives it and hands
 * the adapter's `init` a recording API, so each intercepted action can be
 * driven as the widget would at the end of a drag:
 *
 *   - a dropped bar's `update-task` is refused (the widget applies nothing),
 *     opens "Change dates" with the dates the drop proposes on the item's
 *     working calendar, and the bars are drawn again from the cached rows
 *     (a fresh tasks array with the item where it was);
 *   - a done item's bar cannot be dragged and opens nothing;
 *   - an end-to-start link opens "ISL-2 blocks ISL-1?"; another type is
 *     refused with a sentence; a link's delete goes through the undo toast;
 *   - a caller who does not edit work items gets a read-only widget.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

type Handler = (ev: Record<string, unknown>) => unknown;
const widget = {
    intercepts: new Map<string, Handler>(),
    renders: [] as Array<{ tasks: Array<{ id: string; start: Date }>; readonly: boolean }>,
};

jest.mock('@svar-ui/react-gantt', () => {
    const { useEffect } = jest.requireActual<{ useEffect: (fn: () => void, deps: unknown[]) => void }>('react');
    return {
        __esModule: true,
        Willow: ({ children }: { children: unknown }) => children,
        Gantt: (props: { tasks: Array<{ id: string; start: Date }>; readonly: boolean; init: (api: unknown) => void }) => {
            widget.renders.push({ tasks: props.tasks, readonly: props.readonly });
            useEffect(() => {
                props.init({
                    intercept: (action: string, fn: Handler) => widget.intercepts.set(action, fn),
                    on: () => undefined,
                });
                // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the widget calls init
            }, []);
            return null;
        },
    };
});
jest.mock('@svar-ui/react-gantt/style.css', () => ({}), { virtual: true });
jest.mock('@svar-ui/react-grid/style.css', () => ({}), { virtual: true });

import { DEFAULT_TIMELINE_SETTINGS, TimelineView, type TimelineMode, type TimelineSettings } from '@/components/work-items/timeline/TimelineView';
import { computeTimelineSchedule, type TimelineData, type TimelineRow } from '@/lib/work-items/timeline';

import { installFetch, PROJECT, renderWorkspace, TEAM } from '../helpers/work-items-harness';

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
        version: 2,
        context: false,
        ...over,
    };
}

const DATA: TimelineData = {
    asOf: '2026-03-02',
    rows: [
        item('w1', 1, { startDate: '2026-03-02', dueDate: '2026-03-03' }),
        item('w2', 2, { startDate: '2026-03-04', dueDate: '2026-03-05' }),
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

function Harness({ canEdit }: { canEdit: boolean }) {
    const [mode, setMode] = useState<TimelineMode>('chart');
    const [settings, setSettings] = useState<TimelineSettings>({ ...DEFAULT_TIMELINE_SETTINGS, zoom: 'day' });
    return (
        <TimelineView
            filters={{ projectId: PROJECT }}
            scopeProjectId={PROJECT}
            settings={settings}
            onSettingsChange={setSettings}
            mode={mode}
            onModeChange={setMode}
            onOpen={() => {}}
            canEdit={canEdit}
        />
    );
}

beforeEach(() => {
    widget.intercepts.clear();
    widget.renders.length = 0;
});

async function mounted() {
    await waitFor(() => expect(widget.intercepts.has('update-task')).toBe(true));
    return (action: string, ev: Record<string, unknown>) => {
        let answer: unknown;
        act(() => {
            answer = widget.intercepts.get(action)!(ev);
        });
        return answer;
    };
}

describe('the chart, for a caller who edits work items', () => {
    it('refuses a dropped bar, draws it again where it was and opens "Change dates" with the proposed dates', async () => {
        installFetch({ 'GET /work-items/timeline': { body: RESPONSE } });
        renderWorkspace(<Harness canEdit />);
        const exec = await mounted();
        expect(widget.renders.at(-1)!.readonly).toBe(false);
        const before = widget.renders.at(-1)!.tasks;
        // Moved three days: Mon 2 – Tue 3 March becomes Thu 5 – Fri 6 March (two working days).
        expect(exec('update-task', { id: 'w1', diff: 3, task: { start: new Date(2026, 2, 2), end: new Date(2026, 2, 4) } })).toBe(false);
        expect((await screen.findAllByRole('heading', { name: 'Change dates for ISL-1' })).length).toBeGreaterThan(0);
        expect(document.getElementById('change-dates-start')).toHaveTextContent(/5 Mar 2026|Mar 5, 2026/);
        expect(document.getElementById('change-dates-due')).toHaveTextContent(/6 Mar 2026|Mar 6, 2026/);
        // The widget is handed a fresh array: the bar is drawn from the cached row, not where the drag left it.
        await waitFor(() => expect(widget.renders.at(-1)!.tasks).not.toBe(before));
        const w1 = widget.renders.at(-1)!.tasks.find((t) => t.id === 'w1')!;
        expect([w1.start.getFullYear(), w1.start.getMonth(), w1.start.getDate()]).toEqual([2026, 2, 2]);
    });

    it('a done bar cannot be dragged, and its drop opens nothing', async () => {
        installFetch({ 'GET /work-items/timeline': { body: RESPONSE } });
        renderWorkspace(<Harness canEdit />);
        const exec = await mounted();
        expect(exec('drag-task', { id: 'w3', left: 10, inProgress: true })).toBe(false);
        expect(exec('drag-task', { id: 'w1', left: 10, inProgress: true })).toBe(true);
        expect(exec('update-task', { id: 'w3', diff: 2, task: { start: new Date(), end: new Date() } })).toBe(false);
        // A progress drag (no diff) is refused too, with nothing opened.
        expect(exec('update-task', { id: 'w1', task: { progress: 40 }, inProgress: false })).toBe(false);
        expect(screen.queryByTestId('change-dates-dialog')).toBeNull();
    });

    it('asks before adding a drawn end-to-start dependency, refuses another type, and removes one through the undo toast', async () => {
        const { calls } = installFetch({ 'GET /work-items/timeline': { body: RESPONSE } });
        renderWorkspace(<Harness canEdit />);
        const exec = await mounted();
        expect(exec('add-link', { link: { source: 'w2', target: 'w1', type: 's2s' } })).toBe(false);
        expect(await screen.findByText(/Draw a dependency from the end of one bar to the start of the next/)).toBeInTheDocument();
        expect(exec('add-link', { link: { source: 'w2', target: 'w1', type: 'e2s' } })).toBe(false);
        expect(await screen.findByTestId('add-dependency-question')).toHaveTextContent('ISL-2 blocks ISL-1?');
        expect(calls.some((c) => c.method === 'POST')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(exec('delete-link', { id: 'rel1' })).toBe(false);
        expect(await screen.findByText('Dependency removed: ISL-1 blocks ISL-2.')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    });
});

describe('the chart, for a caller who does not edit work items', () => {
    it('is read-only and opens nothing', async () => {
        installFetch({ 'GET /work-items/timeline': { body: RESPONSE } });
        renderWorkspace(<Harness canEdit={false} />);
        const exec = await mounted();
        expect(widget.renders.at(-1)!.readonly).toBe(true);
        expect(exec('drag-task', { id: 'w1', left: 10 })).toBe(false);
        expect(exec('update-task', { id: 'w1', diff: 3, task: { start: new Date(), end: new Date() } })).toBe(false);
        expect(exec('add-link', { link: { source: 'w2', target: 'w1', type: 'e2s' } })).toBe(false);
        expect(screen.queryByTestId('change-dates-dialog')).toBeNull();
        expect(screen.queryByTestId('add-dependency-question')).toBeNull();
    });
});
