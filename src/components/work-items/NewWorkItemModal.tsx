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
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { useMayOpenSettings } from '@/components/layout/nav-config';
import { ApiClientError } from '@/lib/data/api-client';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { WorkItemDetailData, WorkItemPriority } from '@/lib/work-items/types';

import { MentionTextarea } from './mentions/MentionTextarea';
import { useWorkConfig } from './data/use-work-config';
import { useWorkItemMutations } from './data/use-work-item-mutations';
import { useItemTemplates } from './data/use-item-templates';
import { AssigneePicker, CyclePicker, GoalPicker, LabelsPicker, MilestonePicker, PriorityPicker, StatePicker, TypePicker, WaitingOnPicker } from './pickers';
import { useProjectCustomFields } from './data/use-custom-fields';
import { useFieldSet } from './data/use-field-sets';
import { CustomFieldInput } from './fields/CustomFieldInput';
import type { CustomFieldValueData } from '@/lib/work-items/custom-fields';
import { fieldSetGaps, requirementOf, type FieldKey } from '@/lib/work-items/field-sets';

export interface NewWorkItemInitial {
    projectId?: string;
    stateId?: string;
    parentId?: string;
    /** The cycle a new item joins (a cycle's page, 2.5a), when it is the project's team's. */
    cycleId?: string;
    /** The milestone a new item is aimed at (a milestone's page, 2.5b), when it is the project's. */
    milestoneId?: string;
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
    /** Who the new item waits on (2.4b); not sent into a closed state. */
    waitingOnUserId: string | null;
    /** A start date, offered when the type requires it (2.4b-b). */
    startDate: string | null;
    /** The type's required custom fields (2.4b-b): field id → value. */
    customFields: Record<string, CustomFieldValueData>;
    labelIds: string[];
    dueDate: string | null;
    cycleId: string | null;
    milestoneId: string | null;
    /** A goal the new item names directly (3.2a, decision 211). */
    goalId: string | null;
    /** The item template the form started from (2.5c), or none. */
    templateId: string | null;
}

/** The fields a template fills; once chosen, only what the person then changes is sent (the server applies the rest). */
const TEMPLATE_FIELDS = ['title', 'description', 'typeId', 'priority', 'assigneeId', 'labelIds', 'dueDate', 'milestoneId'] as const;

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
    // With no open project, a member who may open Settings is sent there
    // (decision 55); the sidebar's own rule, never restated here.
    const mayOpenSettings = useMayOpenSettings();
    const tenantHref = useTenantHref();

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
            waitingOnUserId: null,
            startDate: null,
            customFields: {},
            labelIds: [],
            dueDate: null,
            cycleId: initial?.cycleId && config.cycleById.get(initial.cycleId)?.teamId === teamId ? initial.cycleId : null,
            milestoneId: initial?.milestoneId && config.milestoneById.get(initial.milestoneId)?.projectId === projectId ? initial.milestoneId : null,
            goalId: null,
            templateId: null,
        };
    }, [config, initial, liveProjects]);

    const [form, setForm] = useState<FormState>(blank);
    // The fields the person changed since a template filled the form.
    const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
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
            setTouched(new Set());
            setError(null);
        }
        wasOpen.current = open;
    }, [open, blank]);

    const dirty = form.title.trim() !== '' || form.description.trim() !== '';
    const teamId = config.projectById.get(form.projectId)?.teamId ?? '';
    // A closed item waits on nobody (2.4b): the picker leaves, and its value is not sent.
    const stateCategory = config.stateById.get(form.stateId)?.category;
    const stateClosed = stateCategory === 'DONE' || stateCategory === 'CANCELLED';
    // The type's field set (2.4b-b), from the server's rules: a hidden field
    // is not offered, a required one is marked, and a create that leaves one
    // empty is stopped here with the same check the server makes.
    const projectFields = useProjectCustomFields(form.projectId || undefined);
    const liveFields = useMemo(() => projectFields.filter((f) => !f.archived && f.projectId === form.projectId), [projectFields, form.projectId]);
    const fieldSet = useFieldSet(form.typeId || undefined, form.projectId || undefined, liveFields.map((f) => f.id));
    const offered = (key: FieldKey) => requirementOf(fieldSet, key) !== 'HIDDEN';
    const isRequired = (key: FieldKey) => requirementOf(fieldSet, key) === 'REQUIRED';
    const requiredFields = liveFields.filter((f) => isRequired(`cf:${f.id}`));

    const requestClose = () => {
        if (dirty && !submitting) setConfirmDiscard(true);
        else onOpenChange(false);
    };

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((f) => ({ ...f, [key]: value }));
        setTouched((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
    };
    const { data: templates } = useItemTemplates(form.projectId || null);

    /** Fill the form from a template (2.5c); the server applies its sub-items and field values. */
    const applyTemplate = (templateId: string | null) => {
        const tpl = templateId ? (templates ?? []).find((x) => x.id === templateId) : undefined;
        setTouched(new Set());
        if (!tpl) {
            setForm((f) => ({ ...f, templateId: null }));
            return;
        }
        const due = tpl.dueInDays !== null ? new Date(Date.now() + tpl.dueInDays * 86_400_000) : null;
        setForm((f) => ({
            ...f,
            templateId: tpl.id,
            title: tpl.title,
            description: tpl.description ?? '',
            typeId: tpl.typeId ?? f.typeId,
            priority: tpl.priority,
            assigneeId: tpl.assigneeId,
            labelIds: tpl.labelIds,
            dueDate: due ? toYMD(due) : null,
        }));
    };

    const changeProject = (projectId: string) => {
        const team = config.projectById.get(projectId)?.teamId ?? '';
        const states = config.statesOfTeam(team);
        setForm((f) => ({
            ...f,
            projectId,
            stateId: (states.find((s) => s.isDefault) ?? states[0])?.id ?? '',
            // A cycle belongs to a team: another team's project clears it.
            cycleId: f.cycleId && config.cycleById.get(f.cycleId)?.teamId === team ? f.cycleId : null,
            // A milestone belongs to a project: another project clears it.
            milestoneId: f.milestoneId && config.milestoneById.get(f.milestoneId)?.projectId === projectId ? f.milestoneId : null,
            // A template belongs to a project.
            templateId: null,
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
        if (!stateClosed) {
            const gaps = fieldSetGaps(fieldSet, {
                description: form.description,
                assigneeId: form.assigneeId,
                waitingOnUserId: form.waitingOnUserId,
                priority: form.priority,
                labelIds: form.labelIds,
                startDate: form.startDate,
                dueDate: form.dueDate,
                cycleId: form.cycleId,
                milestoneId: form.milestoneId,
                goalId: form.goalId,
                customFields: form.customFields,
            });
            if (gaps.length > 0) {
                const name = (k: FieldKey) => (k.startsWith('cf:') ? (liveFields.find((f) => f.id === k.slice(3))?.name ?? k) : t(`fieldSet.field.${k}`));
                setError(t('fieldSet.missingBeforeCreate', { fields: gaps.map(name).join(', ') }));
                return;
            }
        }
        setSubmitting(true);
        setError(null);
        const full: Record<string, unknown> = {
            projectId: form.projectId,
            typeId: form.typeId,
            title: form.title.trim(),
            ...(form.description.trim() ? { description: form.description } : {}),
            ...(form.stateId ? { stateId: form.stateId } : {}),
            priority: form.priority,
            ...(form.assigneeId ? { assigneeId: form.assigneeId } : {}),
            ...(form.waitingOnUserId && !stateClosed ? { waitingOnUserId: form.waitingOnUserId } : {}),
            ...(form.labelIds.length ? { labelIds: form.labelIds } : {}),
            ...(form.dueDate ? { dueDate: form.dueDate } : {}),
            ...(form.startDate && offered('startDate') ? { startDate: form.startDate } : {}),
            ...(Object.keys(form.customFields).length ? { customFields: form.customFields } : {}),
            ...(form.cycleId ? { cycleId: form.cycleId } : {}),
            ...(form.milestoneId ? { milestoneId: form.milestoneId } : {}),
            ...(form.goalId ? { goalId: form.goalId } : {}),
            ...(initial?.parentId ? { parentId: initial.parentId } : {}),
        };
        // From a template, send it and only what the person changed: the
        // server fills the rest (and skips what no longer fits, naming it).
        const body: Record<string, unknown> = form.templateId
            ? Object.fromEntries(
                  Object.entries(full).filter(([k]) => !(TEMPLATE_FIELDS as readonly string[]).includes(k) || touched.has(k)),
              )
            : full;
        if (form.templateId) {
            body.templateId = form.templateId;
            if (touched.has('dueDate') && !form.dueDate) body.dueDate = null;
            if (touched.has('assigneeId') && !form.assigneeId) body.assigneeId = null;
            if (touched.has('labelIds') && form.labelIds.length === 0) body.labelIds = [];
            if (touched.has('description') && !form.description.trim()) body.description = null;
        }
        const result = await mutations.create(body);
        setSubmitting(false);
        if (result instanceof ApiClientError) {
            setError(result.reason ?? t('toast.failed'));
            return;
        }
        onOpenChange(false);
        onCreated?.(result);
    };

    const projectOptions = liveProjects.map((p) => ({ value: p.id, label: `${p.name} (${p.keyPrefix})` }));
    const templateOptions = [{ value: '', label: t('new.noTemplate') }, ...(templates ?? []).map((x) => ({ value: x.id, label: x.name }))];

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
                            {liveProjects.length === 0 && (
                                <p role="alert">
                                    {t('new.noProjects')}{' '}
                                    {mayOpenSettings && (
                                        <Link href={tenantHref('/settings/projects')} className="text-content-emphasis underline">
                                            {t('new.goSettings')}
                                        </Link>
                                    )}
                                </p>
                            )}
                            {(templates ?? []).length > 0 && (
                                <FormField label={t('fields.template')} description={form.templateId ? t('new.templateHint') : undefined}>
                                    <Combobox
                                        id="work-item-template-input"
                                        selected={templateOptions.find((o) => o.value === (form.templateId ?? '')) ?? null}
                                        setSelected={(o) => o && applyTemplate(o.value || null)}
                                        options={templateOptions}
                                        caret
                                        hideSearch
                                    />
                                </FormField>
                            )}
                            <FormField label={t('fields.title')} required>
                                <Input
                                    id="work-item-title-input"
                                    value={form.title}
                                    onChange={(e) => set('title', e.target.value)}
                                    autoFocus
                                    maxLength={500}
                                />
                            </FormField>
                            {offered('description') && (
                                <FormField label={t('fields.description')} required={isRequired('description')}>
                                    <MentionTextarea id="work-item-description-input" value={form.description} onValueChange={(v) => set('description', v)} rows={3} />
                                </FormField>
                            )}
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
                                {offered('priority') && (
                                    <FormField label={t('fields.priority')} required={isRequired('priority')}>
                                        <PriorityPicker id="work-item-priority-input" value={form.priority} onChange={(v) => set('priority', v)} />
                                    </FormField>
                                )}
                                {offered('assignee') && (
                                    <FormField label={t('fields.assignee')} required={isRequired('assignee')}>
                                        <AssigneePicker id="work-item-assignee-input" value={form.assigneeId} onChange={(v) => set('assigneeId', v)} />
                                    </FormField>
                                )}
                                {!stateClosed && offered('waitingOn') && (
                                    <FormField label={t('fields.waitingOn')} required={isRequired('waitingOn')}>
                                        <WaitingOnPicker id="work-item-waiting-on-input" value={form.waitingOnUserId} onChange={(v) => set('waitingOnUserId', v)} />
                                    </FormField>
                                )}
                                {offered('labels') && (
                                    <FormField label={t('fields.labels')} required={isRequired('labels')}>
                                        <LabelsPicker id="work-item-labels-input" teamId={teamId} value={form.labelIds} onChange={(v) => set('labelIds', v)} />
                                    </FormField>
                                )}
                                {offered('dueDate') && (
                                    <FormField label={t('fields.dueDate')} required={isRequired('dueDate')}>
                                        <DatePicker
                                            id="work-item-due-input"
                                            value={parseYMD(form.dueDate)}
                                            onChange={(d) => set('dueDate', toYMD(d))}
                                            clearable
                                        />
                                    </FormField>
                                )}
                                {isRequired('startDate') && (
                                    <FormField label={t('fields.startDate')} required>
                                        <DatePicker
                                            id="work-item-start-input"
                                            value={parseYMD(form.startDate)}
                                            onChange={(d) => set('startDate', toYMD(d))}
                                            clearable
                                        />
                                    </FormField>
                                )}
                                {config.openCyclesOfTeam(teamId).length > 0 && offered('cycle') && (
                                    <FormField label={t('fields.cycle')} required={isRequired('cycle')}>
                                        <CyclePicker id="work-item-cycle-input" teamId={teamId} value={form.cycleId} onChange={(v) => set('cycleId', v)} />
                                    </FormField>
                                )}
                                {requiredFields.map((field) => (
                                    <FormField key={field.id} label={field.name} required>
                                        <CustomFieldInput
                                            id={`work-item-cf-${field.id}-input`}
                                            field={field}
                                            value={form.customFields[field.id]}
                                            onChange={(value) => {
                                                const next = { ...form.customFields };
                                                if (value === null || value === false || value === '' || (Array.isArray(value) && value.length === 0)) delete next[field.id];
                                                else next[field.id] = value;
                                                set('customFields', next);
                                            }}
                                        />
                                    </FormField>
                                ))}
                                {config.milestonesOfProject(form.projectId).length > 0 && offered('milestone') && (
                                    <FormField label={t('fields.milestone')} required={isRequired('milestone')}>
                                        <MilestonePicker
                                            id="work-item-milestone-input"
                                            projectId={form.projectId}
                                            value={form.milestoneId}
                                            onChange={(v) => set('milestoneId', v)}
                                        />
                                    </FormField>
                                )}
                                {(config.goals ?? []).length > 0 && offered('goal') && (
                                    <FormField label={t('fields.goal')} required={isRequired('goal')}>
                                        <GoalPicker id="work-item-goal-input" value={form.goalId} onChange={(v) => set('goalId', v)} />
                                    </FormField>
                                )}
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
