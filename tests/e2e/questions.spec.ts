/**
 * Questions end to end (sub-phase 2.4b-c; owner decisions 113 to 118), on an
 * isolated workspace: add the Question type in Settings (nothing is
 * seeded), add a Question template on a project's page, make a question from
 * it in the create dialog (it needs someone it waits on), comment on it, mark
 * the comment as the answer, and see the item Done with the answer pinned.
 *
 * Written fresh for Islestone. The team and project are made through the
 * API; everything else through the UI.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Support team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Help desk', keyPrefix: 'QST' } });
    expect(project.status()).toBe(201);
}

test.describe('questions', () => {
    test('add the Question type, a Question template, ask, comment, mark the answer and see it Done', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await seed(page.request, slug);
        const main = page.getByRole('main');

        // Settings → Work item types: the preset (decision 116).
        await page.goto(`/t/${slug}/settings/work-item-types`);
        await main.getByRole('button', { name: 'Add the Question type' }).click();
        const add = page.getByRole('dialog', { name: 'Add the Question type' });
        await expect(add.getByLabel('Name')).toHaveValue('Question');
        const addedType = page.waitForResponse((r) => r.url().endsWith('/work-item-types/question-preset') && r.request().method() === 'POST');
        await add.getByRole('button', { name: 'Add type' }).click();
        expect((await addedType).status()).toBe(201);
        await expect(main.getByRole('link', { name: 'Question', exact: true })).toBeVisible();

        // The project's Question template (due in 5 days).
        await page.goto(`/t/${slug}/projects/QST`);
        await main.getByRole('button', { name: 'Templates', exact: true }).click();
        const manager = page.getByRole('dialog', { name: 'Item templates for Help desk' });
        await manager.getByRole('button', { name: 'Add a Question template' }).click();
        await expect(manager.getByRole('textbox', { name: 'Due in days' })).toHaveValue('5');
        const createdTemplate = page.waitForResponse((r) => r.url().endsWith('/work-item-templates') && r.request().method() === 'POST');
        await manager.getByRole('button', { name: 'Create template' }).click();
        expect((await createdTemplate).status()).toBe(201);
        await manager.getByRole('button', { name: 'Done' }).click();
        await expect(manager).toBeHidden();

        // Ask: the template gives the type and the due date; waiting on is required.
        await page.getByRole('button', { name: 'Work item', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New work item' });
        await dialog.getByRole('combobox', { name: 'No template' }).click();
        await page.getByRole('option', { name: 'Question' }).click();
        await dialog.getByLabel('Title').fill('When does the launch start?');
        await dialog.getByRole('combobox', { name: 'Nobody' }).click();
        await page.getByRole('option').filter({ hasNotText: 'Nobody' }).first().click();
        const createdItem = page.waitForResponse((r) => r.url().endsWith('/work-items') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create work item' }).click();
        const itemResponse = await createdItem;
        expect(itemResponse.status()).toBe(201);
        const item = (await itemResponse.json()) as { key: string; dueDate: string | null; waitingOnUserId: string | null };
        expect(item.dueDate).not.toBeNull();
        expect(item.waitingOnUserId).not.toBeNull();

        // Comment, then mark it as the answer: the item moves to Done.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await main.getByRole('tab', { name: /Comments/ }).click();
        await main.getByRole('textbox', { name: 'New comment' }).fill('Next Tuesday at nine.');
        const commented = page.waitForResponse((r) => r.url().endsWith('/comments') && r.request().method() === 'POST');
        await main.getByRole('button', { name: 'Comment', exact: true }).click();
        expect((await commented).status()).toBe(201);
        const comments = main.getByRole('list', { name: 'Comments' });
        await expect(comments.getByText('Next Tuesday at nine.')).toBeVisible();
        const marked = page.waitForResponse((r) => r.url().endsWith('/answer') && r.request().method() === 'PUT');
        await comments.getByRole('button', { name: /as the answer$/ }).click();
        expect((await marked).status()).toBe(200);
        await expect(comments.getByText('This is the answer. Clear the answer to edit or delete it.')).toBeVisible();
        await expect
            .poll(async () => {
                const res = await page.request.get(`/api/t/${slug}/work-items/by-key/${item.key}`);
                return ((await res.json()) as { item: { stateCategory: string; waitingOnUserId: string | null } }).item;
            })
            .toMatchObject({ stateCategory: 'DONE', waitingOnUserId: null });
        await main.getByRole('tab', { name: 'Overview' }).click();
        await expect(main.getByRole('region', { name: 'Answer' }).getByText('Next Tuesday at nine.')).toBeVisible();
    });
});
