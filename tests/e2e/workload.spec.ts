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
 *     Work's line says next week is over;
 *   - the ways to rebalance (3.5c): "Move dates" opens "Change dates" with
 *     the earliest later dates that fit and the change lands; "Assign to …"
 *     names a Member already on the project, opens the assign picker with
 *     them chosen, and the assignment moves the hours to them.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import { createIsolatedTenant, e2eDay, e2eToday, signInAs, waitForHydration } from './e2e-utils';
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

test.describe('ways to rebalance', () => {
    test('"Move dates" opens Change dates with the earliest later dates that fit, and the week is no longer over', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const me = await meOf(page.request, slug);
        const nextMonday = mondayOf(e2eDay(7));
        const day = (n: number) => new Date(Date.parse(`${nextMonday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
        // 30h and 20h over next week's five working days: 50h against 40h.
        const { project, typeId } = await seedHoursProject(page.request, slug, 'MVD');
        const big = await seedItem(page.request, slug, { projectId: project, typeId, title: 'Big launch', assigneeId: me, startDate: day(0), dueDate: day(4), estimateMinutes: 1800 });
        await seedItem(page.request, slug, { projectId: project, typeId, title: 'Smaller task', assigneeId: me, startDate: day(0), dueDate: day(4), estimateMinutes: 1200 });

        await page.goto(`/t/${slug}/workload`);
        await page.getByTestId(`workload-cell-${me}-${nextMonday}`).click();
        const ways = page.getByRole('region', { name: 'Ways to rebalance' });
        const first = ways.getByTestId('workload-rebalance-item').first();
        await expect(first).toContainText(big.key);
        // Moved by two working days, three of its five fall in next week (18h): Wednesday to the next Tuesday.
        const move = first.getByRole('button', { name: /^Move dates to/ });
        await expect(move).toBeVisible();
        await move.click();
        const dialog = page.getByRole('dialog', { name: `Change dates for ${big.key}` });
        await expect(dialog.getByTestId('change-dates-dialog')).toBeVisible();
        const patched = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/work-items/${big.id}` && r.request().method() === 'PATCH');
        await dialog.getByRole('button', { name: 'Change dates' }).click();
        expect((await patched).status()).toBe(200);
        const onServer = (await (await page.request.get(`/api/t/${slug}/work-items/${big.id}`)).json()) as { startDate: string; dueDate: string };
        expect({ startDate: onServer.startDate.slice(0, 10), dueDate: onServer.dueDate.slice(0, 10) }).toEqual({ startDate: day(2), dueDate: day(8) });
        await expect(page.getByTestId(`workload-cell-${me}-${nextMonday}`)).toContainText('38h / 40h');
    });

    test('"Assign to …" names a Member on the project, opens the assign picker with them chosen, and moves the hours', async ({ authedPage: page, isolatedTenant, browser, request }) => {
        test.setTimeout(180_000);
        const slug = isolatedTenant.tenantSlug;
        const me = await meOf(page.request, slug);
        const nextMonday = mondayOf(e2eDay(7));
        const day = (n: number) => new Date(Date.parse(`${nextMonday}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
        const contexts: BrowserContext[] = [];
        try {
            const mia = await invitedMember(browser, page, slug, request);
            contexts.push(mia.context);
            const miaId = await meOf(mia.page.request, slug);
            const { project, typeId } = await seedHoursProject(page.request, slug, 'ASG');
            const big = await seedItem(page.request, slug, { projectId: project, typeId, title: 'Big launch', assigneeId: me, startDate: day(0), dueDate: day(4), estimateMinutes: 1800 });
            await seedItem(page.request, slug, { projectId: project, typeId, title: 'Smaller task', assigneeId: me, startDate: day(0), dueDate: day(4), estimateMinutes: 1200 });
            // Mia is on the project with 2h next week.
            await seedItem(page.request, slug, { projectId: project, typeId, title: 'Mia\'s part', assigneeId: miaId, startDate: day(0), dueDate: day(4), estimateMinutes: 120 });

            await page.goto(`/t/${slug}/workload`);
            await page.getByTestId(`workload-cell-${me}-${nextMonday}`).click();
            const ways = page.getByRole('region', { name: 'Ways to rebalance' });
            const first = ways.getByTestId('workload-rebalance-item').first();
            await expect(first).toContainText(big.key);
            await expect(first).toContainText('38h free that week');
            await first.getByRole('button', { name: /^Assign to / }).click();
            const dialog = page.getByRole('dialog', { name: `Assign ${big.key}` });
            await expect(dialog.getByRole('combobox', { name: 'Assignee' })).toBeVisible();
            const assigned = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/work-items/${big.id}/assign` && r.request().method() === 'POST');
            await dialog.getByRole('button', { name: 'Assign' }).click();
            expect((await assigned).status()).toBe(200);
            const onServer = (await (await page.request.get(`/api/t/${slug}/work-items/${big.id}`)).json()) as { assigneeId: string };
            expect(onServer.assigneeId).toBe(miaId);
            await expect(page.getByTestId(`workload-cell-${me}-${nextMonday}`)).toContainText('20h / 40h');
            await expect(page.getByTestId(`workload-cell-${miaId}-${nextMonday}`)).toContainText('32h / 40h');
        } finally {
            for (const c of contexts) await c.close();
        }
    });
});

/** A person with a workspace of their own, invited into `slug` as a Member, signed in in a context of their own. */
async function invitedMember(browser: Browser, owner: Page, slug: string, request: APIRequestContext) {
    const person = await createIsolatedTenant({ request, namePrefix: 'workload-mia' });
    const invite = await owner.request.post(`/api/t/${slug}/admin/invites`, { data: { email: person.ownerEmail, role: 'MEMBER' } });
    expect(invite.status()).toBe(201);
    const invitePath = new URL(((await invite.json()) as { url: string }).url, 'http://127.0.0.1').pathname;
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, person);
    await page.goto(invitePath);
    await waitForHydration(page, 'main');
    await page.getByRole('button', { name: /Accept invitation/i }).click();
    await page.waitForURL(`**/t/${slug}/my-work`, { timeout: 60_000 });
    return { person, context, page };
}

async function seedHoursProject(api: APIRequestContext, slug: string, keyPrefix: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: `Hours ${keyPrefix}` } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    expect((await api.patch(`${base}/teams/${teamId}`, { data: { estimateUnit: 'HOURS' } })).status()).toBe(200);
    const project = await api.post(`${base}/projects`, { data: { teamId, name: `Load ${keyPrefix}`, keyPrefix } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    return { project: ((await project.json()) as { id: string }).id, typeId: types[0]!.id };
}

async function seedItem(api: APIRequestContext, slug: string, data: Record<string, unknown>) {
    const item = await api.post(`/api/t/${slug}/work-items`, { data });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}

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
