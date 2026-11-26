/**
 * Property fuzzing of an intake form's compiled schema (Hardening H2f;
 * docs/porting/maps/H2.md part 6; `src/lib/intake/form-definition.ts`), the
 * one schema the form page and the submit both validate with.
 *
 * For random form definitions and random answers:
 *   - parsing never throws (a refusal is Zod's, never an exception);
 *   - accepted output has only the form's keys (the request's three, the
 *     form's field ids, and the requester's when the rules ask), never
 *     `__proto__`, `constructor` or `prototype`, and leaves no prototype
 *     polluted;
 *   - every accepted string is within its declared limit, every choice among
 *     the form's options, every required field present;
 *   - a definition beyond any of its limits is refused when saved.
 */
import fc from 'fast-check';

import {
    compileIntakeRequestSchema,
    compilePublicIntakeRequestSchema,
    INTAKE_FIELD_KINDS,
    INTAKE_LIMITS,
    INTAKE_REQUESTER_ASKS,
    IntakeFormDefinitionSchema,
    type IntakeFormDefinition,
    type IntakeFormField,
} from '@/lib/intake/form-definition';

import { assertFuzz, fuzzRuns, fuzzTimeout } from '../../../helpers/fuzz';

const HOSTILE_KEYS = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'f999', 'F1', ' f1', 'f01'];

const optionArb = fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.trim()).filter((s) => s.length > 0);
const fieldArb = (id: string): fc.Arbitrary<IntakeFormField> =>
    fc
        .record({
            kind: fc.constantFrom(...INTAKE_FIELD_KINDS),
            label: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim() || 'Label'),
            required: fc.boolean(),
            options: fc.uniqueArray(optionArb, { minLength: 1, maxLength: 6, selector: (o) => o.toLowerCase() }),
        })
        .map(({ kind, label, required, options }) => ({ id, kind, label, required, ...(kind === 'SELECT' || kind === 'MULTI_SELECT' ? { options } : {}) }));

const definitionArb: fc.Arbitrary<IntakeFormDefinition> = fc
    .integer({ min: 0, max: 8 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => fieldArb(`f${i + 1}`))))
    .chain((fields) =>
        fc.record({ name: fc.constantFrom(...INTAKE_REQUESTER_ASKS), email: fc.constantFrom(...INTAKE_REQUESTER_ASKS) }).map((requester) => ({ intro: '', confirmation: '', fields, requester })),
    );

/** Any answer value: well-formed ones, wrong types, over-long text, nested objects. */
const valueArb = (def: IntakeFormDefinition) =>
    fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.string({ minLength: 480, maxLength: 2_100 }),
        fc.constantFrom(...def.fields.flatMap((f) => f.options ?? []), 'not an option'),
        fc.array(fc.constantFrom(...def.fields.flatMap((f) => f.options ?? []), 'x'), { maxLength: 25 }),
        fc.constantFrom('2026-02-30', '2026-02-28', '9999-12-31', '0000-01-01', ' 2026-01-01', 'https://example.com/a', 'javascript:alert(1)', 'http://x', 'ftp://x.example', '1e400', '0x10', '-1e9', '12'),
        fc.double(),
        fc.integer(),
        fc.boolean(),
        fc.constant(null),
        fc.jsonValue({ maxDepth: 2 }),
    );

/** A value a person filling `f` in could send (sometimes past its limit). */
function wellFormedValue(f: IntakeFormField): fc.Arbitrary<unknown> {
    switch (f.kind) {
        case 'SHORT_TEXT':
            return fc.oneof({ weight: 6, arbitrary: fc.string({ minLength: 1, maxLength: 40 }) }, { weight: 1, arbitrary: fc.string({ minLength: 490, maxLength: 510 }) });
        case 'LONG_TEXT':
            return fc.oneof({ weight: 6, arbitrary: fc.string({ minLength: 1, maxLength: 200 }) }, { weight: 1, arbitrary: fc.string({ minLength: 1_990, maxLength: 2_010 }) });
        case 'SELECT':
            return fc.constantFrom(...(f.options ?? ['x']));
        case 'MULTI_SELECT':
            return fc.oneof({ weight: 6, arbitrary: fc.array(fc.constantFrom(...(f.options ?? ['x'])), { minLength: 1, maxLength: 8 }) }, { weight: 1, arbitrary: fc.array(fc.constantFrom(...(f.options ?? ['x'])), { minLength: 18, maxLength: 22 }) });
        case 'DATE':
            return fc.date({ min: new Date('1900-01-01T00:00:00Z'), max: new Date('2200-12-31T00:00:00Z'), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
        case 'NUMBER':
            return fc.oneof({ weight: 4, arbitrary: fc.integer({ min: -999_999_999, max: 999_999_999 }) }, { weight: 2, arbitrary: fc.integer({ min: -999_999, max: 999_999 }).map(String) }, { weight: 1, arbitrary: fc.double({ noNaN: true }) }, { weight: 1, arbitrary: fc.integer({ min: -2e9, max: 2e9 }) });
        case 'URL':
            return fc.oneof({ weight: 6, arbitrary: fc.webUrl() }, { weight: 1, arbitrary: fc.webUrl().map((u) => `${u}/${'a'.repeat(500)}`) });
        case 'CHECKBOX':
            return fc.constantFrom(true, false);
    }
}

/** A JSON body as a client could send it: parsed from text, so `__proto__` is an own key. */
const requestArb = definitionArb.chain((def) => {
    const answerPairs = fc
        .tuple(
            ...def.fields.map((f) =>
                fc.oneof(
                    { weight: 2, arbitrary: fc.constant(null) },
                    { weight: 12, arbitrary: wellFormedValue(f).map((v): [string, unknown] => [f.id, v]) },
                    { weight: 1, arbitrary: valueArb(def).map((v): [string, unknown] => [f.id, v]) },
                ),
            ),
        )
        .chain((chosen) =>
            fc
                .array(fc.tuple(fc.constantFrom(...HOSTILE_KEYS), valueArb(def)), { maxLength: 2 })
                .chain((hostile) => fc.oneof({ weight: 4, arbitrary: fc.constant<Array<[string, unknown]>>([]) }, { weight: 1, arbitrary: fc.constant(hostile as Array<[string, unknown]>) }))
                .map((hostile) => [...chosen.filter((c): c is [string, unknown] => c !== null), ...hostile]),
        );
    const extraArb = fc.oneof(
        { weight: 4, arbitrary: fc.constant<Array<[string, unknown]>>([]) },
        { weight: 1, arbitrary: fc.array(fc.tuple(fc.constantFrom(...HOSTILE_KEYS), fc.jsonValue({ maxDepth: 1 })), { minLength: 1, maxLength: 2 }) },
    );
    const asks = (ask: string, arb: fc.Arbitrary<string>) =>
        ask === 'OFF' ? fc.oneof({ weight: 5, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: arb }) : fc.oneof({ weight: 1, arbitrary: fc.constant(undefined) }, { weight: 4, arbitrary: arb });
    return fc
        .record({
            title: fc.oneof({ weight: 6, arbitrary: fc.string({ minLength: 1, maxLength: 30 }) }, { weight: 1, arbitrary: fc.string({ minLength: 190, maxLength: 210 }) }, { weight: 1, arbitrary: fc.constantFrom('   ', '') }),
            body: fc.option(fc.oneof(fc.string({ maxLength: 30 }), fc.string({ minLength: 9_990, maxLength: 10_010 })), { nil: undefined }),
            answers: answerPairs,
            extra: extraArb,
            requesterName: asks(def.requester.name, fc.oneof({ weight: 6, arbitrary: fc.string({ minLength: 1, maxLength: 20 }) }, { weight: 1, arbitrary: fc.string({ minLength: 95, maxLength: 110 }) })),
            requesterEmail: asks(
                def.requester.email,
                fc.oneof({ weight: 6, arbitrary: fc.stringMatching(/^[a-z0-9]{1,12}@[a-z]{1,12}\.(com|org|bg)$/) }, { weight: 1, arbitrary: fc.emailAddress() }, { weight: 1, arbitrary: fc.string({ maxLength: 20 }) }),
            ),
        })
        .map(({ title, body, answers, extra, requesterName, requesterEmail }) => {
            /** A JSON object's text from key and value pairs, keys repeated or hostile as given. */
            const object = (pairs: Array<[string, string]>) => `{${pairs.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`;
            const json = (v: unknown) => JSON.stringify(v ?? null);
            const pairs: Array<[string, string]> = [['title', json(title)]];
            if (body !== undefined) pairs.push(['body', json(body)]);
            pairs.push(['answers', object(answers.map(([k, v]) => [k, json(v)]))]);
            if (requesterName !== undefined) pairs.push(['requesterName', json(requesterName)]);
            if (requesterEmail !== undefined) pairs.push(['requesterEmail', json(requesterEmail)]);
            for (const [k, v] of extra) pairs.push([k, json(v)]);
            return { def, raw: JSON.parse(object(pairs)) as unknown };
        });
});

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function ownKeysDeep(v: unknown, out: string[] = []): string[] {
    if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
            out.push(k);
            ownKeysDeep((v as Record<string, unknown>)[k], out);
        }
    }
    return out;
}

function checkAnswers(def: IntakeFormDefinition, answers: Record<string, unknown>): void {
    expect(Object.getPrototypeOf(answers)).toBe(Object.prototype);
    const ids = new Set(def.fields.map((f) => f.id));
    for (const key of Object.keys(answers)) expect(ids.has(key)).toBe(true);
    for (const f of def.fields) {
        const v = answers[f.id];
        if (v === undefined) {
            expect(f.required).toBe(false);
            continue;
        }
        switch (f.kind) {
            case 'SHORT_TEXT':
            case 'LONG_TEXT':
                expect(typeof v).toBe('string');
                expect((v as string).length).toBeGreaterThanOrEqual(1);
                expect((v as string).length).toBeLessThanOrEqual(f.kind === 'SHORT_TEXT' ? INTAKE_LIMITS.shortText : INTAKE_LIMITS.longText);
                break;
            case 'SELECT':
                expect(f.options).toContain(v);
                break;
            case 'MULTI_SELECT':
                expect(Array.isArray(v)).toBe(true);
                expect((v as string[]).length).toBeGreaterThanOrEqual(1);
                expect((v as string[]).length).toBeLessThanOrEqual(INTAKE_LIMITS.multiSelectValues);
                expect(new Set(v as string[]).size).toBe((v as string[]).length);
                for (const o of v as string[]) expect(f.options).toContain(o);
                break;
            case 'DATE':
                expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(new Date(`${v as string}T00:00:00Z`).toISOString().slice(0, 10)).toBe(v);
                break;
            case 'NUMBER':
                expect(typeof v).toBe('number');
                expect(Number.isFinite(v)).toBe(true);
                expect(Math.abs(v as number)).toBeLessThan(INTAKE_LIMITS.numberAbs);
                break;
            case 'URL':
                expect((v as string).length).toBeLessThanOrEqual(INTAKE_LIMITS.url);
                expect(['http:', 'https:']).toContain(new URL(v as string).protocol);
                break;
            case 'CHECKBOX':
                expect(v).toBe(true);
                break;
        }
    }
}

describe("an intake form's compiled schema (fuzzed)", () => {
    it(
        "never throws, and accepts only the form's keys with every value within its limits",
        () => {
            let accepted = 0;
            assertFuzz(
                fc.property(requestArb, fc.nat({ max: 3 }), ({ def, raw }, keep) => {
                    // A members' form takes no requester: send those keys one time in four.
                    if (keep !== 0) for (const k of ['requesterName', 'requesterEmail']) delete (raw as Record<string, unknown>)[k];
                    const result = compileIntakeRequestSchema(def).safeParse(raw);
                    if (!result.success) return;
                    accepted++;
                    const out = result.data as Record<string, unknown>;
                    for (const key of Object.keys(out)) expect(['title', 'body', 'answers']).toContain(key);
                    for (const key of ownKeysDeep(out)) expect(FORBIDDEN.has(key)).toBe(false);
                    expect(typeof out.title).toBe('string');
                    expect((out.title as string).length).toBeGreaterThanOrEqual(1);
                    expect((out.title as string).length).toBeLessThanOrEqual(INTAKE_LIMITS.title);
                    expect(out.title).toBe((out.title as string).trim());
                    if (out.body !== undefined) expect((out.body as string).length).toBeLessThanOrEqual(INTAKE_LIMITS.body);
                    checkAnswers(def, out.answers as Record<string, unknown>);
                    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
                }),
            );
            // The property is about accepted output: a share of it must be accepted.
            expect(accepted).toBeGreaterThan(fuzzRuns() / 50);
        },
        fuzzTimeout(5),
    );

    it(
        "a public form's schema adds only the requester's keys its rules ask for, within their limits",
        () => {
            let accepted = 0;
            assertFuzz(
                fc.property(requestArb, ({ def, raw }) => {
                    const result = compilePublicIntakeRequestSchema(def).safeParse(raw);
                    if (!result.success) return;
                    accepted++;
                    const out = result.data as Record<string, unknown>;
                    const allowed = ['title', 'body', 'answers', ...(def.requester.name !== 'OFF' ? ['requesterName'] : []), ...(def.requester.email !== 'OFF' ? ['requesterEmail', 'wantsUpdates'] : [])];
                    for (const key of Object.keys(out)) expect(allowed).toContain(key);
                    for (const key of ownKeysDeep(out)) expect(FORBIDDEN.has(key)).toBe(false);
                    if (def.requester.name === 'REQUIRED') expect(typeof out.requesterName).toBe('string');
                    if (def.requester.email === 'REQUIRED') expect(typeof out.requesterEmail).toBe('string');
                    if (out.requesterName !== undefined) expect((out.requesterName as string).length).toBeLessThanOrEqual(INTAKE_LIMITS.requesterName);
                    if (out.requesterEmail !== undefined) {
                        expect((out.requesterEmail as string).length).toBeLessThanOrEqual(INTAKE_LIMITS.requesterEmail);
                        expect(out.requesterEmail).not.toMatch(/[\s\u0000-\u001f\u007f]/);
                    }
                    checkAnswers(def, out.answers as Record<string, unknown>);
                }),
            );
            expect(accepted).toBeGreaterThan(fuzzRuns() / 50);
        },
        fuzzTimeout(5),
    );

    it(
        'refuses, when saved, a definition beyond any one of its limits',
        () => {
            type Breach = (d: IntakeFormDefinition) => unknown;
            const long = (n: number) => 'x'.repeat(n + 1);
            const breaches: Breach[] = [
                (d) => ({ ...d, intro: long(INTAKE_LIMITS.intro) }),
                (d) => ({ ...d, confirmation: long(INTAKE_LIMITS.confirmation) }),
                (d) => ({ ...d, fields: Array.from({ length: INTAKE_LIMITS.fields + 1 }, (_, i) => ({ id: `f${i + 1}`, kind: 'SHORT_TEXT', label: 'L', required: false })) }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: long(INTAKE_LIMITS.label), required: false }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SHORT_TEXT', label: 'L', help: long(INTAKE_LIMITS.help), required: false }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SELECT', label: 'L', required: false, options: Array.from({ length: INTAKE_LIMITS.options + 1 }, (_, i) => `o${i}`) }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SELECT', label: 'L', required: false, options: [long(INTAKE_LIMITS.optionName)] }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SELECT', label: 'L', required: false, options: [] }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'DATE', label: 'L', required: false, options: ['x'] }] }),
                (d) => ({ ...d, fields: [{ id: 'g1', kind: 'DATE', label: 'L', required: false }] }),
                (d) => ({ ...d, fields: [{ id: '__proto__', kind: 'DATE', label: 'L', required: false }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'SCRIPT', label: 'L', required: false }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'DATE', label: '   ', required: false }] }),
                (d) => ({ ...d, fields: [{ id: 'f1', kind: 'DATE', label: 'L', required: false, onclick: 'x' }] }),
                (d) => ({ ...d, fields: [...d.fields, ...d.fields.slice(0, 1)] }),
                (d) => ({ ...d, requester: { name: 'ALWAYS', email: 'OFF' } }),
                (d) => ({ ...d, extra: true }),
                (d) => JSON.parse(`{"__proto__":{"polluted":1},"fields":${JSON.stringify(d.fields)}}`) as unknown,
            ];
            assertFuzz(
                fc.property(definitionArb, fc.nat(), (def, which) => {
                    expect(IntakeFormDefinitionSchema.safeParse(def).success).toBe(true);
                    const breach = breaches[which % breaches.length]!;
                    const broken = breach(def);
                    // Duplicating the first field breaches only when there is one.
                    if (breaches.indexOf(breach) === 14 && def.fields.length === 0) return;
                    expect(IntakeFormDefinitionSchema.safeParse(broken).success).toBe(false);
                    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
                }),
            );
        },
        fuzzTimeout(2),
    );
});
