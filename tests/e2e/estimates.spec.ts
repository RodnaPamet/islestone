/**
 * Estimates end to end (roadmap 3.4a; owner decisions 257 to 259), on an
 * isolated workspace:
 *
 *   - Settings → Teams: the team estimates in points, set in its Edit dialog;
 *   - the item's page: an Estimate of 5 points, saved and on the server; the
 *     card on the board shows it;
 *   - the team switches to hours: the item's points are kept on the server
 *     but its Estimate is empty under hours; "1h 30m" is saved as 90 minutes;
 *   - the cycle's burn-up offers Items / Hours and says "1h 30m in scope".
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { e2eDay } from './e2e-utils';
import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Sizing team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Sizing', keyPrefix: 'SIZ' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId: (await project.json()).id, typeId: types[0]!.id, title: 'Size the work' } });
    expect(item.status()).toBe(201);
    const cycle = await api.post(`${base}/cycles`, { data: { teamId, startsOn: e2eDay(-1), endsOn: e2eDay(12) } });
    expect(cycle.status()).toBe(201);
    return { teamId, item: (await item.json()) as { id: string; key: string; version: number }, cycleId: ((await cycle.json()) as { id: string }).id };
}

async function itemOf(api: APIRequestContext, slug: string, id: string) {
    return (await (await api.get(`/api/t/${slug}/work-items/${id}`)).json()) as { version: number; estimatePoints: number | null; estimateMinutes: number | null };
}

async function setUnit(page: Page, slug: string, unit: 'Points' | 'Hours') {
    await page.goto(`/t/${slug}/settings/teams`);
    await page.getByRole('button', { name: 'Edit Sizing team' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit team' });
    await dialog.getByRole('radio', { name: unit }).click();
    const saved = page.waitForResponse((r) => /\/teams\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('settings-teams-table').getByText(unit)).toBeVisible();
}

test.describe('estimates', () => {
    test("a team's unit, an item's estimate in it, a switch that keeps it, and the burn-up in hours", async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { item, cycleId } = await seed(page.request, slug);

        await setUnit(page, slug, 'Points');

        // The item's page: 5 points.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        const estimate = page.getByRole('textbox', { name: 'Estimate' });
        await estimate.fill('5');
        const saved = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/estimate`) && r.request().method() === 'PUT');
        await estimate.press('Enter');
        expect((await saved).status()).toBe(200);
        expect(await itemOf(page.request, slug, item.id)).toMatchObject({ estimatePoints: 5, estimateMinutes: null });

        // Into the cycle, through the API (the cycle picker is 2.5a's, tested there).
        const v = (await itemOf(page.request, slug, item.id)).version;
        const inCycle = await page.request.put(`/api/t/${slug}/work-items/${item.id}/cycle`, { data: { cycleId }, headers: { 'If-Match': `"${v}"` } });
        expect(inCycle.status()).toBe(200);

        // The board's card shows it.
        await page.goto(`/t/${slug}/projects/SIZ?layout=board`);
        await expect(page.getByRole('main').getByText('5 pts')).toBeVisible();

        // Hours: the points stay on the server, the field is empty, and a duration is saved as minutes.
        await setUnit(page, slug, 'Hours');
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await expect(estimate).toHaveValue('');
        await estimate.fill('1h 30m');
        const savedHours = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/estimate`) && r.request().method() === 'PUT');
        await estimate.press('Enter');
        expect((await savedHours).status()).toBe(200);
        await expect(estimate).toHaveValue('1h 30m');
        expect(await itemOf(page.request, slug, item.id)).toMatchObject({ estimatePoints: 5, estimateMinutes: 90 });

        // The cycle's burn-up in hours.
        await page.goto(`/t/${slug}/cycles/${cycleId}`);
        await page.getByRole('radio', { name: 'Hours' }).click();
        await expect(page.getByTestId('burn-up-summary')).toHaveText('1h 30m in scope, every item estimated');
    });
});
