/**
 * How a custom-field value reads in a cell, a lane header or a card
 * (sub-phase 2.4): option names in option order, a member's name, the date
 * as stored (date-only, never shifted by a time zone), the number as stored.
 * Pure, so the list, the board and the detail render a value alike.
 *
 * Written fresh for Islestone.
 */
import type { CustomFieldValueData } from '@/lib/work-items/custom-fields';
import type { ViewCustomField } from '@/lib/work-items/types';

export function customFieldText(
    field: Pick<ViewCustomField, 'type' | 'options'>,
    value: CustomFieldValueData | undefined,
    memberName: (id: string) => string | null,
    checkedLabel: string,
): string {
    if (value === undefined || value === null) return '';
    switch (field.type) {
        case 'SELECT':
            return field.options.find((o) => o.id === value)?.name ?? '';
        case 'MULTI_SELECT': {
            const held = new Set(Array.isArray(value) ? value : [String(value)]);
            return field.options
                .filter((o) => held.has(o.id))
                .map((o) => o.name)
                .join(', ');
        }
        case 'PERSON':
            return memberName(String(value)) ?? '';
        case 'CHECKBOX':
            return value === true ? checkedLabel : '';
        default:
            return String(value);
    }
}

/** The lane a row sits in for a field (`''` is "no value"); a multi-select by its first option in option order. */
export function customFieldLaneKey(field: Pick<ViewCustomField, 'type' | 'options'>, value: CustomFieldValueData | undefined): string {
    if (value === undefined || value === null) return '';
    if (field.type === 'MULTI_SELECT') {
        const held = new Set(Array.isArray(value) ? value : [String(value)]);
        return field.options.find((o) => held.has(o.id))?.id ?? '';
    }
    if (field.type === 'CHECKBOX') return value === true ? 'checked' : '';
    return String(value);
}
