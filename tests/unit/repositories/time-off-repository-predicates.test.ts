/**
 * Time off's type is held apart (sub-phase 3.5a; decision 287): only
 * `TimeOffRepository.listDays` selects it, and only when its caller says the
 * reader may see it. Every other read's select names no `type`, so the
 * workload read never decrypts one. The method bodies are read from source so
 * a new read that selects the type fails here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { timeOffDaySelect, timeOffHoursSelect } from '@/app-layer/repositories/TimeOffRepository';
import { padTimeOffType, TIME_OFF_TYPE_WIDTH, TIME_OFF_TYPES, unpadTimeOffType } from '@/lib/workload/time-off';

import { codeOf } from '../../helpers/source-blocks';

const SRC = codeOf(fs.readFileSync(path.resolve(__dirname, '../../../src/app-layer/repositories/TimeOffRepository.ts'), 'utf8'));

describe('the time-off repository holds the type apart', () => {
    it('never selects the type in its shared select lists', () => {
        expect(Object.keys(timeOffDaySelect)).not.toContain('type');
        expect(Object.keys(timeOffHoursSelect)).toEqual(['userId', 'day', 'minutes']);
    });

    it('selects the type in exactly one place, behind withType', () => {
        const selects = SRC.match(/type:\s*true/g) ?? [];
        expect(selects).toHaveLength(1);
        const at = SRC.indexOf('type: true');
        expect(SRC.lastIndexOf('if (!withType)', at)).toBeGreaterThan(SRC.lastIndexOf('static async listDays', at));
    });

    it('pads every write and trims every read', () => {
        expect((SRC.match(/\bpadTimeOffType\(/g) ?? []).length).toBe(2);
        expect(SRC).toContain('unpadTimeOffType(r.type)');
    });
});

describe('the padding', () => {
    it('gives every code one width, VACATION exactly it, and reads each back', () => {
        for (const t of TIME_OFF_TYPES) {
            expect(padTimeOffType(t)).toHaveLength(TIME_OFF_TYPE_WIDTH);
            expect(unpadTimeOffType(padTimeOffType(t))).toBe(t);
        }
        expect('VACATION').toHaveLength(TIME_OFF_TYPE_WIDTH);
        expect(unpadTimeOffType('nonsense')).toBe('OTHER');
    });
});
