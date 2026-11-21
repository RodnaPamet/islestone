/**
 * The engine at the timeline's size (roadmap H3: "a 5,000-item project";
 * docs/porting/maps/3.1.md, "Performance"): 5,000 items and 10,000 blocks
 * relations in chains up to 40 long, sub-items three levels deep, dates on
 * 85% of items, two team calendars with holidays and the workspace's. The
 * budget is p95 50 ms in Node on the reference machine (H2's); a test runner
 * shares its machine, so this test fails only at four times the budget and
 * logs the measure. H2's nightly `perf` project holds the budget itself.
 */
import { computeSchedule } from '@/app-layer/domain/schedule/engine';
import type { ScheduleEdge, ScheduleInput, ScheduleItem } from '@/app-layer/domain/schedule/types';

const BUDGET_P95_MS = 50;

/** A deterministic pseudo-random sequence (mulberry32). */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function largeInput(n = 5000, edgeCount = 10_000): ScheduleInput {
    const rand = rng(31);
    const asOf = 20_454;
    const items: ScheduleItem[] = [];
    for (let i = 0; i < n; i += 1) {
        const dated = rand() < 0.85;
        const start = asOf + Math.floor(rand() * 200) - 20;
        // Sub-items: three levels under every 25th item.
        const parentId = i % 25 >= 1 && i % 25 <= 6 ? `i${String(i - (i % 25)).padStart(5, '0')}` : i % 25 >= 7 && i % 25 <= 9 ? `i${String(i - (i % 25) + 1).padStart(5, '0')}` : null;
        items.push({
            id: `i${String(i).padStart(5, '0')}`,
            calendarId: ['ws', 'team-a', 'team-b'][i % 3]!,
            parentId,
            plannedStart: dated ? start : null,
            plannedFinish: dated ? start + Math.floor(rand() * 15) : null,
            status: rand() < 0.1 ? 'done' : rand() < 0.15 ? 'started' : 'open',
            actualStart: asOf - 10,
            actualFinish: asOf - 2,
            milestoneDue: rand() < 0.3 ? asOf + 120 : null,
            projectDue: asOf + 180,
        });
    }
    // Chains of up to 40 among leaves, then random forward edges to reach the count.
    const leaves = items.filter((it) => !items.some((o) => o.parentId === it.id)).map((it) => it.id);
    const edges: ScheduleEdge[] = [];
    const seen = new Set<string>();
    const add = (a: number, b: number) => {
        const key = `${a}>${b}`;
        if (a >= b || seen.has(key)) return;
        seen.add(key);
        edges.push({ from: leaves[a]!, to: leaves[b]! });
    };
    for (let s = 0; s + 40 <= leaves.length; s += 40) for (let k = 0; k < 39; k += 1) add(s + k, s + k + 1);
    while (edges.length < edgeCount) {
        const a = Math.floor(rand() * leaves.length);
        add(a, Math.min(leaves.length - 1, a + 1 + Math.floor(rand() * 60)));
    }
    return {
        asOf,
        calendars: [
            { id: 'ws', workingWeekdays: [1, 2, 3, 4, 5], holidays: Array.from({ length: 30 }, (_, k) => asOf + k * 11) },
            { id: 'team-a', workingWeekdays: [1, 2, 3, 4, 5], holidays: Array.from({ length: 15 }, (_, k) => asOf + k * 17) },
            { id: 'team-b', workingWeekdays: [7, 1, 2, 3, 4], holidays: [] },
        ],
        items,
        edges,
    };
}

describe('computeSchedule at 5,000 items and 10,000 relations', () => {
    it(`stays within four times its ${BUDGET_P95_MS} ms budget at p95`, () => {
        const input = largeInput();
        expect(input.items.length).toBe(5000);
        expect(input.edges.length).toBe(10_000);
        const first = computeSchedule(input);
        expect(first.ok).toBe(true);
        // Warm the JIT before measuring: a page load and a preview run the
        // engine on optimised code, not its first interpreted pass.
        for (let k = 0; k < 10; k += 1) computeSchedule(input);
        const times: number[] = [];
        for (let k = 0; k < 30; k += 1) {
            const t0 = performance.now();
            computeSchedule(input);
            times.push(performance.now() - t0);
        }
        times.sort((a, b) => a - b);
        const p50 = times[Math.floor(times.length * 0.5)]!;
        const p95 = times[Math.floor(times.length * 0.95)]!;
        console.info(`computeSchedule 5,000 items / 10,000 relations: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
        expect(p95).toBeLessThan(BUDGET_P95_MS * 4);
    }, 60_000);
});
