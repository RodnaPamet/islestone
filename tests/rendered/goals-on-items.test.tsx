/** @jest-environment jsdom */

/**
 * An item's goal and ancestry on its detail (sub-phase 3.2a; decisions 211
 * and 220): the breadcrumb reads `GET /work-items/:id/ancestry` and shows
 * "Goal › Initiative › Project › parents", a second "Also serves" line only
 * when the item's own goal is not one of the path's, and hidden levels
 * counted, never named; the Goal picker offers the view configuration's
 * goals and sends the change with `If-Match`; a Viewer gets no picker to use;
 * no axe violations.
 *
 * Written fresh for Islestone.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
    usePathname: () => '/t/acme/work-items/ISL-1',
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ tenantSlug: 'acme' }),
}));

import { showsDirectLine } from '@/components/work-items/detail/AncestryBreadcrumb';
import { WorkItemDetail } from '@/components/work-items/WorkItemDetail';
import type { WorkItemAncestry } from '@/lib/goals/types';
import type { WorkItemViewConfig } from '@/lib/work-items/types';

import { CONFIG, PROJECT, detail, installFetch, MEMBERS, renderWorkspace, row } from '../helpers/work-items-harness';

const WITH_GOALS: WorkItemViewConfig = {
    ...CONFIG,
    goals: [
        { id: 'g-1', parentId: null, title: 'Grow revenue' },
        { id: 'g-2', parentId: 'g-1', title: 'Win enterprise' },
    ],
    initiatives: [{ id: 'i-1', goalId: 'g-2', name: 'SSO rollout' }],
};

const ANCESTRY: WorkItemAncestry = {
    item: { id: 'wi-1', key: 'ISL-1', title: 'Item 1' },
    parents: [{ id: 'wi-0', key: 'ISL-0', title: 'Parent' }],
    project: { id: PROJECT, name: 'Islands', keyPrefix: 'ISL', archived: false },
    initiative: { id: 'i-1', name: 'SSO rollout', status: 'STARTED', archived: false },
    goals: [
        { id: 'g-1', title: 'Grow revenue', status: 'STARTED', archived: false },
        { id: 'g-2', title: 'Win enterprise', status: 'PLANNED', archived: false },
    ],
    directGoals: [{ id: 'g-9', title: 'Cut churn', status: 'STARTED', archived: true }],
    hiddenLevels: 0,
};

function routes(ancestry: WorkItemAncestry = ANCESTRY, extra: Parameters<typeof installFetch>[0] = {}) {
    return installFetch({
        'GET /work-items/wi-1': { body: detail(row(1)) },
        'GET /work-items/wi-1/ancestry': { body: ancestry },
        'GET /users/assignable': { body: MEMBERS },
        'GET /work-items/wi-1/watchers': { body: [] },
        [`GET /projects/${PROJECT}/custom-fields`]: { body: [] },
        ...extra,
    });
}

describe("an item's ancestry and goal", () => {
    it('shows the path and the item\'s own goal on a second line, archived marked, with no axe violations', async () => {
        routes();
        const { container } = renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_GOALS });
        const nav = await screen.findByRole('navigation', { name: 'Ancestry' });
        expect(nav).toHaveTextContent('Grow revenue › Win enterprise › SSO rollout › Islands › ISL-0');
        expect(nav).toHaveTextContent('Also serves: Cut churn (archived)');
        expect(await axe(container)).toHaveNoViolations();
    });

    it('shows no second line when the own goal is already on the path, and counts hidden levels without naming them', async () => {
        expect(showsDirectLine({ goals: ANCESTRY.goals, directGoals: [ANCESTRY.goals[1]!] })).toBe(false);
        expect(showsDirectLine({ goals: [], directGoals: null })).toBe(false);
        routes({ ...ANCESTRY, initiative: null, goals: [], directGoals: null, hiddenLevels: 3 });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_GOALS });
        const nav = await screen.findByRole('navigation', { name: 'Ancestry' });
        expect(nav).toHaveTextContent('3 levels hidden');
        expect(nav).not.toHaveTextContent('Also serves');
        expect(nav).not.toHaveTextContent('Grow revenue');
    });

    it("offers the configuration's goals and sends the change with If-Match", async () => {
        const { calls } = routes(ANCESTRY, { 'PUT /work-items/wi-1/goal': { body: detail(row(1, { goalId: 'g-2', version: 2 })) } });
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_GOALS });
        fireEvent.click(await screen.findByRole('combobox', { name: 'No goal' }));
        fireEvent.click(await screen.findByRole('option', { name: /Win enterprise/ }));
        await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
        const put = calls.find((c) => c.method === 'PUT')!;
        expect(put.path).toBe('/work-items/wi-1/goal');
        expect(put.body).toEqual({ goalId: 'g-2' });
        expect(put.ifMatch).toBe('"1"');
    });

    it('a Viewer cannot change the goal', async () => {
        routes();
        renderWorkspace(<WorkItemDetail workItemId="wi-1" variant="sheet" />, { config: WITH_GOALS, role: 'VIEWER' });
        const picker = await screen.findByRole('combobox', { name: 'No goal' });
        expect(picker).toBeDisabled();
    });
});
