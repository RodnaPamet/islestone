/**
 * Custom fields (sub-phase 2.4): the per-type facts the server and the views
 * share, and the list-query spelling of a custom-field filter and sort.
 * Client-safe: no Prisma runtime, no server import.
 *
 * One exhaustive table over `CustomFieldType` (`satisfies Record<…>`), so a
 * new type fails `tsc` until every fact about it is written (the registry
 * pattern of Teable's `packages/core` field models at
 * bd8cfc054f521f6f9019f62dec2f9fcb1273ecec, MIT; pattern only, no code copied).
 *
 * Written fresh for Islestone.
 */
import type { CustomFieldType } from '@prisma/client';

export type { CustomFieldType };

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'SELECT', 'MULTI_SELECT', 'DATE', 'PERSON', 'URL', 'CHECKBOX'] as const satisfies readonly CustomFieldType[];

/** The value column of each type (ADR 0002 §7). */
export type CustomFieldColumn = 'textValue' | 'numberValue' | 'dateValue' | 'boolValue' | 'optionId' | 'userId';

export interface CustomFieldTypeSpec {
    column: CustomFieldColumn;
    /** One row per chosen option (MULTI_SELECT). */
    multiple: boolean;
    /** Has options (SELECT, MULTI_SELECT). */
    hasOptions: boolean;
    /** The list can sort by it (`order=cf:<id>`). PERSON is not: a name is encrypted PII. */
    sortable: boolean;
    /** The board can group by it (swimlanes). */
    laneable: boolean;
    /** The filter operators the list query accepts (`cf.<id>=<op>[:<operand>]`). */
    operators: readonly CustomFieldOperator[];
}

export type CustomFieldOperator =
    | 'empty'
    | 'set'
    | 'any'
    | 'is'
    | 'eq'
    | 'contains'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'before'
    | 'after'
    | 'onOrBefore'
    | 'onOrAfter';

const PRESENCE = ['empty', 'set'] as const;

export const CUSTOM_FIELD_TYPE_SPECS = {
    TEXT: { column: 'textValue', multiple: false, hasOptions: false, sortable: true, laneable: false, operators: [...PRESENCE, 'eq', 'contains'] },
    URL: { column: 'textValue', multiple: false, hasOptions: false, sortable: true, laneable: false, operators: [...PRESENCE, 'eq', 'contains'] },
    NUMBER: { column: 'numberValue', multiple: false, hasOptions: false, sortable: true, laneable: false, operators: [...PRESENCE, 'eq', 'gt', 'gte', 'lt', 'lte'] },
    DATE: {
        column: 'dateValue',
        multiple: false,
        hasOptions: false,
        sortable: true,
        laneable: false,
        operators: [...PRESENCE, 'eq', 'before', 'after', 'onOrBefore', 'onOrAfter'],
    },
    CHECKBOX: { column: 'boolValue', multiple: false, hasOptions: false, sortable: true, laneable: true, operators: ['is'] },
    SELECT: { column: 'optionId', multiple: false, hasOptions: true, sortable: true, laneable: true, operators: [...PRESENCE, 'any'] },
    MULTI_SELECT: { column: 'optionId', multiple: true, hasOptions: true, sortable: false, laneable: true, operators: [...PRESENCE, 'any'] },
    PERSON: { column: 'userId', multiple: false, hasOptions: false, sortable: false, laneable: true, operators: [...PRESENCE, 'any'] },
} as const satisfies Record<CustomFieldType, CustomFieldTypeSpec>;

/** Caps (Teable's safety limits, scaled to a project; owner-tunable). */
export const CUSTOM_FIELD_LIMITS = {
    fieldsPerProject: 50,
    optionsPerField: 200,
    nameLength: 100,
    textLength: 500,
    /** `|x| < 10^9`, six decimals: fits `Decimal(15, 6)` and a JS number exactly. */
    numberMagnitude: 1e9,
    numberDecimals: 6,
    /** Custom-field conditions in one list query. */
    conditionsPerQuery: 10,
} as const;

/** The list-query key of a field's filter, and the filter system's key. */
export const CUSTOM_FIELD_FILTER_PREFIX = 'cf.';

export function customFieldFilterKey(fieldId: string): string {
    return `${CUSTOM_FIELD_FILTER_PREFIX}${fieldId}`;
}

/** `cf.<id>` → `<id>`, or null for any other key. */
export function fieldIdOfFilterKey(key: string): string | null {
    if (!key.startsWith(CUSTOM_FIELD_FILTER_PREFIX)) return null;
    const id = key.slice(CUSTOM_FIELD_FILTER_PREFIX.length);
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** The `order` of a sort by a field. */
export function customFieldOrder(fieldId: string): `cf:${string}` {
    return `cf:${fieldId}`;
}

/** `cf:<id>` → `<id>`, or null. */
export function fieldIdOfOrder(order: string | undefined): string | null {
    if (!order?.startsWith('cf:')) return null;
    const id = order.slice(3);
    return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** The value a list or detail row carries for one field. */
export type CustomFieldValueData = string | number | boolean | string[];

/** The token the filter system uses for "no value" (as `assigneeId=none`). */
export const NO_VALUE = 'none';

/**
 * The list-query value of a field's filter, from the filter system's values
 * (option ids, member ids, `none`, `checked`/`unchecked`, `set`/`empty`).
 * `undefined` when nothing is selected.
 */
export function customFieldFilterParam(type: CustomFieldType, values: readonly string[]): string | undefined {
    const picked = values.filter(Boolean);
    if (picked.length === 0) return undefined;
    const spec = CUSTOM_FIELD_TYPE_SPECS[type];
    if (type === 'CHECKBOX') return picked.includes('checked') ? 'is:true' : 'is:false';
    if (spec.hasOptions || type === 'PERSON') return `any:${picked.join(',')}`;
    return picked.includes('set') ? 'set' : 'empty';
}
