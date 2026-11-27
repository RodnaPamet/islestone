/**
 * The forecasting module under different process time zones (sub-phase
 * 3.6c; docs/porting/maps/3.6.md, "H3 and 3.6": `forecastCompletion`
 * byte-equal for equal inputs across five process time zones, each in its
 * own process). The module reads no clock and no zone: this test fails if a
 * `Date` with a local reading ever enters the forecast, its seed or the
 * back-test.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'tests', 'helpers', 'forecast-under-tz.ts');
const ZONES = ['UTC', 'Europe/Sofia', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Pacific/Kiritimati'];

describe('the forecasting module under five process time zones', () => {
    it('gives byte-equal answers', () => {
        const outputs = ZONES.map((tz) => {
            const out = execFileSync(TSX, [SCRIPT], { env: { ...process.env, TZ: tz }, cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
            const parsed = JSON.parse(out) as { tz: string; result: { outcome: { refused: unknown } } };
            expect(parsed.tz).toBe(tz);
            expect(parsed.result.outcome.refused).toBeNull();
            return JSON.stringify(parsed.result);
        });
        expect(outputs[0]!.length).toBeGreaterThan(1000);
        for (const o of outputs) expect(o).toBe(outputs[0]);
    }, 120_000);
});
