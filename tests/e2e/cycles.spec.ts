/**
 * Cycles end to end (sub-phase 2.5a), on an isolated workspace: save a
 * team's cycle schedule on the Cycles page, put an item in the current cycle
 * from its detail, mark it done, and see the cycle's page count it (scope 1,
 * completed 1) and the burn-up's table show it for today. The rollover is a
 * job and is proved in the integration suite, not here.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Orbit team' } });
    expect(team.status()).toBe(201);
    const teamBody = (await team.json()) as { id: string; workflowStates: Array<{ id: string; category: string }> };
    const project = await api.post(`${base}/projects`, { data: { teamId: teamBody.id, name: 'Orbit', keyPrefix: 'ORB' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId: (await project.json()).id, typeId: types[0]!.id, title: 'Plan the launch' } });
    expect(item.status()).toBe(201);
    return {
        teamId: teamBody.id,
        doneStateId: teamBody.workflowStates.find((s) => s.category === 'DONE')!.id,
        item: (await item.json()) as { id: string; key: string },
    };
}

test.describe('cycles', () => {
    test('schedule cycles, plan an item into the current one, finish it, and read the burn-up', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { teamId, doneStateId, item } = await seed(page.request, slug);

        // The schedule: two-week cycles starting today, saved from the page.
        await page.goto(`/t/${slug}/cycles`);
        const team = page.getByRole('main').getByRole('region', { name: 'Orbit team' });
        await expect(team.getByText('No current cycle.')).toBeVisible();
        await team.getByRole('button', { name: 'Cycle schedule for Orbit team' }).click();
        const dialog = page.getByRole('dialog', { name: 'Cycle schedule for Orbit team' });
        await dialog.getByRole('button', { name: 'Save schedule' }).click();
        await expect(dialog).toBeHidden();
        const current = team.getByTestId(/^current-cycle-/);
        await expect(current).toBeVisible();
        await expect(team.getByRole('heading', { name: 'Upcoming' })).toBeVisible();

        // The item joins the current cycle from its page.
        await page.goto(`/t/${slug}/work-items/${item.key}`);
        await page.getByRole('combobox', { name: 'No cycle' }).click();
        const saved = page.waitForResponse((r) => r.url().endsWith(`/work-items/${item.id}/cycle`) && r.request().method() === 'PUT');
        await page.getByRole('option', { name: /\(current\)$/ }).click();
        expect((await saved).status()).toBe(200);
        await expect(page.getByRole('combobox', { name: /\(current\)$/ })).toBeVisible();

        // Done, through the API (the state picker is 2.3's, tested there).
        const fresh = (await (await page.request.get(`/api/t/${slug}/work-items/${item.id}`)).json()) as { version: number; cycleId: string };
        expect(fresh.cycleId).toBeTruthy();
        const done = await page.request.post(`/api/t/${slug}/work-items/${item.id}/state`, {
            data: { stateId: doneStateId },
            headers: { 'If-Match': `"${fresh.version}"` },
        });
        expect(done.status()).toBe(200);

        // The cycle's page counts it, and the burn-up's table shows today.
        await page.goto(`/t/${slug}/cycles/${fresh.cycleId}`);
        const summary = page.getByTestId('cycle-summary');
        await expect(summary).toBeVisible();
        await expect(summary.locator('dd').nth(0)).toHaveText('1');
        await expect(summary.locator('dd').nth(2)).toHaveText('1');
        await page.getByRole('button', { name: 'Show as table' }).click();
        const table = page.getByRole('table', { name: /at the end of each day/ });
        await expect(table.getByRole('row').last()).toContainText('1');
        await expect(page.getByRole('main').getByText('Plan the launch')).toBeVisible();

        // The schedule is there for the next visit.
        const schedule = (await (await page.request.get(`/api/t/${slug}/teams/${teamId}/cycle-schedule`)).json()) as { saved: boolean; enabled: boolean };
        expect(schedule).toMatchObject({ saved: true, enabled: true });
    });
});
