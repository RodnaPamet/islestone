/**
 * The roadmap end to end (sub-phase 3.2c; decisions 215, 216, 217 and 222),
 * on an isolated workspace: the Roadmap entry opens the Roadmap page; an
 * initiative and its project are drawn as bars on the read-only chart, an
 * undated project is in the "No dates" list, and nothing is requested from
 * the vendor's CDN; the table shows the same rows; a project's "Open
 * timeline" opens its page in the Timeline layout, and an initiative's the
 * Work items page in the Timeline layout filtered by it.
 */
import type { APIRequestContext, Request } from '@playwright/test';

import { expect, test } from './fixtures';

/** A date-only day `n` days after the first Monday at least three weeks from today (UTC). */
function day(n: number): string {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 21);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const created = async (path: string, data: Record<string, unknown>) => {
        const res = await api.post(`${base}${path}`, { data });
        expect(res.status()).toBe(201);
        return (await res.json()) as { id: string };
    };
    const team = await created('/teams', { name: 'Harbour team' });
    const goal = await created('/goals', { title: 'Open the harbour', dueDate: day(40) });
    const initiative = await created('/initiatives', { name: 'New quay', goalId: goal.id, dueDate: day(30) });
    const quay = await created('/projects', { teamId: team.id, name: 'Quay walls', keyPrefix: 'QUA', initiativeId: initiative.id });
    await created('/projects', { teamId: team.id, name: 'Lighthouse', keyPrefix: 'LHS', initiativeId: initiative.id });
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    for (const [title, dates] of [
        ['Drive the piles', { startDate: day(0), dueDate: day(9) }],
        ['Pour the cap', { startDate: day(14), dueDate: day(18) }],
    ] as const) {
        const res = await api.post(`${base}/work-items`, { data: { projectId: quay.id, typeId: types[0]!.id, title, ...dates } });
        expect(res.status()).toBe(201);
    }
    return { initiativeId: initiative.id };
}

test.describe('the roadmap', () => {
    test('draws initiatives and projects read-only, and a row opens its timeline', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { initiativeId } = await seed(page.request, slug);
        const vendorRequests: string[] = [];
        page.on('request', (req: Request) => {
            if (req.url().includes('svar.dev')) vendorRequests.push(req.url());
        });

        // The Roadmap entry opens the Roadmap page (decision 222).
        await page.goto(`/t/${slug}/my-work`);
        await page.getByTestId('nav-roadmap').click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/roadmap$`));
        const main = page.getByRole('main');
        await expect(main.getByRole('navigation', { name: 'Roadmap pages' }).getByRole('link', { name: 'Roadmap' })).toHaveAttribute('aria-current', 'page');

        // The chart: the initiative and its dated project as bars; the undated project beside it.
        const chart = main.getByRole('region', { name: 'Roadmap chart' });
        await expect(chart.locator('.isl-timeline-bar[data-kind="initiative"]', { hasText: 'New quay' })).toBeVisible();
        await expect(chart.locator('.isl-timeline-bar[data-kind="roadmap-project"]', { hasText: 'Quay walls' })).toBeVisible();
        await expect(chart.locator('.isl-timeline-bar', { hasText: 'Lighthouse' })).toHaveCount(0);
        await expect(main.getByTestId('roadmap-no-dates').getByRole('link', { name: 'Open the timeline of Lighthouse' })).toBeVisible();
        // Read-only: no editor, toolbar or menu.
        await expect(chart.locator('.wx-editor, .wx-toolbar, .wx-menu')).toHaveCount(0);

        // The table shows the same rows; a project's timeline is its page in the Timeline layout.
        await main.getByRole('radio', { name: 'Table' }).click();
        const table = main.getByTestId('roadmap-table');
        await expect(table.getByRole('row').filter({ hasText: 'Quay walls' })).toHaveCount(1);
        await expect(table.getByRole('row').filter({ hasText: 'Lighthouse' })).toHaveCount(1);
        await table.getByRole('link', { name: 'Open the timeline of Quay walls' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/projects/QUA\\?layout=timeline`));
        const timeline = page.getByRole('main').getByRole('region', { name: 'Timeline chart' });
        await expect(timeline.locator('.isl-timeline-bar', { hasText: 'Drive the piles' })).toBeVisible();

        // An initiative's timeline: the Work items page in the Timeline layout, filtered by it (decision 220).
        await page.goto(`/t/${slug}/roadmap`);
        const timelineRead = page.waitForResponse((r) => r.url().includes('/work-items/timeline') && r.url().includes(`initiativeId=${initiativeId}`));
        await page.getByRole('main').getByTestId('roadmap-table').getByRole('link', { name: 'Open the timeline of New quay' }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/work-items\\?.*initiativeId=${initiativeId}`));
        expect((await timelineRead).status()).toBe(200);
        await expect(page.getByRole('main').getByRole('region', { name: 'Timeline chart' }).locator('.isl-timeline-bar', { hasText: 'Pour the cap' })).toBeVisible();
        expect(vendorRequests).toEqual([]);
    });
});
