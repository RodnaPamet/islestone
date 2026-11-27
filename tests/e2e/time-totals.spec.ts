/**
 * Billable rates, Time totals and the export end to end (sub-phase 3.4d;
 * owner decisions 271 to 275), on an isolated workspace whose owner holds
 * `time.rates`: the owner chooses the currency and sets the workspace rate in
 * Settings → Time tracking, makes a project's new time billable in Settings
 * → Projects, adds time through the API (billable by the project's default),
 * then reads Time totals with the amount and downloads the CSV and Excel
 * exports, the CSV holding the entry with its rate and amount.
 *
 * The team, project and item are made through the API; the money through the
 * UI. Written fresh for Islestone.
 */
import * as fs from 'node:fs';

import { e2eDay, waitForHydration } from './e2e-utils';
import { expect, test } from './fixtures';

test.describe('time totals', () => {
    test('a currency and a rate set, a project billable by default, totals with the amount, CSV and Excel downloaded', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(180_000);
        const slug = isolatedTenant.tenantSlug;
        const base = `/api/t/${slug}`;
        const team = await page.request.post(`${base}/teams`, { data: { name: 'Money team' } });
        expect(team.status()).toBe(201);
        const project = await page.request.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Client', keyPrefix: 'MNY' } });
        expect(project.status()).toBe(201);
        const types = (await (await page.request.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
        const item = (await (await page.request.post(`${base}/work-items`, { data: { projectId: ((await project.json()) as { id: string }).id, typeId: types[0]!.id, title: 'Billable work' } })).json()) as { id: string; key: string };
        // Today: the rate applies from today (the form's default date), and Time totals opens on this month to today.
        const day = e2eDay(0);

        // The currency and the workspace rate, in Settings → Time tracking.
        await page.goto(`/t/${slug}/settings/time-tracking`);
        await waitForHydration(page, 'main');
        await expect(page.getByTestId('time-tracking-rates')).toBeVisible();
        const currencySaved = page.waitForResponse((r) => r.url().endsWith('/time-settings') && r.request().method() === 'PUT');
        await page.getByRole('combobox', { name: 'Currency' }).click();
        await page.keyboard.type('EUR');
        await page.getByRole('option', { name: 'EUR', exact: true }).click();
        expect((await currencySaved).status()).toBe(200);
        await page.locator('#workspace-rate-amount').fill('120');
        const rateSaved = page.waitForResponse((r) => r.url().endsWith('/billable-rates/workspace') && r.request().method() === 'PUT');
        await page.locator('#workspace-rate-save').click();
        expect((await rateSaved).status()).toBe(200);
        await expect(page.getByRole('list', { name: 'Rates of the workspace' })).toContainText('€120.00 an hour');
        await expect(page.getByText('Rates exist in this currency, so it cannot change.')).toBeVisible();

        // A project's new time is billable by default, in Settings → Projects.
        await page.goto(`/t/${slug}/settings/projects`);
        await waitForHydration(page, 'main');
        await page.getByRole('button', { name: 'Time settings of Client' }).click();
        const defaultSaved = page.waitForResponse((r) => r.url().endsWith('/billable-default') && r.request().method() === 'PUT');
        await page.getByRole('switch', { name: 'New time is billable' }).click();
        expect((await defaultSaved).status()).toBe(200);
        await page.keyboard.press('Escape');

        // Time added with no billable named takes the project's default.
        const added = await page.request.post(`${base}/time-entries`, { data: { workItemId: item.id, workDate: day, minutes: 90, description: '=1+1' } });
        expect(added.status()).toBe(201);
        expect(((await added.json()) as { billable: boolean }).billable).toBe(true);

        // Time totals: the project's group with its amount (90 minutes at €120.00 = €180.00).
        await page.goto(`/t/${slug}/time/totals`);
        await waitForHydration(page, 'main');
        const table = page.locator('#time-totals-table');
        await expect(table.getByText('MNY Client')).toBeVisible();
        await expect(table.getByText('€180.00')).toBeVisible();
        await expect(page.getByTestId('time-totals-total')).toContainText('Total 1h 30m, billable 1h 30m, 1 entry');

        // The exports download; the CSV holds the entry, its rate and amount, and the formula neutralised.
        const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
        expect(csv.suggestedFilename()).toMatch(/^time-entries-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
        const text = fs.readFileSync((await csv.path())!, 'utf8');
        expect(text).toContain('Rate (EUR per hour),Amount (EUR)');
        expect(text).toContain(`,MNY,${item.key},Billable work,1.50,90,Yes,120.00,180.00,'=1+1`);
        const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel' }).click()]);
        expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/);
        expect(fs.readFileSync((await xlsx.path())!).subarray(0, 2).toString()).toBe('PK');
    });
});
