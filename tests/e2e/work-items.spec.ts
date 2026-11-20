/**
 * The work-item views end to end (sub-phase 2.3), on isolated workspaces:
 * create in the dialog, see the item in the list, move it on the board by
 * pointer and by keyboard (the move persists across a reload), open the
 * sheet and the full page, comment, delete with the undo toast and undo.
 * A second test drives the board with the keyboard only.
 *
 * Copied in intent from inflect-compliance `tests/e2e/issues.spec.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (create and see the detail,
 * comment); the helpers are rewritten: the workspace's team, project and
 * items are made through 2.2's API, and nothing links compliance entities.
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function seedProject(api: APIRequestContext, slug: string, keyPrefix: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: `${keyPrefix} team` } });
    expect(team.status()).toBe(201);
    const teamId = (await team.json()).id as string;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: `${keyPrefix} project`, keyPrefix } });
    expect(project.status()).toBe(201);
    const projectId = (await project.json()).id as string;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    return { teamId, projectId, typeId: types[0]!.id };
}

async function seedItem(api: APIRequestContext, slug: string, body: Record<string, unknown>) {
    const res = await api.post(`/api/t/${slug}/work-items`, { data: body });
    expect(res.status()).toBe(201);
    return (await res.json()) as { id: string; key: string };
}

function column(page: Page, name: string) {
    return page.getByRole('main').getByRole('region', { name: 'Board' }).getByRole('region', { name, exact: true });
}

function card(page: Page, key: string, title: string) {
    return page.getByRole('button', { name: `${key}: ${title}` });
}

async function showBoard(page: Page) {
    await page.getByRole('radio', { name: 'Board' }).click();
    await expect(page.getByRole('region', { name: 'Board' })).toBeVisible();
}

test.describe('work-item views', () => {
    test('create, list, board (pointer and keyboard), detail, comment, delete and undo', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await seedProject(page.request, slug, 'WIE');

        // Create through the dialog.
        await page.goto(`/t/${slug}/projects/WIE`);
        await page.getByRole('button', { name: 'Work item', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New work item' });
        await dialog.getByLabel('Title').fill('Write the board');
        await dialog.getByRole('button', { name: 'Create work item' }).click();
        await expect(dialog).toBeHidden();
        // The new item opens in the sheet; close it.
        const created = page.getByTestId('work-item-sheet-body');
        await expect(created.getByRole('heading', { name: 'Write the board' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(created).toBeHidden();

        // The list shows it.
        const table = page.locator('#work-items-table');
        await expect(table.getByText('Write the board')).toBeVisible();

        // The board: the item sits in the team's default state (Todo).
        await showBoard(page);
        const item = card(page, 'WIE-1', 'Write the board');
        await expect(column(page, 'Todo').getByRole('button', { name: 'WIE-1: Write the board' })).toBeVisible();

        // Pointer drag to In progress; it persists across a reload.
        await item.dragTo(column(page, 'In progress'));
        await expect(column(page, 'In progress').getByRole('button', { name: 'WIE-1: Write the board' })).toBeVisible();
        await expect
            .poll(async () => {
                const res = await page.request.get(`/api/t/${slug}/work-items/by-key/WIE-1`);
                return ((await res.json()) as { item: { stateCategory: string } }).item.stateCategory;
            })
            .toBe('STARTED');
        await page.reload();
        await expect(column(page, 'In progress').getByRole('button', { name: 'WIE-1: Write the board' })).toBeVisible();

        // Keyboard: pick up, move right (In review), drop.
        await item.focus();
        await page.keyboard.press('Space');
        await expect(page.getByRole('status', { name: 'Board announcements' }).filter({ hasText: 'Picked up WIE-1' })).toBeAttached();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Space');
        await expect(column(page, 'In review').getByRole('button', { name: 'WIE-1: Write the board' })).toBeVisible();
        await expect(page.getByRole('status', { name: 'Board announcements' }).filter({ hasText: 'Dropped WIE-1 in In review' })).toBeAttached();

        // The sheet, then the full page.
        await card(page, 'WIE-1', 'Write the board').click();
        const sheet = page.getByTestId('work-item-sheet-body');
        await expect(sheet.getByRole('heading', { name: 'Write the board' })).toBeVisible();
        await sheet.getByRole('link', { name: 'Open full page' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/work-items/WIE-1$`));
        await expect(page.getByRole('heading', { level: 1, name: 'Write the board' })).toBeVisible();

        // Comment.
        await page.getByRole('tab', { name: /Comments/ }).click();
        await page.getByLabel('New comment').fill('Looks right to me.');
        await page.getByRole('button', { name: 'Comment', exact: true }).click();
        await expect(page.getByRole('list', { name: 'Comments' }).getByText('Looks right to me.')).toBeVisible();

        // Delete with the undo toast, and undo.
        await page.getByRole('button', { name: 'Delete work item' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/projects/WIE$`));
        await page.getByRole('button', { name: 'Undo' }).click();
        await page.waitForTimeout(6_000);
        const after = await page.request.get(`/api/t/${slug}/work-items/by-key/WIE-1`);
        expect(after.status()).toBe(200);
    });

    test('a comment mentions a member through the @ picker and links a key (2.7d)', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId, typeId } = await seedProject(page.request, slug, 'MEN');
        await seedItem(page.request, slug, { projectId, typeId, title: 'Linked one' });
        const item = await seedItem(page.request, slug, { projectId, typeId, title: 'Mentioning one' });

        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Mentioning one' })).toBeVisible();
        await page.getByRole('tab', { name: /Comments/ }).click();
        const box = page.getByRole('textbox', { name: 'New comment' });
        await box.pressSequentially('See MEN-1, @');
        const picker = page.getByRole('listbox', { name: 'Mention a member' });
        await expect(picker.getByRole('option', { name: isolatedTenant.ownerName })).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(box).toHaveValue(/^See MEN-1, <@[^>]+> $/);
        const sent = page.waitForResponse((r) => r.url().endsWith('/comments') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Comment', exact: true }).click();
        expect((await sent).status()).toBe(201);

        // The server recorded the mention: the token is a chip with the name, and the key links.
        const comments = page.getByRole('list', { name: 'Comments' });
        await expect(comments.getByText(`@${isolatedTenant.ownerName}`)).toBeVisible();
        await comments.getByRole('link', { name: 'MEN-1' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/work-items/MEN-1$`));
        await expect(page.getByRole('heading', { level: 1, name: 'Linked one' })).toBeVisible();
    });

    test('the board moves cards with the keyboard alone', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId, typeId } = await seedProject(page.request, slug, 'KBD');
        await seedItem(page.request, slug, { projectId, typeId, title: 'First' });
        await seedItem(page.request, slug, { projectId, typeId, title: 'Second' });

        await page.goto(`/t/${slug}/projects/KBD`);
        await showBoard(page);
        const todo = column(page, 'Todo');
        await expect(todo.getByRole('button', { name: 'KBD-2: Second' })).toBeVisible();

        // Reach the second card by Tab alone.
        const second = card(page, 'KBD-2', 'Second');
        for (let i = 0; i < 80; i++) {
            await page.keyboard.press('Tab');
            if (await second.evaluate((el) => el === document.activeElement)) break;
        }
        await expect(second).toBeFocused();

        // Reorder above the first card, then cancel a move with Escape.
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Space');
        await expect(page.getByRole('status', { name: 'Board announcements' })).toContainText('Dropped KBD-2 in Todo at position 1');
        await expect
            .poll(async () => (await todo.getByRole('button', { name: /^KBD-\d/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).slice(0, 2))
            .toEqual(['KBD-2: Second', 'KBD-1: First']);

        await expect(second).toBeFocused();
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('status', { name: 'Board announcements' })).toContainText('Move cancelled');
        await expect(todo.getByRole('button', { name: 'KBD-2: Second' })).toBeVisible();

        // Move to Done with three steps right, and it persists.
        await second.focus();
        await page.keyboard.press('Space');
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect(column(page, 'Done').getByRole('button', { name: 'KBD-2: Second' })).toBeVisible();
        await expect
            .poll(async () => ((await (await page.request.get(`/api/t/${slug}/work-items/by-key/KBD-2`)).json()) as { item: { stateCategory: string } }).item.stateCategory)
            .toBe('DONE');
    });
});
