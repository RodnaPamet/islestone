/**
 * The scale seed's pages (sub-phase 4.1a; docs/porting/maps/4.1.md,
 * "Performance (H2's rules)"), so the page-tree reads, the breadcrumb, the
 * subtree walk, the Deleted list and the title search meet real volume:
 *
 *   - **A project's tree**: one page per ten of its items (100 in each
 *     1,000-item project at 10k, about 10,000 at 100k), nested up to five
 *     deep: a twentieth of them top-level, the rest under an earlier page
 *     whose level is below five.
 *   - **The workspace's tree**: ten pages per project, nested the same way.
 *   - **Deleted pages**: about 3 % of the leaves, each its own delete group,
 *     a few days to a few weeks ago (inside the purge window).
 *   - Every page has its empty `PageContent` row, as a create writes it; the
 *     body is 4.1b's, and the seed gains states then.
 *
 * Written as the database superuser in bulk, as the bulk half writes items:
 * no audit entry (the usecases' rows are the integration suite's).
 *
 * Written fresh for Islestone.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { keysBetween } from '../../src/app-layer/domain/fractional-index';

import { stream, type Rng } from './random';
import { title } from './text';
import type { SeedEnv, SeedWorkspace } from './workspace';
import { DAY_MS } from './workspace';

export const PAGE_RATIOS = {
    /** Pages in a project's tree per item of the project. */
    perItem: 0.1,
    /** Pages in the workspace's tree per project. */
    workspacePerProject: 10,
    /** Share of a tree's pages at its top level. */
    topLevel: 0.05,
    /** The deepest level the seed nests to (the product allows ten). */
    maxLevel: 5,
    /** Share of leaves deleted, each alone. */
    deletedLeaves: 0.03,
} as const;

interface PlannedPage {
    id: string;
    parentIndex: number | null;
    level: number;
}

/** A tree of `n` pages: parents always earlier, levels at most `maxLevel`. */
export function planPageTree(rng: Rng, n: number): PlannedPage[] {
    const out: PlannedPage[] = [];
    const roots = Math.max(1, Math.round(n * PAGE_RATIOS.topLevel));
    for (let i = 0; i < n; i++) {
        if (i < roots) {
            out.push({ id: rng.id(), parentIndex: null, level: 1 });
            continue;
        }
        // Prefer recent pages, so the tree grows deep rather than wide.
        let parentIndex = rng.int(Math.max(0, i - 25), i - 1);
        for (let tries = 0; tries < 8 && out[parentIndex]!.level >= PAGE_RATIOS.maxLevel; tries++) parentIndex = rng.int(0, i - 1);
        if (out[parentIndex]!.level >= PAGE_RATIOS.maxLevel) parentIndex = rng.int(0, roots - 1);
        out.push({ id: rng.id(), parentIndex, level: out[parentIndex]!.level + 1 });
    }
    return out;
}

function treeRows(env: SeedEnv, ws: SeedWorkspace, rng: Rng, projectId: string | null, planned: PlannedPage[]): { pages: Prisma.PageCreateManyInput[]; contents: Prisma.PageContentCreateManyInput[] } {
    // Sort keys per sibling group, in plan order.
    const groups = new Map<number | null, number[]>();
    planned.forEach((p, i) => {
        const list = groups.get(p.parentIndex) ?? [];
        list.push(i);
        groups.set(p.parentIndex, list);
    });
    const keys = new Array<string>(planned.length);
    for (const members of groups.values()) {
        const k = keysBetween(null, null, members.length);
        members.forEach((index, j) => (keys[index] = k[j]!));
    }
    const hasChildren = new Set(planned.flatMap((p) => (p.parentIndex === null ? [] : [p.parentIndex])));
    const pages: Prisma.PageCreateManyInput[] = [];
    const contents: Prisma.PageContentCreateManyInput[] = [];
    planned.forEach((p, i) => {
        const createdAt = new Date(env.anchor.getTime() - rng.int(30, 400) * DAY_MS);
        const deleted = !hasChildren.has(i) && rng.chance(PAGE_RATIOS.deletedLeaves);
        const deletedAt = deleted ? new Date(env.anchor.getTime() - rng.int(2, 25) * DAY_MS) : null;
        pages.push({
            id: p.id,
            tenantId: ws.tenantId,
            projectId,
            parentId: p.parentIndex === null ? null : planned[p.parentIndex]!.id,
            sortKey: keys[i]!,
            title: title(rng).slice(0, 200),
            createdByUserId: rng.pick(ws.writers).userId,
            createdAt,
            updatedAt: createdAt,
            ...(deleted ? { deletedAt, deletedByUserId: ws.owner.userId, deletionId: rng.id() } : {}),
        });
        contents.push({ id: rng.id(), pageId: p.id, tenantId: ws.tenantId, updatedAt: createdAt });
    });
    return { pages, contents };
}

/** Every page of one workspace: each project's tree and the workspace's. */
export async function seedPages(env: SeedEnv, bulk: PrismaClient, ws: SeedWorkspace): Promise<number> {
    const rng = stream(env.seed, `${ws.slug}:pages`);
    const trees: Array<{ projectId: string | null; n: number }> = [
        ...ws.projects.map((p) => ({ projectId: p.id, n: Math.max(1, Math.round(p.size * PAGE_RATIOS.perItem)) })),
        { projectId: null, n: ws.projects.length * PAGE_RATIOS.workspacePerProject },
    ];
    let total = 0;
    for (const tree of trees) {
        const { pages, contents } = treeRows(env, ws, rng, tree.projectId, planPageTree(rng, tree.n));
        // guardrail-allow: n+1 — one tree per statement pair, bounded by the workspace's projects.
        await bulk.$transaction(async (tx) => {
            await tx.page.createMany({ data: pages });
            await tx.pageContent.createMany({ data: contents });
        }, { timeout: 120_000 });
        total += pages.length;
    }
    env.log(`${ws.slug}: ${total} pages`);
    return total;
}
