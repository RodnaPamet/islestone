/**
 * An intake form's definition and its answers (sub-phase 2.6a;
 * docs/porting/maps/2.6.md, "Prisma models"; ADR 0006 "Intake form", "Form
 * field"). Client-safe: the builder, the form page (react-hook-form, through
 * `zodResolver`) and the server's usecases build their schemas from the same
 * functions here, so the browser and the server cannot disagree about what a
 * form accepts.
 *
 * A form always asks for a title (required) and a description (optional);
 * its own fields come after. Field kinds are a closed list; a field may fill
 * one of the project's custom fields when the request is accepted
 * (`FIELD_KIND_FILLS`).
 *
 * Written fresh for Islestone.
 */
import { z } from 'zod';

export const INTAKE_FIELD_KINDS = ['SHORT_TEXT', 'LONG_TEXT', 'SELECT', 'MULTI_SELECT', 'DATE', 'NUMBER', 'URL', 'CHECKBOX'] as const;
export type IntakeFieldKind = (typeof INTAKE_FIELD_KINDS)[number];

/** The caps of a form and of a request (the server's bounds, stated once). */
export const INTAKE_LIMITS = {
    formName: 100,
    intro: 2000,
    confirmation: 1000,
    fields: 30,
    label: 100,
    help: 300,
    options: 50,
    optionName: 100,
    title: 200,
    body: 10_000,
    shortText: 500,
    longText: 2000,
    multiSelectValues: 20,
    url: 500,
    numberAbs: 1e9,
} as const;

/** Which custom-field type a field kind may fill on accept (`null`: none). */
export const FIELD_KIND_FILLS: Record<IntakeFieldKind, 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'NUMBER' | 'URL' | 'CHECKBOX' | null> = {
    SHORT_TEXT: 'TEXT',
    LONG_TEXT: null,
    SELECT: 'SELECT',
    MULTI_SELECT: 'MULTI_SELECT',
    DATE: 'DATE',
    NUMBER: 'NUMBER',
    URL: 'URL',
    CHECKBOX: 'CHECKBOX',
};

const FIELD_ID = /^f[0-9]{1,3}$/;

export const IntakeFormFieldSchema = z
    .object({
        /** `f1`, `f2`, …: minted by the builder, unique in the form, never reused. */
        id: z.string().regex(FIELD_ID),
        kind: z.enum(INTAKE_FIELD_KINDS),
        label: z.string().trim().min(1).max(INTAKE_LIMITS.label),
        help: z.string().trim().max(INTAKE_LIMITS.help).optional(),
        required: z.boolean(),
        /** A select's choices, in order; refused on any other kind. */
        options: z.array(z.string().trim().min(1).max(INTAKE_LIMITS.optionName)).max(INTAKE_LIMITS.options).optional(),
        /** The project's custom field it fills on accept, or none. */
        customFieldId: z.string().min(1).max(64).nullable().optional(),
    })
    .strict()
    .superRefine((f, ctx) => {
        const isSelect = f.kind === 'SELECT' || f.kind === 'MULTI_SELECT';
        if (isSelect && (!f.options || f.options.length === 0)) {
            ctx.addIssue({ code: 'custom', path: ['options'], message: 'A select field needs at least one option.' });
        }
        if (!isSelect && f.options !== undefined) {
            ctx.addIssue({ code: 'custom', path: ['options'], message: 'Only a select field has options.' });
        }
        if (f.options && new Set(f.options.map((o) => o.toLowerCase())).size !== f.options.length) {
            ctx.addIssue({ code: 'custom', path: ['options'], message: 'Options must differ.' });
        }
        if (f.customFieldId && FIELD_KIND_FILLS[f.kind] === null) {
            ctx.addIssue({ code: 'custom', path: ['customFieldId'], message: 'A long text field cannot fill a custom field.' });
        }
    });

export type IntakeFormField = z.infer<typeof IntakeFormFieldSchema>;

export const IntakeFormDefinitionSchema = z
    .object({
        intro: z.string().max(INTAKE_LIMITS.intro).default(''),
        confirmation: z.string().max(INTAKE_LIMITS.confirmation).default(''),
        fields: z.array(IntakeFormFieldSchema).max(INTAKE_LIMITS.fields),
    })
    .strict()
    .superRefine((d, ctx) => {
        const ids = d.fields.map((f) => f.id);
        if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Field ids must be unique.' });
        const mapped = d.fields.map((f) => f.customFieldId).filter((x): x is string => !!x);
        if (new Set(mapped).size !== mapped.length) {
            ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Two form fields cannot fill the same custom field.' });
        }
    });

export type IntakeFormDefinition = z.infer<typeof IntakeFormDefinitionSchema>;

export const EMPTY_DEFINITION: IntakeFormDefinition = { intro: '', confirmation: '', fields: [] };

/** A stored definition read back; an unreadable one reads as empty (never thrown at a page). */
export function readDefinition(raw: unknown): IntakeFormDefinition {
    const parsed = IntakeFormDefinitionSchema.safeParse(raw);
    return parsed.success ? parsed.data : EMPTY_DEFINITION;
}

/** The next unused field id (`f<n+1>` past the highest). */
export function nextFieldId(fields: readonly Pick<IntakeFormField, 'id'>[]): string {
    const max = fields.reduce((m, f) => Math.max(m, Number(f.id.slice(1)) || 0), 0);
    return `f${max + 1}`;
}

/** One answer as stored: a string (text, select, date, URL), strings (multi-select), a number or `true`. */
export type IntakeAnswer = string | string[] | number | boolean;
export type IntakeAnswers = Record<string, IntakeAnswer>;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(s: string): boolean {
    if (!DATE_ONLY.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Empty input (an untouched control) reads as no answer. */
const blank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || v === false;

function answerSchema(f: IntakeFormField): z.ZodType<IntakeAnswer | undefined> {
    const optional = <T extends IntakeAnswer>(inner: z.ZodType<T>) =>
        z.preprocess((v) => (blank(v) ? undefined : v), f.required ? inner : inner.optional()) as z.ZodType<IntakeAnswer | undefined>;
    switch (f.kind) {
        case 'SHORT_TEXT':
            return optional(z.string().trim().min(1).max(INTAKE_LIMITS.shortText));
        case 'LONG_TEXT':
            return optional(z.string().trim().min(1).max(INTAKE_LIMITS.longText));
        case 'SELECT':
            return optional(z.string().refine((v) => (f.options ?? []).includes(v), 'Choose one of the options.'));
        case 'MULTI_SELECT':
            return optional(
                z
                    .array(z.string().refine((v) => (f.options ?? []).includes(v), 'Choose from the options.'))
                    .min(1)
                    .max(INTAKE_LIMITS.multiSelectValues)
                    .transform((vs) => [...new Set(vs)]),
            );
        case 'DATE':
            return optional(z.string().refine(isCalendarDate, 'Give a real date.'));
        case 'NUMBER':
            return optional(
                z.preprocess(
                    (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
                    z.number().finite().refine((n) => Math.abs(n) < INTAKE_LIMITS.numberAbs, 'The number is too large.'),
                ),
            );
        case 'URL':
            return optional(
                z
                    .string()
                    .trim()
                    .max(INTAKE_LIMITS.url)
                    .refine((v) => {
                        try {
                            const u = new URL(v);
                            return u.protocol === 'https:' || u.protocol === 'http:';
                        } catch {
                            return false;
                        }
                    }, 'Give a web address starting with http:// or https://.'),
            );
        case 'CHECKBOX':
            return optional(z.literal(true));
    }
}

/**
 * The schema of one request sent through `definition`: the title, the
 * description and an answer per field. Unknown answer keys are refused. The
 * same schema validates the browser's form (react-hook-form) and the route's
 * body.
 */
export function compileIntakeRequestSchema(definition: IntakeFormDefinition) {
    const answers: Record<string, z.ZodType<IntakeAnswer | undefined>> = {};
    for (const f of definition.fields) answers[f.id] = answerSchema(f);
    return z
        .object({
            title: z.string().trim().min(1, 'Give a title.').max(INTAKE_LIMITS.title),
            body: z.string().max(INTAKE_LIMITS.body).optional(),
            answers: z.object(answers).strict().default({}),
        })
        .strict();
}

export type IntakeRequestInput = { title: string; body?: string; answers: Partial<IntakeAnswers> };

/** The answers with the absent ones dropped, in the definition's order. */
export function compactAnswers(definition: IntakeFormDefinition, answers: Partial<Record<string, IntakeAnswer | undefined>>): IntakeAnswers {
    const out: IntakeAnswers = {};
    for (const f of definition.fields) {
        const v = answers[f.id];
        if (v !== undefined) out[f.id] = v;
    }
    return out;
}

/** An answer as a line of text (the accept's description appendix and the Intake page). */
export function answerText(f: Pick<IntakeFormField, 'kind'>, v: IntakeAnswer): string {
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    void f;
    return String(v);
}
