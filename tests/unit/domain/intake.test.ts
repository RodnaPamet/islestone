/**
 * The triage rules and the accept's field plan (sub-phase 2.6a;
 * `src/app-layer/domain/intake.ts`).
 */
import fc from 'fast-check';

import {
    acceptedDescription,
    checkTriage,
    planAcceptedFields,
    snoozeDateIsFuture,
    TRIAGE_FROM,
    type AcceptFieldTarget,
    type StoredAnswer,
    type TriageAction,
} from '@/app-layer/domain/intake';
import type { IntakeRequestStatus } from '@/lib/intake/types';

const STATUSES: IntakeRequestStatus[] = ['PENDING', 'SNOOZED', 'ACCEPTED', 'DECLINED', 'MERGED'];
const ACTIONS = Object.keys(TRIAGE_FROM) as TriageAction[];

describe('checkTriage', () => {
    it('decides exactly from the table, and an accepted request never reopens', () => {
        for (const action of ACTIONS) {
            for (const status of STATUSES) {
                expect({ action, status, ok: checkTriage(action, status) === null }).toEqual({ action, status, ok: TRIAGE_FROM[action].includes(status) });
            }
        }
        expect(checkTriage('reopen', 'ACCEPTED')).toMatchObject({ reason: 'NOT_REOPENABLE' });
        expect(checkTriage('reopen', 'PENDING')).toMatchObject({ reason: 'NOT_OPEN' });
        expect(checkTriage('accept', 'DECLINED')).toMatchObject({ reason: 'ALREADY_DECIDED' });
    });

    it('no decision starts from a decided status', () => {
        for (const action of ['accept', 'decline', 'merge', 'snooze', 'move', 'edit'] as const) {
            for (const status of ['ACCEPTED', 'DECLINED', 'MERGED'] as const) expect(checkTriage(action, status)).not.toBeNull();
        }
    });

    it('a snooze date must be after today', () => {
        expect(snoozeDateIsFuture('2030-01-02', '2030-01-01')).toBe(true);
        expect(snoozeDateIsFuture('2030-01-01', '2030-01-01')).toBe(false);
        expect(snoozeDateIsFuture('2029-12-31', '2030-01-01')).toBe(false);
    });
});

describe('planAcceptedFields', () => {
    const targets = new Map<string, AcceptFieldTarget>([
        ['cText', { id: 'cText', type: 'TEXT', options: [] }],
        ['cSel', { id: 'cSel', type: 'SELECT', options: [{ id: 'o1', name: 'Red', archivedAt: null }, { id: 'o2', name: 'Old', archivedAt: new Date() }] }],
        ['cMulti', { id: 'cMulti', type: 'MULTI_SELECT', options: [{ id: 'm1', name: 'A', archivedAt: null }, { id: 'm2', name: 'B', archivedAt: null }] }],
        ['cNum', { id: 'cNum', type: 'NUMBER', options: [] }],
        ['cBox', { id: 'cBox', type: 'CHECKBOX', options: [] }],
    ]);
    const a = (fieldId: string, kind: string, value: StoredAnswer['value'], customFieldId: string | null = null): StoredAnswer => ({
        fieldId,
        label: `L${fieldId}`,
        kind,
        customFieldId,
        value,
    });

    it('fills live matching fields, resolves select options by name, and appends everything else', () => {
        const plan = planAcceptedFields(
            [
                a('f1', 'SHORT_TEXT', 'hello', 'cText'),
                a('f2', 'SELECT', 'red', 'cSel'),
                a('f3', 'MULTI_SELECT', ['A', 'B'], 'cMulti'),
                a('f4', 'NUMBER', 3, 'cNum'),
                a('f5', 'CHECKBOX', true, 'cBox'),
                a('f6', 'SELECT', 'Old', 'cSel'),
                a('f7', 'DATE', '2030-01-01', 'gone'),
                a('f8', 'LONG_TEXT', 'notes'),
                a('f9', 'NUMBER', 5, 'cText'),
            ],
            targets,
        );
        expect(plan.customFields).toEqual({ cText: 'hello', cSel: 'o1', cMulti: ['m1', 'm2'], cNum: 3, cBox: true });
        expect(plan.lines).toEqual(['Lf6: Old', 'Lf7: 2030-01-01', 'Lf8: notes', 'Lf9: 5']);
    });

    it('property: every answer lands exactly once, as a field value or a line', () => {
        const kinds = ['SHORT_TEXT', 'LONG_TEXT', 'SELECT', 'NUMBER', 'CHECKBOX', 'DATE'];
        fc.assert(
            fc.property(
                fc.array(fc.tuple(fc.constantFrom(...kinds), fc.constantFrom('cText', 'cSel', 'cNum', 'cBox', null, 'gone')), { maxLength: 10 }),
                (spec) => {
                    const answers = spec.map(([kind, cf], i) =>
                        a(`f${i}`, kind, kind === 'NUMBER' ? 1 : kind === 'CHECKBOX' ? true : kind === 'SELECT' ? 'Red' : 'x', cf),
                    );
                    const plan = planAcceptedFields(answers, targets);
                    expect(Object.keys(plan.customFields).length + plan.lines.length).toBe(answers.length);
                },
            ),
        );
    });

    it('the description is the text, then the lines', () => {
        expect(acceptedDescription('Body', ['A: 1', 'B: 2'])).toBe('Body\n\nA: 1\nB: 2');
        expect(acceptedDescription(null, ['A: 1'])).toBe('A: 1');
        expect(acceptedDescription('  ', [])).toBeNull();
    });
});
