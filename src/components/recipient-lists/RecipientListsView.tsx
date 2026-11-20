'use client';

/**
 * A scope's recipient lists (sub-phase 2.7e; owner decisions 138 to 141):
 * Settings → Recipient lists for the workspace's, and a project's own page
 * for its lists. Each list shows its people; a viewer the server lets manage
 * the scope (`canManage`, asked on the server from the predicates the
 * usecases assert) creates, renames, adds and removes people (removal
 * through the undo toast), archives and restores. Lists are never deleted
 * (decision 141).
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { memberLabel, useMembers } from '@/components/work-items/data/use-work-config';
import { RECIPIENT_LIST_DESCRIPTION_MAX, RECIPIENT_LIST_NAME_MAX, type RecipientListData } from '@/lib/recipient-lists/types';

import { useRecipientListWrites, useRecipientLists, type RecipientListOwner } from './use-recipient-lists';

type Writes = ReturnType<typeof useRecipientListWrites>;

function ListCard({ list, canManage, writes, onEdit }: { list: RecipientListData; canManage: boolean; writes: Writes; onEdit: () => void }) {
    const tCard = useTranslations('recipientLists');
    const { members, byId } = useMembers();
    const nameOf = (id: string) => memberLabel(byId.get(id)) ?? tCard('formerMember');
    const addable = useMemo<ComboboxOption[]>(
        () => members.filter((m) => !list.memberUserIds.includes(m.id)).map((m) => ({ value: m.id, label: memberLabel(m) ?? m.id })),
        [members, list.memberUserIds],
    );
    const headingId = `recipient-list-${list.id}`;
    return (
        <section aria-labelledby={headingId} className="space-y-tight rounded-md border border-border-subtle p-default" data-testid="recipient-list">
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <h2 id={headingId} className="text-lg font-semibold text-content-emphasis">
                    {list.name}
                </h2>
                <span className="flex flex-wrap items-center gap-tight">
                    <span className="text-sm text-content-muted">{tCard('memberCount', { count: list.memberUserIds.length })}</span>
                    {canManage && !list.archived && (
                        <Button variant="ghost" size="sm" text={tCard('edit')} aria-label={tCard('editNamed', { name: list.name })} onClick={onEdit} />
                    )}
                    {canManage && (
                        <Button
                            variant="ghost"
                            size="sm"
                            text={list.archived ? tCard('restore') : tCard('archive')}
                            aria-label={list.archived ? tCard('restoreNamed', { name: list.name }) : tCard('archiveNamed', { name: list.name })}
                            onClick={() => void writes.setArchived(list, !list.archived)}
                        />
                    )}
                </span>
            </div>
            {list.description && <p className="text-sm text-content-muted">{list.description}</p>}
            {list.memberUserIds.length === 0 ? (
                <p className="text-sm text-content-muted">{tCard('noMembers')}</p>
            ) : (
                <ul className="space-y-tight" aria-label={tCard('membersOf', { name: list.name })}>
                    {list.memberUserIds.map((id) => (
                        <li key={id} className="flex items-center justify-between gap-tight text-sm">
                            <span>{nameOf(id)}</span>
                            {canManage && !list.archived && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    text={tCard('remove')}
                                    aria-label={tCard('removeNamed', { name: nameOf(id), list: list.name })}
                                    onClick={() => writes.removeMember(list, id, nameOf(id))}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {canManage && !list.archived && (
                <Combobox
                    id={`recipient-list-add-${list.id}`}
                    selected={null}
                    setSelected={(o) => o && void writes.addMembers(list, [o.value])}
                    options={addable}
                    caret
                    placeholder={tCard('addPerson')}
                    searchPlaceholder={tCard('searchMembers')}
                    buttonProps={{ 'aria-label': tCard('addPersonTo', { name: list.name }) }}
                />
            )}
        </section>
    );
}

export function RecipientListsView({
    owner,
    title,
    description,
    canManage,
    readOnlyReason,
}: {
    owner: RecipientListOwner;
    title: string;
    description: string;
    /** Whether the server lets this viewer manage the scope's lists (and the project is not archived). */
    canManage: boolean;
    /** Why the page offers no writes, when it says so. */
    readOnlyReason?: string;
}) {
    const t = useTranslations('recipientLists');
    const { data, error, isLoading } = useRecipientLists(owner);
    const writes = useRecipientListWrites(owner);
    const [editing, setEditing] = useState<RecipientListData | 'new' | null>(null);
    const [name, setName] = useState('');
    const [text, setText] = useState('');
    const live = (data ?? []).filter((l) => !l.archived);
    const archived = (data ?? []).filter((l) => l.archived);

    const open = (list: RecipientListData | 'new') => {
        setName(list === 'new' ? '' : list.name);
        setText(list === 'new' ? '' : (list.description ?? ''));
        setEditing(list);
    };
    const submit = async (): Promise<string | null> => {
        const value = name.trim();
        if (!value) return t('nameRequired');
        const input = { name: value, description: text.trim() || null };
        return editing === 'new' ? writes.create(input) : editing ? writes.update(editing, input) : null;
    };

    return (
        <DashboardLayout
            header={{
                title,
                description,
                back: { smart: true },
                actions: canManage ? <Button id="new-recipient-list-btn" variant="primary" icon={<Plus />} text={t('create')} onClick={() => open('new')} /> : undefined,
            }}
            data-testid="recipient-lists"
        >
            {!canManage && readOnlyReason && <p className="text-sm text-content-muted">{readOnlyReason}</p>}
            {error && <p role="alert">{t('loadFailed')}</p>}
            {!isLoading && !error && live.length === 0 && <p className="text-sm text-content-muted">{t('empty')}</p>}
            {live.map((list) => (
                <ListCard key={list.id} list={list} canManage={canManage} writes={writes} onEdit={() => open(list)} />
            ))}
            {archived.length > 0 && (
                <details className="space-y-tight">
                    <summary className="cursor-pointer text-sm text-content-muted">{t('archivedLists', { count: archived.length })}</summary>
                    {archived.map((list) => (
                        <ListCard key={list.id} list={list} canManage={canManage} writes={writes} onEdit={() => open(list)} />
                    ))}
                </details>
            )}
            <SettingsFormModal
                open={editing !== null}
                onOpenChange={(v) => !v && setEditing(null)}
                title={editing === 'new' ? t('createTitle') : t('editTitle')}
                description={t('hint')}
                submitLabel={editing === 'new' ? t('createSubmit') : t('save')}
                onSubmit={submit}
            >
                <FormField label={t('name')} required>
                    <Input id="recipient-list-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={RECIPIENT_LIST_NAME_MAX} autoFocus />
                </FormField>
                <FormField label={t('descriptionLabel')}>
                    <Textarea id="recipient-list-description-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={RECIPIENT_LIST_DESCRIPTION_MAX} />
                </FormField>
            </SettingsFormModal>
        </DashboardLayout>
    );
}
