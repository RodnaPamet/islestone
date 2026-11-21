/**
 * Changing dates from the timeline end to end (roadmap 3.1c; owner decision
 * 194), on an isolated workspace with a chain of blocks:
 *
 *   - dragging the first bar two days later opens "Change dates", which
 *     offers to move the two items it pushes later; ticked and confirmed, the
 *     successors move on the chart at once, and Undo puts them back with
 *     nothing sent (the server's dates are unchanged);
 *   - confirmed and left alone, the change is sent when the undo window
 *     closes: every item of the chain has its new dates on the server.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';

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

interface Seeded {
    survey: { id: string; key: string };
    piers: { id: string; key: string };
    deck: { id: string; key: string };
}

async function seed(api: APIRequestContext, slug: string): Promise<Seeded> {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Bridge team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Bridge', keyPrefix: 'BRG' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const make = async (title: string, startDate: string, dueDate: string) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title, startDate, dueDate } });
        expect(res.status()).toBe(201);
        return (await res.json()) as { id: string; key: string };
    };
    // Mon–Tue, then Wed–Fri straight after, then Mon–Wed of the next week.
    const survey = await make('Survey the river', day(0), day(1));
    const piers = await make('Pour the piers', day(2), day(4));
    const deck = await make('Lay the deck', day(7), day(9));
    for (const [from, to] of [
        [survey, piers],
        [piers, deck],
    ] as const) {
        const rel = await api.post(`${base}/work-items/${from.id}/relations`, { data: { type: 'BLOCKS', toId: to.id } });
        expect(rel.status()).toBe(201);
    }
    return { survey, piers, deck };
}

async function datesOf(api: APIRequestContext, slug: string, id: string) {
    const res = await api.get(`/api/t/${slug}/work-items/${id}`);
    const body = (await res.json()) as { startDate: string | null; dueDate: string | null };
    return { startDate: body.startDate, dueDate: body.dueDate };
}

/** Open the project's timeline at day zoom. */
async function openTimeline(page: Page, slug: string): Promise<Locator> {
    await page.goto(`/t/${slug}/projects/BRG`);
    const main = page.getByRole('main');
    await expect(main.getByText('Survey the river')).toBeVisible();
    await main.getByRole('radio', { name: 'Timeline' }).click();
    await main.getByRole('combobox', { name: 'Zoom' }).click();
    await page.getByRole('option', { name: 'Days' }).click();
    const chart = main.getByRole('region', { name: 'Timeline chart' });
    await expect(chart.locator('.isl-timeline-bar').first()).toBeVisible();
    return chart;
}

/** A bar's left edge within the chart (independent of the chart's scroll). */
const leftOf = (bar: Locator) => bar.evaluate((el) => (el as HTMLElement).offsetLeft);

const barOf = (chart: Locator, title: string) => chart.locator('.wx-bar').filter({ has: chart.page().locator('.isl-timeline-bar', { hasText: title }) });

/** Drag a bar by `days` day cells (34 px each at day zoom), from its middle (a move, not a resize). */
async function dragBar(page: Page, bar: Locator, days: number) {
    await bar.scrollIntoViewIfNeeded();
    const box = (await bar.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y, { steps: 2 });
    await page.mouse.move(x + days * 34, y, { steps: 8 });
    await page.mouse.up();
}

/** Drag, tick "Also move the 2 items it pushes later" and confirm. */
async function dragAndConfirm(page: Page, chart: Locator, seeded: Seeded) {
    await dragBar(page, barOf(chart, 'Survey the river'), 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Change dates for ${seeded.survey.key}` }).first()).toBeVisible();
    const also = dialog.getByRole('checkbox', { name: 'Also move the 2 items it pushes later' });
    await expect(also).not.toBeChecked();
    await also.click();
    await dialog.getByRole('button', { name: 'Change dates' }).click();
    await expect(dialog).toBeHidden();
}

test.describe('changing dates from the timeline', () => {
    test('drag a bar in a chain, also move the items it pushes, and undo', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const seeded = await seed(page.request, slug);
        const chart = await openTimeline(page, slug);
        const deckBefore = await leftOf(barOf(chart, 'Lay the deck'));
        const writes: string[] = [];
        page.on('request', (req) => {
            if (req.method() !== 'GET' && req.url().includes('/work-items')) writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
        });

        await dragAndConfirm(page, chart, seeded);
        // The successor moves on the chart at once (two working days later: Wed to Fri of the next week).
        await expect.poll(() => leftOf(barOf(chart, 'Lay the deck'))).toBe(deckBefore + 2 * 34);
        await expect(page.getByText(`Moving ${seeded.survey.key} and 2 items.`)).toBeVisible();

        await page.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => leftOf(barOf(chart, 'Lay the deck'))).toBe(deckBefore);
        // Nothing was sent, and the server still has the old dates.
        await page.waitForTimeout(5_500);
        expect(writes).toEqual([]);
        expect(await datesOf(page.request, slug, seeded.piers.id)).toEqual({ startDate: day(2), dueDate: day(4) });
        expect(await datesOf(page.request, slug, seeded.deck.id)).toEqual({ startDate: day(7), dueDate: day(9) });
    });

    test('confirmed and left alone, the chain is sent when the undo window closes', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const seeded = await seed(page.request, slug);
        const chart = await openTimeline(page, slug);
        const sent = page.waitForResponse((r) => r.url().endsWith('/work-items/bulk/dates') && r.request().method() === 'POST', { timeout: 15_000 });
        await dragAndConfirm(page, chart, seeded);
        expect((await sent).status()).toBe(200);
        // Survey Wed–Thu; the piers move to Fri–Tue (three working days); the deck to Wed–Fri.
        expect(await datesOf(page.request, slug, seeded.survey.id)).toEqual({ startDate: day(2), dueDate: day(3) });
        expect(await datesOf(page.request, slug, seeded.piers.id)).toEqual({ startDate: day(4), dueDate: day(8) });
        expect(await datesOf(page.request, slug, seeded.deck.id)).toEqual({ startDate: day(9), dueDate: day(11) });
    });
});
