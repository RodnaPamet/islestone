'use client';

/**
 * A project's item templates, managed (sub-phase 2.5c): create one (name,
 * the item's title, description, type, priority, labels, assignee, "due in N
 * days" and sub-items), change it, archive or unarchive it, and delete it
 * through the undo toast. Offered to a viewer who may change the project
 * (`manageItemTemplates`, asked on the server), from the project's page.
 * Custom-field values are set through the API for now.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import type { WorkItemPriority, WorkItemTemplateData } from '@/lib/work-items/types';

import { useFieldSet } from '../data/use-field-sets';
import { useWorkConfig } from '../data/use-work-config';
import { requirementOf, type FieldKey } from '@/lib/work-items/field-sets';
import { useItemTemplateManager } from '../data/use-item-templates';
import { AssigneePicker, LabelsPicker, PriorityPicker, TypePicker } from '../pickers';

interface Draft {
    name: string;
    title: string;
    description: string;
    typeId: string;
    priority: WorkItemPriority;
    labelIds: string[];
    assigneeId: string | null;
    dueInDays: string;
    subItems: string;
}

function draftOf(t: WorkItemTemplateData | null, defaultTypeId: string): Draft {
    return {
        name: t?.name ?? '',
        title: t?.title ?? '',
        description: t?.description ?? '',
        typeId: t?.typeId ?? defaultTypeId,
        priority: t?.priority ?? 'NONE',
        labelIds: t?.labelIds ?? [],
        assigneeId: t?.assigneeId ?? null,
        dueInDays: t?.dueInDays !== null && t?.dueInDays !== undefined ? String(t.dueInDays) : '',
        subItems: (t?.subItems ?? []).map((s) => s.title).join('\n'),
    };
}

export function ItemTemplatesManager({
    open,
    onOpenChange,
    projectId,
    teamId,
    projectName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    teamId: string;
    projectName: string;
}) {
    const tManager = useTranslations('workItems.templates');
    const config = useWorkConfig();
    const api = useItemTemplateManager(projectId, open);
    const defaultTypeId = config.types[0]?.id ?? '';
    const [editing, setEditing] = useState<WorkItemTemplateData | null>(null);
    const [draft, setDraft] = useState<Draft>(() => draftOf(null, defaultTypeId));
    const [error, setError] = useState<string | null>(null);
    const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
    // Field sets (2.4b-b): a field the chosen type hides is not offered; a template's value for it would be skipped at use.
    const fieldSet = useFieldSet(draft.typeId || undefined, projectId, []);
    const offered = (key: FieldKey) => requirementOf(fieldSet, key) !== 'HIDDEN';

    const startEdit = (t: WorkItemTemplateData | null) => {
        setEditing(t);
        setDraft(draftOf(t, defaultTypeId));
        setError(null);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!draft.name.trim() || !draft.title.trim()) {
            setError(tManager('required'));
            return;
        }
        const days = draft.dueInDays.trim();
        if (days && !/^\d{1,4}$/.test(days)) {
            setError(tManager('dueInDaysInvalid'));
            return;
        }
        const body = {
            name: draft.name.trim(),
            title: draft.title.trim(),
            description: draft.description.trim() ? draft.description : null,
            typeId: draft.typeId || null,
            priority: draft.priority,
            labelIds: draft.labelIds,
            assigneeId: draft.assigneeId,
            dueInDays: days ? Number(days) : null,
            subItems: draft.subItems
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((title) => ({ title })),
        };
        const out = editing ? await api.update(editing.id, body) : await api.create(body);
        if (out instanceof Error) {
            setError(out.reason ?? tManager('failed'));
            return;
        }
        startEdit(null);
    };

    return (
        <Modal
            showModal={open}
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(open) : v;
                if (!next) onOpenChange(false);
            }}
            title={tManager('title', { project: projectName })}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={tManager('title', { project: projectName })} description={tManager('description')} />
            <Modal.Body>
                <div className="space-y-section">
                    <section aria-labelledby="tpl-list-heading" className="space-y-default">
                        <h2 id="tpl-list-heading" className="text-sm font-semibold text-content-emphasis">
                            {tManager('listHeading')}
                        </h2>
                        {api.isLoading ? (
                            <p className="text-sm text-content-muted">{tManager('loading')}</p>
                        ) : api.templates.length === 0 ? (
                            <p className="text-sm text-content-muted">{tManager('empty')}</p>
                        ) : (
                            <ul className="space-y-tight">
                                {api.templates.map((t) => (
                                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-tight border-t border-border-subtle pt-2 first:border-t-0">
                                        <div className="min-w-0">
                                            <p className="text-sm text-content-emphasis">
                                                {t.name}
                                                {t.archived && <span className="ml-2 text-xs text-content-muted">{tManager('archived')}</span>}
                                            </p>
                                            <p className="text-xs text-content-muted">{tManager('makes', { title: t.title, count: t.subItems.length })}</p>
                                        </div>
                                        <div className="flex gap-tight">
                                            <Button type="button" variant="ghost" size="sm" text={tManager('edit')} aria-label={tManager('editNamed', { name: t.name })} onClick={() => startEdit(t)} />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                text={t.archived ? tManager('unarchive') : tManager('archive')}
                                                aria-label={t.archived ? tManager('unarchiveNamed', { name: t.name }) : tManager('archiveNamed', { name: t.name })}
                                                onClick={() => void api.update(t.id, { archived: !t.archived })}
                                            />
                                            <Button type="button" variant="ghost" size="sm" text={tManager('delete')} aria-label={tManager('deleteNamed', { name: t.name })} onClick={() => api.remove(t)} />
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <form onSubmit={submit} className="space-y-default" aria-labelledby="tpl-form-heading">
                        <h2 id="tpl-form-heading" className="text-sm font-semibold text-content-emphasis">
                            {editing ? tManager('editHeading', { name: editing.name }) : tManager('createHeading')}
                        </h2>
                        <FormField label={tManager('name')} required>
                            <Input id="tpl-name" value={draft.name} maxLength={100} onChange={(e) => set('name', e.target.value)} />
                        </FormField>
                        <FormField label={tManager('itemTitle')} required>
                            <Input id="tpl-title" value={draft.title} maxLength={500} onChange={(e) => set('title', e.target.value)} />
                        </FormField>
                        {offered('description') && (
                            <FormField label={tManager('itemDescription')}>
                                <Textarea id="tpl-description" value={draft.description} rows={3} onChange={(e) => set('description', e.target.value)} />
                            </FormField>
                        )}
                        <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                            <FormField label={tManager('type')}>
                                <TypePicker id="tpl-type" value={draft.typeId} onChange={(v) => set('typeId', v)} />
                            </FormField>
                            {offered('priority') && (
                                <FormField label={tManager('priority')}>
                                    <PriorityPicker id="tpl-priority" value={draft.priority} onChange={(v) => set('priority', v)} />
                                </FormField>
                            )}
                            {offered('assignee') && (
                                <FormField label={tManager('assignee')}>
                                    <AssigneePicker id="tpl-assignee" value={draft.assigneeId} onChange={(v) => set('assigneeId', v)} />
                                </FormField>
                            )}
                            {offered('labels') && (
                                <FormField label={tManager('labels')}>
                                    <LabelsPicker id="tpl-labels" teamId={teamId} value={draft.labelIds} onChange={(v) => set('labelIds', v)} />
                                </FormField>
                            )}
                            {offered('dueDate') && (
                                <FormField label={tManager('dueInDays')} hint={tManager('dueInDaysHint')}>
                                    <Input id="tpl-due" inputMode="numeric" value={draft.dueInDays} maxLength={4} onChange={(e) => set('dueInDays', e.target.value)} />
                                </FormField>
                            )}
                        </div>
                        <FormField label={tManager('subItems')} hint={tManager('subItemsHint')}>
                            <Textarea id="tpl-subitems" value={draft.subItems} rows={3} onChange={(e) => set('subItems', e.target.value)} />
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                        <div className="flex gap-tight">
                            <Button id="tpl-save-btn" type="submit" variant="primary" text={editing ? tManager('save') : tManager('create')} />
                            {editing && <Button type="button" variant="secondary" text={tManager('cancelEdit')} onClick={() => startEdit(null)} />}
                        </div>
                    </form>
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Modal.Actions>
                    <Button type="button" variant="secondary" text={tManager('done')} onClick={() => onOpenChange(false)} />
                </Modal.Actions>
            </Modal.Footer>
        </Modal>
    );
}
