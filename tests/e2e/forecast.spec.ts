/**
 * The forecast end to end (sub-phase 3.6c; owner decisions 319, 321, 322 and
 * 324), on an isolated workspace: a project with three open items and one
 * done today. Its record holds no history before today, so every forecast
 * refuses, and the page says why with the counts and gives no date (H3: a
 * tiny history is never a confident date). The project page's Forecast
 * section, its Details sheet with the window, share and basis a person may
 * change, the Work items page's Forecast action for the current filters, and
 * the read answering the same on the server.
 *
 * The record's rows are the trigger's, written as the items change (the
 * run's "today" is E2E_TODAY). Written fresh for Islestone.
 */
import type { APIRequestContext } from '@playwright/test';

import { e2eToday } from './e2e-utils';
import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = (await (await api.post(`${base}/teams`, { data: { name: 'Forecast team' } })).json()) as { id: string };
    const project = await api.post(`${base}/projects`, { data: { teamId: team.id, name: 'Orbit', keyPrefix: 'ORB' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const make = async (title: string) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title } });
        expect(res.status()).toBe(201);
        return ((await res.json()) as { id: string }).id;
    };
    const shipped = await make('Launch the orbit');
    for (const title of ['Plan the burn', 'Check the fuel', 'Brief the crew']) await make(title);
    const states = (await (await api.get(`${base}/teams/${team.id}/workflow-states`)).json()) as Array<{ id: string; category: string }>;
    const moved = await api.post(`${base}/work-items/${shipped}/move`, { data: { stateId: states.find((s) => s.category === 'DONE')!.id } });
    expect(moved.status()).toBe(200);
    return { projectId };
}

test.describe('forecast', () => {
    test('a project with no history before today: the section and the sheet refuse with the counts, and the list\'s action reads the filters', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId } = await seed(page.request, slug);

        await page.goto(`/t/${slug}/projects/ORB`);
        const main = page.getByRole('main');
        const section = main.getByRole('region', { name: 'Forecast' });
        // Today is never history, so the record holds no working day before it.
        await expect(section.getByTestId('forecast-refused')).toHaveText('Not enough history to forecast: 0 items finished in the last 12 weeks; a forecast needs at least 20.');
        await expect(section.getByTestId('forecast-dates')).toHaveCount(0);

        await section.getByRole('button', { name: 'Details' }).click();
        const sheet = page.getByTestId('forecast-detail');
        await expect(sheet.getByText(/3 open items\. Based on Orbit: 0 items finished in the last 12 weeks\./)).toBeVisible();
        await expect(sheet.getByRole('radio', { name: 'Forecast team (team)' })).toBeVisible();
        const read = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/analytics/forecast` && new URL(r.url()).searchParams.get('historyWeeks') === '4');
        await sheet.getByRole('radio', { name: '4 weeks' }).click();
        expect((await read).status()).toBe(200);
        await expect(page.getByTestId('forecast-detail').getByTestId('forecast-refused')).toContainText('in the last 4 weeks');
        await expect(page.getByTestId('forecast-detail').getByTestId('forecast-record')).toHaveText('How forecasts held here is shown beside a forecast that gives dates.');
        await page.keyboard.press('Escape');

        // The Work items page's action: the sheet for the current filters.
        await page.goto(`/t/${slug}/work-items`);
        const action = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/analytics/forecast`);
        await page.getByRole('main').getByRole('button', { name: 'Forecast' }).click();
        expect((await action).status()).toBe(200);
        await expect(page.getByTestId('forecast-detail').getByTestId('forecast-refused')).toBeVisible();

        // The server's answer, as the section reads it.
        const answer = (await (await page.request.get(`/api/t/${slug}/analytics/forecast?projectId=${projectId}&share=50`)).json()) as {
            asOf: string;
            remaining: number;
            share: number;
            likely: unknown;
            refused: { reason: string; completions: number; needed: number };
            history: { to: string | null };
        };
        expect(answer).toMatchObject({ asOf: e2eToday(), remaining: 3, share: 50, likely: null, refused: { reason: 'TOO_FEW_COMPLETIONS', completions: 0, needed: 20 } });
    });
});
