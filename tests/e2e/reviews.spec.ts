/**
 * Review steps end to end (sub-phase 2.8b; ADR 0009; owner decisions 148 to
 * 165), on an isolated workspace with three people: its owner, the item's
 * assignee, sets two review steps on the item's page (Bea, then Cy) and sends
 * it for review; Bea finds it under My Work's "To review" and signs off; Cy
 * returns it with the reason; the owner sees the round Returned with Cy's
 * reason, and the item waits on its assignee again (decision 152).
 *
 * Bea and Cy each register their own workspace and accept an invitation to
 * this one, each in a browser context of their own. Written fresh for
 * Islestone. The team, project and item are made through the API; the
 * review through the UI.
 */
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';

import { createIsolatedTenant, signInAs, waitForHydration, type IsolatedTenantCredentials } from './e2e-utils';
import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string, assigneeId: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Review team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: ((await team.json()) as { id: string }).id, name: 'Contracts', keyPrefix: 'RVW' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string }>;
    const item = await api.post(`${base}/work-items`, { data: { projectId, typeId: types[0]!.id, title: 'Supplier contract', assigneeId } });
    expect(item.status()).toBe(201);
    return (await item.json()) as { id: string; key: string };
}

/** A person with a workspace of their own, invited into `slug` as a Member, signed in in a context of their own. */
async function invitedMember(browser: Browser, owner: Page, slug: string, request: APIRequestContext, prefix: string) {
    const person = await createIsolatedTenant({ request, namePrefix: prefix });
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

/** Add a review step through the editor, naming one member. */
async function addStep(page: Page, name: string, reviewer: IsolatedTenantCredentials) {
    await page.getByRole('button', { name: 'Add review step' }).click();
    const dialog = page.getByRole('dialog', { name: 'New review step' });
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await dialog.getByRole('combobox', { name: 'No member named' }).click();
    await page.getByRole('option', { name: reviewer.ownerName }).click();
    // Close the picker before saving.
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).click();
    const saved = page.waitForResponse((r) => r.url().endsWith('/review/steps') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Save step' }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
}

test.describe('review steps', () => {
    test('two steps sent; one signs off, the other returns with text; the assignee sees it Returned and is waited on again', async ({
        authedPage: owner,
        isolatedTenant,
        browser,
        request,
    }) => {
        test.setTimeout(240_000);
        const slug = isolatedTenant.tenantSlug;
        const item = await seed(owner.request, slug, isolatedTenant.ownerUserId);
        const contexts: BrowserContext[] = [];
        try {
            const bea = await invitedMember(browser, owner, slug, request, 'reviews-bea');
            contexts.push(bea.context);
            const cy = await invitedMember(browser, owner, slug, request, 'reviews-cy');
            contexts.push(cy.context);
            const itemPath = `/t/${slug}/work-items/${item.key}`;

            // The owner, who is the assignee, plans two steps and sends the round.
            await owner.goto(itemPath);
            await expect(owner.getByRole('heading', { level: 2, name: 'Review steps' })).toBeVisible();
            await expect(owner.getByText('No review steps yet.')).toBeVisible();
            await addStep(owner, 'Peer review', bea.person);
            await addStep(owner, 'Legal', cy.person);
            const sent = owner.waitForResponse((r) => r.url().endsWith('/review/send') && r.request().method() === 'POST');
            await owner.getByRole('button', { name: 'Send for review' }).click();
            expect((await sent).status()).toBe(200);
            await expect(owner.getByText('Round 1: open')).toBeVisible();
            // While the round is open the item waits on the open step's reviewers.
            await expect(owner.getByText(`The reviewers of Peer review: ${bea.person.ownerName}`)).toBeVisible();

            // Bea finds it under "To review" and signs off.
            await bea.page.goto(`/t/${slug}/my-work`);
            const toReview = bea.page.getByRole('region', { name: 'To review' });
            await expect(toReview.getByRole('link', { name: 'Supplier contract' })).toBeVisible();
            await expect(toReview.getByText(/Peer review: 1 pending/)).toBeVisible();
            await bea.page.goto(itemPath);
            await bea.page.getByRole('button', { name: 'Sign off Peer review' }).click();
            const signOff = bea.page.getByRole('dialog', { name: 'Sign off Peer review' });
            const signed = bea.page.waitForResponse((r) => r.url().includes('/respond') && r.request().method() === 'POST');
            await signOff.getByRole('button', { name: 'Sign off' }).click();
            expect((await signed).status()).toBe(200);
            await expect(signOff).toBeHidden();
            const peer = bea.page.getByRole('list', { name: 'Reviewers of Peer review' });
            await expect(peer.getByText('Signed off')).toBeVisible();

            // Cy returns it, and must say why.
            await cy.page.goto(itemPath);
            await cy.page.getByRole('button', { name: 'Return Legal' }).click();
            const giveBack = cy.page.getByRole('dialog', { name: 'Return Legal' });
            await giveBack.getByRole('button', { name: 'Return' }).click();
            await expect(giveBack.getByRole('alert')).toHaveText('Say why you are returning it.');
            await giveBack.getByLabel(/Why it is returned/).fill('Clause 4 is missing.');
            const returned = cy.page.waitForResponse((r) => r.url().includes('/respond') && r.request().method() === 'POST');
            await giveBack.getByRole('button', { name: 'Return' }).click();
            expect((await returned).status()).toBe(200);
            await expect(giveBack).toBeHidden();

            // The assignee sees the round Returned, with Cy's reason, and round 2 waiting to be sent.
            await owner.goto(itemPath);
            await expect(owner.getByText('Round 1 was Returned. Revise the work, then send round 2 for review.')).toBeVisible();
            const ended = owner.getByText(new RegExp(`Round 1: Returned by ${cy.person.ownerName} on`));
            await expect(ended).toBeVisible();
            await ended.click();
            await expect(owner.getByText('Clause 4 is missing.')).toBeVisible();
            await expect(owner.getByRole('button', { name: 'Send for review' })).toBeVisible();

            // Waiting on is the assignee again (decision 152).
            const read = await owner.request.get(`/api/t/${slug}/work-items/${item.id}`);
            expect(((await read.json()) as { waitingOnUserId: string | null }).waitingOnUserId).toBe(isolatedTenant.ownerUserId);
            await expect(owner.locator(`#waiting-on-${item.id}`)).toContainText(isolatedTenant.ownerName);

            // My Work's list marks the item Returned.
            await owner.goto(`/t/${slug}/my-work`);
            await expect(owner.getByRole('region', { name: 'Assigned to me' }).getByText('Returned')).toBeVisible();
        } finally {
            for (const c of contexts) await c.close();
        }
    });
});
