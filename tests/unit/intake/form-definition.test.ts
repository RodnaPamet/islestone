/**
 * An intake form's definition and the request schema compiled from it
 * (sub-phase 2.6a; `src/lib/intake/form-definition.ts`). The same compiled
 * schema validates the browser's form and the route's body, so these cases
 * are what both sides accept.
 */
import fc from 'fast-check';

import {
    compactAnswers,
    compileIntakeRequestSchema,
    INTAKE_FIELD_KINDS,
    INTAKE_LIMITS,
    IntakeFormDefinitionSchema,
    nextFieldId,
    readDefinition,
    type IntakeFormDefinition,
    type IntakeFormField,
} from '@/lib/intake/form-definition';

const field = (over: Partial<IntakeFormField> & Pick<IntakeFormField, 'id' | 'kind'>): IntakeFormField => ({
    label: `Label ${over.id}`,
    required: false,
    ...(over.kind === 'SELECT' || over.kind === 'MULTI_SELECT' ? { options: ['Red', 'Blue'] } : {}),
    ...over,
});

const def = (fields: IntakeFormField[]): IntakeFormDefinition => ({ intro: '', confirmation: '', fields, requester: { name: 'OFF', email: 'OFF' } });

describe('the form definition', () => {
    it('accepts every kind, and refuses a select without options or options on a non-select', () => {
        const fields = INTAKE_FIELD_KINDS.map((kind, i) => field({ id: `f${i + 1}`, kind }));
        expect(IntakeFormDefinitionSchema.safeParse(def(fields)).success).toBe(true);
        expect(IntakeFormDefinitionSchema.safeParse(def([{ ...field({ id: 'f1', kind: 'SELECT' }), options: [] }])).success).toBe(false);
        expect(IntakeFormDefinitionSchema.safeParse(def([{ ...field({ id: 'f1', kind: 'DATE' }), options: ['x'] }])).success).toBe(false);
        expect(IntakeFormDefinitionSchema.safeParse(def([{ ...field({ id: 'f1', kind: 'SELECT' }), options: ['A', 'a'] }])).success).toBe(false);
    });

    it('refuses duplicate field ids, two fields filling one custom field, a long text filling one, and too many fields', () => {
        expect(IntakeFormDefinitionSchema.safeParse(def([field({ id: 'f1', kind: 'DATE' }), field({ id: 'f1', kind: 'URL' })])).success).toBe(false);
        expect(
            IntakeFormDefinitionSchema.safeParse(def([field({ id: 'f1', kind: 'DATE', customFieldId: 'c1' }), field({ id: 'f2', kind: 'DATE', customFieldId: 'c1' })])).success,
        ).toBe(false);
        expect(IntakeFormDefinitionSchema.safeParse(def([field({ id: 'f1', kind: 'LONG_TEXT', customFieldId: 'c1' })])).success).toBe(false);
        const many = Array.from({ length: INTAKE_LIMITS.fields + 1 }, (_, i) => field({ id: `f${i + 1}`, kind: 'SHORT_TEXT' }));
        expect(IntakeFormDefinitionSchema.safeParse(def(many)).success).toBe(false);
        expect(IntakeFormDefinitionSchema.safeParse({ ...def([]), extra: 1 }).success).toBe(false);
    });

    it('reads an unreadable stored definition as empty, and mints the next id past the highest', () => {
        expect(readDefinition({ fields: 'nope' })).toEqual({ intro: '', confirmation: '', fields: [], requester: { name: 'OFF', email: 'OFF' } });
        // A 2.6a definition (no requester rules) reads with both turned off.
        expect(readDefinition({ intro: '', confirmation: '', fields: [] }).requester).toEqual({ name: 'OFF', email: 'OFF' });
        expect(nextFieldId([])).toBe('f1');
        expect(nextFieldId([{ id: 'f2' }, { id: 'f7' }])).toBe('f8');
    });
});

describe('the compiled request schema', () => {
    const d = def([
        field({ id: 'f1', kind: 'SHORT_TEXT', required: true }),
        field({ id: 'f2', kind: 'SELECT' }),
        field({ id: 'f3', kind: 'MULTI_SELECT' }),
        field({ id: 'f4', kind: 'DATE' }),
        field({ id: 'f5', kind: 'NUMBER' }),
        field({ id: 'f6', kind: 'URL' }),
        field({ id: 'f7', kind: 'CHECKBOX' }),
        field({ id: 'f8', kind: 'LONG_TEXT' }),
    ]);
    const schema = compileIntakeRequestSchema(d);

    it('needs a title and every required answer; empty optional answers read as none', () => {
        expect(schema.safeParse({ title: '', answers: { f1: 'x' } }).success).toBe(false);
        expect(schema.safeParse({ title: 'T', answers: {} }).success).toBe(false);
        const ok = schema.parse({ title: '  T  ', answers: { f1: 'x', f2: '', f3: [], f4: '', f5: '', f6: '', f7: false, f8: '' } });
        expect(ok.title).toBe('T');
        expect(compactAnswers(d, ok.answers)).toEqual({ f1: 'x' });
    });

    it('takes each kind in its shape and refuses the wrong one', () => {
        const parsed = schema.parse({
            title: 'T',
            answers: { f1: 'x', f2: 'Red', f3: ['Blue', 'Red', 'Blue'], f4: '2030-02-28', f5: '42.5', f6: 'https://example.com/a', f7: true, f8: 'long' },
        });
        expect(compactAnswers(d, parsed.answers)).toEqual({ f1: 'x', f2: 'Red', f3: ['Blue', 'Red'], f4: '2030-02-28', f5: 42.5, f6: 'https://example.com/a', f7: true, f8: 'long' });
        for (const [key, bad] of [
            ['f2', 'Green'],
            ['f3', ['Green']],
            ['f4', '2030-02-30'],
            ['f5', 'many'],
            ['f5', 1e10],
            ['f6', 'javascript:alert(1)'],
            ['f6', 'example.com'],
            ['f1', 'x'.repeat(INTAKE_LIMITS.shortText + 1)],
        ] as const) {
            expect({ key, ok: schema.safeParse({ title: 'T', answers: { f1: 'x', [key]: bad } }).success }).toEqual({ key, ok: false });
        }
    });

    it('refuses an answer to a field the form does not have, and any other key', () => {
        expect(schema.safeParse({ title: 'T', answers: { f1: 'x', f99: 'y' } }).success).toBe(false);
        expect(schema.safeParse({ title: 'T', answers: { f1: 'x' }, requesterUserId: 'u' }).success).toBe(false);
    });

    it('property: for any valid definition, filling every field with a valid value parses, and leaving the optional ones empty parses', () => {
        const kindArb = fc.constantFrom(...INTAKE_FIELD_KINDS);
        fc.assert(
            fc.property(fc.array(fc.tuple(kindArb, fc.boolean()), { minLength: 0, maxLength: 12 }), (spec) => {
                const fields = spec.map(([kind, required], i) => field({ id: `f${i + 1}`, kind, required }));
                const definition = IntakeFormDefinitionSchema.parse(def(fields));
                const s = compileIntakeRequestSchema(definition);
                const valid: Record<string, unknown> = {};
                for (const f of fields) {
                    valid[f.id] = {
                        SHORT_TEXT: 'text',
                        LONG_TEXT: 'longer text',
                        SELECT: 'Red',
                        MULTI_SELECT: ['Blue'],
                        DATE: '2031-12-31',
                        NUMBER: 7,
                        URL: 'https://example.com',
                        CHECKBOX: true,
                    }[f.kind];
                }
                expect(s.safeParse({ title: 'T', answers: valid }).success).toBe(true);
                const onlyRequired = Object.fromEntries(fields.filter((f) => f.required).map((f) => [f.id, valid[f.id]]));
                expect(s.safeParse({ title: 'T', answers: onlyRequired }).success).toBe(true);
                if (fields.some((f) => f.required)) expect(s.safeParse({ title: 'T', answers: {} }).success).toBe(false);
            }),
        );
    });
});
