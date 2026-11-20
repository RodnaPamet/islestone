'use client';

/**
 * One custom field's editor on the detail (sub-phase 2.4), by type: a select
 * or multi-select picker over the field's options (an archived option shows
 * only where it is held), the member picker for a person, the shared date
 * picker (date-only), a checkbox, and a text input that saves on blur or
 * Enter for text, number and URL. Every change goes to `onChange`; the
 * caller writes through `useWorkItemMutations().setCustomField`.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { Input } from '@/components/ui/input';
import type { CustomFieldValueData } from '@/lib/work-items/custom-fields';
import type { ViewCustomField } from '@/lib/work-items/types';

import { AssigneePicker } from '../pickers';

export interface CustomFieldInputProps {
    id: string;
    field: ViewCustomField;
    value: CustomFieldValueData | undefined;
    disabled?: boolean;
    onChange: (value: CustomFieldValueData | null) => void;
}

function TextLikeInput({ id, field, value, disabled, onChange }: CustomFieldInputProps) {
    const tInput = useTranslations('workItems.customFields');
    const current = value === undefined ? '' : String(value);
    const [draft, setDraft] = useState(current);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the server's value when it changes
        setDraft(current);
    }, [current]);
    const save = () => {
        const next = draft.trim();
        if (next === current) return;
        if (!next) return onChange(null);
        if (field.type === 'NUMBER') {
            const n = Number(next);
            if (!Number.isFinite(n)) {
                setDraft(current);
                return;
            }
            return onChange(n);
        }
        onChange(next);
    };
    return (
        <Input
            id={id}
            value={draft}
            disabled={disabled}
            inputMode={field.type === 'NUMBER' ? 'decimal' : undefined}
            type={field.type === 'URL' ? 'url' : 'text'}
            maxLength={500}
            placeholder={field.type === 'URL' ? tInput('urlPlaceholder') : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                }
            }}
        />
    );
}

export function CustomFieldInput(props: CustomFieldInputProps) {
    const tField = useTranslations('workItems.customFields');
    const { id, field, value, disabled, onChange } = props;
    const held = useMemo(() => new Set(Array.isArray(value) ? value : value === undefined ? [] : [String(value)]), [value]);
    const options = useMemo<ComboboxOption[]>(
        () => field.options.filter((o) => !o.archived || held.has(o.id)).map((o) => ({ value: o.id, label: o.name })),
        [field.options, held],
    );

    switch (field.type) {
        case 'SELECT': {
            const withClear = [{ value: '', label: tField('noValue') }, ...options];
            return (
                <Combobox
                    id={id}
                    disabled={disabled}
                    selected={withClear.find((o) => o.value === (value ?? '')) ?? null}
                    setSelected={(o) => o && (o.value || null) !== (value ?? null) && onChange(o.value || null)}
                    options={withClear}
                    caret
                    buttonProps={{ 'aria-label': field.name }}
                />
            );
        }
        case 'MULTI_SELECT':
            return (
                <Combobox
                    id={id}
                    disabled={disabled}
                    multiple
                    selected={options.filter((o) => held.has(o.value))}
                    setSelected={(opts) => onChange(opts.map((o) => o.value))}
                    options={options}
                    caret
                    placeholder={tField('noValue')}
                    buttonProps={{ 'aria-label': field.name }}
                />
            );
        case 'PERSON':
            return <AssigneePicker id={id} label={field.name} disabled={disabled} value={typeof value === 'string' ? value : null} onChange={(userId) => onChange(userId)} />;
        case 'DATE':
            return (
                <DatePicker
                    id={id}
                    value={parseYMD(typeof value === 'string' ? value : null)}
                    disabled={disabled}
                    clearable
                    onChange={(d) => onChange(toYMD(d))}
                />
            );
        case 'CHECKBOX':
            return <Checkbox id={id} aria-label={field.name} disabled={disabled} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />;
        default:
            return <TextLikeInput {...props} />;
    }
}
