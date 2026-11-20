/**
 * Custom-field values and filter conditions, parsed (sub-phase 2.4,
 * ADR 0002 §7). Pure: no database, so every rule here is unit-tested
 * (`tests/unit/domain/custom-field.test.ts`). What needs the database (an
 * option of THIS field, an ACTIVE member) is checked by the usecase on the
 * ids this module returns.
 *
 * The value rules are Teable's, read in `packages/core/src/models/field/**`
 * at bd8cfc054f521f6f9019f62dec2f9fcb1273ecec (MIT; pattern only, no code
 * copied), with its quirks refused (docs/porting/oss/teable.md §5.2):
 *   - text: CR, LF and tab become spaces, trimmed; empty is "no value";
 *     capped at 500 characters;
 *   - number: a JSON number or a plain decimal string, never "strip every
 *     other character"; finite, |x| < 10^9, at most six decimals;
 *   - date: `YYYY-MM-DD`, a real calendar date (date-only, no time zone);
 *   - checkbox: `true` is stored, `false` is no row;
 *   - select: one option id; multi-select: option ids, de-duplicated;
 *   - person: one member id (the usecase checks membership);
 *   - URL: absolute, `http:` or `https:` only.
 * `null` (or an empty value) clears.
 *
 * Written fresh for Islestone.
 */
import { badRequest } from '@/lib/errors/types';
import {
    CUSTOM_FIELD_LIMITS,
    CUSTOM_FIELD_TYPE_SPECS,
    NO_VALUE,
    type CustomFieldOperator,
    type CustomFieldType,
} from '@/lib/work-items/custom-fields';

/** What a write stores: nothing (clear), or the typed rows. */
export type ParsedCustomFieldValue =
    | { kind: 'clear' }
    | { kind: 'text'; value: string }
    | { kind: 'number'; value: string }
    | { kind: 'date'; value: string }
    | { kind: 'checked' }
    | { kind: 'options'; optionIds: string[] }
    | { kind: 'person'; userId: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isCalendarDate(s: string): boolean {
    if (!DATE_RE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** Normalise a decimal: a string with at most six decimals and |x| < 10^9, or a refusal. */
export function normaliseNumber(raw: unknown, label: string): string {
    let text: string;
    if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) throw badRequest(`${label} must be a finite number.`);
        text = String(raw);
        if (/e/i.test(text)) throw badRequest(`${label} is out of range.`);
    } else if (typeof raw === 'string' && NUMBER_RE.test(raw.trim())) {
        text = raw.trim();
    } else {
        throw badRequest(`${label} must be a number.`);
    }
    const [whole, decimals = ''] = text.replace(/^-/, '').split('.');
    if (decimals.length > CUSTOM_FIELD_LIMITS.numberDecimals) {
        throw badRequest(`${label} has more than ${CUSTOM_FIELD_LIMITS.numberDecimals} decimals.`);
    }
    if (Math.abs(Number(text)) >= CUSTOM_FIELD_LIMITS.numberMagnitude || (whole ?? '').replace(/^0+/, '').length > 9) {
        throw badRequest(`${label} is out of range.`);
    }
    return text;
}

/** Text: control whitespace to spaces, trimmed, capped. Empty → `null`. */
export function normaliseText(raw: string): string | null {
    const text = raw.replace(/[\r\n\t]+/g, ' ').trim();
    if (text === '') return null;
    if (text.length > CUSTOM_FIELD_LIMITS.textLength) {
        throw badRequest(`A text value is at most ${CUSTOM_FIELD_LIMITS.textLength} characters.`);
    }
    return text;
}

/** An absolute `http:`/`https:` URL, or a refusal. */
export function normaliseUrl(raw: string): string | null {
    const text = raw.trim();
    if (text === '') return null;
    if (text.length > CUSTOM_FIELD_LIMITS.textLength) {
        throw badRequest(`A URL is at most ${CUSTOM_FIELD_LIMITS.textLength} characters.`);
    }
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        throw badRequest('A URL value must be an absolute http or https URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw badRequest('A URL value must be an absolute http or https URL.');
    }
    return text;
}

function idOf(raw: unknown, label: string): string {
    if (typeof raw !== 'string' || !ID_RE.test(raw)) throw badRequest(`${label} must be an id.`);
    return raw;
}

/**
 * Parse a write's raw value for a field of `type`. Text is expected already
 * sanitised by the caller (`sanitizePlainText`, `sanitizeUrlText`).
 */
export function parseCustomFieldValue(type: CustomFieldType, raw: unknown): ParsedCustomFieldValue {
    if (raw === null || raw === undefined) return { kind: 'clear' };
    switch (type) {
        case 'TEXT': {
            if (typeof raw !== 'string') throw badRequest('A text value must be a string.');
            const value = normaliseText(raw);
            return value === null ? { kind: 'clear' } : { kind: 'text', value };
        }
        case 'URL': {
            if (typeof raw !== 'string') throw badRequest('A URL value must be a string.');
            const value = normaliseUrl(raw);
            return value === null ? { kind: 'clear' } : { kind: 'text', value };
        }
        case 'NUMBER': {
            if (raw === '') return { kind: 'clear' };
            return { kind: 'number', value: normaliseNumber(raw, 'A number value') };
        }
        case 'DATE': {
            if (raw === '') return { kind: 'clear' };
            if (typeof raw !== 'string' || !isCalendarDate(raw)) throw badRequest('A date value must be a real date in the form YYYY-MM-DD.');
            return { kind: 'date', value: raw };
        }
        case 'CHECKBOX': {
            if (typeof raw !== 'boolean') throw badRequest('A checkbox value must be true or false.');
            return raw ? { kind: 'checked' } : { kind: 'clear' };
        }
        case 'SELECT': {
            if (raw === '') return { kind: 'clear' };
            return { kind: 'options', optionIds: [idOf(raw, 'A select value')] };
        }
        case 'MULTI_SELECT': {
            if (!Array.isArray(raw)) throw badRequest('A multi-select value must be a list of option ids.');
            if (raw.length > CUSTOM_FIELD_LIMITS.optionsPerField) throw badRequest('Too many options.');
            const ids = [...new Set(raw.map((r) => idOf(r, 'A multi-select value')))];
            return ids.length === 0 ? { kind: 'clear' } : { kind: 'options', optionIds: ids };
        }
        case 'PERSON': {
            if (raw === '') return { kind: 'clear' };
            return { kind: 'person', userId: idOf(raw, 'A person value') };
        }
    }
}

// ─── Filter conditions ────────────────────────────────────────────────────

/** One parsed `cf.<fieldId>=<op>[:<operand>]` condition. */
export type CustomFieldCondition =
    | { op: 'empty' }
    | { op: 'set' }
    | { op: 'any'; ids: string[]; orEmpty: boolean }
    | { op: 'is'; checked: boolean }
    | { op: 'eq' | 'contains'; text: string }
    | { op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte'; number: string }
    | { op: 'eq' | 'before' | 'after' | 'onOrBefore' | 'onOrAfter'; date: string };

/**
 * Parse a condition for a field of `type`. `callerId` resolves the `me`
 * token of a person filter to the reader, so one shared view works for
 * everybody (Teable's `Me`, study §5.7). An operator the type does not take,
 * or a malformed operand, is a 400: never "matches nothing".
 */
export function parseCustomFieldCondition(type: CustomFieldType, raw: string, callerId: string): CustomFieldCondition {
    const colon = raw.indexOf(':');
    const op = (colon === -1 ? raw : raw.slice(0, colon)) as CustomFieldOperator;
    const operand = colon === -1 ? '' : raw.slice(colon + 1);
    const spec = CUSTOM_FIELD_TYPE_SPECS[type];
    if (!(spec.operators as readonly string[]).includes(op)) {
        throw badRequest(`A ${type} field takes the operators ${spec.operators.join(', ')}.`);
    }
    if (op === 'empty' || op === 'set') {
        if (operand) throw badRequest(`The ${op} operator takes no value.`);
        return { op };
    }
    if (op === 'is') {
        if (operand !== 'true' && operand !== 'false') throw badRequest('A checkbox filter is is:true or is:false.');
        return { op, checked: operand === 'true' };
    }
    if (op === 'any') {
        const parts = [...new Set(operand.split(',').map((s) => s.trim()).filter(Boolean))];
        if (parts.length === 0 || parts.length > 100) throw badRequest('The any operator takes 1 to 100 ids.');
        const orEmpty = parts.includes(NO_VALUE);
        const ids = parts
            .filter((p) => p !== NO_VALUE)
            .map((p) => (type === 'PERSON' && p === 'me' ? callerId : idOf(p, 'An id')));
        return { op, ids, orEmpty };
    }
    if (type === 'NUMBER') return { op: op as 'eq', number: normaliseNumber(operand, 'A number filter') };
    if (type === 'DATE') {
        if (!isCalendarDate(operand)) throw badRequest('A date filter takes a date in the form YYYY-MM-DD.');
        return { op: op as 'eq', date: operand };
    }
    if (operand.length === 0 || operand.length > CUSTOM_FIELD_LIMITS.textLength) throw badRequest('A text filter takes 1 to 500 characters.');
    return { op: op as 'eq', text: operand };
}
