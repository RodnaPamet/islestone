'use client';

/**
 * A plain-text box with the `@` picker (sub-phase 2.7d; owner decision 127):
 * typing `@` at the start or after a space opens a list of the workspace's
 * active members (`GET /users/assignable`, the pickers' roster), narrowed by
 * what follows; choosing one puts their token, `<@userId>`, in place of the
 * `@…` typed. The text stays plain: the token is what is stored, and the
 * renderer (`MentionText`) shows it as a chip once the server has recorded
 * the mention.
 *
 * Keyboard: ArrowDown and ArrowUp move through the list, Enter or Tab chooses,
 * Escape closes it; the keys go to the text box's own `onKeyDown` (no window
 * listener) and do their usual work when the list is closed. The box keeps
 * the textbox role (`aria-autocomplete="list"`, `aria-controls`,
 * `aria-activedescendant`).
 */
import { useTranslations } from 'next-intl';
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { insertMention, mentionQueryAt } from '@/app-layer/domain/mention';
import { Textarea, type TextareaProps } from '@/components/ui/textarea';

import { memberLabel, useMembers } from '../data/use-work-config';

/** How many people the list offers at once. */
export const MENTION_PICKER_LIMIT = 8;

export interface MentionTextareaProps extends Omit<TextareaProps, 'value' | 'onChange'> {
    value: string;
    onValueChange: (next: string) => void;
}

interface OpenQuery {
    start: number;
    query: string;
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(function MentionTextarea(
    { value, onValueChange, onKeyDown, onBlur, ...rest },
    ref,
) {
    const tMention = useTranslations('workItems.mentions');
    const { members } = useMembers();
    const inner = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
    const listId = useId();
    const hintId = useId();
    const [open, setOpen] = useState<OpenQuery | null>(null);
    const [active, setActive] = useState(0);
    const [caretAfter, setCaretAfter] = useState<number | null>(null);

    const options = useMemo(() => {
        if (!open) return [];
        const q = open.query.toLowerCase();
        return members
            .map((m) => ({ id: m.id, label: memberLabel(m) ?? '' }))
            .filter((m) => m.label && (!q || m.label.toLowerCase().includes(q)))
            .slice(0, MENTION_PICKER_LIMIT);
    }, [members, open]);

    useEffect(() => {
        // Put the caret after the inserted token, once the new value is rendered.
        if (caretAfter === null || !inner.current) return;
        inner.current.setSelectionRange(caretAfter, caretAfter);
        setCaretAfter(null);
    }, [caretAfter, value]);

    const follow = (text: string, caret: number) => {
        const q = mentionQueryAt(text, caret);
        setOpen(q);
        setActive(0);
    };

    const choose = (userId: string) => {
        if (!open) return;
        const next = insertMention(value, open, userId);
        onValueChange(next.text);
        setOpen(null);
        setCaretAfter(next.caret);
        inner.current?.focus();
    };

    const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (open && options.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => (i + 1) % options.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (i - 1 + options.length) % options.length);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(options[Math.min(active, options.length - 1)]!.id);
                return;
            }
        }
        if (open && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(null);
            return;
        }
        onKeyDown?.(e);
    };

    const showing = open !== null && options.length > 0;
    const activeId = showing ? `${listId}-${options[Math.min(active, options.length - 1)]!.id}` : undefined;

    return (
        <div className="relative">
            <Textarea
                {...rest}
                ref={inner}
                value={value}
                aria-autocomplete="list"
                aria-controls={showing ? listId : undefined}
                aria-activedescendant={activeId}
                aria-describedby={[rest['aria-describedby'], hintId].filter(Boolean).join(' ')}
                onChange={(e) => {
                    onValueChange(e.target.value);
                    follow(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                onSelect={(e) => {
                    const el = e.currentTarget;
                    if (open) follow(el.value, el.selectionStart ?? el.value.length);
                }}
                onKeyDown={keyDown}
                onBlur={(e) => {
                    setOpen(null);
                    onBlur?.(e);
                }}
            />
            <span id={hintId} className="sr-only">
                {tMention('hint')}
            </span>
            {showing && (
                <ul
                    id={listId}
                    role="listbox"
                    aria-label={tMention('pickerLabel')}
                    className="absolute left-0 z-20 mt-1 max-h-60 w-64 overflow-auto rounded-lg border border-border-default bg-bg-default py-1 shadow-md"
                >
                    {options.map((o, i) => (
                        <li
                            key={o.id}
                            id={`${listId}-${o.id}`}
                            role="option"
                            aria-selected={i === active}
                            className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? 'bg-bg-subtle text-content-emphasis' : 'text-content-default'}`}
                            // Keep the focus in the text box: the click chooses, the blur would close first.
                            onMouseDown={(e) => {
                                e.preventDefault();
                                choose(o.id);
                            }}
                        >
                            {o.label}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
});
