/**
 * Custom fields and saved views end to end (sub-phase 2.4), on an isolated
 * workspace: define a select field in the project's field manager, set its
 * value on an item's page, filter the list by it (the list
 * keeps only that item), save the state as a view, and reload it from the
 * Views page with the filter applied again.
 *
 * Written fresh for Islestone. The team, project and items are made through
 * 2.2's API; the field, the value, the filter and the view through the UI.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'CFV team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: (await team.json()).id, name: 'Fielded', keyPrefix: 'CFV' } });
    expect(project.status()).toBe(201);
    const projectId = (await project.json()).id as string;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    for (const title of ['Tagged item', 'Plain item']) {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title } });
        expect(res.status()).toBe(201);
    }
}

test.describe('custom fields and saved views', () => {
    test('define a field, set a value, filter by it, save a view and reload it', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await seed(page.request, slug);
        await page.goto(`/t/${slug}/projects/CFV`);
        const table = page.locator('#work-items-table');
        await expect(table.getByText('Plain item')).toBeVisible();

        // Define a select field in the field manager.
        await page.getByRole('button', { name: 'Fields', exact: true }).click();
        const manager = page.getByRole('dialog', { name: 'Fields of Fielded' });
        await manager.getByLabel(/^Name(?! of)/).fill('Stage');
        await manager.getByRole('combobox', { name: 'Text' }).click();
        await page.getByRole('option', { name: 'Select', exact: true }).click();
        await manager.getByLabel(/^Options/).fill('Alpha\nBeta');
        await manager.getByRole('button', { name: 'Add field' }).click();
        await expect(manager.getByRole('listitem', { name: 'Stage' })).toBeVisible();
        await manager.getByRole('button', { name: 'Done' }).click();
        await expect(manager).toBeHidden();

        // Set the value on one item, on its page (the title links there).
        await table.getByRole('link', { name: 'Tagged item' }).click();
        await page.waitForURL(new RegExp(`/t/${slug}/work-items/CFV-1$`));
        await page.getByRole('group', { name: 'Properties' }).getByRole('combobox', { name: 'Stage' }).click();
        await page.getByRole('option', { name: 'Alpha', exact: true }).click();
        await expect
            .poll(async () => {
                const res = await page.request.get(`/api/t/${slug}/work-items/by-key/CFV-1`);
                return Object.keys(((await res.json()) as { item: { customFields: Record<string, unknown> } }).item.customFields).length;
            })
            .toBe(1);

        // Filter by the field: only the tagged item stays.
        await page.goto(`/t/${slug}/projects/CFV`);
        await expect(table.getByText('Plain item')).toBeVisible();
        await page.getByRole('button', { name: /^Filter/ }).first().click();
        await page.getByRole('option', { name: 'Stage' }).click();
        await page.getByRole('option', { name: 'Alpha' }).click();
        await page.keyboard.press('Escape');
        await expect(table.getByText('Plain item')).toBeHidden();
        await expect(table.getByText('Tagged item')).toBeVisible();

        // Save the state as a view.
        await page.getByRole('button', { name: 'Save view' }).click();
        const save = page.getByRole('dialog', { name: 'Save view' });
        await save.getByLabel(/^Name/).fill('Alpha only');
        await save.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(save).toBeHidden();

        // Reload it from the Views page, on a clean URL.
        await page.goto(`/t/${slug}/views`);
        await page.getByRole('link', { name: 'Alpha only' }).click();
        await page.waitForURL(new RegExp(`/t/${slug}/projects/CFV\\?view=`));
        await expect(table.getByText('Tagged item')).toBeVisible();
        await expect(table.getByText('Plain item')).toBeHidden();
    });
});
