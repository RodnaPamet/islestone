/**
 * The forecast's calibration on the seeded database (sub-phase 3.6c;
 * Hardening H3; owner decision 325; docs/porting/maps/3.6.md, "Calibration"):
 * H3's back-test over every project of the 10k seed's workspace (the next
 * 10, 25 and 50 completions from every weekly origin, the history as it
 * stood then) holds the 85 % date between 80 and 90 % of the time over at
 * least 200 scorable origins. The band is the one `docs/analytics.md`
 * records; it is never widened to pass. The seed's record is synthetic and
 * non-stationary on purpose (`scripts/seed-scale/history.ts`), so the
 * back-test is not calibrated by construction.
 */
import { backtestWorkspaceForecasts } from '@/app-layer/usecases/forecast-calibration';

import { directClient, loadPerfWorld } from './perf-world';

describe(`the forecast's calibration (PERF_SHAPE=${process.env.PERF_SHAPE || '10k'})`, () => {
    it('holds the 85 % date between 80 and 90 % of the time over at least 200 scorable origins', async () => {
        const direct = directClient();
        try {
            const world = await loadPerfWorld(direct);
            const r = await backtestWorkspaceForecasts(world.ctx);
            const scorable = r.bySize.reduce((n, s) => n + s.scores.p85.scorable, 0);
            const held = r.bySize.reduce((n, s) => n + s.scores.p85.held, 0);
            for (const s of r.bySize) console.log(`next ${s.size}: 50 % ${s.scores.p50.held}/${s.scores.p50.scorable}, 85 % ${s.scores.p85.held}/${s.scores.p85.scorable}, 95 % ${s.scores.p95.held}/${s.scores.p95.scorable}`);
            expect(r.projects).toBeGreaterThan(0);
            expect(scorable).toBeGreaterThanOrEqual(200);
            expect(held / scorable).toBeGreaterThanOrEqual(0.8);
            expect(held / scorable).toBeLessThanOrEqual(0.9);
            // The percentiles are ordered: a later date holds at least as often.
            for (const s of r.bySize) {
                expect(s.scores.p50.held / s.scores.p50.scorable).toBeLessThanOrEqual(s.scores.p85.held / s.scores.p85.scorable);
                expect(s.scores.p85.held / s.scores.p85.scorable).toBeLessThanOrEqual(s.scores.p95.held / s.scores.p95.scorable);
            }
        } finally {
            await direct.$disconnect();
        }
    }, 300_000);
});
