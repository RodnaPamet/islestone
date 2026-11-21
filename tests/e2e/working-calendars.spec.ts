/**
 * Working calendars and a project's due date end to end (roadmap 3.1a; ADR
 * 0010 §3 and §5; owner decisions 188 to 193), on an isolated workspace: its
 * owner opens Settings → Working calendars from the Settings page, saves the
 * workspace calendar with Sunday as a working day, adds a holiday, copies the
 * year's holidays to the next and removes one through the undo toast; gives
 * a team its own calendar and goes back to the workspace's; and sets a
 * project's due date from the project page's header. Written fresh for
 * Islestone; the team and project are made through the API, the rest through
 * the UI, and each write is read back through the API.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Calendar team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Dated project', keyPrefix: 'DTP' } });
    expect(project.status()).toBe(201);
    return { teamId, projectId: ((await project.json()) as { id: string }).id };
}

type Overview = { workspace: { isDefault: boolean; workingWeekdays: number[]; holidays: Array<{ day: string; name: string }> }; teams: Array<{ teamId: string; calendarId: string | null }> };

test.describe('working calendars and a project due date', () => {
    test('an owner edits the workspace calendar, its holidays and a team calendar', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(180_000);
        const slug = isolatedTenant.tenantSlug;
        const { teamId } = await seed(page.request, slug);
        const main = page.getByRole('main');
        const read = async () => (await (await page.request.get(`/api/t/${slug}/working-calendar`)).json()) as Overview;

        await page.goto(`/t/${slug}/settings`);
        await main.getByRole('link', { name: 'Manage working calendars' }).click();
        await expect(main.getByRole('heading', { level: 2, name: 'Workspace calendar' })).toBeVisible();
        await expect(main.getByText(/Not saved yet/)).toBeVisible();

        // Sunday becomes a working day.
        await main.getByRole('checkbox', { name: 'Sunday' }).click();
        const saved = page.waitForResponse((r) => r.url().endsWith('/working-calendar') && r.request().method() === 'PUT');
        await main.getByRole('button', { name: 'Save working calendar' }).click();
        expect((await saved).status()).toBe(200);
        await expect(main.getByText(/Not saved yet/)).toBeHidden();
        expect((await read()).workspace.workingWeekdays).toEqual([1, 2, 3, 4, 5, 7]);

        // Two holidays (through the API), the year copied and one removed through the undo toast (in the UI).
        const addHoliday = async (day: string, name: string) => {
            const res = await page.request.post(`/api/t/${slug}/working-calendar/holidays`, { data: { holidays: [{ day, name }] } });
            expect(res.status()).toBe(201);
        };
        await addHoliday('2027-03-03', 'Liberation Day');
        await addHoliday('2027-01-01', 'New Year');
        await page.reload();
        const holidays = main.getByRole('table', { name: 'Holidays' });
        await expect(holidays.getByText('Liberation Day')).toBeVisible();
        const copied = page.waitForResponse((r) => r.url().endsWith('/working-calendar/holidays') && r.request().method() === 'POST');
        await main.getByRole('button', { name: "Copy 2027's holidays to 2028" }).click();
        expect((await copied).status()).toBe(201);
        await expect(holidays.getByText('2028-03-03')).toBeVisible();
        expect((await read()).workspace.holidays.map((h) => h.day)).toEqual(['2027-01-01', '2027-03-03', '2028-01-01', '2028-03-03']);
        const removed = page.waitForResponse((r) => r.url().includes('/working-calendar/holidays/') && r.request().method() === 'DELETE', { timeout: 20_000 });
        await main.getByRole('button', { name: 'Remove the holiday New Year (2028-01-01)' }).click();
        await expect(holidays.getByText('2028-01-01')).toBeHidden();
        expect((await removed).status()).toBe(200);
        expect((await read()).workspace.holidays.map((h) => h.day)).toEqual(['2027-01-01', '2027-03-03', '2028-03-03']);

        // The team gets its own calendar, then goes back to the workspace's.
        await main.getByRole('link', { name: 'Calendar team' }).click();
        await expect(main.getByRole('heading', { level: 1, name: 'Working calendar of Calendar team' })).toBeVisible();
        const given = page.waitForResponse((r) => r.url().endsWith(`/teams/${teamId}/working-calendar`) && r.request().method() === 'PUT');
        await main.getByRole('button', { name: 'Give this team its own calendar' }).click();
        expect((await given).status()).toBe(200);
        await expect(main.getByRole('heading', { level: 2, name: 'Team calendar' })).toBeVisible();
        expect((await read()).teams.find((t) => t.teamId === teamId)?.calendarId).not.toBeNull();
        const back = page.waitForResponse((r) => r.url().endsWith(`/teams/${teamId}/working-calendar`) && r.request().method() === 'DELETE', { timeout: 20_000 });
        await main.getByRole('button', { name: 'Use the workspace calendar' }).click();
        expect((await back).status()).toBe(200);
        expect((await read()).teams.find((t) => t.teamId === teamId)?.calendarId).toBeNull();
    });

    test("a project's due date is set from its page's header", async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId } = await seed(page.request, slug);
        const set = await page.request.patch(`/api/t/${slug}/projects/${projectId}`, { data: { dueDate: '2027-03-14' } });
        expect(set.status()).toBe(200);
        await page.goto(`/t/${slug}/projects/DTP`);
        const header = page.getByRole('main').getByTestId('project-due-date');
        await expect(header.getByText('Due 2027-03-14')).toBeVisible();
        await header.getByRole('button', { name: 'Change due date' }).click();
        const dialog = page.getByRole('dialog', { name: 'Due date of Dated project' });
        const patched = page.waitForResponse((r) => r.url().endsWith(`/projects/${projectId}`) && r.request().method() === 'PATCH');
        await dialog.getByRole('button', { name: 'Save' }).click();
        expect((await patched).status()).toBe(200);
        const read = (await (await page.request.get(`/api/t/${slug}/projects/${projectId}`)).json()) as { dueDate: string | null };
        expect(read.dueDate).toBe('2027-03-14');
        await page.goto(`/t/${slug}/projects`);
        await expect(page.getByRole('main').getByRole('row', { name: /Dated project/ }).getByText('2027-03-14')).toBeVisible();
    });
});
