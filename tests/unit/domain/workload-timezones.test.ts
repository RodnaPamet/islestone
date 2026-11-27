/**
 * The workload modules under different process time zones (sub-phase 3.5b;
 * docs/porting/maps/3.5.md, "H3 and 3.5": results byte-equal under five
 * process time zones, each in its own process). Capacity and allocation read
 * no clock and no zone: this test fails if a `Date` with a local reading ever
 * enters them.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'tests', 'helpers', 'workload-under-tz.ts');
const ZONES = ['UTC', 'Europe/London', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Pacific/Apia'];

describe('the workload modules under five process time zones', () => {
    it('give byte-equal results', () => {
        const outputs = ZONES.map((tz) => {
            const out = execFileSync(TSX, [SCRIPT], { env: { ...process.env, TZ: tz }, cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
            const parsed = JSON.parse(out) as { tz: string; result: unknown };
            expect(parsed.tz).toBe(tz);
            return JSON.stringify(parsed.result);
        });
        expect(outputs[0]!.length).toBeGreaterThan(1000);
        for (const o of outputs) expect(o).toBe(outputs[0]);
    }, 120_000);
});
