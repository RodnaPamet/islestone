/**
 * The scale seed's shapes (Hardening H2a; docs/porting/maps/H2.md part 1.1;
 * owner decision 170). Each shape is built twice: the measured workspace and a
 * sibling of the same size, so the planner and row-level security see other
 * tenants' rows as they do in production (`tenantId`-leading indexes only
 * prove themselves when other workspaces exist).
 *
 * `mini` is not a measured shape: the integration suite seeds it so the
 * seeder runs on every pull request even when the Performance job restores a
 * cached dump.
 */

export interface Shape {
    name: string;
    /** Teams in each workspace; projects are dealt to them in turn. */
    teams: number;
    /** Members in each workspace, the owner included. */
    members: number;
    /** Items per project, in order; the sum is the workspace's size. */
    projects: readonly number[];
}

const repeat = (n: number, size: number): number[] => Array.from({ length: n }, () => size);

export const SHAPES = {
    mini: { name: 'mini', teams: 1, members: 6, projects: [300, 200] },
    '10k': { name: '10k', teams: 1, members: 40, projects: repeat(10, 1_000) },
    // Decision 170: 100,000 items, one large project of 20,000 (the skew) among
    // nineteen sharing the other 80,000 (4,210 or 4,211 each). The map's "19 ×
    // 4,200" sums to 99,800; the decision's totals win.
    '100k': { name: '100k', teams: 5, members: 200, projects: [...repeat(10, 4_211), ...repeat(9, 4_210), 20_000] },
} as const satisfies Record<string, Shape>;

export type ShapeName = keyof typeof SHAPES;

export function isShapeName(value: string): value is ShapeName {
    return Object.prototype.hasOwnProperty.call(SHAPES, value);
}

export function shapeItemCount(shape: Shape): number {
    return shape.projects.reduce((s, n) => s + n, 0);
}

/**
 * The ratios of the map's part 1.1, the same at every size. Probabilities are
 * per item unless named otherwise.
 */
export const RATIOS = {
    /** Share of each project's items written through the usecases (decision 171). */
    sample: 0.01,
    /** Mean comments per item (0 to 6). */
    commentsPerItem: 3,
    /** Mean labels per item (0 to 3). */
    labelsPerItem: 1.5,
    /** BLOCKS edges per item, always from an earlier item to a later one (acyclic). */
    blocksPerItem: 0.3,
    /** Custom fields per project, and the share of items with a value in each. */
    customFieldsPerProject: 5,
    customFieldFill: 0.6,
    /** Milestones per project. */
    milestonesPerProject: 3,
    /** Share of items that are sub-items (of an earlier item in the same project). */
    subItems: 0.2,
    /** Share of items with a description. */
    described: 0.7,
    /** Share of items with an assignee (Zipf over members), and of open ones waiting on somebody. */
    assigned: 0.8,
    waitingOn: 0.1,
    /** Share of items with a due date (spread over ±180 days around the anchor) and a start date. */
    due: 0.6,
    started: 0.3,
    /** Share of items with a watcher who is neither creator nor assignee. */
    watched: 0.5,
    /** Labels in each workspace. */
    labels: 12,
    /** Fortnightly cycles per team: half before the anchor (completed), half from it. */
    cycles: 26,
    /** Share of items in a cycle. */
    inCycle: 0.5,
    /** Share of items in a milestone. */
    inMilestone: 0.4,
    /** Share of the sample's open items sent for review (2.8; the usecases only). */
    inReview: 0.4,
} as const;

/** The state mix of a real backlog (map part 1.1). */
export const STATE_MIX = [
    ['Done', 0.45],
    ['Cancelled', 0.1],
    ['Backlog', 0.25],
    ['Todo', 0.12],
    ['In progress', 0.06],
    ['In review', 0.02],
] as const;

/** How many of a project's items the sample takes: 1 %, at least one (decision 171). */
export function sampleCount(size: number): number {
    return Math.max(1, Math.round(size * RATIOS.sample));
}

/** `AA`, `AB`, … `ZZ`: a project's key prefix by its index (676 projects at most). */
export function prefixFor(index: number): string {
    if (index < 0 || index >= 26 * 26) throw new Error(`no two-letter prefix for project ${index}`);
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return `${a[Math.floor(index / 26)]}${a[index % 26]}`;
}
