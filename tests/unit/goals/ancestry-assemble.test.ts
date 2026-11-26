/**
 * Assembling the ancestry statement's rows (sub-phase 3.2a, decisions 211 and
 * 220): root-first chains, keys from the project's prefix, the item's own goal
 * apart, and every goal and the initiative withheld (counted) from a caller
 * who may not read goals.
 */
import type { AncestryRow } from '@/app-layer/repositories/WorkItemRepository';
import { assembleAncestry } from '@/app-layer/usecases/work-item-ancestry';

const r = (kind: AncestryRow['kind'], id: string, depth: number, label: string, extra: Partial<AncestryRow> = {}): AncestryRow => ({
    kind,
    id,
    depth,
    label,
    num: null,
    code: null,
    archived: false,
    ...extra,
});

const ROWS: AncestryRow[] = [
    r('item', 'w2', 0, 'leaf', { num: 3 }),
    r('item', 'w1', 1, 'mid', { num: 2 }),
    r('item', 'w0', 2, 'top', { num: 1 }),
    r('project', 'p', 0, 'Islands', { code: 'ISL' }),
    r('initiative', 'i', 0, 'SSO', { code: 'STARTED' }),
    r('goal', 'g3', 0, 'Leaf goal', { code: 'PLANNED' }),
    r('goal', 'g2', 1, 'Mid goal', { code: 'STARTED', archived: true }),
    r('goal', 'g1', 2, 'Root goal', { code: 'COMPLETED' }),
    r('direct_goal', 'd2', 0, 'Own', { code: 'STARTED' }),
    r('direct_goal', 'd1', 1, 'Own root', { code: 'STARTED' }),
];

describe('assembleAncestry', () => {
    it('orders every chain root-first and keys items from the project', () => {
        const a = assembleAncestry(ROWS, true)!;
        expect(a.item).toEqual({ id: 'w2', key: 'ISL-3', title: 'leaf' });
        expect(a.parents.map((p) => p.key)).toEqual(['ISL-1', 'ISL-2']);
        expect(a.project).toEqual({ id: 'p', name: 'Islands', keyPrefix: 'ISL', archived: false });
        expect(a.initiative).toEqual({ id: 'i', name: 'SSO', status: 'STARTED', archived: false });
        expect(a.goals.map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
        expect(a.goals[1]).toMatchObject({ archived: true, status: 'STARTED' });
        expect(a.directGoals?.map((g) => g.id)).toEqual(['d1', 'd2']);
        expect(a.hiddenLevels).toBe(0);
    });

    it('withholds the initiative and the goals from a caller who may not read goals, counting them', () => {
        const a = assembleAncestry(ROWS, false)!;
        expect(a).toMatchObject({ initiative: null, goals: [], directGoals: null, hiddenLevels: 6 });
        expect(a.parents).toHaveLength(2);
    });

    it('no item row (missing, deleted or invisible) is null; no goals is an empty chain and no direct goal', () => {
        expect(assembleAncestry([], true)).toBeNull();
        const a = assembleAncestry([r('item', 'w', 0, 'only', { num: 9 }), r('project', 'p', 0, 'P', { code: 'P' })], true)!;
        expect(a).toMatchObject({ parents: [], initiative: null, goals: [], directGoals: null });
    });
});
