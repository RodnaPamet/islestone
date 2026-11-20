/**
 * Templates end to end (sub-phase 2.5c), on an isolated workspace: define an
 * item template on a project's page, make a work item from it in the create
 * dialog (its sub-items come too), save the project as a template from
 * Settings → Projects, see it in Settings → Project templates, and make a new
 * project from it, which starts with the item template and the starter items.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Launch team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Launchpad', keyPrefix: 'LCH' } });
    expect(project.status()).toBe(201);
    return { teamId, projectId: ((await project.json()) as { id: string }).id };
}

test.describe('templates', () => {
    test('an item template, a work item from it, a project template, and a project from that', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId } = await seed(page.request, slug);
        const main = page.getByRole('main');

        // The project's item templates.
        await page.goto(`/t/${slug}/projects/LCH`);
        await main.getByRole('button', { name: 'Templates', exact: true }).click();
        const manager = page.getByRole('dialog', { name: 'Item templates for Launchpad' });
        await manager.getByLabel('Template name').fill('Kick-off');
        await manager.getByLabel('Work item title').fill('Kick-off meeting');
        await manager.getByRole('textbox', { name: 'Sub-items' }).fill('Book a room\nSend the agenda');
        const createdTemplate = page.waitForResponse((r) => r.url().endsWith('/work-item-templates') && r.request().method() === 'POST');
        await manager.getByRole('button', { name: 'Create template' }).click();
        expect((await createdTemplate).status()).toBe(201);
        await expect(manager.getByText('Makes: Kick-off meeting · sub-items: 2')).toBeVisible();
        await manager.getByRole('button', { name: 'Done' }).click();
        await expect(manager).toBeHidden();

        // A work item from it; its sub-items come with it.
        await page.getByRole('button', { name: 'Work item', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New work item' });
        await dialog.getByRole('combobox', { name: 'No template' }).click();
        await page.getByRole('option', { name: 'Kick-off' }).click();
        await expect(dialog.getByLabel('Title')).toHaveValue('Kick-off meeting');
        const createdItem = page.waitForResponse((r) => r.url().endsWith('/work-items') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Create work item' }).click();
        const itemResponse = await createdItem;
        expect(itemResponse.status()).toBe(201);
        const item = (await itemResponse.json()) as { id: string };
        const subs = (await (await page.request.get(`/api/t/${slug}/work-items/${item.id}/sub-items`)).json()) as { items: Array<{ title: string }> };
        expect(subs.items.map((s) => s.title)).toEqual(['Book a room', 'Send the agenda']);

        // Save the project as a template, with its open items.
        await page.goto(`/t/${slug}/settings/projects`);
        await page.getByRole('button', { name: 'Save Launchpad as a template' }).click();
        const save = page.getByRole('dialog', { name: 'Save Launchpad as a template' });
        await save.getByLabel('Template name').fill('Standard launch');
        await save.getByRole('switch', { name: 'Include open work items' }).click();
        const savedTemplate = page.waitForResponse((r) => r.url().endsWith('/project-templates') && r.request().method() === 'POST');
        await save.getByRole('button', { name: 'Save template' }).click();
        expect((await savedTemplate).status()).toBe(201);
        await page.goto(`/t/${slug}/settings/project-templates`);
        await expect(main.getByText('Standard launch')).toBeVisible();
        await expect(main.getByText('Fields: 0 · milestones: 0 · item templates: 1 · work items: 1')).toBeVisible();

        // A new project from it.
        await page.goto(`/t/${slug}/projects`);
        await page.getByRole('button', { name: 'Project', exact: true }).click();
        const create = page.getByRole('dialog', { name: 'New project' });
        await create.getByLabel('Name').fill('Second launch');
        await create.getByLabel('Key prefix').fill('SEC');
        await create.getByRole('combobox', { name: 'No template' }).click();
        await page.getByRole('option', { name: 'Standard launch' }).click();
        const createdProject = page.waitForResponse((r) => r.url().endsWith('/projects') && r.request().method() === 'POST');
        await create.getByRole('button', { name: 'Create project' }).click();
        const projectResponse = await createdProject;
        expect(projectResponse.status()).toBe(201);
        const made = (await projectResponse.json()) as { id: string };
        expect(made.id).not.toBe(projectId);
        await page.goto(`/t/${slug}/projects/SEC`);
        await expect(main.getByText('Kick-off meeting')).toBeVisible();
        const templates = (await (await page.request.get(`/api/t/${slug}/projects/${made.id}/work-item-templates`)).json()) as Array<{ name: string }>;
        expect(templates.map((t) => t.name)).toEqual(['Kick-off']);
    });
});
