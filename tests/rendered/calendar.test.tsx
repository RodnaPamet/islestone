/** @jest-environment jsdom */

/**
 * The calendar view (roadmap 3.3a; owner decisions 241 and 242).
 *
 * The month grid's own behaviour, ported with it from inflect-compliance's
 * `tests/rendered/calendar-views.test.tsx` (`<CalendarMonth />` block, at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; rewritten to Islestone's chips):
 * seven weekday headers from the week start and a fixed 6×7 grid; chips with
 * "+N more" past the cap; today marked; a day selected by a click anywhere
 * in its cell outside a chip, by Enter, never by a chip; the cursor only
 * when the grid selects; plus the roving tabindex and arrow, Home and End
 * keys.
 *
 * The view over its read: chips on their due dates, closed ones struck, the
 * summary line counting undated items and naming what is omitted, holidays
 * and non-working days shaded, milestone and project due-date diamonds
 * linking to them, cycle bands; the day panel; "Move to date…" (the keyboard
 * path) opening 3.1c's "Change dates" with the due date and start moved by
 * the same number of days, the preview over the project's timeline, and the
 * PATCH with If-Match; a parent whose dates follow its sub-items refused with
 * a sentence; a caller who does not edit work items offered no move; a too
 * large window asks to narrow the filter; no axe violations.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/projects/ISL',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { CalendarMonth, type CalendarMonthProps } from '@/components/work-items/calendar/CalendarMonth';
import { CalendarView, DEFAULT_CALENDAR_SETTINGS, type CalendarSettings } from '@/components/work-items/calendar/CalendarView';
import { itemsByDay } from '@/components/work-items/calendar/calendar-model';
import type { CalendarItem, CalendarResponse } from '@/lib/work-items/calendar';
import { computeTimelineSchedule, type TimelineData, type TimelineRow } from '@/lib/work-items/timeline';

import { detail, installFetch, PROJECT, renderWorkspace, row as listRow, TEAM } from '../helpers/work-items-harness';

function item(id: string, n: number, over: Partial<CalendarItem> = {}): CalendarItem {
    return {
        id,
        key: `ISL-${n}`,
        title: `Item ${n}`,
        projectId: PROJECT,
        teamId: TEAM,
        typeId: 'ty-feature',
        stateCategory: 'UNSTARTED',
        assigneeId: null,
        parentId: null,
        cycleId: null,
        milestoneId: null,
        startDate: null,
        dueDate: '2026-03-03',
        version: 4,
        ...over,
    };
}

const MONTH = new Date('2026-03-01T00:00:00Z');
const WINDOW = { from: '2026-02-23', to: '2026-04-05' };

// ─── The ported grid ────────────────────────────────────────────────────

function grid(over: Partial<CalendarMonthProps> = {}) {
    const props: CalendarMonthProps = {
        month: MONTH,
        todayYmd: '2026-03-04',
        items: new Map(),
        cycles: new Map(),
        markers: new Map(),
        dayKind: () => null,
        onOpenItem: jest.fn(),
        movable: new Set(),
        onMoveRequest: jest.fn(),
        onDropItem: jest.fn(),
        markerHref: () => '/t/acme/projects/ISL',
        ...over,
    };
    return renderWorkspace(<CalendarMonth {...props} />);
}

describe('<CalendarMonth /> (ported)', () => {
    it('renders 7 weekday headers from the week start and a fixed 6×7 day grid', () => {
        grid();
        const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
        expect(headers).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        expect(screen.getAllByRole('gridcell')).toHaveLength(42);
        expect(screen.getAllByRole('row')).toHaveLength(7);
        expect(screen.getByRole('grid', { name: 'March 2026' })).toBeInTheDocument();
    });

    it('renders one chip per item and respects the cap with "+N more"', () => {
        const items = Array.from({ length: 5 }, (_, i) => item(`w${i}`, i + 1));
        const { container } = grid({ items: itemsByDay(items, WINDOW) });
        const cell = container.querySelector('[data-ymd="2026-03-03"]')!;
        expect(cell.querySelectorAll('[data-item-id]')).toHaveLength(3);
        expect(cell.textContent).toMatch(/\+2 more/);
        expect(cell.getAttribute('aria-label')).toMatch(/5 items due/);
    });

    it('marks today with aria-current and data-today', () => {
        const { container } = grid();
        const today = container.querySelector('[data-today="true"]');
        expect(today?.getAttribute('data-ymd')).toBe('2026-03-04');
        expect(today?.getAttribute('aria-current')).toBe('date');
    });

    it('selects a day by a click anywhere in its cell, not by a chip, which opens the item', () => {
        const onSelectDate = jest.fn();
        const onOpenItem = jest.fn();
        const { container } = grid({ onSelectDate, onOpenItem, items: itemsByDay([item('w1', 1)], WINDOW) });
        fireEvent.click(container.querySelector('[data-ymd="2026-03-10"]')!);
        expect(onSelectDate).toHaveBeenCalledWith('2026-03-10');
        onSelectDate.mockReset();
        fireEvent.click(screen.getByRole('button', { name: /ISL-1 Item 1/ }));
        expect(onSelectDate).not.toHaveBeenCalled();
        expect(onOpenItem).toHaveBeenCalledWith('w1');
    });

    it('keeps one cell tabbable and moves it with the arrow, Home and End keys; Enter selects', () => {
        const onSelectDate = jest.fn();
        const { container } = grid({ onSelectDate });
        const tabbable = () => [...container.querySelectorAll('[role="gridcell"][tabindex="0"]')].map((c) => c.getAttribute('data-ymd'));
        expect(tabbable()).toEqual(['2026-03-04']);
        const today = container.querySelector<HTMLElement>('[data-ymd="2026-03-04"]')!;
        today.focus();
        fireEvent.keyDown(today, { key: 'ArrowRight' });
        expect(document.activeElement?.getAttribute('data-ymd')).toBe('2026-03-05');
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement?.getAttribute('data-ymd')).toBe('2026-03-12');
        fireEvent.keyDown(document.activeElement!, { key: 'Home' });
        expect(document.activeElement?.getAttribute('data-ymd')).toBe('2026-03-09');
        fireEvent.keyDown(document.activeElement!, { key: 'End' });
        expect(document.activeElement?.getAttribute('data-ymd')).toBe('2026-03-15');
        expect(tabbable()).toEqual(['2026-03-15']);
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
        expect(onSelectDate).toHaveBeenCalledWith('2026-03-15');
    });

    it('shows the cursor only when the grid selects days (a read-only grid has none)', () => {
        const { container, unmount } = grid({ onSelectDate: () => undefined });
        expect(container.querySelector('[data-ymd="2026-03-10"]')?.className).toContain('cursor-pointer');
        unmount();
        const { container: readOnly } = grid();
        expect(readOnly.querySelector('[data-ymd="2026-03-10"]')?.className).not.toContain('cursor-pointer');
    });

    it('offers "Move to date…" beside a movable chip only', () => {
        const onMoveRequest = jest.fn();
        const { container } = grid({ items: itemsByDay([item('w1', 1), item('w2', 2)], WINDOW), movable: new Set(['w1']), onMoveRequest });
        expect(screen.queryByRole('button', { name: 'Move ISL-2 to date…' })).toBeNull();
        expect(container.querySelector('[data-item-id="w1"]')!.getAttribute('data-movable')).toBe('true');
        expect(container.querySelector('[data-item-id="w2"]')!.hasAttribute('data-movable')).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Move ISL-1 to date…' }));
        expect(onMoveRequest).toHaveBeenCalledWith('w1');
    });
});

// ─── The view ───────────────────────────────────────────────────────────

const CALENDAR: CalendarResponse = {
    ...WINDOW,
    asOf: '2026-03-04',
    items: [
        item('w1', 1, { startDate: '2026-03-02', dueDate: '2026-03-03' }),
        item('w2', 2, { dueDate: '2026-03-05', version: 7 }),
        item('w3', 3, { dueDate: '2026-03-03', stateCategory: 'DONE' }),
    ],
    noDueDate: 37,
    cycles: [{ id: 'cy1', teamId: TEAM, number: 12, name: null, startsOn: '2026-03-02', endsOn: '2026-03-15' }],
    milestones: [{ id: 'ms1', projectId: PROJECT, name: 'Beta', dueDate: '2026-03-20' }],
    projects: [{ id: PROJECT, name: 'Islands', keyPrefix: 'ISL', dueDate: '2026-03-31', archived: false }],
    calendar: { id: 'cal-1', teamId: TEAM, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: ['2026-03-03'] },
    omitted: [],
    truncated: [],
};

function tlRow(id: string, n: number, over: Partial<TimelineRow> = {}): TimelineRow {
    return {
        id,
        key: `ISL-${n}`,
        title: `Item ${n}`,
        projectId: PROJECT,
        teamId: TEAM,
        typeId: 'ty-feature',
        stateCategory: 'UNSTARTED',
        assigneeId: null,
        parentId: null,
        sortKey: `a${n}`,
        startDate: null,
        dueDate: null,
        actualStart: null,
        actualFinish: null,
        milestoneId: null,
        calendarId: 'cal-1',
        version: 4,
        context: false,
        ...over,
    };
}

const TIMELINE_DATA: TimelineData = {
    asOf: '2026-03-04',
    rows: [tlRow('w1', 1, { startDate: '2026-03-02', dueDate: '2026-03-03' }), tlRow('w2', 2, { startDate: '2026-03-04', dueDate: '2026-03-05', version: 7 })],
    edges: [{ id: 'rel1', fromId: 'w1', toId: 'w2' }],
    calendars: [{ id: 'cal-1', teamId: TEAM, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
    milestones: [],
    projects: [{ id: PROJECT, name: 'Islands', keyPrefix: 'ISL', dueDate: null, archived: false }],
    hiddenDependencies: 0,
    omittedContextRows: 0,
};
const TIMELINE = { ...TIMELINE_DATA, schedule: computeTimelineSchedule(TIMELINE_DATA) };

const onOpen = jest.fn();
beforeEach(() => onOpen.mockReset());

function Harness({ canEdit = true }: { canEdit?: boolean }) {
    const [settings, setSettings] = useState<CalendarSettings>(DEFAULT_CALENDAR_SETTINGS);
    return <CalendarView filters={{ projectId: PROJECT }} settings={settings} onSettingsChange={setSettings} onOpen={onOpen} canEdit={canEdit} initialMonth={MONTH} />;
}

async function pickDay(triggerId: string, day: RegExp) {
    fireEvent.click(document.getElementById(triggerId)!);
    fireEvent.click(await screen.findByRole('button', { name: day }));
}

describe('the calendar view', () => {
    it('reads the grid window with the list filters and draws items, markers, bands and shading', async () => {
        const { calls } = installFetch({ 'GET /work-items/calendar': { body: CALENDAR } });
        const { container } = renderWorkspace(<Harness />);
        const view = await screen.findByTestId('calendar-view');
        await within(view).findByRole('button', { name: /ISL-1 Item 1/ });
        const read = calls.find((c) => c.path === '/work-items/calendar')!;
        expect(Object.fromEntries(read.search)).toEqual({ projectId: PROJECT, from: '2026-02-23', to: '2026-04-05' });
        expect(screen.getByRole('heading', { name: 'March 2026', level: 2 })).toBeInTheDocument();
        // The summary line counts what is shown and what has no due date.
        expect(screen.getByTestId('calendar-summary').textContent).toBe('3 items due in these weeks · 37 items have no due date');
        // A closed item is struck through; a holiday and a weekend are shaded and said.
        const done = screen.getByRole('button', { name: /ISL-3 Item 3, Done/ });
        expect(done.className).toContain('line-through');
        const holiday = container.querySelector('[data-ymd="2026-03-03"]')!;
        expect(holiday.getAttribute('data-day-kind')).toBe('holiday');
        expect(holiday.getAttribute('aria-label')).toMatch(/2 items due, Cycle 12, holiday$/);
        expect(container.querySelector('[data-ymd="2026-03-07"]')!.getAttribute('data-day-kind')).toBe('nonWorking');
        // Diamonds link to the milestone and the project.
        expect(screen.getByRole('link', { name: 'milestone Beta due' })).toHaveAttribute('href', '/t/acme/projects/ISL/milestones/ms1');
        expect(screen.getByRole('link', { name: 'project Islands due' })).toHaveAttribute('href', '/t/acme/projects/ISL');
        // The cycle band starts on its first day and on each week's first day.
        expect(container.querySelector('[data-ymd="2026-03-02"] [data-cycle-band="cy1"]')!.textContent).toBe('Cycle 12');
        expect(container.querySelector('[data-ymd="2026-03-09"] [data-cycle-band="cy1"]')!.textContent).toBe('Cycle 12');
        expect(container.querySelector('[data-ymd="2026-03-10"] [data-cycle-band="cy1"]')!.textContent?.trim()).toBe('');
        expect(await axe(document.body)).toHaveNoViolations();
    });

    it('switches cycle bands and markers off, and moves between months', async () => {
        const { calls } = installFetch({ 'GET /work-items/calendar': { body: CALENDAR } });
        const { container } = renderWorkspace(<Harness />);
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        fireEvent.click(screen.getByRole('switch', { name: 'Cycles' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Milestones and due dates' }));
        expect(container.querySelector('[data-cycle-band]')).toBeNull();
        expect(screen.queryByRole('link', { name: 'milestone Beta due' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
        await waitFor(() => expect(calls.some((c) => c.search.get('from') === '2026-03-30' && c.search.get('to') === '2026-05-10')).toBe(true));
        expect(screen.getByRole('heading', { name: 'April 2026', level: 2 })).toBeInTheDocument();
    });

    it('names what the caller may not see, and asks to narrow a window over the limit', async () => {
        installFetch({ 'GET /work-items/calendar': { body: { ...CALENDAR, omitted: ['cycles'], truncated: ['milestones'] } } });
        const { unmount } = renderWorkspace(<Harness />);
        expect(await screen.findByText(/Cycles are not shown: you cannot see cycles/)).toBeInTheDocument();
        expect(screen.getByText(/Not every milestone is shown/)).toBeInTheDocument();
        unmount();
        installFetch({ 'GET /work-items/calendar': { status: 422, body: { error: { code: 'CALENDAR_TOO_LARGE', message: 'Too many', details: { reason: 'CALENDAR_TOO_LARGE', count: 2311, limit: 2000 } } } } });
        renderWorkspace(<Harness />);
        expect((await screen.findByTestId('calendar-too-large')).textContent).toBe('Narrow the filter: 2,311 items are due in these weeks, and a calendar shows at most 2000.');
    });

    it('opens the day panel, a table of the day, from a cell by keyboard', async () => {
        installFetch({ 'GET /work-items/calendar': { body: CALENDAR } });
        const { container } = renderWorkspace(<Harness />);
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        const cell = container.querySelector<HTMLElement>('[data-ymd="2026-03-03"]')!;
        fireEvent.keyDown(cell, { key: 'Enter' });
        const panel = await screen.findByTestId('calendar-day-panel');
        expect(within(panel).getByRole('heading', { name: 'Due 3 March 2026' })).toBeInTheDocument();
        const table = within(panel).getByTestId('calendar-day-table');
        expect(within(table).getByText('Item 1')).toBeInTheDocument();
        expect(within(table).getByText('Item 3')).toBeInTheDocument();
        // A done item cannot be moved; an open one can.
        expect(within(table).getByRole('button', { name: 'Move ISL-1 to another date' })).toBeInTheDocument();
        expect(within(table).queryByRole('button', { name: 'Move ISL-3 to another date' })).toBeNull();
        fireEvent.click(within(table).getByText('Item 3'));
        expect(onOpen).toHaveBeenCalledWith('w3');
        // The shared DataTable's row-click chevron column has an empty header (a mirrored primitive): excused as every table test does.
        expect(await axe(document.body, { rules: { 'empty-table-header': { enabled: false } } })).toHaveNoViolations();
    });

    it('"Move to date…" opens Change dates with the due date and start moved alike, previews over the project timeline, and sends the PATCH with If-Match', async () => {
        const saved = detail(listRow(1, { id: 'w1', startDate: '2026-03-09', dueDate: '2026-03-10', version: 5 }));
        const { calls } = installFetch({
            'GET /work-items/calendar': { body: CALENDAR },
            'GET /work-items/timeline': { body: TIMELINE },
            'PATCH /work-items/w1': { body: saved },
        });
        const { container } = renderWorkspace(<Harness />);
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        fireEvent.click(screen.getByRole('button', { name: 'Move ISL-1 to date…' }));
        expect(screen.getAllByRole('heading', { name: 'Move ISL-1 to another date' }).length).toBeGreaterThan(0);
        await pickDay('calendar-move-date', /^Tuesday, March 10th, 2026/);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        const dialog = await screen.findByTestId('change-dates-dialog');
        // The project's timeline is the preview's data.
        const tl = calls.find((c) => c.path === '/work-items/timeline')!;
        expect(Object.fromEntries(tl.search)).toEqual({ projectId: PROJECT });
        // Due 3 → 10 March, start 2 → 9 March: seven days each.
        expect(document.getElementById('change-dates-due')!.textContent).toMatch(/10/);
        expect(document.getElementById('change-dates-start')!.textContent).toMatch(/9/);
        expect(within(dialog).getByRole('checkbox', { name: 'Also move the 1 item it pushes later' })).not.toBeChecked();
        expect(await axe(document.body)).toHaveNoViolations();
        fireEvent.click(screen.getByRole('button', { name: 'Change dates' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
        const patch = calls.find((c) => c.method === 'PATCH')!;
        expect(patch.body).toEqual({ startDate: '2026-03-09', dueDate: '2026-03-10' });
        expect(patch.ifMatch).toBe('"4"');
        // The chip moves to its new day in the cached calendar.
        await waitFor(() => expect(container.querySelector('[data-ymd="2026-03-10"] [data-item-id="w1"]')).not.toBeNull());
        expect(container.querySelector('[data-ymd="2026-03-03"] [data-item-id="w1"]')).toBeNull();
    });

    it('refuses a parent whose dates follow its sub-items with a sentence, offering the item', async () => {
        const data: TimelineData = { ...TIMELINE_DATA, rows: [...TIMELINE_DATA.rows, tlRow('w9', 9, { parentId: 'w1', startDate: '2026-03-02', dueDate: '2026-03-03' })] };
        installFetch({ 'GET /work-items/calendar': { body: CALENDAR }, 'GET /work-items/timeline': { body: { ...data, schedule: computeTimelineSchedule(data) } } });
        const { container } = renderWorkspace(<Harness />);
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        // The keyboard path from the day panel: Enter on the day, then "Move to date…" in its row.
        fireEvent.keyDown(container.querySelector<HTMLElement>('[data-ymd="2026-03-03"]')!, { key: 'Enter' });
        fireEvent.click(await screen.findByRole('button', { name: 'Move ISL-1 to another date' }));
        await pickDay('calendar-move-date', /^Tuesday, March 10th, 2026/);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect((await screen.findByTestId('calendar-move-status')).textContent).toBe('The dates of ISL-1 follow its sub-items: change theirs.');
        fireEvent.click(screen.getByRole('button', { name: 'Open the item' }));
        expect(onOpen).toHaveBeenCalledWith('w1');
    });

    it('a project too large to preview is said, never changed without a preview', async () => {
        const { calls } = installFetch({
            'GET /work-items/calendar': { body: CALENDAR },
            'GET /work-items/timeline': { status: 422, body: { error: { code: 'TIMELINE_TOO_LARGE', message: 'Too many', details: { reason: 'TIMELINE_TOO_LARGE', count: 7214, limit: 5000, what: 'items' } } } },
        });
        const { container } = renderWorkspace(<Harness />);
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        // The keyboard path from the day panel: Enter on the day, then "Move to date…" in its row.
        fireEvent.keyDown(container.querySelector<HTMLElement>('[data-ymd="2026-03-03"]')!, { key: 'Enter' });
        fireEvent.click(await screen.findByRole('button', { name: 'Move ISL-1 to another date' }));
        await pickDay('calendar-move-date', /^Tuesday, March 10th, 2026/);
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect((await screen.findByTestId('calendar-move-status')).textContent).toMatch(/7,214 items, more than the 5000 a preview reads/);
        expect(calls.some((c) => c.method !== 'GET')).toBe(false);
    });

    it('offers a caller who does not edit work items no move', async () => {
        installFetch({ 'GET /work-items/calendar': { body: CALENDAR } });
        const { container } = renderWorkspace(<Harness canEdit={false} />, { role: 'VIEWER' });
        await screen.findByRole('button', { name: /ISL-1 Item 1/ });
        expect(screen.queryByRole('button', { name: /to date…$/ })).toBeNull();
        expect(container.querySelector('[data-movable]')).toBeNull();
        fireEvent.keyDown(container.querySelector<HTMLElement>('[data-ymd="2026-03-03"]')!, { key: 'Enter' });
        const panel = await screen.findByTestId('calendar-day-panel');
        expect(within(panel).queryByRole('button', { name: /to another date/ })).toBeNull();
    });
});
