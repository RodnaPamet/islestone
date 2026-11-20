/**
 * Milestones end to end (sub-phase 2.5b), on an isolated workspace: from a
 * project's page open its milestones, create one with a due date, aim an
 * item at it from the item's page, finish the item, and see the milestone
 * count it (1 of 1 done) on the milestones page and on its own page, where
 * the item is listed. Then filter the project's list by the milestone.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Summit team' } });
    expect(team.status()).toBe(201);
    const teamBody = (await team.json()) as { id: string; workflowStates: Array<{ id: string; category: string }> };
    const project = await api.post(`${base}/projects`, { data: { teamId: teamBody.id, name: 'Summit', keyPrefix: 'SUM' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const make = async (title: string) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title } });
        expect(res.status()).toBe(201);
        return (await res.json()) as { id: string; key: string };
    };
    return {
        projectId,
        doneStateId: teamBody.workflowStates.find((s) => s.category === 'DONE')!.id,
        item: await make('Reach base camp'),
        other: await make('Pack the tents'),
    };
}

test.describe('milestones', () => {
    test('create a milestone, aim an item at it, finish the item, and read the progress', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { doneStateId, item } = await seed(page.request, slug);

        // From the project's page to its milestones, and a new one.
        await page.goto(`/t/${slug}/projects/SUM`);
        await page.getByRole('main').getByRole('link', { name: 'Milestones' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/projects/SUM/milestones$`));
        const main = page.getByRole('main');
        await expect(main.getByText('No milestones yet. Add one to group work towards a date.')).toBeVisible();
        await main.getByRole('button', { name: 'Milestone' }).click();
        const dialog = page.getByRole('dialog', { name: 'New milestone' });
        await dialog.getByLabel('Name').fill('Base camp');
        const created = page.waitForResponse((r) => r.url().endsWith('/milestones') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create milestone' }).click();
        expect((await created).status()).toBe(201);
        await expect(dialog).toBeHidden();
        await expect(main.getByRole('link', { name: 'Base camp' })).toBeVisible();
        await expect(main.getByText('0 of 0 done')).toBeVisible();

        // The item is aimed at it from its page.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await page.getByRole('combobox', { name: 'No milestone' }).click();
        const saved = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/milestone`) && r.request().method() === 'PUT');
        await page.getByRole('option', { name: 'Base camp' }).click();
        expect((await saved).status()).toBe(200);
        await expect(page.getByRole('combobox', { name: 'Base camp' })).toBeVisible();

        // Done, through the API (the state picker is 2.3's, tested there).
        const fresh = (await (await page.request.get(`/api/t/${slug}/work-items/${item.id}`)).json()) as { version: number; milestoneId: string };
        expect(fresh.milestoneId).toBeTruthy();
        const done = await page.request.post(`/api/t/${slug}/work-items/${item.id}/state`, {
            data: { stateId: doneStateId },
            headers: { 'If-Match': `"${fresh.version}"` },
        });
        expect(done.status()).toBe(200);

        // The milestones page counts it; the milestone's page lists the item.
        await page.goto(`/t/${slug}/projects/SUM/milestones`);
        const row = page.getByTestId(`milestone-${fresh.milestoneId}`);
        await expect(row.getByText('1 of 1 done')).toBeVisible();
        await expect(row.getByText('Complete')).toBeVisible();
        await row.getByRole('link', { name: 'Base camp' }).click();
        await expect(page).toHaveURL(new RegExp(`/projects/SUM/milestones/${fresh.milestoneId}$`));
        const summary = page.getByTestId('milestone-summary');
        await expect(summary.locator('dd').nth(1)).toHaveText('1');
        await expect(summary.locator('dd').nth(2)).toHaveText('1');
        await expect(page.getByRole('main').getByText('Reach base camp')).toBeVisible();
        await expect(page.getByRole('main').getByText('Pack the tents')).toHaveCount(0);

        // The project's list filtered by the milestone, from the URL.
        await page.goto(`/t/${slug}/projects/SUM?milestoneId=${fresh.milestoneId}`);
        await expect(page.getByRole('main').getByText('Reach base camp')).toBeVisible();
        await expect(page.getByRole('main').getByText('Pack the tents')).toHaveCount(0);
    });
});
