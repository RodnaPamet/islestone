/**
 * The field-set evaluation every caller shares (sub-phase 2.4b-b; ADR 0002
 * §1; owner decisions 108 to 111): resolution with defaults, the answer
 * hidden by default, archived fields ignored, emptiness per field, gaps and
 * hidden values. Property-tested: a gap is exactly a required field left
 * empty, and a write that names nothing hidden is never refused for it.
 */
import fc from 'fast-check';

import {
    CONFIGURABLE_BUILT_IN_FIELDS,
    FIELD_REQUIREMENTS,
    allowedRequirements,
    fieldSetGaps,
    hiddenFieldsSet,
    isClosedCategory,
    isFieldEmpty,
    requirementOf,
    resolveFieldSet,
    type BuiltInField,
    type FieldSetEntry,
    type FieldValues,
} from '@/lib/work-items/field-sets';

const builtIn = (typeId: string, field: BuiltInField, requirement: FieldSetEntry['requirement']): FieldSetEntry => ({
    typeId,
    projectId: null,
    builtInField: field,
    customFieldId: null,
    requirement,
});
const custom = (typeId: string, projectId: string, fieldId: string, requirement: FieldSetEntry['requirement']): FieldSetEntry => ({
    typeId,
    projectId,
    builtInField: null,
    customFieldId: fieldId,
    requirement,
});

describe('resolveFieldSet', () => {
    it('defaults every field to OPTIONAL and the answer to HIDDEN', () => {
        const set = resolveFieldSet([], 'bug');
        for (const f of CONFIGURABLE_BUILT_IN_FIELDS) expect(set.builtIn[f]).toBe(f === 'answer' ? 'HIDDEN' : 'OPTIONAL');
        expect(set.customFields).toEqual({});
        expect(allowedRequirements('answer')).toEqual(['OPTIONAL', 'HIDDEN']);
    });

    it("takes the type's built-in entries, and custom entries of the project's live fields only", () => {
        const entries = [
            builtIn('bug', 'dueDate', 'REQUIRED'),
            builtIn('chore', 'dueDate', 'HIDDEN'),
            custom('bug', 'p1', 'f-live', 'REQUIRED'),
            custom('bug', 'p1', 'f-archived', 'REQUIRED'),
            custom('bug', 'p2', 'f-other', 'HIDDEN'),
        ];
        const set = resolveFieldSet(entries, 'bug', { projectId: 'p1', liveCustomFieldIds: ['f-live'] });
        expect(set.builtIn.dueDate).toBe('REQUIRED');
        expect(set.customFields).toEqual({ 'f-live': 'REQUIRED' });
        expect(requirementOf(set, 'cf:f-other')).toBe('OPTIONAL');
    });
});

describe('emptiness', () => {
    it('reads None as an empty priority, no labels as empty labels, blank text as empty', () => {
        expect(isFieldEmpty('priority', { priority: 'NONE' })).toBe(true);
        expect(isFieldEmpty('priority', { priority: 'LOW' })).toBe(false);
        expect(isFieldEmpty('labels', { labelIds: [] })).toBe(true);
        expect(isFieldEmpty('description', { description: '   ' })).toBe(true);
        expect(isFieldEmpty('cf:x', { customFields: { x: false } })).toBe(true);
        expect(isFieldEmpty('cf:x', { customFields: { x: 0 } })).toBe(false);
        expect(isClosedCategory('DONE')).toBe(true);
        expect(isClosedCategory('STARTED')).toBe(false);
    });
});

describe('gaps and hidden values', () => {
    const set = resolveFieldSet([builtIn('q', 'dueDate', 'REQUIRED'), builtIn('q', 'waitingOn', 'REQUIRED'), builtIn('q', 'priority', 'HIDDEN')], 'q');

    it('names the required fields left empty, or only those a write names', () => {
        expect(fieldSetGaps(set, { dueDate: null, waitingOnUserId: 'u1' })).toEqual(['dueDate']);
        expect(fieldSetGaps(set, { waitingOnUserId: null }, ['waitingOn'])).toEqual(['waitingOn']);
        expect(fieldSetGaps(set, { assigneeId: null }, ['assignee'])).toEqual([]);
    });

    it('names a hidden field only when the write gives it a value (clearing passes)', () => {
        expect(hiddenFieldsSet(set, { priority: 'HIGH' })).toEqual(['priority']);
        expect(hiddenFieldsSet(set, { priority: 'NONE' })).toEqual([]);
        expect(hiddenFieldsSet(set, { dueDate: '2030-01-01' })).toEqual([]);
    });
});

describe('properties', () => {
    const requirement = fc.constantFrom(...FIELD_REQUIREMENTS);
    const field = fc.constantFrom(...CONFIGURABLE_BUILT_IN_FIELDS.filter((f) => f !== 'answer'));
    const entries = fc.uniqueArray(fc.tuple(field, requirement), { selector: ([f]) => f }).map((pairs) => pairs.map(([f, r]) => builtIn('t', f, r)));
    const values = fc.record(
        {
            description: fc.option(fc.constantFrom('', 'text'), { nil: null }),
            assigneeId: fc.option(fc.constant('u1'), { nil: null }),
            waitingOnUserId: fc.option(fc.constant('u2'), { nil: null }),
            priority: fc.constantFrom('NONE', 'HIGH'),
            labelIds: fc.constantFrom([], ['l1']),
            startDate: fc.option(fc.constant('2030-01-01'), { nil: null }),
            dueDate: fc.option(fc.constant('2030-01-02'), { nil: null }),
            cycleId: fc.option(fc.constant('c1'), { nil: null }),
            milestoneId: fc.option(fc.constant('m1'), { nil: null }),
        },
        { requiredKeys: [] },
    );

    it('a gap is exactly a required field left empty', () => {
        fc.assert(
            fc.property(entries, values, (rows, v) => {
                const set = resolveFieldSet(rows, 't');
                const gaps = new Set(fieldSetGaps(set, v as FieldValues));
                for (const f of CONFIGURABLE_BUILT_IN_FIELDS) {
                    expect(gaps.has(f)).toBe(set.builtIn[f] === 'REQUIRED' && isFieldEmpty(f, v as FieldValues));
                }
            }),
        );
    });

    it('hidden values are only ever hidden, named and non-empty fields', () => {
        fc.assert(
            fc.property(entries, values, (rows, v) => {
                const set = resolveFieldSet(rows, 't');
                for (const f of hiddenFieldsSet(set, v as FieldValues)) {
                    expect(requirementOf(set, f)).toBe('HIDDEN');
                    expect(isFieldEmpty(f, v as FieldValues)).toBe(false);
                }
            }),
        );
    });
});
