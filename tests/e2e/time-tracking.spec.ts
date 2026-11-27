/**
 * Time entries and timers end to end (roadmap 3.4b; owner decisions 260 to
 * 267), on an isolated workspace:
 *
 *   - the item's page: "Add time" of 1h 30m, the Time panel's "Time spent"
 *     and the entry, on the server as 90 minutes;
 *   - the timer: started from the panel, shown in the top chrome with its
 *     item, stopped there (under 30 seconds it is discarded);
 *   - My time: the week grid by keyboard, a cell's entry changed from 1h 30m
 *     to 2h, on the server with its version;
 *   - the Time entry in the sidebar.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Hours team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Hours', keyPrefix: 'HRS' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId: (await project.json()).id, typeId: types[0]!.id, title: 'Write the report' } });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}

test.describe('time tracking', () => {
    test('add time on an item, run the timer from the top chrome, and change the entry in My time', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const item = await seed(page.request, slug);

        // The item's Time panel: Add time.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        const panel = page.getByTestId('time-panel');
        await expect(panel.getByTestId('time-summary')).toHaveText('Time spent 0m');
        await panel.getByRole('button', { name: 'Add time' }).click();
        const dialog = page.getByRole('dialog', { name: `Add time on ${item.key}` });
        await dialog.getByRole('textbox', { name: 'Time spent' }).fill('1h 30m');
        const added = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/time-entries` && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Save' }).click();
        expect((await added).status()).toBe(201);
        await expect(dialog).toBeHidden();
        await expect(panel.getByTestId('time-summary')).toHaveText('Time spent 1h 30m');
        await expect(panel.getByTestId('time-entry-row')).toHaveCount(1);
        const onServer = (await (await page.request.get(`/api/t/${slug}/work-items/${item.id}/time`)).json()) as { totalMinutes: number; entries: Array<{ id: string; minutes: number; workDate: string }> };
        expect(onServer.totalMinutes).toBe(90);

        // The timer: started from the panel, shown and stopped in the top chrome.
        await panel.getByRole('button', { name: 'Start timer' }).click();
        const chip = page.getByTestId('timer-chip');
        await expect(chip).toContainText(item.key);
        await expect(panel.getByText('Timer on')).toBeVisible();
        const stopped = page.waitForResponse((r) => r.url().endsWith('/time-entries/timer/stop') && r.request().method() === 'POST');
        await chip.getByRole('button', { name: 'Stop timer' }).click();
        expect((await stopped).status()).toBe(200);
        await expect(chip).toBeHidden();

        // My time: the entry sits on its day; move to it by keyboard and change it.
        // The entry is dated in the browser's today; open My time on that week.
        const entry = onServer.entries[0]!;
        await page.getByTestId('nav-time').click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/time`));
        await page.goto(`/t/${slug}/time?week=${entry.workDate}`);
        const grid = page.getByRole('grid', { name: /Your time/ });
        const cell = grid.getByRole('gridcell', { name: new RegExp(`^${item.key}, .*, 1h 30m$`) });
        await expect(cell).toBeVisible();
        await cell.focus();
        await page.keyboard.press('Enter');
        const change = page.getByRole('dialog', { name: `Change time on ${item.key}` });
        await change.getByRole('textbox', { name: 'Time spent' }).fill('2h');
        const patched = page.waitForResponse((r) => r.url().endsWith(`/time-entries/${entry.id}`) && r.request().method() === 'PATCH');
        await change.getByRole('button', { name: 'Save' }).click();
        const res = await patched;
        expect(res.status()).toBe(200);
        expect(res.request().headers()['if-match']).toBe('"1"');
        await expect(grid.getByRole('gridcell', { name: new RegExp(`^${item.key}, .*, 2h$`) })).toBeVisible();
        await expect(page.getByTestId('my-time-week-total')).toHaveText('2h');
    });
});
