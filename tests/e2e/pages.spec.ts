/**
 * Pages end to end (sub-phase 4.1a), on an isolated workspace: from a
 * project's page open its Pages, create a page and land on it, add a subpage
 * from its header, rename it, see the breadcrumb lead back through the tree,
 * expand the parent in the tree, move the subpage to the workspace's tree,
 * then delete the parent through the undo toast and restore it from the
 * Deleted list.
 */
import { expect, test } from './fixtures';

test.describe('pages', () => {
    test("create, nest, rename, move, delete and restore pages in a project's tree", async ({ authedPage: page, isolatedTenant }) => {
        const slug = isolatedTenant.tenantSlug;
        const base = `/api/t/${slug}`;
        const team = await page.request.post(`${base}/teams`, { data: { name: 'Docs team' } });
        expect(team.status()).toBe(201);
        const teamId = ((await team.json()) as { id: string }).id;
        expect((await page.request.post(`${base}/projects`, { data: { teamId, name: 'Handbook', keyPrefix: 'HBK' } })).status()).toBe(201);

        // From the project's page to its Pages, and a first page.
        await page.goto(`/t/${slug}/projects/HBK`);
        await page.getByRole('main').getByRole('link', { name: 'Pages', exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/projects/HBK/pages$`));
        const main = page.getByRole('main');
        await expect(main.getByText('No pages yet. Create the first one.')).toBeVisible();
        await main.getByRole('button', { name: 'Page', exact: true }).click();
        const create = page.getByRole('dialog', { name: 'New page', exact: true });
        await create.getByLabel(/Title/).fill('Onboarding');
        const created = page.waitForResponse((r) => r.url().endsWith('/pages') && r.request().method() === 'POST');
        await create.getByRole('button', { name: 'Create page', exact: true }).click();
        expect((await created).status()).toBe(201);
        await expect(page).toHaveURL(new RegExp(`/t/${slug}/pages/[^/]+$`));
        await expect(page.getByRole('heading', { level: 1, name: 'Onboarding' })).toBeVisible();
        await expect(page.getByTestId('page-body')).toHaveText('This page has no content yet.');

        // A subpage from the header, then renamed from its own page.
        await page.getByRole('button', { name: 'New subpage', exact: true }).click();
        const sub = page.getByRole('dialog', { name: 'New subpage', exact: true });
        await sub.getByLabel(/Title/).fill('First week');
        const subCreated = page.waitForResponse((r) => r.url().endsWith('/pages') && r.request().method() === 'POST');
        await sub.getByRole('button', { name: 'Create page', exact: true }).click();
        const child = (await (await subCreated).json()) as { id: string };
        await expect(sub).toBeHidden();
        await expect(page.getByRole('main').getByRole('link', { name: 'First week', exact: true })).toBeVisible();
        await page.goto(`/t/${slug}/pages/${child.id}`);
        await page.getByRole('button', { name: 'Rename', exact: true }).click();
        const rename = page.getByRole('dialog', { name: 'Rename page', exact: true });
        await rename.getByLabel(/Title/).fill('The first week');
        const renamed = page.waitForResponse((r) => r.url().endsWith(`/pages/${child.id}`) && r.request().method() === 'PATCH');
        await rename.getByRole('button', { name: 'Rename page', exact: true }).click();
        expect((await renamed).status()).toBe(200);
        await expect(rename).toBeHidden();
        await expect(page.getByRole('heading', { level: 1, name: 'The first week' })).toBeVisible();

        // The breadcrumb names the tree, then the parent; in the tree the parent expands.
        const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
        await expect(crumbs.getByRole('link', { name: 'Handbook pages', exact: true })).toHaveAttribute('href', `/t/${slug}/projects/HBK/pages`);
        await expect(crumbs.getByRole('link', { name: 'Onboarding', exact: true })).toHaveAttribute('href', new RegExp(`/t/${slug}/pages/[^/]+$`));
        await page.goto(`/t/${slug}/projects/HBK/pages`);
        await page.getByRole('button', { name: 'Expand Onboarding (1 subpage)', exact: true }).click();
        await expect(page.getByRole('list', { name: 'Subpages of Onboarding', exact: true }).getByRole('link', { name: 'The first week', exact: true })).toBeVisible();

        // Move the subpage to the workspace's tree, at its top level.
        await page.getByRole('button', { name: 'Move The first week', exact: true }).click();
        const move = page.getByRole('dialog', { name: 'Move The first week', exact: true });
        await move.locator('#page-move-tree-input').click();
        await page.getByRole('option', { name: 'Workspace pages', exact: true }).click();
        const moved = page.waitForResponse((r) => r.url().endsWith(`/pages/${child.id}/move`) && r.request().method() === 'POST');
        await move.getByRole('button', { name: 'Move page', exact: true }).click();
        expect((await moved).status()).toBe(200);
        await page.goto(`/t/${slug}/pages`);
        await expect(page.getByRole('main').getByRole('link', { name: 'The first week', exact: true })).toBeVisible();

        // Delete the parent through the undo toast; restore it from the Deleted list.
        await page.goto(`/t/${slug}/projects/HBK/pages`);
        const deleted = page.waitForResponse((r) => /\/pages\/[^/]+$/.test(r.url()) && r.request().method() === 'DELETE', { timeout: 15_000 });
        await page.getByRole('button', { name: 'Delete Onboarding', exact: true }).click();
        await expect(page.getByText('Deleted Onboarding and the pages below it')).toBeVisible();
        expect((await deleted).status()).toBe(200);
        await expect(page.getByRole('main').getByText('No pages yet. Create the first one.')).toBeVisible();
        await page.getByRole('button', { name: 'Show deleted pages', exact: true }).click();
        const restored = page.waitForResponse((r) => r.url().endsWith('/restore') && r.request().method() === 'POST');
        await page.getByRole('button', { name: 'Restore Onboarding', exact: true }).click();
        expect((await restored).status()).toBe(200);
        await expect(page.getByRole('list', { name: 'Handbook pages', exact: true }).getByRole('link', { name: 'Onboarding', exact: true })).toBeVisible();
    });
});
