/**
 * The calendar view end to end (roadmap 3.3a; owner decisions 241 and 242),
 * on an isolated workspace with a chain of blocks, a milestone and a cycle:
 *
 *   - the Calendar layout on a project's page draws the items on their due
 *     dates, the milestone's diamond and the cycle's band; dragging a chip
 *     two days later opens "Change dates" with the due and start dates moved
 *     alike and "Also move the N items it pushes later"; ticked and
 *     confirmed, the change is held behind the undo toast and sent as one
 *     bulk change of dates;
 *   - by keyboard: a focused day opens its day panel with Enter, "Move to
 *     date…" asks for the day with the date picker, and "Change dates" sends
 *     the item's PATCH; the chip is on its new day.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { plannedDay as day } from './e2e-utils';
import { expect, test } from './fixtures';


/** The date picker's day button label ("Thursday, March 12th, 2026"). */
function pickerLabel(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    const n = d.getUTCDate();
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
    return `${weekday}, ${month} ${n}${suffix}, ${d.getUTCFullYear()}`;
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
    const milestone = await api.post(`${base}/projects/${projectId}/milestones`, { data: { name: 'Deck open', dueDate: day(3) } });
    expect(milestone.status()).toBe(201);
    const cycle = await api.post(`${base}/cycles`, { data: { teamId, name: 'Span one', startsOn: day(0), endsOn: day(13) } });
    expect(cycle.status()).toBe(201);
    return { survey, piers, deck };
}

async function datesOf(api: APIRequestContext, slug: string, id: string) {
    const body = (await (await api.get(`/api/t/${slug}/work-items/${id}`)).json()) as { startDate: string | null; dueDate: string | null };
    return { startDate: body.startDate, dueDate: body.dueDate };
}

const cell = (main: Locator, ymd: string) => main.locator(`[role="gridcell"][data-ymd="${ymd}"]`);

/** Open the project's calendar on the month of `day(0)`. */
async function openCalendar(page: Page, slug: string): Promise<Locator> {
    await page.goto(`/t/${slug}/projects/BRG`);
    const main = page.getByRole('main');
    await expect(main.getByText('Survey the river')).toBeVisible();
    await main.getByRole('radio', { name: 'Calendar' }).click();
    await expect(main.getByRole('grid')).toBeVisible();
    const inMonth = async () => (await cell(main, day(0)).count()) > 0 && (await cell(main, day(0)).getAttribute('data-in-month')) === 'true';
    for (let i = 0; i < 3 && !(await inMonth()); i++) {
        await main.getByRole('button', { name: 'Next month' }).click();
        await expect(main.getByRole('grid')).toBeVisible();
    }
    await expect(cell(main, day(0))).toHaveAttribute('data-in-month', 'true');
    await expect(cell(main, day(1)).getByRole('button', { name: /Survey the river/ })).toBeVisible();
    return main;
}

test.describe('the calendar view', () => {
    test('draws the items, the milestone and the cycle; a dragged chip opens Change dates and moves the chain', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const seeded = await seed(page.request, slug);
        const main = await openCalendar(page, slug);
        await expect(cell(main, day(4)).getByRole('button', { name: /Pour the piers/ })).toBeVisible();
        await expect(cell(main, day(3)).getByRole('link', { name: 'milestone Deck open due' })).toBeVisible();
        await expect(cell(main, day(0)).locator('[data-cycle-band]')).toHaveText('Span one');

        const writes: string[] = [];
        page.on('request', (req) => {
            if (req.method() !== 'GET' && req.url().includes('/work-items')) writes.push(`${req.method()} ${new URL(req.url()).pathname}`);
        });
        const chip = main.locator(`[data-item-id="${seeded.survey.id}"]`);
        await expect(chip).toHaveAttribute('data-movable', 'true');
        await chip.dragTo(cell(main, day(3)));

        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: `Change dates for ${seeded.survey.key}` }).first()).toBeVisible();
        const also = dialog.getByRole('checkbox', { name: /^Also move the \d+ items? it pushes later$/ });
        await expect(also).not.toBeChecked();
        await also.click();
        const sent = page.waitForResponse((r) => r.url().endsWith('/work-items/bulk/dates') && r.request().method() === 'POST', { timeout: 15_000 });
        await dialog.getByRole('button', { name: 'Change dates' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText(new RegExp(`^Moving ${seeded.survey.key} and \\d+ items?\\.$`))).toBeVisible();
        // Shown at once, sent when the undo window closes.
        await expect(cell(main, day(3)).locator(`[data-item-id="${seeded.survey.id}"]`)).toBeVisible();
        expect(writes).toEqual([]);
        expect((await sent).status()).toBe(200);
        expect(await datesOf(page.request, slug, seeded.survey.id)).toEqual({ startDate: day(2), dueDate: day(3) });
        const piers = await datesOf(page.request, slug, seeded.piers.id);
        expect(piers.dueDate! > day(4)).toBe(true);
    });

    test('by keyboard: the day panel, "Move to date…" and the PATCH', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const seeded = await seed(page.request, slug);
        const main = await openCalendar(page, slug);
        await cell(main, day(4)).focus();
        await page.keyboard.press('Enter');
        const panel = main.getByTestId('calendar-day-panel');
        await expect(panel.getByRole('heading', { name: /^Due / })).toBeVisible();
        await panel.getByRole('button', { name: `Move ${seeded.piers.key} to another date` }).click();

        const move = page.getByRole('dialog');
        await expect(move.getByRole('heading', { name: `Move ${seeded.piers.key} to another date` }).first()).toBeVisible();
        await page.locator('#calendar-move-date').click();
        await page.getByRole('button', { name: pickerLabel(day(3)) }).click();
        await move.getByRole('button', { name: 'Continue' }).click();

        const change = page.getByRole('dialog');
        await expect(change.getByRole('heading', { name: `Change dates for ${seeded.piers.key}` }).first()).toBeVisible();
        const sent = page.waitForResponse((r) => r.url().endsWith(`/work-items/${seeded.piers.id}`) && r.request().method() === 'PATCH');
        await change.getByRole('button', { name: 'Change dates' }).click();
        const res = await sent;
        expect(res.status()).toBe(200);
        expect(res.request().headers()['if-match']).toMatch(/^"\d+"$/);
        await expect(cell(main, day(3)).locator(`[data-item-id="${seeded.piers.id}"]`)).toBeVisible();
        expect(await datesOf(page.request, slug, seeded.piers.id)).toEqual({ startDate: day(1), dueDate: day(3) });
    });
});
