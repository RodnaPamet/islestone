/**
 * Capacity and time off end to end (roadmap 3.5a; owner decisions 284 to 288,
 * 297, 298 and 303), on an isolated workspace:
 *
 *   - the Workload entry in the sidebar, the page's capacity grid;
 *   - "My capacity and time off": a working day opened from the month of
 *     dates, recorded as a whole day of Vacation through the dialog's
 *     preview, on the server with its type, then shown in the grid's week;
 *   - Settings → Workload: the default changed to 37h 30m, and the owner's
 *     own capacity from next Monday, on the server;
 *   - allocation (3.5b): an hours team's item of 50 hours over next week,
 *     assigned to the owner, fills that week over capacity in the grid; the
 *     cell opens its items in a sheet and the item opens its own sheet; My
 *     Work's line says next week is over.
 */
import type { APIRequestContext } from '@playwright/test';

import { e2eDay, e2eToday } from './e2e-utils';
import { expect, test } from './fixtures';

function isoWeekday(ymd: string): number {
    const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d;
}

function mondayOf(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (isoWeekday(ymd) - 1));
    return d.toISOString().slice(0, 10);
}

test.describe('workload', () => {
    test('record time off from the month of dates, see it in the grid, and set capacity in Settings', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const today = e2eToday();

        await page.goto(`/t/${slug}/my-work`);
        await page.getByTestId('nav-workload').click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/workload$`));
        const grid = page.getByRole('grid', { name: /Workload by week/ });
        await expect(grid).toBeVisible();

        // The next working day (Monday to Friday) from tomorrow.
        let offset = 1;
        while (isoWeekday(e2eDay(offset)) > 5) offset += 1;
        const date = e2eDay(offset);
        if (date.slice(0, 7) !== today.slice(0, 7)) await page.getByRole('button', { name: 'Next month' }).click();
        const cell = page.getByTestId(`my-time-off-day-${date}`);
        await cell.click();
        const dialog = page.getByRole('dialog', { name: 'Add time off' });
        await expect(dialog.getByTestId('time-off-preview').getByRole('listitem')).toHaveCount(1);
        await dialog.getByRole('radio', { name: 'Vacation' }).check();
        const saved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/time-off/days` && r.request().method() === 'PUT');
        await dialog.getByRole('button', { name: 'Save' }).click();
        expect((await saved).status()).toBe(200);
        await expect(dialog).toBeHidden();
        await expect(cell).toContainText('Whole day');
        await expect(cell).toContainText('Vacation');

        const onServer = (await (await page.request.get(`/api/t/${slug}/time-off?from=${date}&to=${date}`)).json()) as { days: Array<{ day: string; minutes: number | null; type?: string }> };
        expect(onServer.days).toEqual([expect.objectContaining({ day: date, minutes: null, type: 'VACATION' })]);

        // The grid's week of that date: 32h of 40h, with the time-off mark.
        const workload = (await (await page.request.get(`/api/t/${slug}/workload?weeks=2`)).json()) as { people: Array<{ userId: string }> };
        const me = workload.people[0]!.userId;
        const week = mondayOf(date);
        await expect(page.getByTestId(`workload-cell-${me}-${week}`)).toContainText('Time off 8h');

        // Settings → Workload: the default, then the owner's capacity from next Monday.
        await page.goto(`/t/${slug}/settings/workload`);
        await page.getByRole('textbox', { name: 'Hours a week' }).fill('37h 30m');
        const defaultSaved = page.waitForResponse((r) => r.url().endsWith('/workload-settings') && r.request().method() === 'PUT');
        await page.getByRole('button', { name: 'Save default' }).click();
        expect((await defaultSaved).status()).toBe(200);
        await expect(page.getByText('Default capacity saved.')).toBeVisible();

        const row = page.getByTestId(`workload-member-${me}`);
        await expect(row).toContainText('Default (37h 30m)');
        await row.getByRole('button', { name: /Change the capacity of/ }).click();
        const capacity = page.getByRole('dialog', { name: /Change capacity/ });
        await capacity.getByRole('textbox', { name: 'Hours a week' }).fill('24h');
        const capSaved = page.waitForResponse((r) => r.url().endsWith(`/members/${me}/capacity`) && r.request().method() === 'PUT');
        await capacity.getByRole('button', { name: 'Save' }).click();
        expect((await capSaved).status()).toBe(200);
        await expect(row).toContainText('24h from');
        const history = (await (await page.request.get(`/api/t/${slug}/members/${me}/capacity`)).json()) as { rows: Array<{ weeklyMinutes: number; effectiveFrom: string }> };
        expect(history.rows).toEqual([expect.objectContaining({ weeklyMinutes: 1440 })]);
        expect(isoWeekday(history.rows[0]!.effectiveFrom)).toBe(1);
    });

    test("an item's hours fill its assignee's week over capacity, the week opens its items, and My Work says so", async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const me = await meOf(page.request, slug);
        // Next week's Monday to Friday: 50 hours there are over the default 40.
        const nextMonday = mondayOf(e2eDay(7));
        const friday = new Date(Date.parse(`${nextMonday}T00:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
        const item = await seedHoursItem(page.request, slug, { assigneeId: me, startDate: nextMonday, dueDate: friday, estimateMinutes: 3000 });

        await page.goto(`/t/${slug}/workload`);
        const cell = page.getByTestId(`workload-cell-${me}-${nextMonday}`);
        await expect(cell).toContainText('50h / 40h');
        await expect(cell).toContainText('Over by 10h');
        await expect(cell).toHaveAttribute('data-over', 'true');

        await cell.click();
        const sheet = page.getByTestId('workload-cell-sheet');
        await expect(sheet.getByTestId('workload-cell-summary')).toContainText('50h allocated of 40h, over by 10h');
        const table = sheet.getByTestId('workload-cell-table');
        await expect(table).toContainText(item.key);
        await expect(table).toContainText('Spread over 5 working days');
        await table.getByText('Plan the launch').click();
        await expect(page.getByRole('dialog').getByRole('heading', { name: /Plan the launch/ }).first()).toBeVisible();

        await page.goto(`/t/${slug}/my-work`);
        await expect(page.getByTestId('my-workload-line')).toContainText('next week over by 10h');
    });
});

async function meOf(api: APIRequestContext, slug: string): Promise<string> {
    const workload = (await (await api.get(`/api/t/${slug}/workload?weeks=1&userId=me`)).json()) as { people: Array<{ userId: string }> };
    return workload.people[0]!.userId;
}

async function seedHoursItem(api: APIRequestContext, slug: string, fields: { assigneeId: string; startDate: string; dueDate: string; estimateMinutes: number }) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Hours team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const unit = await api.patch(`${base}/teams/${teamId}`, { data: { estimateUnit: 'HOURS' } });
    expect(unit.status()).toBe(200);
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Launch', keyPrefix: 'LCH' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId: ((await project.json()) as { id: string }).id, typeId: types[0]!.id, title: 'Plan the launch', ...fields } });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}
