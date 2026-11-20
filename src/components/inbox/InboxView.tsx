'use client';

/**
 * The Inbox (sub-phase 2.7c; owner decision 134): the member's notifications
 * in this workspace, as the tabs Unread, All and Done, optionally of one kind.
 * Each row can be opened, marked read or unread, and marked Done (or, on the
 * Done tab, moved back to the Inbox); Done goes through the undo toast. "Mark
 * all read" clears the unread count. Keyboard: J and K move the selection, E
 * marks it Done, U toggles read, while focus is in the list (`useKeyboardShortcut`); Enter on the
 * focused row opens it.
 *
 * A row shows the copy the bell stored (titles and names, never a description
 * or a comment). Opening one marks it read and follows its link.
 *
 * Written fresh for Islestone.
 */
import type { NotificationType } from '@prisma/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { formatDateTime } from '@inflect/ui/lib/format-date';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useKeyboardShortcut } from '@/lib/hooks/use-keyboard-shortcut';
import { INBOX_VIEWS, type InboxView as View, type NotificationRowData } from '@/lib/notifications/inbox';
import { PREFERENCE_TYPES } from '@/lib/notifications/preferences';
import { useTenantHref } from '@/lib/tenant-context-provider';

import { inboxRefusal, useInbox } from './use-inbox';

const ALL_TYPES = '';

export function InboxView({ title }: { title: string }) {
    const t = useTranslations('inbox');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const [view, setView] = useState<View>('unread');
    const [type, setType] = useState<NotificationType | null>(null);
    const inbox = useInbox(view, type);
    const { rows } = inbox;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const selectedIndex = rows.findIndex((r) => r.id === selectedId);
    // A selection that left the view (Done, another tab) is no selection.
    const selected = selectedIndex >= 0 ? rows[selectedIndex] : undefined;

    const typeOptions = useMemo<ComboboxOption[]>(
        () => [{ value: ALL_TYPES, label: t('typeFilter.all') }, ...PREFERENCE_TYPES.map((x) => ({ value: x, label: t(`types.${x}`) }))],
        [t],
    );

    const openRow = (row: NotificationRowData) => {
        if (!row.read) void inbox.setRead(row, true);
        if (row.linkUrl) router.push(row.linkUrl);
    };

    const move = (step: number) => {
        if (rows.length === 0) return;
        const next = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, selectedIndex + step));
        setSelectedId(rows[next]!.id);
        document.getElementById(`inbox-row-${rows[next]!.id}`)?.focus();
    };

    // Single keys fire only while focus is in the list (WCAG 2.1.4: a bare
    // character shortcut is never bound for the whole page).
    const listRef = useRef<HTMLElement>(null);
    useKeyboardShortcut('j', () => move(1), { description: t('shortcuts.next'), within: listRef });
    useKeyboardShortcut('k', () => move(-1), { description: t('shortcuts.previous'), within: listRef });
    useKeyboardShortcut('e', () => selected && inbox.setDone(selected, view !== 'done'), { description: t('shortcuts.done'), within: listRef });
    useKeyboardShortcut('u', () => selected && void inbox.setRead(selected, !selected.read), { description: t('shortcuts.toggleRead'), within: listRef });

    return (
        <DashboardLayout
            header={{
                title,
                description: t('description'),
                actions: (
                    <div className="flex flex-wrap items-center gap-tight">
                        {view !== 'done' && inbox.unreadCount > 0 && (
                            <Button variant="secondary" text={t('markAllRead')} onClick={() => void inbox.markAllRead()} />
                        )}
                        <Link className="text-sm text-content-emphasis underline" href={tenantHref('/inbox/preferences')}>
                            {t('preferences')}
                        </Link>
                    </div>
                ),
            }}
            data-testid="inbox-page"
        >
            <div className="flex flex-wrap items-center gap-default">
                <div className="flex flex-wrap gap-tight" role="group" aria-label={t('views.label')}>
                    {INBOX_VIEWS.map((v) => (
                        <Button
                            key={v}
                            variant={v === view ? 'primary' : 'secondary'}
                            aria-pressed={v === view}
                            text={v === 'unread' && inbox.unreadCount > 0 ? `${t('views.unread')} (${inbox.unreadCount})` : t(`views.${v}`)}
                            onClick={() => {
                                setView(v);
                                setSelectedId(null);
                            }}
                        />
                    ))}
                </div>
                <div className="w-64 max-w-full">
                    <Combobox
                        id="inbox-type-filter"
                        selected={typeOptions.find((o) => o.value === (type ?? ALL_TYPES)) ?? null}
                        setSelected={(o) => o && setType((o.value || null) as NotificationType | null)}
                        options={typeOptions}
                        caret
                        hideSearch
                        buttonProps={{ 'aria-label': t('typeFilter.label') }}
                    />
                </div>
                <span className="sr-only" aria-live="polite">
                    {t('unreadCount', { count: inbox.unreadCount })}
                </span>
            </div>
            <section ref={listRef} aria-labelledby="inbox-list-heading" className="space-y-tight">
                <h2 id="inbox-list-heading" className="sr-only">
                    {t(`views.${view}`)}
                </h2>
                <p className="text-xs text-content-muted">{t('keyboardHint')}</p>
                {inbox.error && <p role="alert">{inboxRefusal(inbox.error, t('loadFailed'))}</p>}
                {!inbox.error && !inbox.isLoading && rows.length === 0 && <p className="text-sm text-content-muted">{t(`empty.${view}`)}</p>}
                {rows.length > 0 && (
                    <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle" aria-label={t('listLabel')} data-testid="inbox-list">
                        {rows.map((r) => {
                            const active = r.id === selected?.id;
                            return (
                                <li
                                    key={r.id}
                                    className={`flex flex-wrap items-start gap-default px-default py-tight ${active ? 'bg-bg-muted' : ''}`}
                                    data-testid="inbox-row"
                                    data-read={r.read ? 'true' : 'false'}
                                >
                                    <button
                                        id={`inbox-row-${r.id}`}
                                        type="button"
                                        className="min-w-0 flex-1 text-left"
                                        aria-current={active ? 'true' : undefined}
                                        onFocus={() => setSelectedId(r.id)}
                                        onClick={() => openRow(r)}
                                    >
                                        <span className={`block truncate text-sm ${r.read ? 'text-content-default' : 'font-semibold text-content-emphasis'}`}>
                                            {!r.read && <span className="sr-only">{t('unreadMark')}: </span>}
                                            {r.title}
                                        </span>
                                        <span className="block text-sm text-content-muted">{r.body}</span>
                                        <span className="block text-xs text-content-muted">
                                            {t(`types.${r.type}`)} · {formatDateTime(r.createdAt)}
                                        </span>
                                    </button>
                                    <div className="flex flex-wrap gap-tight">
                                        {view !== 'done' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={r.read ? t('markUnread') : t('markRead')}
                                                aria-label={r.read ? t('markUnreadNamed', { title: r.title }) : t('markReadNamed', { title: r.title })}
                                                onClick={() => void inbox.setRead(r, !r.read)}
                                            />
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            text={view === 'done' ? t('restore') : t('done')}
                                            aria-label={view === 'done' ? t('restoreNamed', { title: r.title }) : t('doneNamed', { title: r.title })}
                                            onClick={() => inbox.setDone(r, view !== 'done')}
                                        />
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {inbox.hasMore && <Button variant="secondary" text={t('loadMore')} onClick={() => void inbox.loadMore()} />}
            </section>
        </DashboardLayout>
    );
}
