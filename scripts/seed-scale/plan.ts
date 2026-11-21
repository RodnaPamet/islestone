/**
 * What each seeded item is (Hardening H2a; docs/porting/maps/H2.md part 1.1):
 * one pure, deterministic plan per project, drawn from a named stream, that
 * both writers read. The bulk writer turns the first items of a project into
 * rows; the last `RATIOS.sample` share go through the usecases with the same
 * plan, so the sample looks like the rest.
 */
import type { WorkItemPriority } from '@prisma/client';

import type { Rng } from './random';
import { zipf } from './random';
import { RATIOS, STATE_MIX } from './shapes';
import { commentBody, description, shortText, title } from './text';

export type StateName = (typeof STATE_MIX)[number][0];

/** The five fields every seeded project carries, in order (map part 1.1: five per project). */
export const FIELD_DEFS = [
    { name: 'Stage', type: 'SELECT', options: ['Discovery', 'Design', 'Build', 'Verify', 'Ship'] },
    { name: 'Points', type: 'NUMBER' },
    { name: 'Target date', type: 'DATE' },
    { name: 'Reviewer', type: 'PERSON' },
    { name: 'Customer', type: 'TEXT' },
] as const;

export type FieldValue = { optionIndex: number } | { number: number } | { date: string } | { memberIndex: number } | { text: string };

export interface CommentPlan {
    /** Index into the workspace's writers (members who may comment). */
    author: number;
    body: string;
    createdAt: Date;
}

export interface ItemPlan {
    index: number;
    title: string;
    description: string | null;
    state: StateName;
    /** Index into the workspace's types (the three defaults: about half, a third, a fifth). */
    type: number;
    priority: WorkItemPriority;
    /** Index into the assignable members, or null. */
    assignee: number | null;
    /** Index into all members (an open item only), or null. */
    waitingOn: number | null;
    /** Index into the writers. */
    creator: number;
    /** An earlier item of the same project, or null. */
    parent: number | null;
    startDate: string | null;
    dueDate: string | null;
    createdAt: Date;
    updatedAt: Date;
    /** Index into the team's cycles (past cycles for closed items), or null. */
    cycle: number | null;
    /** Index into the project's milestones, or null. */
    milestone: number | null;
    /** Indexes into the workspace's labels, distinct. */
    labels: number[];
    /** One entry per FIELD_DEFS member; undefined is no value. */
    fields: Array<FieldValue | undefined>;
    /** Index into all members, or null. */
    watcher: number | null;
    comments: CommentPlan[];
    /** Later items of the same project this one blocks (always a higher index: acyclic). */
    blocks: number[];
    /** Soft-deleted (about 1 %), with its deletion time. */
    deletedAt: Date | null;
}

export interface PlanContext {
    /** Items in the project. */
    size: number;
    /** The run's anchor day (UTC midnight): due dates spread ±180 days around it. */
    anchor: Date;
    /** How many members may be assigned, how many in all, how many may write. */
    assignable: number;
    members: number;
    writers: number;
    labels: number;
    /** The team's cycles: how many lie before the anchor (closed) and in all. */
    pastCycles: number;
    cycles: number;
    milestones: number;
}

const DAY = 86_400_000;
/** How far ahead of an item its BLOCKS targets lie (in creation order). */
export const BLOCKS_WINDOW = 200;
const CLOSED: ReadonlySet<StateName> = new Set(['Done', 'Cancelled']);
const PRIORITIES: ReadonlyArray<readonly [WorkItemPriority, number]> = [
    ['NONE', 0.4],
    ['LOW', 0.2],
    ['MEDIUM', 0.25],
    ['HIGH', 0.11],
    ['URGENT', 0.04],
];

function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** A count with the given mean: a coin below one, else uniform over 0..2·mean. */
function around(rng: Rng, mean: number): number {
    if (mean < 1) return rng.chance(mean) ? 1 : 0;
    return rng.int(0, Math.round(mean * 2));
}

export function isClosedState(state: StateName): boolean {
    return CLOSED.has(state);
}

/** The plans of one project's items, in creation order. */
export function planProject(rng: Rng, ctx: PlanContext): ItemPlan[] {
    const assigneeRank = zipf(ctx.assignable);
    const depth: number[] = [];
    const plans: ItemPlan[] = [];
    const yearAgo = ctx.anchor.getTime() - 365 * DAY;
    for (let i = 0; i < ctx.size; i++) {
        const state = rng.weighted(STATE_MIX);
        const closed = CLOSED.has(state);
        // Created through the year before the anchor, in index order with jitter.
        const createdAt = new Date(yearAgo + Math.floor(((i + rng.next()) / ctx.size) * 360 * DAY));
        const updatedAt = new Date(Math.min(createdAt.getTime() + rng.int(0, 60) * DAY + rng.int(0, DAY - 1), ctx.anchor.getTime() - 1));
        let parent: number | null = null;
        if (i > 0 && rng.chance(RATIOS.subItems)) {
            const candidate = rng.int(Math.max(0, i - 300), i - 1);
            if (depth[candidate]! < 4) parent = candidate;
        }
        depth.push(parent === null ? 0 : depth[parent]! + 1);
        const due = rng.chance(RATIOS.due) ? new Date(ctx.anchor.getTime() + rng.int(-180, 180) * DAY) : null;
        const start = due && rng.chance(RATIOS.started / RATIOS.due) ? new Date(due.getTime() - rng.int(0, 30) * DAY) : null;
        let cycle: number | null = null;
        if (ctx.cycles > 0 && rng.chance(RATIOS.inCycle)) {
            if (closed && ctx.pastCycles > 0) cycle = rng.int(0, ctx.pastCycles - 1);
            else if (!closed && ctx.cycles > ctx.pastCycles) cycle = rng.int(ctx.pastCycles, Math.min(ctx.cycles - 1, ctx.pastCycles + 3));
        }
        const fields: Array<FieldValue | undefined> = FIELD_DEFS.map((def) => {
            if (!rng.chance(RATIOS.customFieldFill)) return undefined;
            switch (def.type) {
                case 'SELECT':
                    return { optionIndex: rng.int(0, def.options.length - 1) };
                case 'NUMBER':
                    return { number: rng.pick([1, 2, 3, 5, 8, 13]) };
                case 'DATE':
                    return { date: dayKey(new Date(ctx.anchor.getTime() + rng.int(-120, 240) * DAY)) };
                case 'PERSON':
                    return { memberIndex: rng.int(0, ctx.assignable - 1) };
                case 'TEXT':
                    return { text: shortText(rng) };
            }
        });
        const commentCount = around(rng, RATIOS.commentsPerItem);
        const comments: CommentPlan[] = [];
        for (let c = 0; c < commentCount; c++) {
            comments.push({
                author: rng.int(0, ctx.writers - 1),
                body: commentBody(rng),
                createdAt: new Date(Math.min(createdAt.getTime() + (c + 1) * rng.int(1, 5) * DAY, ctx.anchor.getTime() - 1)),
            });
        }
        const blocks: number[] = [];
        const edges = around(rng, RATIOS.blocksPerItem);
        for (let e = 0; e < edges && i < ctx.size - 1; e++) {
            const to = rng.int(i + 1, Math.min(ctx.size - 1, i + BLOCKS_WINDOW));
            if (!blocks.includes(to)) blocks.push(to);
        }
        plans.push({
            index: i,
            title: title(rng),
            description: rng.chance(RATIOS.described) ? description(rng) : null,
            state,
            type: rng.weighted<number>([
                [0, 0.5],
                [1, 0.3],
                [2, 0.2],
            ]),
            priority: rng.weighted(PRIORITIES),
            assignee: rng.chance(RATIOS.assigned) ? assigneeRank(rng) : null,
            waitingOn: !closed && rng.chance(RATIOS.waitingOn) ? rng.int(0, ctx.members - 1) : null,
            creator: rng.int(0, ctx.writers - 1),
            parent,
            startDate: start ? dayKey(start) : null,
            dueDate: due ? dayKey(due) : null,
            createdAt,
            updatedAt,
            cycle,
            milestone: ctx.milestones > 0 && rng.chance(RATIOS.inMilestone) ? rng.int(0, ctx.milestones - 1) : null,
            labels: rng.sample(
                Array.from({ length: ctx.labels }, (_, k) => k),
                around(rng, RATIOS.labelsPerItem),
            ),
            fields,
            watcher: rng.chance(RATIOS.watched) ? rng.int(0, ctx.members - 1) : null,
            comments,
            blocks,
            // A sub-item of a deleted item went with it (a subtree delete).
            deletedAt:
                parent !== null && plans[parent]!.deletedAt
                    ? plans[parent]!.deletedAt
                    : rng.chance(0.01)
                      ? new Date(ctx.anchor.getTime() - rng.int(1, 60) * DAY)
                      : null,
        });
    }
    return plans;
}
