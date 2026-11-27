/**
 * Board accessibility in a real browser (Hardening H2e; owner decision 177;
 * `docs/porting/maps/H2.md` part 5; `docs/accessibility.md`).
 *
 * jsdom (`tests/rendered/work-item-board.test.tsx`) proves the board's logic;
 * only a browser shows what it exposes: colour contrast, visible focus, the
 * computed accessibility tree, and focus after a virtualised re-render. Each
 * test runs on its own isolated workspace with three states (Todo, Done,
 * Cancelled: a team keeps its default state and one live state of each
 * closed category, so the seed deletes the other three), two lanes by
 * priority (High and Low) and 120 cards, so the Todo column, with fifty cards
 * loaded, virtualises when the board has no lanes.
 *
 *   - Browser axe (`@axe-core/playwright`, dev-only) against WCAG 2.0, 2.1
 *     and 2.2 A and AA on the whole page at rest, with a card picked up,
 *     during a move, after a cancel and with a refusal shown. No rule and no
 *     element is excluded.
 *   - Accessibility-tree snapshots of the focused card and the live region at
 *     each step.
 *   - Keyboard-only flows: pick up, move across columns and lanes, reorder,
 *     drop, cancel, a drop the server refuses, and a drop into the
 *     virtualised column, after which focus stays on the moved card and the
 *     column scrolls to it.
 *   - Focus visible on every card and control the board offers.
 *
 * The refusal is real: the type Chore requires its review to finish before
 * Done (2.8c), and its item carries the planned round its type's default step
 * gives it. Written fresh for Islestone.
 */
import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { expect, test } from './fixtures';

/** WCAG 2.0, 2.1 and 2.2, levels A and AA (axe's tags). */
const WCAG_A_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

const INSTRUCTIONS =
    'To move a card with the keyboard, press Space to pick it up, the arrow keys to move it, Space again to drop it, or Escape to cancel. Press Enter to open it.';

interface Seeded {
    projectId: string;
    ids: Record<string, string>;
}

/**
 * The workspace: a team with Todo, Done and Cancelled; a project ACC; the
 * type Chore gated on its review; four named cards made first, in order (so
 * they lead their cells and their keys are ACC-1 to ACC-4), then 116 Low
 * cards. Cells as loaded (fifty cards a column): Todo/High ACC-1, ACC-2;
 * Todo/Low ACC-3 then 47 more; Done/High ACC-4; Done/Low 6; Cancelled/Low 5.
 */
async function seedBoard(api: APIRequestContext, slug: string, ownerUserId: string): Promise<Seeded> {
    const base = `/api/t/${slug}`;
    const team = await api.post(`${base}/teams`, { data: { name: 'Access team' } });
    expect(team.status()).toBe(201);
    const teamId = ((await team.json()) as { id: string }).id;
    const states = (await (await api.get(`${base}/teams/${teamId}/workflow-states`)).json()) as Array<{ id: string; name: string }>;
    for (const name of ['Backlog', 'In progress', 'In review']) {
        const state = states.find((s) => s.name === name)!;
        expect((await api.delete(`${base}/teams/${teamId}/workflow-states/${state.id}`)).status()).toBe(200);
    }
    const stateId = (name: string) => states.find((s) => s.name === name)!.id;
    const project = await api.post(`${base}/projects`, { data: { teamId, name: 'Access', keyPrefix: 'ACC' } });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const types = (await (await api.get(`${base}/work-item-types`)).json()) as Array<{ id: string; name: string }>;
    const featureId = types.find((t) => t.name === 'Feature')!.id;
    const choreId = types.find((t) => t.name === 'Chore')!.id;
    const gate = await api.put(`${base}/work-item-types/${choreId}/review-steps`, {
        data: { reviewRequiredForDone: true, steps: [{ name: 'Sign-off', mode: 'ALL', dueInWorkingDays: 2, memberIds: [ownerUserId], recipientListIds: [] }] },
    });
    expect(gate.status()).toBe(200);

    const create = async (body: Record<string, unknown>) => {
        const res = await api.post(`${base}/work-items`, { data: { projectId, typeId: featureId, priority: 'LOW', ...body } });
        expect(res.status(), await res.text()).toBe(201);
        return (await res.json()) as { id: string; key: string };
    };
    const ids: Record<string, string> = {};
    const named: Array<[string, Record<string, unknown>]> = [
        ['ACC-1', { title: 'Draft the brief', priority: 'HIGH' }],
        ['ACC-2', { title: 'Check the copy', priority: 'HIGH' }],
        ['ACC-3', { title: 'Gated release', typeId: choreId }],
        ['ACC-4', { title: 'Ship the notes', priority: 'HIGH', stateId: stateId('Done') }],
    ];
    for (const [key, body] of named) {
        const made = await create(body);
        expect(made.key).toBe(key);
        ids[key] = made.id;
    }
    const rest: Array<Record<string, unknown>> = [
        ...Array.from({ length: 105 }, (_, i) => ({ title: `Todo card ${i + 1}` })),
        ...Array.from({ length: 6 }, (_, i) => ({ title: `Done card ${i + 1}`, stateId: stateId('Done') })),
        ...Array.from({ length: 5 }, (_, i) => ({ title: `Cancelled card ${i + 1}`, stateId: stateId('Cancelled') })),
    ];
    // Eight at a time: within the per-project create queue (decision 174).
    for (let i = 0; i < rest.length; i += 8) await Promise.all(rest.slice(i, i + 8).map((body) => create(body)));
    return { projectId, ids };
}

function board(page: Page) {
    return page.getByRole('main').getByRole('region', { name: 'Board' });
}

function cell(page: Page, name: string) {
    return board(page).getByRole('list', { name, exact: true });
}

function card(page: Page, label: string) {
    return board(page).getByRole('button', { name: label, exact: true });
}

function announcements(page: Page) {
    return page.getByRole('status', { name: 'Board announcements' });
}

async function openBoard(page: Page, slug: string, lanes: 'By priority' | 'No swimlanes') {
    await page.goto(`/t/${slug}/projects/ACC`);
    await page.getByRole('radio', { name: 'Board' }).click();
    await expect(board(page)).toBeVisible();
    await page.getByRole('combobox', { name: 'Swimlanes' }).click();
    await page.getByRole('option', { name: lanes }).click();
    await expect(page.getByRole('combobox', { name: 'Swimlanes' })).toContainText(lanes);
    await expect(card(page, 'ACC-1: Draft the brief')).toBeVisible();
}

/** Browser axe on the whole page, WCAG 2.2 A and AA, nothing excluded. */
async function expectNoAxeViolations(page: Page, when: string) {
    const results = await new AxeBuilder({ page }).withTags(WCAG_A_AA).analyze();
    const found = results.violations.map((v) => ({ rule: v.id, impact: v.impact, nodes: v.nodes.map((n) => `${n.target.join(' ')} — ${n.failureSummary ?? ''}`) }));
    expect(found, `axe violations ${when}`).toEqual([]);
}

async function press(page: Page, ...keys: string[]) {
    for (const key of keys) await page.keyboard.press(key);
}

/**
 * Tab (or Shift+Tab) until `target` has focus (keyboard only), at most `limit` presses. A walk forward to an
 * earlier column wraps through the whole page (the chrome, the sidebar's rows, the toolbar), so the limit grows
 * with the shell: 80 since the sidebar's Time entry (3.4b) took the walk past 60.
 */
async function tabTo(page: Page, target: Locator, limit = 80, key: 'Tab' | 'Shift+Tab' = 'Tab') {
    for (let i = 0; i < limit; i++) {
        if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
        await page.keyboard.press(key);
    }
    await expect(target).toBeFocused();
}

async function itemOf(api: APIRequestContext, slug: string, id: string) {
    return (await (await api.get(`/api/t/${slug}/work-items/${id}`)).json()) as { stateCategory: string; priority: string };
}

/** The card labels of a cell, in order. */
async function labelsIn(list: Locator) {
    return list.getByRole('button', { name: /^ACC-\d+: / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
}

test.describe('board accessibility', () => {
    test('keyboard moves across columns and lanes, reorder, cancel and a refusal: axe and the accessibility tree at each step', async ({
        authedPage: page,
        isolatedTenant,
    }) => {
        test.setTimeout(240_000);
        const slug = isolatedTenant.tenantSlug;
        const { ids } = await seedBoard(page.request, slug, isolatedTenant.ownerUserId);
        await openBoard(page, slug, 'By priority');
        const focused = page.locator(':focus');

        await test.step('at rest', async () => {
            await expect(cell(page, 'Todo, High')).toBeVisible();
            await expect(cell(page, 'Todo, Low')).toBeVisible();
            await expectNoAxeViolations(page, 'at rest');
        });

        await test.step('pick up by keyboard', async () => {
            const first = card(page, 'ACC-1: Draft the brief');
            await tabTo(page, first);
            await expect(first).toHaveAccessibleDescription(INSTRUCTIONS);
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-1: Draft the brief"'`);
            await press(page, 'Space');
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-1: Draft the brief" [pressed]'`);
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Picked up ACC-1. Todo, position 1 of 2. Lane High.`);
            await expectNoAxeViolations(page, 'with a card picked up');
        });

        await test.step('move within the cell, into the next lane, across a column, then drop', async () => {
            await press(page, 'ArrowDown');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-1. Todo, position 2 of 2. Lane High.`);
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-1: Draft the brief" [pressed]'`);
            await expectNoAxeViolations(page, 'during a move');
            await press(page, 'ArrowDown');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-1. Todo, position 1 of 49. Lane Low.`);
            await press(page, 'ArrowRight');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-1. Done, position 1 of 7. Lane Low.`);
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-1: Draft the brief" [pressed]'`);
            await press(page, 'Space');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Dropped ACC-1 in Done at position 1. Lane Low.`);
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-1: Draft the brief"'`);
            await expect(cell(page, 'Done, Low').getByRole('button', { name: 'ACC-1: Draft the brief' })).toBeFocused();
            await expect.poll(async () => itemOf(page.request, slug, ids['ACC-1']!)).toMatchObject({ stateCategory: 'DONE', priority: 'LOW' });
        });

        await test.step('reorder within a column', async () => {
            const gated = card(page, 'ACC-3: Gated release');
            await tabTo(page, gated);
            await press(page, 'Space', 'ArrowDown', 'ArrowDown');
            // The column was read again after the first move, so its count is the server's now.
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": /Moving ACC-3\\. Todo, position 3 of \\d+\\. Lane Low\\./`);
            await press(page, 'Enter');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Dropped ACC-3 in Todo at position 3. Lane Low.`);
            await expect(gated).toBeFocused();
            await expect.poll(async () => (await labelsIn(cell(page, 'Todo, Low'))).indexOf('ACC-3: Gated release')).toBe(2);
        });

        await test.step('cancel a move', async () => {
            // ACC-2 is in the lane above: back to it by key.
            const second = card(page, 'ACC-2: Check the copy');
            await tabTo(page, second, 30, 'Shift+Tab');
            await press(page, 'Space', 'ArrowRight');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-2. Done, position 1 of 2. Lane High.`);
            await press(page, 'Escape');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Move cancelled. ACC-2 is back where it was.`);
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-2: Check the copy"'`);
            await expect(cell(page, 'Todo, High').getByRole('button', { name: 'ACC-2: Check the copy' })).toBeFocused();
            await expectNoAxeViolations(page, 'after a cancel');
        });

        await test.step('a drop the server refuses rolls back, says why, and keeps focus', async () => {
            const gated = card(page, 'ACC-3: Gated release');
            await tabTo(page, gated, 40);
            const refused = page.waitForResponse((r) => r.url().endsWith(`/work-items/${ids['ACC-3']}/move`) && r.request().method() === 'POST');
            await press(page, 'Space', 'ArrowRight', 'Space');
            expect((await refused).status()).toBe(409);
            const toast = page.getByText('ACC-3 cannot move to Done until its review is complete', { exact: false });
            await expect(toast).toBeVisible();
            // The sentence is spoken: it sits in a polite live region.
            await expect(toast.locator('xpath=ancestor::*[@aria-live="polite"]').first()).toBeAttached();
            await expect(cell(page, 'Todo, Low').getByRole('button', { name: 'ACC-3: Gated release' })).toBeFocused();
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-3: Gated release"'`);
            // Alt+T, the toaster's own key, moves focus to the notifications and holds the
            // toast while it is checked (it would leave after three seconds, fading).
            await press(page, 'Alt+t');
            await expect.poll(() => toast.evaluate((el) => getComputedStyle(el.closest('[data-sonner-toast]')!).opacity)).toBe('1');
            await expectNoAxeViolations(page, 'with the refusal shown');
            expect((await itemOf(page.request, slug, ids['ACC-3']!)).stateCategory).toBe('UNSTARTED');
        });
    });

    test('a drop into a virtualised column keeps focus on the moved card and scrolls to it', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(240_000);
        const slug = isolatedTenant.tenantSlug;
        const { ids } = await seedBoard(page.request, slug, isolatedTenant.ownerUserId);
        await openBoard(page, slug, 'No swimlanes');
        const todo = board(page).getByRole('region', { name: 'Todo', exact: true });
        const focused = page.locator(':focus');

        await test.step('the Todo column virtualises', async () => {
            await expect(todo.locator('[data-virtualized-list]')).toHaveCount(1);
            // Named as a plain cell's list is, and its rows are its items.
            await expect(cell(page, 'Todo')).toBeVisible();
            await expect(cell(page, 'Todo').getByRole('listitem').first()).toBeVisible();
            await expectNoAxeViolations(page, 'with a virtualised column at rest');
        });

        await test.step('pick up from the virtualised column and drop in Done', async () => {
            const second = card(page, 'ACC-2: Check the copy');
            await tabTo(page, second);
            await press(page, 'Space');
            await expect(second).toBeFocused();
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-2: Check the copy" [pressed]'`);
            await press(page, 'ArrowRight', 'Space');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Dropped ACC-2 in Done at position 2.`);
            await expect(board(page).getByRole('region', { name: 'Done', exact: true }).getByRole('button', { name: 'ACC-2: Check the copy' })).toBeFocused();
        });

        await test.step('carry a card to the bottom of the virtualised column', async () => {
            // ACC-4 sits just above ACC-2 in Done: back to it by key.
            const notes = card(page, 'ACC-4: Ship the notes');
            await tabTo(page, notes, 10, 'Shift+Tab');
            await press(page, 'Space', 'ArrowLeft');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-4. Todo, position 1 of 50.`);
            for (let i = 0; i < 49; i++) await press(page, 'ArrowDown');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Moving ACC-4. Todo, position 50 of 50.`);
            await expect(notes).toBeFocused();
            await expect(notes).toBeInViewport();
            await expectNoAxeViolations(page, 'carrying a card down a long column');
        });

        await test.step('drop after the last card loaded: the card stays, the column virtualises again, focus stays on it in view', async () => {
            // Todo holds 50 of its 107 cards; a drop after the last of them used to leave the
            // board with the card (the list leaves such a row for the next page), taking focus.
            const notes = card(page, 'ACC-4: Ship the notes');
            await press(page, 'Space');
            await expect(announcements(page)).toMatchAriaSnapshot(`- status "Board announcements": Dropped ACC-4 in Todo at position 50.`);
            // The next page came with it (99 to 101 cards, as the move and the read cross).
            await expect(todo.getByRole('heading', { level: 2 })).toHaveText(/^Todo (99|100|101)\+$/);
            await expect(todo.locator('[data-virtualized-list]')).toHaveCount(1);
            await expect(todo.getByRole('button', { name: 'ACC-4: Ship the notes' })).toBeFocused();
            await expect(notes).toBeInViewport();
            await expect(focused).toMatchAriaSnapshot(`- 'button "ACC-4: Ship the notes"'`);
            await expect.poll(async () => (await itemOf(page.request, slug, ids['ACC-4']!)).stateCategory).toBe('UNSTARTED');
            await expectNoAxeViolations(page, 'after a drop into a virtualised column');
        });

        await test.step('"Load more" by keyboard: focus goes to the first card it brings, and the moved card does not take it back', async () => {
            const loadMore = todo.getByRole('button', { name: 'Load more' });
            await tabTo(page, loadMore, 160);
            await press(page, 'Enter');
            // The last page: the button goes, and focus does not fall to the page.
            await expect(todo.getByRole('heading', { level: 2 })).toHaveText('Todo 108');
            await expect(loadMore).toHaveCount(0);
            await expect(focused).toBeInViewport();
            const landed = await focused.evaluate((el) => ({
                card: el.getAttribute('aria-describedby') === 'work-item-board-instructions',
                inTodo: !!el.closest('[data-board-column]')?.querySelector('h2')?.textContent?.startsWith('Todo'),
                label: el.getAttribute('aria-label'),
            }));
            expect(landed).toMatchObject({ card: true, inTodo: true });
            expect(landed.label).not.toBe('ACC-4: Ship the notes');
        });
    });

    test('focus is visible on every card and control of the board', async ({ authedPage: page, isolatedTenant }) => {
        test.setTimeout(240_000);
        const slug = isolatedTenant.tenantSlug;
        await seedBoard(page.request, slug, isolatedTenant.ownerUserId);
        await openBoard(page, slug, 'By priority');
        const ring = await page.evaluate(() => {
            // The token the cards' ring names, resolved to the colour the browser computes.
            const probe = document.createElement('div');
            probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ring').trim();
            document.body.append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        });
        expect(ring).toMatch(/^rgb/);

        // The board's own controls before it: back from the swimlanes to the layout, and
        // forward again (each reached by key, so :focus-visible applies).
        const swimlanes = page.getByRole('combobox', { name: 'Swimlanes' });
        await swimlanes.focus();
        for (const [control, key] of [
            [page.getByRole('radio', { name: 'Board' }), 'Shift+Tab'],
            [swimlanes, 'Tab'],
        ] as const) {
            await tabTo(page, control, 20, key);
            const style = await control.evaluate((el) => {
                const s = getComputedStyle(el);
                return { focusVisible: el.matches(':focus-visible'), outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow };
            });
            expect(style.focusVisible).toBe(true);
            expect(style.outline || (style.shadow !== 'none' && style.shadow !== ''), `focus indicator on ${await control.evaluate((el) => el.outerHTML.slice(0, 120))}`).toBe(true);
        }

        // Then every focusable thing inside the board, in Tab order, until focus leaves it.
        const region = board(page);
        await tabTo(page, region.getByRole('button', { name: 'Add a work item to Todo' }), 80);
        const seen: string[] = [];
        for (let i = 0; i < 400; i++) {
            const inBoard = await region.evaluate((el) => el.contains(document.activeElement));
            if (!inBoard) break;
            const style = await focusedStyle(page);
            seen.push(style.label);
            expect(style.focusVisible, `:focus-visible on ${style.label}`).toBe(true);
            if (style.isCard) {
                // A card's indicator is the ring token.
                expect(style.shadow, `ring on ${style.label}`).toContain(ring);
            } else {
                expect(style.outline || (style.shadow !== 'none' && style.shadow !== ''), `focus indicator on ${style.label}`).toBe(true);
            }
            await page.keyboard.press('Tab');
        }
        // Every card loaded (fifty in Todo, seven in Done, five in Cancelled), its "Move to" menu button,
        // the three "+" buttons and Todo's "Load more" were each reached.
        expect(seen.filter((l) => /^card ACC-\d+:/.test(l))).toHaveLength(62);
        expect(seen.filter((l) => l.startsWith('combobox Move ACC-'))).toHaveLength(62);
        expect(seen.filter((l) => l.startsWith('button Add a work item to'))).toHaveLength(3);
        expect(seen).toContain('button Load more');
    });
});

async function focusedStyle(page: Page) {
    return page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const s = getComputedStyle(el);
        const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName;
        const isCard = el.getAttribute('aria-describedby') === 'work-item-board-instructions';
        return {
            label: `${isCard ? 'card' : el.getAttribute('role') ?? el.tagName.toLowerCase()} ${name}`,
            isCard,
            focusVisible: el.matches(':focus-visible'),
            outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
            shadow: s.boxShadow,
        };
    });
}
