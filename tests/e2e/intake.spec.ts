/**
 * Intake end to end (sub-phase 2.6a), on an isolated workspace: turn intake
 * on for a project and build a form in Settings → Intake, send a request
 * through it from the Forms page, find it on the Intake page and accept it,
 * and see the item it became in the project's list with its key. Sub-phase
 * 2.6b: someone with no session sends a request through a public form (the
 * page's signed token and its proof-of-work, solved in the real browser under
 * the real Content-Security-Policy), and the owner accepts it. The jobs and
 * the abuse cases are proved in the integration suite, not here.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures';

async function seed(api: APIRequestContext, slug: string) {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Help team' } });
    expect(team.status()).toBe(201);
    const project = await api.post(`${base}/projects`, { data: { teamId: (await team.json()).id, name: 'Helpdesk', keyPrefix: 'HLP' } });
    expect(project.status()).toBe(201);
    return { projectId: ((await project.json()) as { id: string }).id };
}

test.describe('intake', () => {
    test('build a form, send a request through it, and accept it into the backlog', async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        await seed(page.request, slug);

        // Settings → Intake: turn it on and build a form with one choice.
        await page.goto(`/t/${slug}/settings/intake`);
        const card = page.getByTestId('intake-project').filter({ hasText: 'Helpdesk' });
        await card.getByRole('switch', { name: 'Helpdesk takes requests' }).click();
        await expect(card.getByText('Takes requests')).toBeVisible();
        await card.getByRole('button', { name: 'New form' }).click();
        const builder = page.getByRole('dialog', { name: 'New form' });
        await builder.getByLabel('Name').fill('Report a problem');
        await builder.getByRole('button', { name: 'Add a field' }).click();
        await builder.getByLabel('Label').fill('Area');
        await builder.getByRole('combobox', { name: 'Kind of Area' }).click();
        await page.getByRole('option', { name: 'Choice', exact: true }).click();
        await builder.getByLabel('Options').fill('Billing\nSearch');
        const created = page.waitForResponse((r) => r.url().endsWith('/intake/forms') && r.request().method() === 'POST');
        await builder.getByRole('button', { name: 'Create form' }).click();
        expect((await created).status()).toBe(201);
        await expect(builder).toBeHidden();
        await expect(card.getByRole('link', { name: 'Report a problem' })).toBeVisible();

        // Forms: send a request through it.
        await page.goto(`/t/${slug}/forms`);
        await page.getByRole('main').getByRole('link', { name: 'Report a problem' }).click();
        await page.getByLabel('Title').fill('Invoices are blank');
        await page.getByLabel('Description').fill('Every invoice since Monday.');
        await page.getByRole('combobox', { name: 'Area' }).click();
        await page.getByRole('option', { name: 'Billing' }).click();
        await page.getByRole('button', { name: 'Send request' }).click();
        await expect(page.getByTestId('intake-sent')).toContainText('Reference:');

        // Intake: the request is new; accept it.
        await page.goto(`/t/${slug}/intake`);
        const detail = page.getByTestId('intake-request-detail');
        await expect(detail.getByRole('heading', { name: 'Invoices are blank' })).toBeVisible();
        await expect(detail.getByText('Billing')).toBeVisible();
        await detail.getByRole('button', { name: 'Accept' }).click();
        const dialog = page.getByRole('dialog', { name: 'Accept the request' });
        const accepted = page.waitForResponse((r) => r.url().includes('/accept') && r.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Accept' }).click();
        expect((await accepted).status()).toBe(200);
        await expect(page.getByTestId('intake-list').getByText('Invoices are blank')).toBeHidden();

        // Decided: it shows the item's key; the project's list has the item.
        await page.getByRole('button', { name: 'Decided' }).click();
        await expect(detail.getByRole('link', { name: /^HLP-\d+$/ })).toBeVisible();
        await page.goto(`/t/${slug}/projects/HLP`);
        await expect(page.getByRole('main').getByText('Invoices are blank')).toBeVisible();
    });

    test('someone with no session sends a request through a public form, and the owner accepts it', async ({ authedPage: page, isolatedTenant, browser }) => {
        const slug = isolatedTenant.tenantSlug;
        const { projectId } = await seed(page.request, slug);
        const base = `/api/t/${slug}`;
        expect((await page.request.put(`${base}/projects/${projectId}/intake`, { data: { enabled: true } })).status()).toBe(200);
        const form = await page.request.post(`${base}/intake/forms`, {
            data: {
                projectId,
                name: 'Tell us',
                access: 'PUBLIC',
                definition: { intro: 'Anyone may write.', confirmation: 'Thank you.', fields: [], requester: { name: 'OPTIONAL', email: 'OFF' } },
            },
        });
        expect(form.status()).toBe(201);
        const publicId = ((await form.json()) as { publicId: string }).publicId;
        expect(publicId).toMatch(/^[A-Za-z0-9_-]{22}$/);

        // A browser with no cookies at all.
        const outsider = await browser.newContext();
        try {
            const pub = await outsider.newPage();
            await pub.goto(`/f/${publicId}`);
            await expect(pub.getByRole('heading', { level: 1, name: 'Tell us' })).toBeVisible();
            await pub.getByLabel('Title').fill('The door is stuck');
            await pub.getByLabel('Your name').fill('Grace');
            // A person takes longer than the token's three-second floor.
            await pub.waitForTimeout(3_500);
            const sent = pub.waitForResponse((r) => r.url().includes(`/api/intake/forms/${publicId}`));
            await pub.getByRole('button', { name: 'Send request' }).click();
            expect((await sent).status()).toBe(201);
            await expect(pub.getByRole('heading', { name: 'Your request was sent.' })).toBeVisible();
            await expect(pub.getByText(/^Reference: [A-Z0-9]{8}$/)).toBeVisible();
            await expect(pub.getByText('Thank you.')).toBeVisible();
        } finally {
            await outsider.close();
        }

        // The owner finds it, from a public form, and accepts it.
        await page.goto(`/t/${slug}/intake`);
        const detail = page.getByTestId('intake-request-detail');
        await expect(detail.getByRole('heading', { name: 'The door is stuck' })).toBeVisible();
        await expect(detail.getByText('Grace')).toBeVisible();
        await expect(detail.getByText(/Public form/)).toBeVisible();
        await detail.getByRole('button', { name: 'Accept' }).click();
        const accepted = page.waitForResponse((r) => r.url().includes('/accept') && r.request().method() === 'POST');
        await page.getByRole('dialog', { name: 'Accept the request' }).getByRole('button', { name: 'Accept' }).click();
        expect((await accepted).status()).toBe(200);
        await page.goto(`/t/${slug}/projects/HLP`);
        await expect(page.getByRole('main').getByText('The door is stuck')).toBeVisible();
    });
});
