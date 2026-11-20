/**
 * The board's pure model (sub-phase 2.3): columns for a scope, lanes for a
 * grouping, a drop's placement between neighbours, and the keyboard's moves.
 * No React and no DOM, so every rule here is property-tested
 * (`tests/unit/work-items/board-model.test.ts`).
 *
 *   - **Columns.** A project's board (one team) has one column per live
 *     workflow state, grouped by category in the category order. A board
 *     over several teams (the workspace list, My Work) has one column per
 *     CATEGORY: a drop maps the item to its own team's default state of that
 *     category, as the bulk state change does (2.2), so two teams' "In
 *     review" are never mixed in one column.
 *   - **Lanes.** By assignee, priority, type, label or project, or none.
 *     Lanes group the loaded rows; they never filter them (the server owns
 *     filtering). A row with several labels sits in the lane of its first
 *     label in the workspace's label order. Moving a card to another lane
 *     changes that field for assignee, priority and type; label and project
 *     lanes are fixed (a card does not change label or project by a drop).
 *   - **Placement.** A drop at an index sends the neighbour above
 *     (`afterId`) or, at the top, the neighbour below (`beforeId`), and the
 *     client's optimistic `sortKey` between them (2.1's `keyBetween`); the
 *     server computes its own key from the same neighbour, and the server's
 *     wins. Keys compare with `<` (COLLATE "C"), never `localeCompare`. An
 *     anchor in another project is not sent (a position names an item of
 *     the moved item's project).
 *
 * The SHAPE (pure move functions, thin drag wiring) follows
 * inflect-compliance's `src/lib/framework-tree/builder-state.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; pattern only, no code copied.
 */
import { keyBetween } from '@/app-layer/domain/fractional-index';
import { WORKFLOW_STATE_CATEGORIES } from '@/app-layer/domain/workflow-state';
import type { ViewState, WorkflowStateCategory, WorkItemRow } from '@/lib/work-items/types';

export type LaneBy = 'none' | 'assignee' | 'priority' | 'type' | 'label' | 'project';

export const LANE_BY_VALUES: readonly LaneBy[] = ['none', 'assignee', 'priority', 'type', 'label', 'project'];

/** Lanes whose value a drop may change. */
export const MOVABLE_LANES: ReadonlySet<LaneBy> = new Set<LaneBy>(['none', 'assignee', 'priority', 'type']);

export interface BoardColumnDef {
    /** A state id, or a category for a cross-team board. */
    id: string;
    kind: 'state' | 'category';
    category: WorkflowStateCategory;
    /** The state's name; a category column's label is the caller's (i18n). */
    name: string | null;
    /** The list filter this column reads. */
    filter: { stateId: string } | { stateCategory: WorkflowStateCategory };
}

/** A project's board: its team's live states, grouped by category. */
export function stateColumns(states: readonly ViewState[]): BoardColumnDef[] {
    const rank = new Map<string, number>(WORKFLOW_STATE_CATEGORIES.map((c, i) => [c, i]));
    return states
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (rank.get(a.s.category) ?? 0) - (rank.get(b.s.category) ?? 0) || a.i - b.i)
        .map(({ s }) => ({ id: s.id, kind: 'state' as const, category: s.category, name: s.name, filter: { stateId: s.id } }));
}

/** A board over several teams: one column per category. */
export function categoryColumns(): BoardColumnDef[] {
    return WORKFLOW_STATE_CATEGORIES.map((category) => ({
        id: category,
        kind: 'category' as const,
        category,
        name: null,
        filter: { stateCategory: category },
    }));
}

/**
 * The state a drop into `column` gives `row`: the column's state, or the
 * row's team's default state of the column's category (`undefined` when that
 * team has no live state of it; the drop is refused before any request).
 */
export function targetStateId(
    column: BoardColumnDef,
    row: Pick<WorkItemRow, 'teamId'>,
    defaultStateOf: (teamId: string, category: WorkflowStateCategory) => ViewState | undefined,
): string | undefined {
    if (column.kind === 'state') return column.id;
    return defaultStateOf(row.teamId, column.category)?.id;
}

export interface LaneContext {
    labelOrder: readonly string[];
}

/** The lane a row sits in (`''` is "no value"). */
export function laneKeyOf(row: WorkItemRow, laneBy: LaneBy, ctx: LaneContext): string {
    switch (laneBy) {
        case 'none':
            return '';
        case 'assignee':
            return row.assigneeId ?? '';
        case 'priority':
            return row.priority;
        case 'type':
            return row.typeId;
        case 'project':
            return row.projectId;
        case 'label': {
            const first = ctx.labelOrder.find((id) => row.labelIds.includes(id));
            return first ?? '';
        }
    }
}

/**
 * The lanes present among the loaded rows, in `order` (the config's order
 * for that field), with the "no value" lane last.
 */
export function lanesOf(rows: readonly WorkItemRow[], laneBy: LaneBy, ctx: LaneContext, order: readonly string[]): string[] {
    if (laneBy === 'none') return [''];
    const present = new Set(rows.map((r) => laneKeyOf(r, laneBy, ctx)));
    const known = order.filter((k) => present.has(k));
    const unknown = [...present].filter((k) => k !== '' && !order.includes(k)).sort();
    return [...known, ...unknown, ...(present.has('') ? [''] : [])];
}

/** Byte-wise `sortKey` order, then id. */
export function bySortKey(a: Pick<WorkItemRow, 'sortKey' | 'id'>, b: Pick<WorkItemRow, 'sortKey' | 'id'>): number {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface Placement {
    afterId?: string;
    beforeId?: string;
    /** The optimistic key, strictly between the neighbours sent. */
    sortKey?: string;
}

/**
 * Where a drop at `index` of `cell` (sorted, WITHOUT the moved row) puts
 * `row`. Anchors in another project are not sent: the server would refuse
 * them, and a cross-project column keeps each project's own order.
 */
export function placementFor(cell: readonly WorkItemRow[], index: number, row: Pick<WorkItemRow, 'projectId' | 'sortKey'>): Placement {
    const i = Math.max(0, Math.min(index, cell.length));
    const prev = cell[i - 1];
    const next = cell[i];
    const prevOk = prev && prev.projectId === row.projectId ? prev : undefined;
    const nextOk = next && next.projectId === row.projectId ? next : undefined;
    if (!prevOk && !nextOk) return {};
    let sortKey: string | undefined;
    try {
        const lo = prevOk?.sortKey ?? null;
        const hi = nextOk?.sortKey ?? null;
        sortKey = lo !== null && hi !== null && !(lo < hi) ? undefined : keyBetween(lo, hi);
    } catch {
        sortKey = undefined;
    }
    return prevOk ? { afterId: prevOk.id, sortKey } : { beforeId: nextOk!.id, sortKey };
}

// ─── Keyboard moves ───────────────────────────────────────────────────────

/** Where a picked-up card would land: a column, a lane and an index in that cell. */
export interface GrabTarget {
    column: number;
    lane: number;
    index: number;
}

export type GrabDirection = 'up' | 'down' | 'left' | 'right';

/**
 * The next target for an arrow key. `cellSize(column, lane)` is the number of
 * cards in a cell WITHOUT the picked-up card, so an index runs 0..size.
 * Up and down move within a cell and, past its edge, into the neighbouring
 * lane when lanes are movable; left and right keep the index, clamped.
 */
export function nextTarget(
    target: GrabTarget,
    direction: GrabDirection,
    dims: { columns: number; lanes: number; lanesMovable: boolean },
    cellSize: (column: number, lane: number) => number,
): GrabTarget {
    const { column, lane, index } = target;
    switch (direction) {
        case 'left':
        case 'right': {
            const c = Math.max(0, Math.min(dims.columns - 1, column + (direction === 'left' ? -1 : 1)));
            return { column: c, lane, index: Math.min(index, cellSize(c, lane)) };
        }
        case 'up':
            if (index > 0) return { column, lane, index: index - 1 };
            if (dims.lanesMovable && lane > 0) return { column, lane: lane - 1, index: cellSize(column, lane - 1) };
            return target;
        case 'down':
            if (index < cellSize(column, lane)) return { column, lane, index: index + 1 };
            if (dims.lanesMovable && lane < dims.lanes - 1) return { column, lane: lane + 1, index: 0 };
            return target;
    }
}

/** Insert `row` into `cell` (without it) at `index`: the keyboard's preview. */
export function withPreview<T extends { id: string }>(cell: readonly T[], row: T, index: number): T[] {
    const without = cell.filter((r) => r.id !== row.id);
    const i = Math.max(0, Math.min(index, without.length));
    return [...without.slice(0, i), row, ...without.slice(i)];
}
