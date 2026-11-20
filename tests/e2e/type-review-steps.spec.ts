/**
 * Default review steps per type and the Done check end to end (sub-phase
 * 2.8c; ADR 0009 §14 and §15; owner decisions 149 and 159), on an isolated
 * workspace: its owner sets a default review step on the type Feature in
 * Settings and turns on "Review must finish before Done"; a new Feature item
 * starts with that step planned; a drop into Done on the board is refused
 * with the server's sentence and the card goes back; once the round is sent
 * and signed off, the same drop lands.
 *
 * The item is unassigned, so the owner may review it (decision 158). Written
 * fresh for Islestone. The team, project and item are made through the API;
 * the defaults, the review and the moves through the UI.
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Gate team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Gated', keyPrefix: 'GTE' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string; name: string }>;
    return { projectId: ((await project.json()) as { id: string }).id, featureId: types.find((t) => t.name === 'Feature')!.id };
}

function column(page: Page, name: string) {
    return page.getByRole('main').getByRole('region', { name: 'Board' }).getByRole('region', { name, exact: true });
}

/** Keyboard move from Todo to Done (In progress, In review, Done): the Done column sits past the viewport. */
async function moveToDone(page: Page, name: string) {
    const card = page.getByRole('button', { name });
    await card.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('status', { name: 'Board announcements' }).filter({ hasText: 'Picked up' })).toBeAttached();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
}

async function stateOf(api: APIRequestContext, slug: string, id: string) {
    return ((await (await api.get(`/api/t/${slug}/work-items/${id}`)).json()) as { stateCategory: string }).stateCategory;
}

test.describe('default review steps and the Done check', () => {
    test('an admin sets a type default; a new item has the step; Done is refused until its review completes', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(180_000);
        const slug = isolatedTenant.tenantSlug;
        const { projectId, featureId } = await seed(page.request, slug);
        const main = page.getByRole('main');

        // Settings → Work item types → Feature → Review steps.
        await page.goto(`/t/${slug}/settings/work-item-types`);
        await main.getByRole('link', { name: 'Review steps of Feature' }).click();
        await expect(main.getByRole('heading', { level: 1, name: 'Feature review steps' })).toBeVisible();
        await main.getByRole('button', { name: 'Review step', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'New review step' });
        await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Sign-off');
        await dialog.getByRole('combobox', { name: 'No member named' }).click();
        await page.getByRole('option', { name: isolatedTenant.ownerName }).click();
        await dialog.getByRole('textbox', { name: 'Name', exact: true }).click();
        const saved = page.waitForResponse((r) => r.url().endsWith(`/work-item-types/${featureId}/review-steps`) && r.request().method() === 'PUT');
        await dialog.getByRole('button', { name: 'Save step' }).click();
        expect((await saved).status()).toBe(200);
        await expect(dialog).toBeHidden();
        await expect(main.getByTestId('settings-type-review-steps-table').getByText('Sign-off')).toBeVisible();
        const required = main.getByRole('switch', { name: /moves to Done/ });
        const turnedOn = page.waitForResponse((r) => r.url().endsWith(`/work-item-types/${featureId}/review-steps`) && r.request().method() === 'PUT');
        await required.click();
        expect((await turnedOn).status()).toBe(200);
        await expect(required).toBeChecked();

        // A new Feature item starts with the step, planned.
        const made = await page.request.post(`/api/t/${slug}/work-items`, { data: { projectId, typeId: featureId, title: 'Gated launch' } });
        expect(made.status()).toBe(201);
        const item = (await made.json()) as { id: string; key: string };
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await expect(main.getByRole('heading', { level: 3, name: 'Sign-off' })).toBeVisible();
        await expect(main.getByRole('button', { name: 'Send for review' })).toBeVisible();

        // The board: a drop into Done is refused with the server's sentence, and the card goes back.
        await page.goto(`/t/${slug}/projects/GTE`);
        await page.getByRole('radio', { name: 'Board' }).click();
        await expect(column(page, 'Todo').getByRole('button', { name: `${item.key}: Gated launch` })).toBeVisible();
        const refused = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/move`) && r.request().method() === 'POST');
        await moveToDone(page, `${item.key}: Gated launch`);
        expect((await refused).status()).toBe(409);
        await expect(page.getByText(`${item.key} cannot move to Done until its review is complete`)).toBeVisible();
        await expect(column(page, 'Todo').getByRole('button', { name: `${item.key}: Gated launch` })).toBeVisible();
        expect(await stateOf(page.request, slug, item.id)).not.toBe('DONE');

        // Send the round and sign it off.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        const sent = page.waitForResponse((r) => r.url().endsWith('/review/send') && r.request().method() === 'POST');
        await main.getByRole('button', { name: 'Send for review' }).click();
        expect((await sent).status()).toBe(200);
        await main.getByRole('button', { name: 'Sign off Sign-off' }).click();
        const signOff = page.getByRole('dialog', { name: 'Sign off Sign-off' });
        const signed = page.waitForResponse((r) => r.url().includes('/respond') && r.request().method() === 'POST');
        await signOff.getByRole('button', { name: 'Sign off' }).click();
        expect((await signed).status()).toBe(200);
        await expect(signOff).toBeHidden();

        // The same drop now lands.
        await page.goto(`/t/${slug}/projects/GTE`);
        await page.getByRole('radio', { name: 'Board' }).click();
        await expect(column(page, 'Todo').getByRole('button', { name: `${item.key}: Gated launch` })).toBeVisible();
        await moveToDone(page, `${item.key}: Gated launch`);
        await expect(column(page, 'Done').getByRole('button', { name: `${item.key}: Gated launch` })).toBeVisible();
        await expect.poll(() => stateOf(page.request, slug, item.id)).toBe('DONE');
    });
});
