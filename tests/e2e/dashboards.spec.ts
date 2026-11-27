/**
 * Dashboards end to end (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Dashboards (3.6d)" and "Editing"; owner decisions 326 to 328), on an
 * isolated workspace with a project and a completed item:
 *
 *   - the default dashboard; "Customise" saves a personal copy and opens it
 *     in edit mode;
 *   - "Add widget" (a Forecast with its own title) and a widget's settings
 *     (throughput over four weeks, read with the new window);
 *   - a widget dragged by its handle, sent as one versioned layout write;
 *   - a widget's removal through the undo toast, sent when the window closes;
 *   - rename and share; the page remembering the last dashboard opened;
 *   - the dashboard's delete through the undo toast, back to the default.
 *
 * Every change is read back from the server. Written fresh for Islestone.
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { e2eDay } from './e2e-utils';
import { expect, test } from './fixtures';

interface DashboardBody {
    id: string;
    name: string;
    visibility: 'PERSONAL' | 'SHARED';
    version: number;
    widgets: Array<{ id: string; type: string; title: string | null; position: { x: number; y: number }; shape: { config: { window?: { weeks?: number } } } | null }>;
}

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = (await (await api.post(`${base}/teams`, { data: { name: 'Board team' } })).json()) as { id: string };
    const project = await api.post(`${base}/projects`, { data: { teamId: team.id, name: 'Dash', keyPrefix: 'DSH' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const made = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title: 'Ship the dashboard' } });
    expect(made.status()).toBe(201);
    const states = (await (await api.get(`${base}/teams/${team.id}/workflow-states`)).json()) as Array<{ id: string; category: string }>;
    const id = ((await made.json()) as { id: string }).id;
    expect((await api.post(`${base}/work-items/${id}/move`, { data: { stateId: states.find((s) => s.category === 'DONE')!.id } })).status()).toBe(200);
}

async function dashboardOf(page: Page, slug: string, id: string): Promise<DashboardBody> {
    const res = await page.request.get(`/api/t/${slug}/dashboards/${id}`);
    expect(res.status()).toBe(200);
    return (await res.json()) as DashboardBody;
}

test.describe('dashboards', () => {
    test('customise the default, add, change, move and remove widgets, rename and share, remember it, delete it', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(120_000);
        const slug = isolatedTenant.tenantSlug;
        await seed(page.request, slug);

        await page.goto(`/t/${slug}/analytics`);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: 'Analytics' })).toBeAttached();
        await expect(main.getByTestId('analytics-count-done')).toHaveText('1');
        await expect(main.getByRole('button', { name: 'Edit' })).toHaveCount(0);

        // Customise: a personal copy of the default, opened in edit mode.
        await main.getByRole('button', { name: 'Customise' }).click();
        await page.waitForURL(new RegExp(`/t/${slug}/analytics/dashboards/([^/?]+)\\?edit=1$`));
        const id = /dashboards\/([^/?]+)/.exec(page.url())![1]!;
        await expect(main.getByRole('heading', { level: 1, name: 'My dashboard' })).toBeVisible();
        let saved = await dashboardOf(page, slug, id);
        expect(saved.widgets.map((w) => w.type)).toEqual(['COUNTS', 'THROUGHPUT', 'CYCLE_TIME', 'LEAD_TIME', 'CUMULATIVE_FLOW', 'BURN_UP', 'TIME_WAITING']);
        expect(saved.visibility).toBe('PERSONAL');

        // Add a Forecast widget with its own title.
        await main.getByRole('button', { name: 'Add widget' }).click();
        const picker = page.getByRole('dialog', { name: 'Add widget' });
        await picker.getByRole('combobox', { name: 'Throughput' }).click();
        await page.getByRole('option', { name: 'Forecast', exact: true }).click();
        await picker.getByRole('textbox', { name: 'Title' }).fill('Delivery forecast');
        await picker.getByRole('button', { name: 'Add widget' }).click();
        await expect(picker).toBeHidden();
        await expect(main.getByRole('region', { name: 'Delivery forecast' })).toBeVisible();
        await expect.poll(async () => (await dashboardOf(page, slug, id)).widgets.map((w) => w.title)).toContain('Delivery forecast');

        // Throughput over the last four weeks: the widget reads its new window.
        const read = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/analytics/throughput` && new URL(r.url()).searchParams.get('from') === e2eDay(-27));
        await main.getByRole('button', { name: 'Settings of Throughput' }).click();
        const settings = page.getByRole('dialog', { name: 'Widget settings' });
        await settings.getByRole('radio', { name: '4 weeks' }).click();
        await settings.getByRole('button', { name: 'Save' }).click();
        expect((await read).status()).toBe(200);
        await expect(main.getByRole('region', { name: 'Throughput' }).getByText(/Last 4 weeks/)).toBeVisible();
        saved = await dashboardOf(page, slug, id);
        expect(saved.widgets.find((w) => w.type === 'THROUGHPUT')!.shape!.config.window).toEqual({ kind: 'weeks', weeks: 4 });

        // Drag the counts below the throughput chart by its handle: one layout write on the version held.
        const before = (await dashboardOf(page, slug, id)).version;
        const layoutWrite = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/t/${slug}/dashboards/${id}/widgets`);
        const counts = saved.widgets.find((w) => w.type === 'COUNTS')!;
        const handle = main.getByTestId(`dashboard-drag-${counts.id}`);
        const box = (await handle.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 12 });
        await page.mouse.move(box.x + box.width / 2, box.y + 420, { steps: 12 });
        await page.mouse.up();
        const written = await layoutWrite;
        expect(written.status()).toBe(200);
        expect(written.request().headers()['if-match']).toBe(`"${before}"`);
        await expect.poll(async () => (await dashboardOf(page, slug, id)).widgets.find((w) => w.type === 'COUNTS')!.position.y).toBeGreaterThan(0);

        // Remove Lead time: gone at once; sent when the undo window closes.
        await main.getByRole('button', { name: 'Remove Lead time' }).click();
        await expect(main.getByRole('region', { name: 'Lead time' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
        await expect.poll(async () => (await dashboardOf(page, slug, id)).widgets.map((w) => w.type), { timeout: 15_000 }).not.toContain('LEAD_TIME');

        // Rename and share it.
        await main.getByRole('button', { name: 'Rename and share' }).click();
        const rename = page.getByRole('dialog', { name: 'Rename and share the dashboard' });
        await rename.getByRole('textbox', { name: 'Name' }).fill('Team flow');
        await rename.getByRole('radio', { name: 'Everyone who sees analytics' }).click();
        await rename.getByRole('button', { name: 'Save' }).click();
        await expect(main.getByRole('heading', { level: 1, name: 'Team flow' })).toBeVisible();
        saved = await dashboardOf(page, slug, id);
        expect([saved.name, saved.visibility]).toEqual(['Team flow', 'SHARED']);
        await main.getByRole('button', { name: 'Done' }).click();
        await expect(main.getByRole('button', { name: 'Add widget' })).toHaveCount(0);

        // The Analytics page opens the last dashboard opened.
        await page.goto(`/t/${slug}/analytics`);
        await page.waitForURL(new RegExp(`/t/${slug}/analytics/dashboards/${id}$`));
        await expect(main.getByRole('heading', { level: 1, name: 'Team flow' })).toBeVisible();

        // Delete it through the undo toast: back to the default, gone when the window closes.
        await main.getByRole('button', { name: 'Edit' }).click();
        await main.getByRole('button', { name: 'Delete dashboard' }).click();
        await page.waitForURL(new RegExp(`/t/${slug}/analytics$`));
        await expect(main.getByRole('heading', { level: 1, name: 'Analytics' })).toBeAttached();
        await expect
            .poll(async () => ((await (await page.request.get(`/api/t/${slug}/dashboards`)).json()) as { dashboards: Array<{ id: string }> }).dashboards.map((d) => d.id), { timeout: 15_000 })
            .not.toContain(id);
    });
});
