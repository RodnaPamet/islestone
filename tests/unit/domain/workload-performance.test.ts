/**
 * The workload modules at the Workload page's largest read (sub-phase 3.5b;
 * docs/porting/maps/3.5.md, "Performance"): 500 people, 20,000 counted items,
 * 12,500 dates of time off and 26 weeks, capacity and allocation together, on
 * three calendars with holidays. The budget is p95 100 ms in Node; a test
 * runner shares its machine, so this test fails only at four times the
 * budget, takes each sample as the smaller of wall-clock and processor time
 * (#95, as the engine's performance test does), and logs the measure.
 *
 * The ways to rebalance (3.5c) are timed on the same input for the farthest
 * cell they are worked out for (52 weeks ahead, an 80-week window), every
 * other person a candidate, with the same budget.
 */
import { capacityByWeek } from '@/app-layer/domain/workload/capacity';
import { planRebalance, REBALANCE_LIMITS, type RebalanceInput } from '@/app-layer/domain/workload/options';
import { buildWorkload } from '@/app-layer/domain/workload/workload';

import { largeWorkload } from '../../helpers/workload-fixture';

const BUDGET_P95_MS = 100;

describe('the workload modules at 500 people, 20,000 items, 12,500 dates of time off and 26 weeks', () => {
    it(`stay within four times their ${BUDGET_P95_MS} ms budget at p95`, () => {
        const input = largeWorkload();
        expect(input.items.length).toBe(20_000);
        expect(input.people.reduce((n, p) => n + p.person.timeOff.length, 0)).toBeGreaterThan(12_000);
        const first = buildWorkload(input);
        expect(first.rows.size).toBe(500);
        for (let k = 0; k < 5; k += 1) buildWorkload(input);
        const times: number[] = [];
        for (let k = 0; k < 20; k += 1) {
            const cpu0 = process.cpuUsage();
            const t0 = performance.now();
            buildWorkload(input);
            const wall = performance.now() - t0;
            const cpu = process.cpuUsage(cpu0);
            times.push(Math.min(wall, (cpu.user + cpu.system) / 1000));
        }
        times.sort((a, b) => a - b);
        const p50 = times[Math.floor(times.length * 0.5)]!;
        const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
        console.info(`buildWorkload 500 people / 20,000 items / 26 weeks: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
        expect(p95).toBeLessThan(BUDGET_P95_MS * 4);
    }, 60_000);
});

function sample(run: () => void): { p50: number; p95: number } {
    for (let k = 0; k < 5; k += 1) run();
    const times: number[] = [];
    for (let k = 0; k < 20; k += 1) {
        const cpu0 = process.cpuUsage();
        const t0 = performance.now();
        run();
        const wall = performance.now() - t0;
        const cpu = process.cpuUsage(cpu0);
        times.push(Math.min(wall, (cpu.user + cpu.system) / 1000));
    }
    times.sort((a, b) => a - b);
    return { p50: times[Math.floor(times.length * 0.5)]!, p95: times[Math.ceil(times.length * 0.95) - 1]! };
}

describe('the ways to rebalance at 500 people, 20,000 items and their widest window', () => {
    it(`stay within four times the ${BUDGET_P95_MS} ms budget at p95`, () => {
        const large = largeWorkload();
        const cellAhead = REBALANCE_LIMITS.cellWeeksAhead;
        const weekCount = cellAhead + 1 + REBALANCE_LIMITS.weeksAfterCell;
        const weeks = Array.from({ length: weekCount }, (_, i) => large.firstMonday + 7 * i);
        const byPerson = new Map<string, typeof large.items[number][]>();
        for (const item of large.items) if (item.assigneeId) byPerson.set(item.assigneeId, [...(byPerson.get(item.assigneeId) ?? []), item]);
        const people = large.people.map((p) => ({
            userId: p.userId,
            name: p.userId,
            capacity: capacityByWeek(p.person, weeks, large.capacity).map((w) => Math.floor(w.capacityMinutes / 4)),
            items: byPerson.get(p.userId) ?? [],
        }));
        const input: RebalanceInput = {
            firstMonday: large.firstMonday,
            weekCount,
            cellWeek: large.firstMonday,
            person: people[1]!,
            wholeDaysOff: [],
            others: people.slice(2),
            calendarOfTeam: large.calendarOfTeam,
            offer: { assign: true, moveDates: true },
        };
        expect(planRebalance(input)?.items.length).toBe(REBALANCE_LIMITS.largest);
        const { p50, p95 } = sample(() => planRebalance(input));
        console.info(`planRebalance 499 others / 20,000 items / ${weekCount} weeks: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
        expect(p95).toBeLessThan(BUDGET_P95_MS * 4);
    }, 60_000);
});
