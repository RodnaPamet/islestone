/**
 * The work-item graph rules, as pure functions (ADR 0002 §2 and §6).
 *
 * `wouldCreateCycle` mirrors the recursive `UNION` query the relation
 * repository runs under the workspace's graph lock: an edge `from → to` is
 * refused when `to` already reaches `from`. The property test drives this
 * function over random edge sequences; the integration test proves the SQL
 * twin refuses the same edges.
 *
 * The depth rule caps sub-items at five levels below a top-level item (owner
 * decision, 2026-11-19).
 */

/** Sub-item levels allowed below a top-level item. */
export const MAX_SUB_ITEM_DEPTH = 5;

/**
 * True when adding the edge `from → to` to `edges` would close a cycle, that
 * is when `from === to` or `to` already reaches `from`.
 */
export function wouldCreateCycle(edges: Iterable<readonly [string, string]>, from: string, to: string): boolean {
    if (from === to) return true;
    const out = new Map<string, string[]>();
    for (const [a, b] of edges) {
        const list = out.get(a);
        if (list) list.push(b);
        else out.set(a, [b]);
    }
    // Walk forward from `to`; reaching `from` means the new edge closes a loop.
    const seen = new Set<string>([to]);
    const stack = [to];
    while (stack.length > 0) {
        const node = stack.pop()!;
        for (const next of out.get(node) ?? []) {
            if (next === from) return true;
            if (!seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return false;
}

/** True when the edge set contains a directed cycle (used by the property test). */
export function hasCycle(edges: Iterable<readonly [string, string]>): boolean {
    const out = new Map<string, string[]>();
    const nodes = new Set<string>();
    for (const [a, b] of edges) {
        nodes.add(a);
        nodes.add(b);
        const list = out.get(a);
        if (list) list.push(b);
        else out.set(a, [b]);
    }
    const colour = new Map<string, 0 | 1 | 2>();
    const visit = (start: string): boolean => {
        const stack: Array<[string, number]> = [[start, 0]];
        colour.set(start, 1);
        while (stack.length > 0) {
            const top = stack[stack.length - 1]!;
            const nexts = out.get(top[0]) ?? [];
            if (top[1] < nexts.length) {
                const next = nexts[top[1]++]!;
                const c = colour.get(next) ?? 0;
                if (c === 1) return true;
                if (c === 0) {
                    colour.set(next, 1);
                    stack.push([next, 0]);
                }
            } else {
                colour.set(top[0], 2);
                stack.pop();
            }
        }
        return false;
    };
    for (const n of nodes) {
        if ((colour.get(n) ?? 0) === 0 && visit(n)) return true;
    }
    return false;
}

/**
 * Whether placing a subtree of height `subtreeHeight` (0 for a leaf) under a
 * parent at depth `parentDepth` (0 for a top-level item) stays within the
 * cap. The moved item's depth becomes `parentDepth + 1`, its deepest
 * descendant's `parentDepth + 1 + subtreeHeight`.
 */
export function fitsDepthCap(parentDepth: number, subtreeHeight: number): boolean {
    return parentDepth + 1 + subtreeHeight <= MAX_SUB_ITEM_DEPTH;
}
