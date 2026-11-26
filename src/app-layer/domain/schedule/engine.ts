/**
 * The scheduling engine (roadmap 3.1; ADR 0010 §1 to §4; owner decisions 183
 * to 188, 197 and 198). Pure and client-safe: plain data in, plain data out,
 * no database, no clock, no time zone. The server computes a schedule for
 * every timeline read and the browser runs the same function to preview a
 * change of dates; there is no second implementation.
 *
 * The rules, in order:
 *
 *   1. **Validate.** A duplicate item or calendar id, an unknown calendar, or
 *      an edge naming an unknown item is a programmer error and throws. More
 *      than {@link SCHEDULE_ITEM_LIMIT} items returns `TOO_LARGE` before any
 *      work.
 *   2. **Summaries** (decision 186). An item with sub-items in the input is a
 *      summary, not scheduled itself: a blocks relation into it applies to
 *      each of its leaf sub-items, and one out of it leaves from every leaf
 *      (so from its last-finishing one). A relation between an item and its
 *      own sub-item means nothing in a schedule: it is left out and named
 *      (`EDGE_INSIDE_SUMMARY`).
 *   3. **Duration** on the item's calendar: both dates, the working days
 *      between them (at least 1); one date, 1 working day; neither, 0 and
 *      "No dates" (decision 185); start after due, `DATES_REVERSED` and 1
 *      working day at the due date.
 *   4. **Order.** Kahn's sort, the ready set ordered by id (`<`). A remainder
 *      is a cycle: the result is `CYCLE`, naming one, the second line behind
 *      the relation usecase's refusal (ADR 0002 §6).
 *   5. **Forward pass** (decision 187). Done: fixed at its actual dates.
 *      Started: from its actual start, never finishing before today. Open:
 *      not before today, its start date or the day after each blocker
 *      finishes, on its own calendar's next working day.
 *   6. **Backward pass.** The latest finish is the earliest of the finish in
 *      view, the item's milestone's due date, its project's due date
 *      (decision 188) and the day before each open successor's latest start.
 *   7. **Float**, in working days on the item's calendar; negative when a
 *      deadline is missed ("late by N days"). **Critical** (decision 198):
 *      the open and started items with the least float, when that is 0 or
 *      less, and the edges between them that leave no gap.
 *
 * Nothing here writes a date (decision 184): conflicts are reported. Results
 * are sorted by id, so the order of the input never changes them.
 *
 * Kahn's sort with ties broken by id follows the shape of inflect-compliance's
 * `src/app-layer/libraries/dependency-graph.ts` (pattern only, no code
 * copied); the rest is written fresh for Islestone.
 */
import {
    addWorkingDays,
    compileCalendar,
    isWorkingDay,
    nextWorkingDay,
    previousWorkingDay,
    subtractWorkingDays,
    workingDayDiff,
    workingDaysInclusive,
    type CompiledCalendar,
    type EpochDay,
} from './calendar';
import { spanOf } from './span';
import {
    SCHEDULE_ITEM_LIMIT,
    type ItemSchedule,
    type ScheduleConflict,
    type ScheduleEdge,
    type ScheduleInput,
    type ScheduleItem,
    type ScheduleResult,
    type ScheduleWarning,
} from './types';

/** One leaf the passes schedule. */
interface Node {
    item: ScheduleItem;
    cal: CompiledCalendar;
    duration: number;
    /** No planned dates (open), or no dates at all (done): placed, never constrains or is critical when it has no edges. */
    unscheduled: boolean;
    /** Has no blocks relation in the input. */
    isolated: boolean;
    /** The planned start used for conflicts: the start date, or the due date's working day for a due-only item. */
    conflictStart: EpochDay | null;
    /** The start date as "not before"; null when reversed or absent. */
    notBefore: EpochDay | null;
    preds: number[];
    succs: number[];
    es: EpochDay;
    ef: EpochDay;
    ls: EpochDay;
    lf: EpochDay;
    /** The first day a successor may start: the day after its finish, or its start for a zero-day item; null when it constrains nothing. */
    release: EpochDay | null;
    totalFloat: number;
    freeFloat: number;
    conflicts: Set<ScheduleConflict>;
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A min-heap of node indices (indices are in id order, so the smallest index is the smallest id). */
class IndexHeap {
    private readonly data: number[] = [];
    get size(): number {
        return this.data.length;
    }
    push(v: number): void {
        const d = this.data;
        d.push(v);
        let i = d.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (d[p]! <= v) break;
            d[i] = d[p]!;
            i = p;
        }
        d[i] = v;
    }
    pop(): number {
        const d = this.data;
        const top = d[0]!;
        const last = d.pop()!;
        if (d.length > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                let mv = last;
                if (l < d.length && d[l]! < mv) {
                    m = l;
                    mv = d[l]!;
                }
                if (r < d.length && d[r]! < mv) m = r;
                if (m === i) break;
                d[i] = d[m]!;
                i = m;
            }
            d[i] = last;
        }
        return top;
    }
}

function isClosed(n: Node): boolean {
    return n.item.status === 'done';
}

/** Placed but out of the passes: done without dates, or open without dates and without relations. */
function isFloating(n: Node): boolean {
    return n.unscheduled && (n.isolated || n.item.status === 'done');
}

export function computeSchedule(input: ScheduleInput): ScheduleResult {
    if (input.items.length > SCHEDULE_ITEM_LIMIT) return { ok: false, error: 'TOO_LARGE', items: input.items.length, limit: SCHEDULE_ITEM_LIMIT };
    const { asOf } = input;

    // ── 1. Validate ────────────────────────────────────────────────────
    const calendars = new Map<string, CompiledCalendar>();
    for (const spec of input.calendars) {
        if (calendars.has(spec.id)) throw new Error(`computeSchedule: duplicate calendar ${spec.id}`);
        calendars.set(spec.id, compileCalendar(spec));
    }
    const byId = new Map<string, ScheduleItem>();
    for (const item of input.items) {
        if (byId.has(item.id)) throw new Error(`computeSchedule: duplicate item ${item.id}`);
        if (!calendars.has(item.calendarId)) throw new Error(`computeSchedule: unknown calendar ${item.calendarId} on ${item.id}`);
        byId.set(item.id, item);
    }
    for (const e of input.edges) {
        if (!byId.has(e.from) || !byId.has(e.to)) throw new Error(`computeSchedule: an edge names an unknown item (${e.from} → ${e.to})`);
        if (e.from === e.to) return { ok: false, error: 'CYCLE', cycle: [e.from] };
    }

    // ── 2. Summaries ───────────────────────────────────────────────────
    const parents = new Map<string, string>();
    for (const item of input.items) if (item.parentId !== null && byId.has(item.parentId)) parents.set(item.id, item.parentId);
    const parentOf = (id: string): string | null => parents.get(id) ?? null;
    const children = new Map<string, string[]>();
    for (const item of input.items) {
        const p = parentOf(item.id);
        if (p === null) continue;
        const list = children.get(p);
        if (list) list.push(item.id);
        else children.set(p, [item.id]);
    }
    const ancestorMemo = new Map<string, ReadonlySet<string>>();
    const NONE: ReadonlySet<string> = new Set();
    const ancestorsOf = (id: string): ReadonlySet<string> => {
        const memo = ancestorMemo.get(id);
        if (memo) return memo;
        if (parentOf(id) === null) return NONE;
        const out = new Set<string>();
        let p = parentOf(id);
        while (p !== null) {
            if (out.has(p) || p === id) throw new Error(`computeSchedule: the parents of ${id} form a loop`);
            out.add(p);
            p = parentOf(p);
        }
        ancestorMemo.set(id, out);
        return out;
    };
    const leafMemo = new Map<string, string[]>();
    const leavesOf = (id: string): string[] => {
        const memo = leafMemo.get(id);
        if (memo) return memo;
        const kids = children.get(id);
        const leaves = kids ? kids.flatMap((k) => leavesOf(k)) : [id];
        leafMemo.set(id, leaves);
        return leaves;
    };
    // Every chain of parents ends (a loop throws).
    for (const item of input.items) ancestorsOf(item.id);

    const leafIds = input.items.filter((i) => !children.has(i.id)).map((i) => i.id).sort(byString);
    const index = new Map(leafIds.map((id, i) => [id, i]));

    const warnings: ScheduleWarning[] = [];
    const inside: string[] = [];
    /** Each expanded leaf edge, and the input edges it came from. */
    const leafEdges = new Map<number, { a: number; b: number; origins: ScheduleEdge[] }>();
    for (const e of input.edges) {
        if (ancestorsOf(e.to).has(e.from) || ancestorsOf(e.from).has(e.to)) {
            inside.push(`${e.from}>${e.to}`);
            continue;
        }
        for (const a of leavesOf(e.from)) {
            for (const b of leavesOf(e.to)) {
                const ia = index.get(a)!;
                const ib = index.get(b)!;
                const key = ia * leafIds.length + ib;
                const found = leafEdges.get(key);
                if (found) found.origins.push(e);
                else leafEdges.set(key, { a: ia, b: ib, origins: [e] });
            }
        }
    }
    if (inside.length > 0) warnings.push({ code: 'EDGE_INSIDE_SUMMARY', ids: [...new Set(inside)].sort(byString) });

    // ── 3. Nodes and durations ─────────────────────────────────────────
    const nodes: Node[] = leafIds.map((id) => {
        const item = byId.get(id)!;
        const cal = calendars.get(item.calendarId)!;
        const conflicts = new Set<ScheduleConflict>();
        const reversed = item.plannedStart !== null && item.plannedFinish !== null && item.plannedStart > item.plannedFinish;
        if (reversed) conflicts.add('DATES_REVERSED');
        const start = reversed ? null : item.plannedStart;
        const due = item.plannedFinish;
        let duration: number;
        let unscheduled = false;
        if (item.status === 'done') {
            const s = item.actualStart ?? start ?? item.actualFinish ?? due;
            const f = item.actualFinish ?? due ?? s;
            unscheduled = s === null || f === null;
            duration = unscheduled ? 0 : Math.max(1, workingDaysInclusive(cal, Math.min(s!, f!), f!));
        } else if (start !== null && due !== null) {
            duration = Math.max(1, workingDaysInclusive(cal, start, due));
        } else if (start !== null || due !== null) {
            duration = 1;
        } else if (item.status === 'started') {
            duration = 1;
        } else {
            duration = 0;
            unscheduled = true;
        }
        if (item.status === 'open' && start !== null && !isWorkingDay(cal, start)) conflicts.add('STARTS_ON_NON_WORKING_DAY');
        return {
            item,
            cal,
            duration,
            unscheduled,
            isolated: true,
            conflictStart: start ?? (due !== null ? previousWorkingDay(cal, due) : null),
            notBefore: start,
            preds: [],
            succs: [],
            es: 0,
            ef: 0,
            ls: 0,
            lf: 0,
            release: null,
            totalFloat: 0,
            freeFloat: 0,
            conflicts,
        };
    });
    const indegree = new Array<number>(nodes.length).fill(0);
    const leafEdgeList = [...leafEdges.values()];
    for (const { a, b } of leafEdgeList) {
        nodes[a]!.succs.push(b);
        nodes[b]!.preds.push(a);
        nodes[a]!.isolated = false;
        nodes[b]!.isolated = false;
        indegree[b]! += 1;
    }
    // Neighbours in id order, whatever order the edges came in.
    const byIndex = (x: number, y: number) => x - y;
    for (const n of nodes) {
        if (n.succs.length > 1) n.succs.sort(byIndex);
        if (n.preds.length > 1) n.preds.sort(byIndex);
    }

    // ── 4. Order ───────────────────────────────────────────────────────
    const order: number[] = [];
    const ready = new IndexHeap();
    for (let i = 0; i < nodes.length; i += 1) if (indegree[i] === 0) ready.push(i);
    while (ready.size > 0) {
        const i = ready.pop();
        order.push(i);
        for (const s of nodes[i]!.succs) {
            indegree[s]! -= 1;
            if (indegree[s] === 0) ready.push(s);
        }
    }
    if (order.length < nodes.length) return { ok: false, error: 'CYCLE', cycle: findCycle(nodes, indegree, leafIds) };

    // ── 5. Forward pass ────────────────────────────────────────────────
    for (const i of order) {
        const n = nodes[i]!;
        const c = n.cal;
        const item = n.item;
        // The blockers that constrain it: every predecessor with a release day.
        const preds = n.preds;
        if (item.status === 'done') {
            if (n.unscheduled) {
                n.es = n.ef = nextWorkingDay(c, asOf);
                n.release = null;
            } else {
                const f = item.actualFinish ?? item.plannedFinish ?? item.actualStart ?? n.notBefore!;
                const s = Math.min(item.actualStart ?? n.notBefore ?? f, f);
                n.es = s;
                n.ef = f;
                n.release = f + 1;
            }
        } else if (item.status === 'started') {
            const s = item.actualStart ?? n.notBefore ?? n.conflictStart ?? asOf;
            n.es = s;
            n.ef = Math.max(addWorkingDays(c, s, n.duration - 1), nextWorkingDay(c, asOf));
            n.release = n.ef + 1;
            for (const p of preds) {
                const b = nodes[p]!;
                if (b.release !== null && !isClosed(b) && s < b.release) n.conflicts.add('STARTS_BEFORE_BLOCKER_FINISHES');
            }
        } else {
            let base = asOf;
            if (n.notBefore !== null && n.notBefore > base) base = n.notBefore;
            for (const p of preds) {
                const r = nodes[p]!.release;
                if (r !== null && r > base) base = r;
            }
            n.es = nextWorkingDay(c, base);
            if (n.duration > 0) {
                n.ef = addWorkingDays(c, n.es, n.duration - 1);
                n.release = n.ef + 1;
            } else {
                n.ef = n.es;
                n.release = isFloating(n) ? null : n.es;
            }
            if (n.conflictStart !== null) {
                for (const p of preds) {
                    const b = nodes[p]!;
                    if (b.release !== null && !isClosed(b) && n.conflictStart < b.release) n.conflicts.add('STARTS_BEFORE_BLOCKER_FINISHES');
                }
            }
        }
    }

    // The finish in view: the latest earliest finish of the open and started
    // work, else of the done work, else today.
    const endOf = (n: Node) => (n.duration > 0 ? n.ef : n.es);
    let finish: EpochDay | null = null;
    for (const n of nodes) if (!isClosed(n) && !isFloating(n) && (finish === null || endOf(n) > finish)) finish = endOf(n);
    if (finish === null) for (const n of nodes) if (isClosed(n) && !n.unscheduled && (finish === null || n.ef > finish)) finish = n.ef;
    if (finish === null) finish = asOf;

    // ── 6. Backward pass ───────────────────────────────────────────────
    for (let k = order.length - 1; k >= 0; k -= 1) {
        const n = nodes[order[k]!]!;
        const c = n.cal;
        if (isClosed(n) || isFloating(n)) {
            n.ls = n.es;
            n.lf = n.ef;
            continue;
        }
        let bound = finish;
        if (n.item.milestoneDue !== null && n.item.milestoneDue < bound) bound = n.item.milestoneDue;
        if (n.item.projectDue !== null && n.item.projectDue < bound) bound = n.item.projectDue;
        for (const si of n.succs) {
            const s = nodes[si]!;
            // A successor already started or done no longer waits: it bounds nothing.
            if (s.item.status !== 'open') continue;
            const limit = n.duration > 0 ? s.ls - 1 : s.ls;
            if (limit < bound) bound = limit;
        }
        n.lf = previousWorkingDay(c, bound);
        n.ls = n.duration > 0 ? subtractWorkingDays(c, n.lf, n.duration - 1) : n.lf;
    }

    // ── 7. Float, deadlines, criticality ───────────────────────────────
    let minFloat: number | null = null;
    for (const n of nodes) {
        const c = n.cal;
        if (isClosed(n) || isFloating(n)) continue;
        n.totalFloat = n.duration > 0 ? workingDayDiff(c, n.ef, n.lf) : workingDayDiff(c, n.es, n.ls);
        const from = n.duration > 0 ? n.ef + 1 : n.es;
        let free: number | null = null;
        for (const si of n.succs) {
            const s = nodes[si]!;
            if (s.item.status !== 'open') continue;
            const room = workingDaysInclusive(c, from, s.es - 1);
            if (free === null || room < free) free = room;
        }
        if (free === null) free = workingDaysInclusive(c, from, finish);
        n.freeFloat = Math.max(0, Math.min(free, n.totalFloat));
        const end = endOf(n);
        if (n.item.milestoneDue !== null && end > n.item.milestoneDue) n.conflicts.add('MISSES_MILESTONE_DUE_DATE');
        if (n.item.projectDue !== null && end > n.item.projectDue) n.conflicts.add('MISSES_PROJECT_DUE_DATE');
        if (minFloat === null || n.totalFloat < minFloat) minFloat = n.totalFloat;
    }
    const critical = new Set<number>();
    if (minFloat !== null && minFloat <= 0) {
        nodes.forEach((n, i) => {
            if (!isClosed(n) && !isFloating(n) && n.totalFloat === minFloat) critical.add(i);
        });
    }
    const criticalEdgeKeys = new Map<string, ScheduleEdge>();
    for (const { a, b, origins } of leafEdgeList) {
        if (!critical.has(a) || !critical.has(b)) continue;
        const na = nodes[a]!;
        const nb = nodes[b]!;
        if (nb.es !== nextWorkingDay(nb.cal, na.release!)) continue;
        for (const e of origins) criticalEdgeKeys.set(`${e.from}\u0000${e.to}`, { from: e.from, to: e.to });
    }

    const unscheduledInChain = nodes.filter((n) => n.unscheduled && !n.isolated && !isClosed(n)).map((n) => n.item.id);
    if (unscheduledInChain.length > 0) warnings.push({ code: 'UNSCHEDULED_IN_CHAIN', ids: unscheduledInChain });

    // ── Output ─────────────────────────────────────────────────────────
    const out = new Map<string, ItemSchedule>();
    nodes.forEach((n, i) => {
        out.set(n.item.id, {
            id: n.item.id,
            durationDays: n.duration,
            unscheduled: n.unscheduled,
            summary: false,
            earliestStart: n.es,
            earliestFinish: n.ef,
            latestStart: n.ls,
            latestFinish: n.lf,
            totalFloat: n.totalFloat,
            freeFloat: n.freeFloat,
            lateDays: isClosed(n) ? 0 : Math.max(0, -n.totalFloat),
            critical: critical.has(i),
            conflicts: [...n.conflicts].sort(byString),
        });
    });
    const outside: string[] = [];
    for (const id of [...children.keys()].sort(byString)) {
        const item = byId.get(id)!;
        const cal = calendars.get(item.calendarId)!;
        const leaves = leavesOf(id).map((l) => nodes[index.get(l)!]!).filter((n) => !isFloating(n));
        const conflicts = new Set<ScheduleConflict>();
        const reversed = item.plannedStart !== null && item.plannedFinish !== null && item.plannedStart > item.plannedFinish;
        if (reversed) conflicts.add('DATES_REVERSED');
        if (leaves.length === 0) {
            const day = nextWorkingDay(cal, asOf);
            out.set(id, {
                id,
                durationDays: 0,
                unscheduled: true,
                summary: true,
                earliestStart: day,
                earliestFinish: day,
                latestStart: day,
                latestFinish: day,
                totalFloat: 0,
                freeFloat: 0,
                lateDays: 0,
                critical: false,
                conflicts: [...conflicts].sort(byString),
            });
            continue;
        }
        // The span of its leaves: the one summary rule (`spanOf`, shared with the roadmap's bars, 3.2c).
        const { start: es, end: ef } = spanOf(leaves.map((n) => ({ start: n.es, end: endOf(n) })))!;
        const live = leaves.filter((n) => !isClosed(n));
        const totalFloat = live.length > 0 ? Math.min(...live.map((n) => n.totalFloat)) : 0;
        if (item.milestoneDue !== null && ef > item.milestoneDue && live.length > 0) conflicts.add('MISSES_MILESTONE_DUE_DATE');
        if (item.projectDue !== null && ef > item.projectDue && live.length > 0) conflicts.add('MISSES_PROJECT_DUE_DATE');
        if ((item.plannedStart !== null && !reversed && es < item.plannedStart) || (item.plannedFinish !== null && ef > item.plannedFinish)) outside.push(id);
        out.set(id, {
            id,
            durationDays: Math.max(1, workingDaysInclusive(cal, es, ef)),
            unscheduled: false,
            summary: true,
            earliestStart: es,
            earliestFinish: ef,
            latestStart: Math.min(...leaves.map((n) => n.ls)),
            latestFinish: Math.max(...leaves.map((n) => n.lf)),
            totalFloat,
            freeFloat: 0,
            lateDays: Math.max(0, ...live.map((n) => Math.max(0, -n.totalFloat))),
            critical: false,
            conflicts: [...conflicts].sort(byString),
        });
    }
    if (outside.length > 0) warnings.push({ code: 'SUMMARY_OUTSIDE_PLANNED_DATES', ids: outside });

    return {
        ok: true,
        asOf,
        finish,
        items: [...out.values()].sort((a, b) => byString(a.id, b.id)),
        criticalEdges: [...criticalEdgeKeys.values()].sort((a, b) => byString(a.from, b.from) || byString(a.to, b.to)),
        warnings: warnings.sort((a, b) => byString(a.code, b.code)),
    };
}

/**
 * One cycle among the nodes Kahn's sort could not order: every one of them
 * has a blocker among them, so walking blockers from the smallest id must
 * come back round. Returned in blocks order (each blocks the next, the last
 * blocks the first), starting from its smallest id.
 */
function findCycle(nodes: readonly Node[], indegree: readonly number[], ids: readonly string[]): string[] {
    const remaining = (i: number) => indegree[i]! > 0;
    let start = -1;
    for (let i = 0; i < nodes.length; i += 1) {
        if (remaining(i)) {
            start = i;
            break;
        }
    }
    const seenAt = new Map<number, number>();
    const path: number[] = [];
    let cur = start;
    while (!seenAt.has(cur)) {
        seenAt.set(cur, path.length);
        path.push(cur);
        cur = nodes[cur]!.preds.filter(remaining).reduce((m, p) => Math.min(m, p), Number.POSITIVE_INFINITY);
    }
    // `path` walks blockers backwards; the loop is from `cur` on, reversed into blocks order.
    const loop = path.slice(seenAt.get(cur)!).reverse();
    const smallest = loop.indexOf(Math.min(...loop));
    return [...loop.slice(smallest), ...loop.slice(0, smallest)].map((i) => ids[i]!);
}
