/**
 * The forecasting module at its worst case (sub-phase 3.6c;
 * docs/porting/maps/3.6.md, "Performance of the module"): 10,000 trials over
 * 2,000 remaining items at about one completion a day, every trial running
 * to the 520-day cap (5.2 million draws). The budget is p95 150 ms in Node,
 * and the typical case (500 remaining, six a day) 20 ms; a test runner shares
 * its machine, so this test fails only at four times each budget, as the
 * engine's and the workload modules' performance tests do, and logs the
 * measure. The timing runs in its own Node process (`forecast-timing.ts`):
 * Jest's sandbox does not inline `Math.imul`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'tests', 'helpers', 'forecast-timing.ts');

interface Timing {
    p50: number;
    p95: number;
    refused: string | null;
    trials: number;
}

describe('the forecast at its worst and typical cases, in Node', () => {
    const out = () => JSON.parse(execFileSync(TSX, [SCRIPT], { cwd: ROOT, encoding: 'utf8', timeout: 120_000 })) as { cap: number; worst: Timing; typical: Timing };

    it('runs 10,000 trials to the cap within four times its 150 ms budget, and the typical case within four times 20 ms, at p95', () => {
        const { cap, worst, typical } = out();
        // Every trial of the worst case reached the cap: the work measured is the whole 5.2 million draws.
        expect(worst.refused).toBe('BEYOND_TWO_YEARS');
        expect(cap * worst.trials).toBe(5_200_000);
        expect(typical.refused).toBeNull();
        console.log(`forecast: worst p50 ${worst.p50.toFixed(1)} ms, p95 ${worst.p95.toFixed(1)} ms; typical p50 ${typical.p50.toFixed(1)} ms, p95 ${typical.p95.toFixed(1)} ms`);
        expect(worst.p95).toBeLessThan(150 * 4);
        expect(typical.p95).toBeLessThan(20 * 4);
    }, 120_000);
});
