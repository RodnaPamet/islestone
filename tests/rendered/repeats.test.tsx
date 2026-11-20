/** @jest-environment jsdom */

/**
 * The detail's Repeat control (sub-phase 2.5d): set a repeat through its
 * dialog, see the next date or why it is on hold, resume, put on hold, stop
 * through the undo toast, the series mark on a copy, and nothing to change
 * for a viewer.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { __resetPendingUndoToastsForTest } from '@/components/ui/hooks/use-toast-with-undo';
import { describeRepeat, RepeatControl } from '@/components/work-items/detail/RepeatControl';
import type { RecurrenceData } from '@/lib/work-items/types';

import { installFetch, renderWorkspace } from '../helpers/work-items-harness';

const PATH = 'GET /work-items/wi-1/recurrence';
const RULE: RecurrenceData = {
    id: 'rr-1',
    frequency: 'WEEKLY',
    interval: 2,
    weekdays: [1, 5],
    firstOn: '2026-11-16',
    endsOn: null,
    maxOccurrences: 6,
    leadDays: 3,
    nextOccurrenceOn: '2026-11-20',
    occurrenceCount: 0,
    ownerUserId: 'u-1',
    heldAt: null,
    heldReason: null,
};
const t = (key: string, v: Record<string, string | number> = {}) => `${key}${Object.values(v).length ? `(${Object.values(v).join('|')})` : ''}`;

beforeEach(() => {
    __resetPendingUndoToastsForTest();
    jest.useRealTimers();
});

describe('describeRepeat', () => {
    it('says the interval, the weekdays Monday first, and the end', () => {
        expect(describeRepeat({ ...RULE, weekdays: [5, 1] }, t)).toBe('everyN.weeks(2) · onDays(weekday.1, weekday.5) · times(6)');
        expect(describeRepeat({ ...RULE, frequency: 'MONTHLY', interval: 1, weekdays: [], maxOccurrences: null, endsOn: '2027-06-30' }, t)).toBe('every.MONTHLY · until(2027-06-30)');
    });
});

describe('the Repeat control', () => {
    it('sets a weekly repeat through its dialog, with no axe violations', async () => {
        const { calls } = installFetch({ [PATH]: { body: { rule: null, occurrenceOf: null } }, 'PUT /work-items/wi-1/recurrence': { body: RULE } });
        const { baseElement } = renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate archived={false} />);
        expect(await screen.findByText('Does not repeat')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Set repeat' }));
        const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
        fireEvent.change(within(dialog).getByLabelText(/^Every/), { target: { value: '2' } });
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Mon' }));
        fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Fri' }));
        fireEvent.click(within(dialog).getByRole('combobox', { name: 'Never' }));
        fireEvent.click(await screen.findByRole('option', { name: 'After a number of times' }));
        fireEvent.change(within(dialog).getByLabelText(/^Times/), { target: { value: '6' } });
        expect(await axe(baseElement)).toHaveNoViolations();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save repeat' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ frequency: 'WEEKLY', interval: 2, weekdays: [1, 5], endsOn: null, maxOccurrences: 6, leadDays: 3 });
    });

    it('refuses an interval past 99 without sending', async () => {
        const { calls } = installFetch({ [PATH]: { body: { rule: null, occurrenceOf: null } } });
        renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate archived={false} />);
        fireEvent.click(await screen.findByRole('button', { name: 'Set repeat' }));
        const dialog = await screen.findByRole('dialog', { name: 'Repeat' });
        fireEvent.change(within(dialog).getByLabelText(/^Every/), { target: { value: '0' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save repeat' }));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent('Every is a whole number from 1 to 99.');
        expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    });

    it('shows why a repeat is on hold and resumes it', async () => {
        const held = { ...RULE, heldAt: '2026-11-20T00:30:00.000Z', heldReason: 'OWNER_NOT_ACTIVE' as const };
        const { calls } = installFetch({ [PATH]: { body: { rule: held, occurrenceOf: null } }, 'PUT /work-items/wi-1/recurrence': { body: RULE } });
        renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate archived={false} />);
        expect(await screen.findByRole('status')).toHaveTextContent('no longer an active member');
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ frequency: 'WEEKLY', onHold: false });
    });

    it('shows the next date, and stops through the undo toast: nothing is sent, and Undo sends nothing', async () => {
        const { calls } = installFetch({ [PATH]: { body: { rule: RULE, occurrenceOf: null } }, 'DELETE /work-items/wi-1/recurrence': { body: { removed: true } } });
        renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate archived={false} />);
        expect(await screen.findByText('Next copy due 2026-11-20, made 3 day(s) before.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Stop repeat' }));
        expect(await screen.findByText('Does not repeat')).toBeInTheDocument();
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
        fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
        expect(await screen.findByText('Next copy due 2026-11-20, made 3 day(s) before.')).toBeInTheDocument();
        await act(async () => {
            await new Promise((r) => setTimeout(r, 50));
        });
        expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('marks a copy with its series, and offers a viewer nothing to change', async () => {
        installFetch({ [PATH]: { body: { rule: RULE, occurrenceOf: { id: 'wi-0', key: 'ISL-7', occurrenceOn: '2026-11-30' } } } });
        renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate archived={false} />, { role: 'VIEWER' });
        expect(await screen.findByRole('link', { name: 'ISL-7' })).toHaveAttribute('href', '/t/acme/work-items/ISL-7');
        expect(screen.getByText(/A copy for 2026-11-30, from/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /repeat|Resume|hold/i })).toBeNull();
    });

    it('asks for a due date before a repeat can be set', async () => {
        installFetch({ [PATH]: { body: { rule: null, occurrenceOf: null } } });
        renderWorkspace(<RepeatControl itemId="wi-1" hasDueDate={false} archived={false} />);
        expect(await screen.findByText('Give it a due date to set a repeat.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Set repeat' })).toBeNull();
    });
});
