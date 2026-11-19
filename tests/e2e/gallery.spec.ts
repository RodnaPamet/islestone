import { expect, test } from '@playwright/test';

/**
 * Smoke test for the shared-UI gallery: the page loads, both themed panels
 * render, and the styling actually applies (tokens.css, the Tailwind theme
 * keys and the scan of packages/ui), which no Jest test can see.
 */
test('the UI gallery loads with a light and a dark panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const response = await page.goto('/gallery');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle('UI gallery · Islestone');

    const light = page.getByRole('region', { name: 'Light theme' });
    const dark = page.getByRole('region', { name: 'Dark theme' });
    await expect(light).toBeVisible();
    await expect(dark).toBeVisible();

    // The two panels paint different page backgrounds from the same class
    // (`bg-bg-page`): the dark tokens apply under data-theme="dark".
    const background = (el: typeof light) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await background(light)).toBe('rgb(255, 255, 255)');
    expect(await background(dark)).toBe('rgb(14, 17, 22)');

    // A package primitive is styled: the primary button is a pill with the brand fill.
    const primary = light.getByRole('button', { name: 'Primary' });
    await expect(primary).toBeVisible();
    expect(await primary.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).not.toBe('0px');
    expect(await primary.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(44, 85, 128)');

    // The table renders its rows in both themes.
    await expect(light.getByRole('table')).toContainText('Ship the gallery');
    await expect(dark.getByRole('table')).toContainText('Ship the gallery');

    expect(errors).toEqual([]);
});
