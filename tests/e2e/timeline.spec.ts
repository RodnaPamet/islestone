/**
 * The timeline end to end (roadmap 3.1b), on an isolated workspace:
 *
 *   - a project with a chain of blocks: the Timeline layout draws the chain
 *     as the critical path (bars and the link between them), the item off
 *     the chain is not critical, the undated item is in the "No dates" list,
 *     and the table toggle shows the same rows; the widget's code is fetched
 *     only when the timeline opens, and nothing is requested from the
 *     vendor's CDN;
 *   - the 5,000-item budget (H3): a timeline answer of 5,000 items (served to
 *     the built page in place of the server's) draws its first bars within
 *     the ceiling, renders a bounded window of rows (the widget and the table
 *     both virtualise), and reports the time it took. Browser timings are
 *     reported, not gated, on pull requests (decision 168); the ceiling here
 *     only catches a collapse.
 */
import type { APIRequestContext, Request } from '@playwright/test';

import { computeTimelineSchedule, type TimelineData, type TimelineRow } from '../../src/lib/work-items/timeline';

import { e2eToday, plannedDay as day } from './e2e-utils';
import { expect, test } from './fixtures';


async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Bridge team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Bridge', keyPrefix: 'BRG' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const make = async (title: string, dates: { startDate?: string; dueDate?: string }) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title, ...dates } });
        expect(res.status()).toBe(201);
        return (await res.json()) as { id: string; key: string };
    };
    const survey = await make('Survey the river', { startDate: day(0), dueDate: day(1) });
    const piers = await make('Pour the piers', { startDate: day(2), dueDate: day(4) });
    const deck = await make('Lay the deck', { startDate: day(7), dueDate: day(9) });
    await make('Order the paint', { startDate: day(0), dueDate: day(0) });
    await make('Name the bridge', {});
    for (const [from, to] of [
        [survey, piers],
        [piers, deck],
    ] as const) {
        const rel = await api.post(`${base}/work-items/${from.id}/relations`, { data: { type: 'BLOCKS', toId: to.id } });
        expect(rel.status()).toBe(201);
    }
    return { projectId };
}

test.describe('the timeline', () => {
    test('a chain of blocks is the critical path, and the table shows the same rows', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await seed(page.request, slug);

        const scripts: string[] = [];
        const vendorRequests: string[] = [];
        page.on('request', (req: Request) => {
            if (req.url().includes('svar.dev')) vendorRequests.push(req.url());
        });
        page.on('response', async (res) => {
            if (res.request().resourceType() === 'script' && res.ok()) scripts.push(await res.text().catch(() => ''));
        });

        await page.goto(`/t/${slug}/projects/BRG`);
        const main = page.getByRole('main');
        await expect(main.getByText('Survey the river')).toBeVisible();
        // The list loaded no widget code.
        expect(scripts.some((s) => s.includes('wx-willow-theme'))).toBe(false);

        const timelineRead = page.waitForResponse((r) => r.url().includes('/work-items/timeline') && r.request().method() === 'GET');
        await main.getByRole('radio', { name: 'Timeline' }).click();
        expect((await timelineRead).status()).toBe(200);
        const chart = main.getByRole('region', { name: 'Timeline chart' });
        await expect(chart.locator('.isl-timeline-bar').first()).toBeVisible();
        await expect.poll(() => scripts.some((s) => s.includes('wx-willow-theme'))).toBe(true);

        // The chain is critical; the item off it is not.
        const criticalBars = chart.locator('.isl-timeline-bar[data-critical="true"]');
        await expect(criticalBars).toHaveCount(3);
        await expect(criticalBars.filter({ hasText: 'Survey the river' })).toHaveCount(1);
        await expect(criticalBars.filter({ hasText: 'Lay the deck' })).toHaveCount(1);
        await expect(chart.locator('.isl-timeline-bar', { hasText: 'Order the paint' })).not.toHaveAttribute('data-critical', 'true');
        // Both links are drawn, and each has its critical rule.
        const rules = (await chart.locator('.isl-timeline > style').textContent()) ?? '';
        const linkIds = await chart.locator('[data-link-id]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-link-id')))]);
        expect(linkIds).toHaveLength(2);
        for (const id of linkIds) expect(rules).toContain(`[data-link-id="${id}"]`);
        // The undated item is listed beside the chart, and the summary says what finishes when.
        await expect(main.getByTestId('timeline-no-dates').getByText('Name the bridge')).toBeVisible();
        await expect(main.getByTestId('timeline-summary')).toContainText('3 items on the critical path');

        // The table shows the same rows.
        await main.getByRole('radio', { name: 'Table' }).click();
        const table = main.getByTestId('timeline-schedule-table');
        await expect(table).toBeVisible();
        for (const title of ['Survey the river', 'Pour the piers', 'Lay the deck', 'Order the paint', 'Name the bridge']) {
            await expect(table.getByRole('row').filter({ hasText: title })).toHaveCount(1);
        }
        await expect(table.getByRole('row').filter({ hasText: 'Pour the piers' }).getByText('Critical', { exact: true })).toBeVisible();
        await expect(table.getByRole('row').filter({ hasText: 'Order the paint' }).getByText('Critical', { exact: true })).toHaveCount(0);
        expect(vendorRequests).toEqual([]);
    });

    test('5,000 items draw within the budget, in a bounded window', async ({ authedPage: page, isolatedTenant }, testInfo) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId } = await seed(page.request, slug);

        // 5,000 items in chains of 40, sub-items under every tenth, dates on 85 %.
        const rows: TimelineRow[] = [];
        const edges: TimelineData['edges'] = [];
        for (let i = 0; i < 5000; i++) {
            const chainPos = i % 40;
            const dated = i % 20 < 17;
            rows.push({
                id: `w${String(i).padStart(5, '0')}`,
                key: `BRG-${i + 1}`,
                title: `Item ${i + 1}`,
                projectId,
                teamId: 't',
                typeId: 'ty',
                stateCategory: 'UNSTARTED',
                assigneeId: null,
                parentId: i % 10 !== 0 && i % 40 > 30 ? `w${String(i - (i % 10)).padStart(5, '0')}` : null,
                sortKey: `a${String(i).padStart(5, '0')}`,
                startDate: dated ? day(chainPos * 2) : null,
                dueDate: dated ? day(chainPos * 2 + 1) : null,
                actualStart: null,
                actualFinish: null,
                milestoneId: null,
                calendarId: 'cal',
                version: 1,
                context: false,
            });
            if (chainPos > 0 && chainPos <= 30) edges.push({ id: `r${i}`, fromId: `w${String(i - 1).padStart(5, '0')}`, toId: `w${String(i).padStart(5, '0')}` });
        }
        const data: TimelineData = {
            asOf: e2eToday(),
            rows,
            edges,
            calendars: [{ id: 'cal', teamId: null, timeZone: 'UTC', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] }],
            milestones: [],
            projects: [{ id: projectId, name: 'Bridge', keyPrefix: 'BRG', dueDate: null, archived: false }],
            hiddenDependencies: 0,
            omittedContextRows: 0,
        };
        const body = JSON.stringify({ ...data, schedule: computeTimelineSchedule(data) });
        await page.route('**/work-items/timeline**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body }));

        await page.goto(`/t/${slug}/projects/BRG`);
        const main = page.getByRole('main');
        await expect(main.getByText('Survey the river')).toBeVisible();
        const started = Date.now();
        await main.getByRole('radio', { name: 'Timeline' }).click();
        const chart = main.getByRole('region', { name: 'Timeline chart' });
        await expect(chart.locator('.isl-timeline-bar').first()).toBeVisible({ timeout: 15_000 });
        const elapsed = Date.now() - started;
        testInfo.annotations.push({ type: 'timeline-5000-bars-visible-ms', description: String(elapsed) });
        console.log(`timeline: 5,000 items, first bars visible after ${elapsed} ms (budget p95 2,000 ms, reported)`);
        expect(elapsed).toBeLessThan(10_000);
        // A window, never every row: the widget virtualises.
        expect(await chart.locator('.isl-timeline-bar').count()).toBeLessThan(400);

        await main.getByRole('radio', { name: 'Table' }).click();
        const table = main.getByTestId('timeline-schedule-table');
        await expect(table.getByRole('row').filter({ hasText: 'BRG-1' }).first()).toBeVisible();
        expect(await table.getByRole('row').count()).toBeLessThan(200);
    });
});
