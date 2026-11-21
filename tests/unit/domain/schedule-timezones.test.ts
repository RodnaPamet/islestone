/**
 * The engine under different process time zones (roadmap H3: "calendars
 * correct across time zones and daylight-saving changes"). Each zone runs the
 * engine in its own process with `TZ` set before any module loads; every
 * result must be byte-equal. The engine reads no clock and no zone: this test
 * fails if a `Date` with a local reading ever enters it.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import fc from 'fast-check';

import type { ScheduleInput } from '@/app-layer/domain/schedule/types';

const ROOT = path.resolve(__dirname, '../../..');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(ROOT, 'tests', 'helpers', 'schedule-under-tz.ts');
const ZONES = ['UTC', 'Europe/London', 'America/Sao_Paulo', 'Australia/Lord_Howe', 'Pacific/Apia'];

/** A fixed input across a European spring daylight-saving change (29 March 2026), with holidays and two calendars. */
function input(): ScheduleInput {
    const asOf = 20_530; // 2026-03-18
    const items = fc.sample(
        fc.record({ start: fc.option(fc.integer({ min: asOf - 5, max: asOf + 40 }), { nil: null }), len: fc.integer({ min: 0, max: 12 }), cal: fc.constantFrom('a', 'b') }),
        { numRuns: 60, seed: 3101 },
    ).map((r, i) => ({
        id: `i${String(i).padStart(2, '0')}`,
        calendarId: r.cal,
        parentId: null,
        plannedStart: r.start,
        plannedFinish: r.start === null ? null : r.start + r.len,
        status: 'open' as const,
        actualStart: null,
        actualFinish: null,
        milestoneDue: i % 7 === 0 ? asOf + 20 : null,
        projectDue: i % 11 === 0 ? asOf + 25 : null,
    }));
    const edges = items.slice(1).flatMap((it, i) => (i % 3 === 0 ? [{ from: items[i]!.id, to: it.id }] : []));
    return {
        asOf,
        calendars: [
            { id: 'a', workingWeekdays: [1, 2, 3, 4, 5], holidays: [asOf + 11, asOf + 12] },
            { id: 'b', workingWeekdays: [7, 1, 2, 3, 4], holidays: [asOf + 15] },
        ],
        items,
        edges,
    };
}

describe('computeSchedule under five process time zones', () => {
    it('gives byte-equal results', () => {
        const body = JSON.stringify(input());
        const outputs = ZONES.map((tz) => {
            const out = execFileSync(TSX, [SCRIPT], { input: body, env: { ...process.env, TZ: tz }, cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
            const parsed = JSON.parse(out) as { tz: string; result: unknown };
            expect(parsed.tz).toBe(tz);
            return JSON.stringify(parsed.result);
        });
        expect(JSON.parse(outputs[0]!).ok).toBe(true);
        for (const o of outputs) expect(o).toBe(outputs[0]);
    }, 120_000);
});
