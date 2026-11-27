/**
 * The Analytics page end to end (sub-phase 3.6a; owner decisions 311, 324
 * and 329), on an isolated workspace: a project with two items, one of them
 * moved to Done through the API; the Analytics entry in the sidebar; the
 * counts (one open, one done in the window); throughput naming the
 * completion and its table; cumulative flow and the burn-up drawn; another
 * window read; and the reads answering the same numbers on the server. Time
 * waiting (3.6b): the open item made to wait on the owner, the section's
 * totals and the owner's row (an Owner holds `analytics.people`), what waits
 * now, and the server's answer.
 *
 * The record's rows are the trigger's, written as the items change (the run's
 * "today" is E2E_TODAY; the window ends on it). Written fresh for Islestone.
 */
import type { APIRequestContext } from '@playwright/test';

import { e2eDay, e2eToday } from './e2e-utils';
import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = (await (await api.post(`${base}/teams`, { data: { name: 'Flow team' } })).json()) as { id: string };
    const project = await api.post(`${base}/projects`, { data: { teamId: team.id, name: 'Flow', keyPrefix: 'FLW' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const make = async (title: string) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title } });
        expect(res.status()).toBe(201);
        return ((await res.json()) as { id: string }).id;
    };
    const shipped = await make('Ship the flow');
    const planned = await make('Plan the next one');
    const states = (await (await api.get(`${base}/teams/${team.id}/workflow-states`)).json()) as Array<{ id: string; category: string }>;
    const moved = await api.post(`${base}/work-items/${shipped}/move`, { data: { stateId: states.find((s) => s.category === 'DONE')!.id } });
    expect(moved.status()).toBe(200);
    return { projectId, planned };
}

test.describe('analytics', () => {
    test('counts, throughput with its table, flow, the burn-up and time waiting over the last twelve weeks, and another window', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId, planned } = await seed(page.request, slug);
        // The open item waits on the owner (3.6b).
        const waiting = await page.request.put(`/api/t/${slug}/work-items/${planned}/waiting-on`, { data: { userId: isolatedTenant.ownerUserId } });
        expect(waiting.status()).toBe(200);

        await page.goto(`/t/${slug}/my-work`);
        await page.getByTestId('nav-analytics').click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/analytics$`));
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: 'Analytics' })).toBeAttached();

        await expect(main.getByTestId('analytics-count-open')).toHaveText('1');
        await expect(main.getByTestId('analytics-count-done')).toHaveText('1');
        await expect(main.getByTestId('analytics-count-created')).toHaveText('2');

        const throughput = main.getByRole('region', { name: 'Throughput' });
        await expect(throughput.getByText('1 done; a median week of 0.')).toBeVisible();
        await throughput.getByRole('button', { name: 'Show table' }).click();
        await expect(throughput.getByRole('table', { name: 'Items done per period' })).toBeVisible();

        await expect(main.getByRole('region', { name: 'Cumulative flow' }).getByText(/2 items followed/)).toBeVisible();
        await expect(main.getByRole('region', { name: 'Burn-up' })).toBeVisible();
        await expect(main.getByRole('region', { name: 'Cycle time' }).getByText(/1 item was done without starting/)).toBeVisible();

        // Time waiting: one item waits on the owner now; the owner sees every party's row.
        const waitingSection = main.getByRole('region', { name: 'Time waiting' });
        await expect(waitingSection.getByText(/1 item waits on someone now\./)).toBeVisible();
        await waitingSection.getByRole('button', { name: 'Show table' }).click();
        const perPerson = waitingSection.getByRole('table', { name: 'Time waited per person in the window, in working days' });
        await expect(perPerson.getByRole('rowheader', { name: isolatedTenant.ownerName })).toBeVisible();
        await expect(waitingSection.getByRole('table', { name: 'What waits now, the oldest first' }).getByRole('cell', { name: 'FLW-2' })).toBeVisible();

        // Another window: four weeks ending today.
        const read = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/analytics/throughput` && new URL(r.url()).searchParams.get('from') === e2eDay(-27));
        await main.getByRole('radio', { name: '4 weeks' }).click();
        expect((await read).status()).toBe(200);
        await expect(main.getByTestId('analytics-count-done')).toHaveText('1');

        // The server's answer for the project, as the page reads it.
        const flow = (await (await page.request.get(`/api/t/${slug}/analytics/flow?projectId=${projectId}&from=${e2eDay(-6)}&to=${e2eToday()}&burnUp=1`)).json()) as {
            days: Array<{ date: string; unstarted: number; done: number }>;
            burnUp: { points: Array<{ scope: number; completed: number }> };
        };
        expect(flow.days.at(-1)).toEqual(expect.objectContaining({ date: e2eToday(), done: 1 }));
        expect(flow.burnUp.points.at(-1)).toEqual(expect.objectContaining({ scope: 2, completed: 1 }));
        const waits = (await (await page.request.get(`/api/t/${slug}/analytics/waiting?projectId=${projectId}&from=${e2eDay(-6)}&to=${e2eToday()}`)).json()) as {
            totals: { waitingNow: number };
            self: { waitingNow: number; waitingNowItems: Array<{ key: string; asReviewer: boolean }> };
            people: unknown[];
        };
        expect(waits.totals.waitingNow).toBe(1);
        expect(waits.self.waitingNowItems).toEqual([expect.objectContaining({ key: 'FLW-2', asReviewer: false })]);
        expect(waits.people).toHaveLength(1);
    });
});
