/**
 * Recipient lists end to end (sub-phase 2.7e; owner decisions 138 to 142), on
 * an isolated workspace: its owner creates a workspace list in Settings →
 * Recipient lists and puts themselves on it, creates a project list from the
 * project's page, copies the workspace list onto an item's watchers from the
 * item's page, names the project list in Settings → Intake, removes a person
 * through the undo toast, and archives a list.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Desk team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Help desk', keyPrefix: 'HLP' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title: 'Printer on fire' } });
    expect(item.status()).toBe(201);
    const members = (await (await api.get(`${base}/users/assignable`)).json()) as Array<{ id: string; name: string | null; email: string }>;
    const me = members[0]!;
    return { projectId, item: (await item.json()) as { id: string; key: string }, me: { id: me.id, label: me.name?.trim() || me.email } };
}

test.describe('recipient lists', () => {
    test('create lists, copy one onto watchers, name one in intake, remove a person and archive', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(120_000);
        const slug = isolatedTenant.tenantSlug;
        const { projectId, item, me } = await seed(page.request, slug);
        const main = page.getByRole('main');

        // Settings → Recipient lists: a workspace list with the owner on it.
        await page.goto(`/t/${slug}/settings`);
        await main.getByRole('link', { name: 'Open recipient lists' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/settings/recipient-lists$`));
        await expect(main.getByText('No recipient lists yet.')).toBeVisible();
        await main.getByRole('button', { name: 'Recipient list', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New recipient list' });
        await dialog.getByLabel('Name').fill('Leads');
        await dialog.getByRole('button', { name: 'Create list' }).click();
        await expect(dialog).toBeHidden();
        const leads = main.getByRole('region', { name: 'Leads' });
        await expect(leads).toBeVisible();
        await leads.getByRole('combobox', { name: 'Add a person to Leads' }).click();
        const added = page.waitForResponse((r) => r.url().endsWith('/members') && r.request().method() === 'PATCH');
        await page.getByRole('option', { name: me.label }).click();
        expect((await added).status()).toBe(200);
        await expect(leads.getByRole('list', { name: 'People on Leads' }).getByText(me.label)).toBeVisible();

        // A project list, from the project's page.
        await page.goto(`/t/${slug}/projects/HLP`);
        await main.getByRole('link', { name: 'Recipient lists' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/projects/HLP/recipient-lists$`));
        await main.getByRole('button', { name: 'Recipient list', exact: true }).click();
        const projectDialog = page.getByRole('dialog', { name: 'New recipient list' });
        await projectDialog.getByLabel('Name').fill('Desk');
        await projectDialog.getByRole('button', { name: 'Create list' }).click();
        await expect(projectDialog).toBeHidden();
        const desk = main.getByRole('region', { name: 'Desk' });
        await desk.getByRole('combobox', { name: 'Add a person to Desk' }).click();
        await page.getByRole('option', { name: me.label }).click();
        await expect(desk.getByRole('list', { name: 'People on Desk' }).getByText(me.label)).toBeVisible();

        // The item's watchers: nobody watches, then the workspace list is copied on.
        await page.request.delete(`/api/t/${slug}/work-items/${item.id}/watchers`);
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        const watchers = page.getByRole('list', { name: 'Watchers' });
        await expect(watchers.getByText(me.label)).toHaveCount(0);
        await page.getByRole('combobox', { name: 'Add recipient list' }).click();
        const copied = page.waitForResponse((r) => r.url().endsWith('/watchers/recipient-list') && r.request().method() === 'POST');
        await page.getByRole('option', { name: 'Leads (workspace)' }).click();
        expect((await copied).status()).toBe(200);
        await expect(watchers.getByText(me.label)).toBeVisible();

        // Settings → Intake names the project list beside the notify list.
        expect((await page.request.put(`/api/t/${slug}/projects/${projectId}/intake`, { data: { enabled: true } })).status()).toBe(200);
        await page.goto(`/t/${slug}/settings/intake`);
        await main.getByRole('combobox', { name: 'Recipient list for Help desk' }).click();
        const named = page.waitForResponse((r) => r.url().endsWith(`/projects/${projectId}/intake`) && r.request().method() === 'PUT');
        await page.getByRole('option', { name: 'Desk', exact: true }).click();
        expect((await named).status()).toBe(200);
        const intakes = (await (await page.request.get(`/api/t/${slug}/intake/projects`)).json()) as Array<{ projectId: string; recipientListId: string | null }>;
        expect(intakes.find((p) => p.projectId === projectId)?.recipientListId).toBeTruthy();

        // A person leaves a list through the undo toast; archiving is at once.
        await page.goto(`/t/${slug}/projects/HLP/recipient-lists`);
        const deskAgain = main.getByRole('region', { name: 'Desk' });
        const removed = page.waitForResponse((r) => r.url().endsWith('/members') && r.request().method() === 'PATCH', { timeout: 15_000 });
        await deskAgain.getByRole('button', { name: `Remove ${me.label} from Desk` }).click();
        await expect(page.getByText(`Removed ${me.label} from Desk.`)).toBeVisible();
        expect((await removed).status()).toBe(200);
        await expect(deskAgain.getByText('Nobody is on this list yet.')).toBeVisible();

        await page.goto(`/t/${slug}/settings/recipient-lists`);
        await main.getByRole('button', { name: 'Archive Leads' }).click();
        // An archived list folds away under its own group, from where it is restored.
        await main.getByText('1 archived list').click();
        await expect(main.getByRole('button', { name: 'Restore Leads' })).toBeVisible();
        const lists = (await (await page.request.get(`/api/t/${slug}/recipient-lists?includeArchived=1`)).json()) as Array<{ name: string; archived: boolean }>;
        expect(lists.find((l) => l.name === 'Leads')?.archived).toBe(true);
    });
});
