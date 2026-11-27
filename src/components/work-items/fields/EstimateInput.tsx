'use client';

/**
 * The estimate's editor (sub-phase 3.4a; owner decision 257): a text input
 * in the item's team's unit that saves on blur or Enter. Points take a whole
 * number from 0 to 100; hours take "2h 30m", "2.5h", "45m" or a bare number
 * of hours, stored as minutes. Both are parsed by the one parser in
 * `src/lib/work-items/estimate.ts`; a value it refuses is not sent and the
 * field says why. Clearing the text clears the estimate.
 *
 * `EstimateText` is how an estimate reads elsewhere (the list column, the
 * board card): "5 pts", "2h 30m", nothing for none.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { estimateInputText, formatDuration, parseEstimate, type EstimateUnitValue } from '@/lib/work-items/estimate';

export interface EstimateInputProps {
    id: string;
    unit: EstimateUnitValue;
    value: number | null;
    disabled?: boolean;
    /** Saved on blur or Enter (the detail); left out, every valid change is reported at once (a form). */
    onChange: (value: number | null) => void;
    /** A form reports each keystroke's value (`undefined` while the text does not parse). */
    live?: boolean;
    onDraft?: (value: number | null | undefined) => void;
}

export function EstimateInput({ id, unit, value, disabled, onChange, live, onDraft }: EstimateInputProps) {
    const t = useTranslations('workItems.estimate');
    const current = estimateInputText(unit, value);
    const [draft, setDraft] = useState(current);
    const [invalid, setInvalid] = useState(false);
    const hintId = useId();
    // In a form the value comes back from what the person types: the text
    // they typed stays ("1.5" is not rewritten to "1h 30m" under them).
    const emitted = useRef<number | null | undefined>(undefined);
    useEffect(() => {
        if (live && emitted.current === value) return;
        setDraft(current);
        setInvalid(false);
    }, [current, live, value]);
    const parsed = (text: string): number | null | undefined => (text.trim() === '' ? null : (parseEstimate(unit, text) ?? undefined));
    const save = () => {
        const next = parsed(draft);
        if (next === undefined) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        if (next === value) {
            setDraft(estimateInputText(unit, next));
            return;
        }
        onChange(next);
    };
    return (
        <div className="space-y-1">
            <Input
                id={id}
                value={draft}
                disabled={disabled}
                inputMode={unit === 'POINTS' ? 'numeric' : 'text'}
                placeholder={unit === 'POINTS' ? t('pointsPlaceholder') : t('hoursPlaceholder')}
                aria-invalid={invalid || undefined}
                aria-describedby={hintId}
                onChange={(e) => {
                    setDraft(e.target.value);
                    if (live) {
                        const next = parsed(e.target.value);
                        setInvalid(next === undefined);
                        onDraft?.(next);
                        if (next !== undefined) {
                            emitted.current = next;
                            onChange(next);
                        }
                    }
                }}
                onBlur={live ? undefined : save}
                onKeyDown={(e) => {
                    if (!live && e.key === 'Enter') {
                        e.preventDefault();
                        save();
                    }
                }}
            />
            <p id={hintId} className={`text-xs ${invalid ? 'text-content-error' : 'text-content-muted'}`}>
                {invalid ? (unit === 'POINTS' ? t('pointsInvalid') : t('hoursInvalid')) : unit === 'POINTS' ? t('pointsHint') : t('hoursHint')}
            </p>
        </div>
    );
}

/** An estimate as a short label: "5 pts", "2h 30m"; nothing for none. */
export function EstimateText({ unit, value }: { unit: EstimateUnitValue | null | undefined; value: number | null | undefined }) {
    const tText = useTranslations('workItems.estimate');
    if (!unit || value === null || value === undefined) return null;
    return <>{unit === 'POINTS' ? tText('points', { count: value }) : formatDuration(value)}</>;
}
