/**
 * The Inbox, notification preferences and Settings → Notifications end to
 * end (sub-phase 2.7c; owner decisions 132, 134 and 136), on an isolated
 * workspace: an owner assigned a work item finds it Unread in the Inbox,
 * marks it Done (the undo window closes and it is on the Done tab), turns a
 * kind's bell off in their preferences and sees it stay off after a reload,
 * and opens the workspace's notification settings from Settings.
 *
 * The item is made over HTTP (the Inbox is under test, not the create path).
 * Written fresh for Islestone.
 */
import { expect, test } from './fixtures';

test.describe('Inbox', () => {
    test('an assignment reaches the Inbox, is marked Done, and preferences and settings hold', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const api = page.request;
        const base = `/api/t/${slug}`;
        const teamId = (await (await api.post(`${base}/teams`, { data: { name: 'Inbox team' } })).json()).id as string;
        const projectId = (await (await api.post(`${base}/projects`, { data: { teamId, name: 'Inbox', keyPrefix: 'INB' } })).json()).id as string;
        const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
        const me = ((await (await api.get(`${base}/users/assignable`)).json()) as Array<{ id: string }>)[0]!.id;
        const created = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title: 'Read the inbox', assigneeId: me } });
        expect(created.status()).toBe(201);

        await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Inbox' }).click();
        await page.waitForURL(`**/t/${slug}/inbox`, { timeout: 30_000 });
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1 })).toHaveText('Inbox');
        await expect(main.getByRole('button', { name: 'Unread (1)' })).toHaveAttribute('aria-pressed', 'true');
        await expect(main.getByText('INB-1 "Read the inbox" is now yours.')).toBeVisible();

        await main.getByRole('button', { name: 'Mark as done: You were assigned a work item' }).click();
        await expect(main.getByText('Nothing unread. You are all caught up.')).toBeVisible();
        // The write leaves when the undo window closes; the Done tab then holds the row.
        await page.waitForTimeout(5_500);
        await main.getByRole('button', { name: 'Done', exact: true }).click();
        await expect(main.getByText('INB-1 "Read the inbox" is now yours.')).toBeVisible();

        await main.getByRole('link', { name: 'Notification preferences' }).click();
        await page.waitForURL(`**/t/${slug}/inbox/preferences`);
        await expect(main.getByRole('heading', { level: 1, name: 'Notification preferences' })).toBeVisible();
        const bell = main.getByRole('switch', { name: 'Watched work items: in the Inbox and bell' });
        await expect(bell).toBeChecked();
        await bell.click();
        await expect(page.getByText('Preferences saved')).toBeVisible();
        await page.reload();
        await expect(page.getByRole('main').getByRole('switch', { name: 'Watched work items: in the Inbox and bell' })).not.toBeChecked();

        await page.getByRole('link', { name: 'Settings', exact: true }).click();
        await page.waitForURL(`**/t/${slug}/settings`);
        await page.getByRole('main').getByRole('link', { name: 'Open notification settings' }).click();
        await page.waitForURL(`**/t/${slug}/settings/notifications`);
        await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
        await expect(page.getByRole('main').getByRole('switch', { name: 'Send email notifications' })).toBeChecked();
    });
});
