'use client';

/**
 * Create a work item: title, project (unless the view fixes it), type,
 * state, priority, assignee, labels, due date and parent (prefilled by the
 * sub-items table). The server's refusal is shown in the dialog with the
 * text kept; closing a dirty form asks first.
 *
 * Copied from inflect-compliance `src/app/t/[tenantSlug]/(app)/tasks/NewTaskModal.tsx`,
 * `_form/useNewTaskForm.ts` and `_form/NewTaskFields.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3) and rewritten to
 * the map's cuts: no staged entity links, no severity, reviewer, finding
 * source or gap type; the fields are 2.2's `CreateWorkItemSchema`; the
 * discard guard (`ConfirmDialog`) and the "refused create keeps the text"
 * behaviour kept. The created row reaches every list through the shared
 * cache (`useWorkItemMutations().create`).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { ApiClientError } from '@/lib/data/api-client';
import type { WorkItemDetailData, WorkItemPriority } from '@/lib/work-items/types';

import { useWorkConfig } from './data/use-work-config';
import { useWorkItemMutations } from './data/use-work-item-mutations';
import { AssigneePicker, LabelsPicker, PriorityPicker, StatePicker, TypePicker } from './pickers';

export interface NewWorkItemInitial {
    projectId?: string;
    stateId?: string;
    parentId?: string;
    /** Shown above the form when a parent is preset. */
    parentKey?: string;
}

interface FormState {
    title: string;
    description: string;
    projectId: string;
    typeId: string;
    stateId: string;
    priority: WorkItemPriority;
    assigneeId: string | null;
    labelIds: string[];
    dueDate: string | null;
}

export function NewWorkItemModal({
    open,
    onOpenChange,
    initial,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initial?: NewWorkItemInitial;
    onCreated?: (item: WorkItemDetailData) => void;
}) {
    const t = useTranslations('workItems');
    const config = useWorkConfig();
    const mutations = useWorkItemMutations();
    const liveProjects = useMemo(() => config.projects.filter((p) => !p.archived), [config]);

    const blank = useMemo<FormState>(() => {
        const projectId = initial?.projectId ?? liveProjects[0]?.id ?? '';
        const teamId = config.projectById.get(projectId)?.teamId ?? '';
        const states = config.statesOfTeam(teamId);
        const stateId = initial?.stateId ?? (states.find((s) => s.isDefault) ?? states[0])?.id ?? '';
        return {
            title: '',
            description: '',
            projectId,
            typeId: config.types[0]?.id ?? '',
            stateId,
            priority: 'NONE',
            assigneeId: null,
            labelIds: [],
            dueDate: null,
        };
    }, [config, initial, liveProjects]);

    const [form, setForm] = useState<FormState>(blank);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [confirmDiscard, setConfirmDiscard] = useState(false);

    // A new opening starts from the view's preset (a board column's "+"):
    // reset on the closed-to-open transition only, never while the person
    // types.
    const wasOpen = useRef(false);
    useEffect(() => {
        if (open && !wasOpen.current) {
            setForm(blank);
            setError(null);
        }
        wasOpen.current = open;
    }, [open, blank]);

    const dirty = form.title.trim() !== '' || form.description.trim() !== '';
    const teamId = config.projectById.get(form.projectId)?.teamId ?? '';

    const requestClose = () => {
        if (dirty && !submitting) setConfirmDiscard(true);
        else onOpenChange(false);
    };

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

    const changeProject = (projectId: string) => {
        const team = config.projectById.get(projectId)?.teamId ?? '';
        const states = config.statesOfTeam(team);
        setForm((f) => ({
            ...f,
            projectId,
            stateId: (states.find((s) => s.isDefault) ?? states[0])?.id ?? '',
            labelIds: f.labelIds.filter((id) => {
                const label = config.labelById.get(id);
                return !!label && (label.teamId === null || label.teamId === team);
            }),
        }));
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!form.title.trim()) {
            setError(t('new.titleRequired'));
            return;
        }
        setSubmitting(true);
        setError(null);
        const result = await mutations.create({
            projectId: form.projectId,
            typeId: form.typeId,
            title: form.title.trim(),
            ...(form.description.trim() ? { description: form.description } : {}),
            ...(form.stateId ? { stateId: form.stateId } : {}),
            priority: form.priority,
            ...(form.assigneeId ? { assigneeId: form.assigneeId } : {}),
            ...(form.labelIds.length ? { labelIds: form.labelIds } : {}),
            ...(form.dueDate ? { dueDate: form.dueDate } : {}),
            ...(initial?.parentId ? { parentId: initial.parentId } : {}),
        });
        setSubmitting(false);
        if (result instanceof ApiClientError) {
            setError(result.reason ?? t('toast.failed'));
            return;
        }
        onOpenChange(false);
        onCreated?.(result);
    };

    const projectOptions = liveProjects.map((p) => ({ value: p.id, label: `${p.name} (${p.keyPrefix})` }));

    return (
        <>
            <Modal
                showModal={open}
                setShowModal={(v) => {
                    const next = typeof v === 'function' ? v(open) : v;
                    if (!next) requestClose();
                }}
                title={t('new.title')}
                preventDefaultClose={dirty}
                onClose={requestClose}
            >
                <Modal.Header title={t('new.title')} description={initial?.parentKey ? t('new.subItemOf', { key: initial.parentKey }) : undefined} />
                <Modal.Form onSubmit={submit}>
                    <Modal.Body>
                        <div className="space-y-default">
                            {liveProjects.length === 0 && <p role="alert">{t('new.noProjects')}</p>}
                            <FormField label={t('fields.title')} required>
                                <Input
                                    id="work-item-title-input"
                                    value={form.title}
                                    onChange={(e) => set('title', e.target.value)}
                                    autoFocus
                                    maxLength={500}
                                />
                            </FormField>
                            <FormField label={t('fields.description')}>
                                <Textarea id="work-item-description-input" value={form.description} onChange={(e) => set('description', e.target.value)} rows={3} />
                            </FormField>
                            {!initial?.projectId && (
                                <FormField label={t('fields.project')}>
                                    <Combobox
                                        id="work-item-project-input"
                                        selected={projectOptions.find((o) => o.value === form.projectId) ?? null}
                                        setSelected={(o) => o && changeProject(o.value)}
                                        options={projectOptions}
                                        caret
                                    />
                                </FormField>
                            )}
                            <div className="grid grid-cols-1 gap-default sm:grid-cols-2">
                                <FormField label={t('fields.type')}>
                                    <TypePicker id="work-item-type-input" value={form.typeId} onChange={(v) => set('typeId', v)} />
                                </FormField>
                                <FormField label={t('fields.state')}>
                                    <StatePicker id="work-item-state-input" teamId={teamId} value={form.stateId} onChange={(v) => set('stateId', v)} />
                                </FormField>
                                <FormField label={t('fields.priority')}>
                                    <PriorityPicker id="work-item-priority-input" value={form.priority} onChange={(v) => set('priority', v)} />
                                </FormField>
                                <FormField label={t('fields.assignee')}>
                                    <AssigneePicker id="work-item-assignee-input" value={form.assigneeId} onChange={(v) => set('assigneeId', v)} />
                                </FormField>
                                <FormField label={t('fields.labels')}>
                                    <LabelsPicker id="work-item-labels-input" teamId={teamId} value={form.labelIds} onChange={(v) => set('labelIds', v)} />
                                </FormField>
                                <FormField label={t('fields.dueDate')}>
                                    <DatePicker
                                        id="work-item-due-input"
                                        value={parseYMD(form.dueDate)}
                                        onChange={(d) => set('dueDate', toYMD(d))}
                                        clearable
                                    />
                                </FormField>
                            </div>
                            {error && (
                                <p role="alert" className="text-sm text-content-error">
                                    {error}
                                </p>
                            )}
                        </div>
                    </Modal.Body>
                    <Modal.Footer>
                        <Modal.Actions>
                            <Button type="button" variant="secondary" onClick={requestClose} text={t('new.cancel')} />
                            <Button
                                type="submit"
                                variant="primary"
                                loading={submitting}
                                disabled={liveProjects.length === 0}
                                text={t('new.submit')}
                            />
                        </Modal.Actions>
                    </Modal.Footer>
                </Modal.Form>
            </Modal>
            <ConfirmDialog
                showModal={confirmDiscard}
                setShowModal={setConfirmDiscard}
                title={t('new.discardTitle')}
                description={t('new.discardBody')}
                tone="warning"
                confirmLabel={t('new.discardConfirm')}
                cancelLabel={t('new.keepEditing')}
                onConfirm={() => {
                    setConfirmDiscard(false);
                    onOpenChange(false);
                }}
            />
        </>
    );
}
