import { expect, test } from '@playwright/test';

test('the home page loads and names the product', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('Islestone');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Islestone');
});

test('/api/livez answers 200', async ({ request }) => {
    const response = await request.get('/api/livez');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
});
