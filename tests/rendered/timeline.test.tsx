/** @jest-environment jsdom */

/**
 * The timeline (roadmap 3.1b): the schedule table shows the engine's numbers
 * (decision 203) with no axe violations; the Chart / Table toggle; the
 * summary line and the critical path; a scope over 5,000 items says so and
 * draws nothing; relations to hidden items are counted; the chart renders
 * the widget with Islestone's critical bars and one CSS rule per critical
 * relation, every editing path shut and no request to the vendor's CDN.
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
        version: 1,
        context: false,
        ...over,
    };
}

const DATA: TimelineData = {
    asOf: '2026-03-02',
    rows: [
        item('w1', 1, { startDate: '2026-03-02', dueDate: '2026-03-03' }),
        item('w2', 2, { startDate: '2026-03-04', dueDate: '2026-03-13' }),
        item('w3', 3, { startDate: '2026-03-02', dueDate: '2026-03-02' }),
        item('w4', 4),
    ],
    edges: [{ id: 'rel1', fromId: 'w1', toId: 'w2' }],
    calendars: [{ id: 'cal-ws', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
    milestones: [],
    projects: [{ id: PROJECT, name: 'Islestone', keyPrefix: 'ISL', dueDate: '2026-03-10', archived: false }],
    hiddenDependencies: 2,
    omittedContextRows: 0,
};
const RESPONSE = { ...DATA, schedule: computeTimelineSchedule(DATA) };
const ROUTE = 'GET /work-items/timeline';

function Harness({ initialMode = 'table' as TimelineMode, initial = DEFAULT_TIMELINE_SETTINGS }: { initialMode?: TimelineMode; initial?: TimelineSettings }) {
    const [mode, setMode] = useState<TimelineMode>(initialMode);
    const [settings, setSettings] = useState<TimelineSettings>(initial);
    return (
        <TimelineView
            filters={{ projectId: PROJECT }}
            scopeProjectId={PROJECT}
            settings={settings}
            onSettingsChange={setSettings}
            mode={mode}
            onModeChange={setMode}
            onOpen={onOpen}
        />
    );
}
const onOpen = jest.fn();

beforeEach(() => onOpen.mockReset());

describe('the schedule table (decision 203)', () => {
    it("shows the same rows with the engine's numbers, the critical path and conflicts, with no axe violations", async () => {
        const { calls } = installFetch({ [ROUTE]: { body: RESPONSE } });
        const { container } = renderWorkspace(<Harness />);
        const table = await screen.findByTestId('timeline-schedule-table');
        await within(table).findByText('Item 2');
        expect(calls.find((c) => c.path === '/work-items/timeline')?.search.get('projectId')).toBe(PROJECT);
        const rowOf = (title: string) => within(table).getByText(title).closest('tr')!;
        // ISL-1 blocks ISL-2, which runs past the project's due date: the chain is critical and late.
        expect(within(rowOf('Item 1')).getByText('Critical')).toBeInTheDocument();
        expect(within(rowOf('Item 2')).getByText(/Late by \d+ days?/)).toBeInTheDocument();
        expect(within(rowOf('Item 2')).getByText("Misses the project's due date")).toBeInTheDocument();
        expect(within(rowOf('Item 3')).queryByText('Critical')).toBeNull();
        expect(within(rowOf('Item 3')).getByText(/days of float/)).toBeInTheDocument();
        // The summary line and the notice for relations to hidden items.
        const summary = screen.getByTestId('timeline-summary');
        expect(summary).toHaveTextContent('Finishes on');
        expect(summary).toHaveTextContent('2 items on the critical path');
        expect(summary).toHaveTextContent('Due');
        expect(summary).toHaveTextContent(/late by 3 days/);
        expect(screen.getByText('2 dependencies to items you cannot see are not shown.')).toBeInTheDocument();
        // The shared table's row-chevron column has an empty header by design (the mirrored DataTable; every list's test skips the rule).
        expect(await axe(container, { rules: { 'empty-table-header': { enabled: false } } })).toHaveNoViolations();
    });

    it('opens the item a row names, and the critical path switched off marks nothing', async () => {
        installFetch({ [ROUTE]: { body: RESPONSE } });
        renderWorkspace(<Harness />);
        const table = await screen.findByTestId('timeline-schedule-table');
        fireEvent.click(await within(table).findByText('Item 1'));
        expect(onOpen).toHaveBeenCalledWith('w1');
        fireEvent.click(screen.getByRole('switch', { name: 'Critical path' }));
        await waitFor(() => expect(within(table).queryByText('Critical')).toBeNull());
        expect(screen.getByTestId('timeline-summary')).not.toHaveTextContent('critical path');
    });

    it('says "Add dates to see the critical path" rather than inventing one', async () => {
        const undated: TimelineData = { ...DATA, rows: [item('w4', 4)], edges: [], hiddenDependencies: 0, projects: [{ ...DATA.projects[0]!, dueDate: null }] };
        installFetch({ [ROUTE]: { body: { ...undated, schedule: computeTimelineSchedule(undated) } } });
        renderWorkspace(<Harness />);
        expect(await screen.findByText('Add dates to see the critical path.')).toBeInTheDocument();
    });

    it('a scope over 5,000 items asks to narrow the filter and draws nothing', async () => {
        installFetch({
            [ROUTE]: { status: 422, body: { error: { code: 'TIMELINE_TOO_LARGE', message: 'too large', details: { reason: 'TIMELINE_TOO_LARGE', count: 7214, limit: 5000, what: 'items' } } } },
        });
        renderWorkspace(<Harness />);
        expect(await screen.findByTestId('timeline-too-large')).toHaveTextContent('Narrow the filter: 7,214 items match, and a timeline shows at most 5000.');
        expect(screen.queryByTestId('timeline-schedule-table')).toBeNull();
    });
});

describe('the chart (the widget, read-only)', () => {
    // jsdom has no canvas; the widget measures text with one. A 2D context
    // whose every method is a no-op (and measureText a fixed width).
    const original = HTMLCanvasElement.prototype.getContext;
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const SIZES = { clientWidth: 1600, clientHeight: 900, offsetWidth: 1600, offsetHeight: 900 };
    const saved: Record<string, PropertyDescriptor | undefined> = {};
    let savedObserver: typeof ResizeObserver;
    beforeAll(() => {
        const ctx2d = new Proxy({} as Record<string, unknown>, {
            get: (target, prop) => (prop in target ? target[prop as string] : prop === 'measureText' ? (t: string) => ({ width: t.length * 7 }) : () => undefined),
            set: (target, prop, value) => {
                target[prop as string] = value;
                return true;
            },
        });
        HTMLCanvasElement.prototype.getContext = (() => ctx2d) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
        // jsdom lays nothing out: give every element a size, and a ResizeObserver
        // that reports once, so the widget's virtual window holds the rows.
        for (const [prop, value] of Object.entries(SIZES)) {
            saved[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
            Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
        }
        savedObserver = window.ResizeObserver;
        window.ResizeObserver = class {
            constructor(private cb: ResizeObserverCallback) {}
            observe(target: Element) {
                // A real observer reports after layout, never inside the render that observes.
                queueMicrotask(() => this.cb([{ target, contentRect: { width: SIZES.clientWidth, height: SIZES.clientHeight } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
            }
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
    });
    afterAll(() => {
        HTMLCanvasElement.prototype.getContext = original;
        HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
        for (const [prop, desc] of Object.entries(saved)) {
            if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc);
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
        }
        window.ResizeObserver = savedObserver;
    });

    it('renders the widget with critical bars, one CSS rule per critical relation and the "No dates" list, and switches to the table', async () => {
        installFetch({ [ROUTE]: { body: RESPONSE } });
        const { container } = renderWorkspace(<Harness initialMode="chart" initial={{ ...DEFAULT_TIMELINE_SETTINGS, zoom: 'day' }} />);
        const region = await screen.findByRole('region', { name: 'Timeline chart' });
        expect(region).toHaveAccessibleDescription(/schedule table shows the same rows/);
        // The adapter loads through next/dynamic.
        await waitFor(() => expect(container.querySelector('.isl-timeline')).not.toBeNull());
        const style = container.querySelector('.isl-timeline > style')!;
        expect(style.textContent).toBe('.isl-timeline [data-link-id=":rel1"] .wx-line-draw{stroke:var(--isl-timeline-critical);stroke-width:2.5}');
        // The rule names a link the widget draws with that attribute.
        await waitFor(() => expect(container.querySelector('[data-link-id=":rel1"]')).not.toBeNull());
        const critical = [...container.querySelectorAll('.isl-timeline-bar[data-critical="true"]')].map((b) => b.textContent);
        expect(critical).toEqual(expect.arrayContaining(['Item 1', 'Item 2']));
        expect(critical).not.toContain('Item 3');
        // No editor, toolbar or menu, and nothing from the vendor's CDN.
        expect(container.querySelector('.wx-editor, .wx-toolbar, .wx-menu')).toBeNull();
        expect(document.querySelector('link[href*="cdn.svar.dev"]')).toBeNull();
        // Choosing a bar opens the item; a double click opens no editor (show-editor is refused).
        const bar = [...container.querySelectorAll('.isl-timeline-bar')].find((b) => b.textContent === 'Item 1')!;
        fireEvent.mouseDown(bar);
        fireEvent.mouseUp(bar);
        fireEvent.click(bar);
        fireEvent.dblClick(bar);
        await waitFor(() => expect(onOpen).toHaveBeenCalledWith('w1'));
        expect(container.querySelector('.wx-editor, .wx-sidearea, [role="dialog"]')).toBeNull();
        // The undated item is listed beside the chart.
        expect(within(screen.getByTestId('timeline-no-dates')).getByText('Item 4')).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
        });
        expect(await screen.findByTestId('timeline-schedule-table')).toBeInTheDocument();
    });
});
