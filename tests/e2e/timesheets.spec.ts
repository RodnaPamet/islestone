/**
 * Timesheets end to end (sub-phase 3.4c; owner decisions 256, 268 to 270),
 * on an isolated workspace with two people: its owner turns on "Timesheets
 * need approval" in Settings → Time tracking; Mia, a Member, adds time and
 * submits her week in My time, whose cells are then read-only; the owner
 * finds it on the Timesheets page and returns it with an explanation; Mia
 * sees the explanation and submits again; the owner approves it.
 *
 * Mia registers her own workspace and accepts an invitation to this one, in
 * a browser context of her own. The team, project, item and time are made
 * through the API; the approval through the UI. Written fresh for Islestone.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import { createIsolatedTenant, e2eDay, signInAs, waitForHydration } from './e2e-utils';
import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Weeks team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Weeks', keyPrefix: 'WKS' } });
    expect(project.status()).toBe(201);
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId: (await project.json()).id, typeId: types[0]!.id, title: 'Write the plan' } });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}

/** A person with a workspace of their own, invited into `slug` as a Member, signed in in a context of their own. */
async function invitedMember(browser: Browser, owner: Page, slug: string, request: APIRequestContext) {
    const person = await createIsolatedTenant({ request, namePrefix: 'sheets-mia' });
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

test.describe('timesheets', () => {
    test('approval turned on; a week submitted and frozen, returned with an explanation, submitted again and approved', async ({ authedPage: owner, isolatedTenant, browser, request }) => {
        test.setTimeout(240_000);
        const slug = isolatedTenant.tenantSlug;
        const item = await seed(owner.request, slug);
        // Last week: begun, and dated by the run's one "today" (E2E_TODAY).
        const day = e2eDay(-7);
        const contexts: BrowserContext[] = [];
        try {
            const mia = await invitedMember(browser, owner, slug, request);
            contexts.push(mia.context);

            // The owner turns approval on in Settings → Time tracking.
            await owner.goto(`/t/${slug}/settings/time-tracking`);
            const toggle = owner.getByRole('switch', { name: 'Timesheets need approval' });
            await expect(toggle).not.toBeChecked();
            const saved = owner.waitForResponse((r) => r.url().endsWith('/time-settings') && r.request().method() === 'PUT');
            await toggle.click();
            expect((await saved).status()).toBe(200);
            await expect(toggle).toBeChecked();

            // Mia records time last week and submits it from My time.
            const added = await mia.page.request.post(`/api/t/${slug}/time-entries`, { data: { workItemId: item.id, workDate: day, minutes: 90 } });
            expect(added.status()).toBe(201);
            await mia.page.goto(`/t/${slug}/time?week=${day}`);
            await expect(mia.page.getByTestId('timesheet-status-text')).toHaveText('This week is not submitted.');
            const submitted = mia.page.waitForResponse((r) => new URL(r.url()).pathname === `/api/t/${slug}/timesheets` && r.request().method() === 'POST');
            await mia.page.getByRole('button', { name: 'Submit' }).click();
            expect((await submitted).status()).toBe(201);
            await expect(mia.page.getByTestId('timesheet-status-text')).toContainText('Submitted');
            // Frozen: no "Add time", and a cell opens nothing.
            await expect(mia.page.getByRole('button', { name: 'Add time' })).toBeHidden();
            const cell = mia.page.getByRole('gridcell', { name: new RegExp(`^${item.key}, .*, 1h 30m$`) });
            await cell.click();
            await expect(mia.page.getByRole('dialog')).toBeHidden();

            // The owner finds it on the Timesheets page and returns it with an explanation.
            await owner.goto(`/t/${slug}/time/timesheets`);
            const table = owner.getByTestId('timesheets-table');
            await table.getByText(mia.person.ownerName).click();
            const detail = owner.getByTestId('timesheet-detail');
            await expect(detail).toContainText('1h 30m');
            await detail.getByRole('button', { name: 'Return' }).click();
            const ask = owner.getByRole('dialog', { name: 'Return this week' });
            await ask.getByRole('textbox', { name: 'Explanation' }).fill('Add Friday as well');
            const returned = owner.waitForResponse((r) => r.url().endsWith('/return') && r.request().method() === 'POST');
            await ask.getByRole('button', { name: 'Return' }).click();
            const res = await returned;
            expect(res.status()).toBe(200);
            expect(res.request().headers()['if-match']).toBe('"1"');

            // Mia sees why, and the week is open again; she submits it again.
            await mia.page.reload();
            await expect(mia.page.getByTestId('timesheet-status-text')).toHaveText(`Returned by ${isolatedTenant.ownerName}:`);
            await expect(mia.page.getByTestId('timesheet-explanation')).toHaveText('Add Friday as well');
            await expect(mia.page.getByRole('button', { name: 'Add time' })).toBeVisible();
            await mia.page.getByRole('button', { name: 'Submit' }).click();
            await expect(mia.page.getByTestId('timesheet-status-text')).toContainText('Submitted');

            // The owner approves it.
            await owner.reload();
            await owner.getByTestId('timesheets-table').getByText(mia.person.ownerName).click();
            const approved = owner.waitForResponse((r) => r.url().endsWith('/approve') && r.request().method() === 'POST');
            await owner.getByTestId('timesheet-detail').getByRole('button', { name: 'Approve' }).click();
            expect((await approved).status()).toBe(200);
            await mia.page.reload();
            await expect(mia.page.getByTestId('timesheet-status-text')).toContainText(`Approved by ${isolatedTenant.ownerName}`);
        } finally {
            for (const c of contexts) await c.close();
        }
    });
});
