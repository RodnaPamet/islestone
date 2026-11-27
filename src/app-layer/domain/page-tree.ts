/**
 * The page tree's rules (sub-phase 4.1a; docs/porting/maps/4.1.md, "Page and
 * the tree"; ADR 0015 §1; owner decisions 341 and 344), pure and client-safe.
 * The usecases read the rows under the page-tree lock and ask these; the
 * pages' "New subpage" button asks the same depth rule.
 *
 *   - Pages nest at most ten levels (decision 341): a top-level page is level 1.
 *   - A move refuses a new parent inside the moved page's own subtree,
 *     deleted pages included (a cycle), and a new parent whose level plus the
 *     moved subtree's height passes ten. Deleted pages count, so a restore
 *     can never break either rule.
 *   - A delete group's root is the one page of the group whose parent is not
 *     in the group (decision 344): only it restores the group.
 *
 * Written fresh for Islestone (the shape of `goal-tree.ts`).
 */

export const MAX_PAGE_DEPTH = 10;

export type PageMoveRefusal = { reason: 'PAGE_WOULD_CYCLE' } | { reason: 'PAGE_TOO_DEEP'; depth: number };

/**
 * Can a page whose subtree (itself at depth 0) has the given depths move
 * under a parent whose chain (the parent itself first, deleted pages
 * included) is `parentChain`? `null` when it can; `parentChain` empty is a
 * move to the top level of a tree.
 */
export function pageMoveRefusal(pageId: string, parentChain: readonly string[], subtreeIds: readonly string[], subtreeDepths: readonly number[]): PageMoveRefusal | null {
    if (parentChain.length > 0 && (parentChain.includes(pageId) || subtreeIds.includes(parentChain[0]!))) return { reason: 'PAGE_WOULD_CYCLE' };
    const height = (subtreeDepths.length ? Math.max(...subtreeDepths) : 0) + 1;
    const depth = parentChain.length + height;
    return depth > MAX_PAGE_DEPTH ? { reason: 'PAGE_TOO_DEEP', depth } : null;
}

/** Can a new page go under a parent at `parentLevel` (1 for a top-level page; 0 for no parent)? */
export function subpageFits(parentLevel: number): boolean {
    return parentLevel + 1 <= MAX_PAGE_DEPTH;
}

/** The roots of a delete group: pages whose parent is not in the group, in id order. */
export function pageGroupRoots(pages: ReadonlyArray<{ id: string; parentId: string | null }>): string[] {
    const ids = new Set(pages.map((p) => p.id));
    return pages.filter((p) => p.parentId === null || !ids.has(p.parentId)).map((p) => p.id).sort();
}
