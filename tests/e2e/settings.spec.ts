/**
 * The first-project path through Settings (decision 55), on an isolated,
 * brand-new workspace: its owner opens Settings from the sidebar, follows the
 * first-project steps to create a team (which brings its workflow) and a
 * project, then creates a work item from the Work items page. A second test
 * archives a project behind the typed confirmation and sees its work items
 * refuse changes.
 *
 * Written fresh for Islestone. Nothing is seeded through the API: the path
 * under test is the one a person without the API takes.
 */
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function createTeam(page: Page, name: string) {
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New team' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('main').getByRole('link', { name, exact: true })).toBeVisible();
}

async function createProject(page: Page, name: string, keyPrefix: string) {
    await page.getByRole('button', { name: 'Project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Key prefix').fill(keyPrefix);
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('main').getByRole('link', { name, exact: true })).toBeVisible();
}

test.describe('Settings', () => {
    test('a new workspace gets its first project and work item without the API', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;

        // Settings, from the sidebar's gear.
        await page.getByRole('link', { name: 'Settings', exact: true }).click();
        await page.waitForURL(`**/t/${slug}/settings`, { timeout: 30_000 });
        const steps = page.getByRole('region', { name: 'Your first project' });
        await expect(steps).toBeVisible();

        // A team first: it comes with its workflow.
        await steps.getByRole('link', { name: 'Go to Teams' }).click();
        await page.waitForURL(`**/t/${slug}/settings/teams`);
        await expect(page.getByText('No teams yet. Create one to start a project.')).toBeVisible();
        await createTeam(page, 'Core');
        await page.getByRole('main').getByRole('link', { name: 'Core', exact: true }).click();
        await page.waitForURL(`**/t/${slug}/settings/teams/**`);
        await expect(page.getByRole('heading', { level: 1, name: 'Core: workflow' })).toBeVisible();
        const states = page.locator('#settings-states-table');
        const workflow = ['Backlog', 'Todo', 'In progress', 'In review', 'Done', 'Cancelled'];
        for (const [i, name] of workflow.entries()) {
            // Row 0 is the header; the first cell is the state's name.
            await expect(states.getByRole('row').nth(i + 1).getByRole('cell').first()).toHaveText(new RegExp(`^${name}`));
        }

        // Then a project, from the steps (the team step is now done).
        await page.goto(`/t/${slug}/settings`);
        await expect(steps.getByRole('link', { name: 'Go to Teams' })).toHaveCount(0);
        await steps.getByRole('link', { name: 'Go to Projects' }).click();
        await page.waitForURL(`**/t/${slug}/settings/projects`);
        await createProject(page, 'First steps', 'fst');
        await expect(page.locator('#settings-projects-table').getByText('FST', { exact: true })).toBeVisible();

        // The steps are done: Settings no longer shows them.
        await page.goto(`/t/${slug}/settings`);
        await expect(page.getByTestId('settings-count-projects')).toHaveText('1 in this workspace');
        await expect(steps).toHaveCount(0);

        // A work item from the Work items page.
        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Work items', exact: true }).click();
        await page.waitForURL(`**/t/${slug}/work-items`);
        await page.getByRole('button', { name: 'Work item', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New work item' });
        await dialog.getByLabel('Title').fill('The first item');
        await dialog.getByRole('button', { name: 'Create work item' }).click();
        await expect(dialog).toBeHidden();
        const created = page.getByTestId('work-item-sheet-body');
        await expect(created.getByRole('heading', { name: 'The first item' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#work-items-table').getByText('The first item')).toBeVisible();
        await expect
            .poll(async () => (await page.request.get(`/api/t/${slug}/work-items/by-key/FST-1`)).status())
            .toBe(200);
    });

    test('archiving a project asks for its key prefix, and its items then refuse changes', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await page.goto(`/t/${slug}/settings/teams`);
        await createTeam(page, 'Ops');
        await page.goto(`/t/${slug}/settings/projects`);
        await createProject(page, 'Runbooks', 'RUN');

        const types = (await (await page.request.get(`/api/t/${slug}/work-item-types`)).json()) as Array<{ id: string }>;
        const projects = (await (await page.request.get(`/api/t/${slug}/projects`)).json()) as Array<{ id: string }>;
        const item = await page.request.post(`/api/t/${slug}/work-items`, {
            data: { projectId: projects[0]!.id, typeId: types[0]!.id, title: 'Restart the queue' },
        });
        expect(item.status()).toBe(201);

        await page.getByRole('button', { name: 'Archive Runbooks' }).click();
        const dialog = page.getByRole('dialog', { name: 'Archive Runbooks?' });
        const confirm = dialog.getByRole('button', { name: 'Archive project' });
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel('Type RUN to confirm').fill('RUN');
        await confirm.click();
        await expect(dialog).toBeHidden();
        const row = page.locator('#settings-projects-table').getByRole('row').filter({ hasText: 'Runbooks' });
        await expect(row.getByText('Archived')).toBeVisible();

        const id = ((await item.json()) as { id: string }).id;
        const edit = await page.request.patch(`/api/t/${slug}/work-items/${id}`, { data: { priority: 'HIGH' } });
        expect(edit.status()).toBe(409);

        // Unarchive brings it back.
        await row.getByRole('button', { name: 'Unarchive Runbooks' }).click();
        await expect(row.getByText('Active')).toBeVisible();
    });
});
