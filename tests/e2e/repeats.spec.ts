/**
 * Repeats end to end (sub-phase 2.5d), on an isolated workspace: set a
 * repeat on an item from its page, see its next date, put it on hold and
 * resume it, then stop it through the undo toast. The nightly job is proved
 * in the integration suite, not here.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Rhythm team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Rhythm', keyPrefix: 'RHY' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, {
        data: { projectId: ((await project.json()) as { id: string }).id, typeId: types[0]!.id, title: 'Weekly review', dueDate: day(1) },
    });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}

test.describe('repeats', () => {
    test('set a repeat, put it on hold, resume it and stop it', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const item = await seed(page.request, slug);
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        const control = page.getByRole('main').getByTestId('repeat-control');
        await expect(control.getByText('Does not repeat')).toBeVisible();

        await control.getByRole('button', { name: 'Set repeat' }).click();
        const dialog = page.getByRole('dialog', { name: 'Repeat' });
        const saved = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/recurrence`) && r.request().method() === 'PUT');
        await dialog.getByRole('button', { name: 'Save repeat' }).click();
        expect((await saved).status()).toBe(200);
        await expect(dialog).toBeHidden();
        await expect(control.getByText('Every week')).toBeVisible();
        await expect(control.getByText(`Next copy due ${day(8)}, made 3 day(s) before.`)).toBeVisible();

        await control.getByRole('button', { name: 'Put on hold' }).click();
        await expect(control.getByRole('status')).toHaveText('On hold. Resume it to make copies again.');
        await control.getByRole('button', { name: 'Resume' }).click();
        await expect(control.getByText(/^Next copy due/)).toBeVisible();

        const removed = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/recurrence`) && r.request().method() === 'DELETE', { timeout: 15_000 });
        await control.getByRole('button', { name: 'Stop repeat' }).click();
        await expect(control.getByText('Does not repeat')).toBeVisible();
        expect((await removed).status()).toBe(200);
        const series = (await (await page.request.get(`/api/t/${slug}/work-items/${item.id}/recurrence`)).json()) as { rule: unknown };
        expect(series.rule).toBeNull();
    });
});
