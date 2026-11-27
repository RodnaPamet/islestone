'use client';

/**
 * The triage dialogs of the Intake page (sub-phase 2.6a; owner decision 90):
 * accept (the item's type, state, priority, assignee and project, read from
 * the server's view configuration), decline (a reason, an explanation for
 * the requester and an internal remark), merge (into a work item by its key,
 * or into another open request), snooze (until a date after today) and move.
 * Each sends the version the person read; the server's refusal is shown in
 * the dialog.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { useWorkConfig } from '@/components/work-items/data/use-work-config';
import { AssigneePicker, GoalPicker, MilestonePicker, PriorityPicker, StatePicker, TypePicker, WaitingOnPicker } from '@/components/work-items/pickers';
import { useProjectCustomFields } from '@/components/work-items/data/use-custom-fields';
import { useFieldSet } from '@/components/work-items/data/use-field-sets';
import { EstimateInput } from '@/components/work-items/fields/EstimateInput';
import { estimateColumnOf } from '@/lib/work-items/estimate';
import { requirementOf, type FieldKey } from '@/lib/work-items/field-sets';
import { apiGet } from '@/lib/data/api-client';
import { INTAKE_DECLINE_REASONS, type IntakeDeclineReason, type IntakeRequestDetail, type IntakeRequestRow } from '@/lib/intake/types';
import { useTenantApiUrl } from '@/lib/tenant-context-provider';
import type { WorkItemPriority } from '@/lib/work-items/types';

import { intakeRefusal, useIntakeApi } from './data/intake-data';

export type IntakeDialogKind = 'accept' | 'decline' | 'merge' | 'snooze' | 'move';

interface DialogProps {
    request: IntakeRequestDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (next: IntakeRequestDetail) => void;
}

function AcceptDialog({ request, open, onOpenChange, onDone }: DialogProps) {
    const tAccept = useTranslations('intake.accept');
    const config = useWorkConfig();
    const { send } = useIntakeApi();
    const liveProjects = useMemo(() => config.projects.filter((p) => !p.archived), [config]);
    const [projectId, setProjectId] = useState(request.projectId);
    const teamId = config.projectById.get(projectId)?.teamId ?? '';
    const openStates = config.statesOfTeam(teamId).filter((s) => s.category === 'BACKLOG' || s.category === 'UNSTARTED');
    const [typeId, setTypeId] = useState(config.types[0]?.id ?? '');
    const [stateId, setStateId] = useState('');
    const [priority, setPriority] = useState<WorkItemPriority>('NONE');
    const [assigneeId, setAssigneeId] = useState<string | null>(null);
    // The type's field set (2.4b-b), read from the server: hidden fields are
    // not offered, required ones are marked, and the fields a type may
    // require beyond these (who it waits on, dates, milestone) are offered
    // when it requires them. The server checks the same rules.
    const [waitingOnUserId, setWaitingOnUserId] = useState<string | null>(null);
    const [dueDate, setDueDate] = useState<string | null>(null);
    const [startDate, setStartDate] = useState<string | null>(null);
    const [milestoneId, setMilestoneId] = useState<string | null>(null);
    const [goalId, setGoalId] = useState<string | null>(null);
    const [estimate, setEstimate] = useState<number | null>(null);
    // The estimate (3.4a), in the target project's team's unit, when the type requires it.
    const estimateUnit = config.estimateUnitOfProject(projectId) ?? null;
    const projectFields = useProjectCustomFields(projectId);
    const fieldSet = useFieldSet(typeId || undefined, projectId, projectFields.filter((f) => !f.archived).map((f) => f.id));
    const offered = (key: FieldKey) => requirementOf(fieldSet, key) !== 'HIDDEN';
    const isRequired = (key: FieldKey) => requirementOf(fieldSet, key) === 'REQUIRED';
    const projectOptions = liveProjects.map((p) => ({ value: p.id, label: `${p.name} (${p.keyPrefix})` }));
    const stateValue = openStates.some((s) => s.id === stateId) ? stateId : (openStates.find((s) => s.isDefault) ?? openStates[0])?.id ?? '';

    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tAccept('title')}
            description={tAccept('description', { title: request.title })}
            submitLabel={tAccept('submit')}
            submitDisabled={!typeId}
            onSubmit={async () => {
                try {
                    const next = await send<IntakeRequestDetail>(
                        'POST',
                        `/intake/requests/${encodeURIComponent(request.id)}/accept`,
                        {
                            typeId,
                            priority,
                            ...(projectId !== request.projectId ? { projectId } : {}),
                            ...(stateValue ? { stateId: stateValue } : {}),
                            ...(assigneeId && offered('assignee') ? { assigneeId } : {}),
                            ...(waitingOnUserId && isRequired('waitingOn') ? { waitingOnUserId } : {}),
                            ...(dueDate && isRequired('dueDate') ? { dueDate } : {}),
                            ...(startDate && isRequired('startDate') ? { startDate } : {}),
                            ...(milestoneId && isRequired('milestone') ? { milestoneId } : {}),
                            ...(goalId && isRequired('goal') ? { goalId } : {}),
                            ...(estimate !== null && estimateUnit && isRequired('estimate') ? { [estimateColumnOf(estimateUnit)]: estimate } : {}),
                        },
                        request.version,
                    );
                    onDone(next);
                    return null;
                } catch (err) {
                    return intakeRefusal(err, tAccept('failed'));
                }
            }}
        >
            <FormField label={tAccept('project')}>
                <Combobox
                    id="intake-accept-project"
                    selected={projectOptions.find((o) => o.value === projectId) ?? null}
                    setSelected={(o) => o && setProjectId(o.value)}
                    options={projectOptions}
                    caret
                />
            </FormField>
            <FormField label={tAccept('type')}>
                <TypePicker id="intake-accept-type" value={typeId} onChange={setTypeId} />
            </FormField>
            <FormField label={tAccept('state')} description={tAccept('stateHint')}>
                <StatePicker id="intake-accept-state" teamId={teamId} value={stateValue} onChange={setStateId} />
            </FormField>
            {offered('priority') && (
                <FormField label={tAccept('priority')} required={isRequired('priority')}>
                    <PriorityPicker id="intake-accept-priority" value={priority} onChange={setPriority} />
                </FormField>
            )}
            {offered('assignee') && (
                <FormField label={tAccept('assignee')} required={isRequired('assignee')}>
                    <AssigneePicker id="intake-accept-assignee" value={assigneeId} onChange={setAssigneeId} />
                </FormField>
            )}
            {isRequired('waitingOn') && (
                <FormField label={tAccept('waitingOn')} required>
                    <WaitingOnPicker id="intake-accept-waiting-on" value={waitingOnUserId} onChange={setWaitingOnUserId} />
                </FormField>
            )}
            {isRequired('dueDate') && (
                <FormField label={tAccept('dueDate')} required>
                    <DatePicker id="intake-accept-due" value={parseYMD(dueDate)} onChange={(d) => setDueDate(toYMD(d))} clearable />
                </FormField>
            )}
            {isRequired('startDate') && (
                <FormField label={tAccept('startDate')} required>
                    <DatePicker id="intake-accept-start" value={parseYMD(startDate)} onChange={(d) => setStartDate(toYMD(d))} clearable />
                </FormField>
            )}
            {isRequired('milestone') && (
                <FormField label={tAccept('milestone')} required>
                    <MilestonePicker id="intake-accept-milestone" projectId={projectId} value={milestoneId} onChange={setMilestoneId} />
                </FormField>
            )}
            {isRequired('goal') && (
                <FormField label={tAccept('goal')} required>
                    <GoalPicker id="intake-accept-goal" value={goalId} onChange={setGoalId} />
                </FormField>
            )}
            {estimateUnit && isRequired('estimate') && (
                <FormField label={tAccept('estimate')} required>
                    <EstimateInput id="intake-accept-estimate" unit={estimateUnit} value={estimate} live onChange={setEstimate} />
                </FormField>
            )}
        </SettingsFormModal>
    );
}

function DeclineDialog({ request, open, onOpenChange, onDone, mayBlockSender }: DialogProps & { mayBlockSender: boolean }) {
    const tDecline = useTranslations('intake.decline');
    const tReason = useTranslations('intake.reason');
    const { send } = useIntakeApi();
    const [reason, setReason] = useState<IntakeDeclineReason>('NOT_PLANNED');
    const [explanation, setExplanation] = useState('');
    const [remark, setRemark] = useState('');
    const [blockSender, setBlockSender] = useState(false);
    // "Block this sender" (2.6c): a spam decline of a request with an address, offered under `intake.manage`.
    const offerBlock = reason === 'SPAM' && mayBlockSender && request.senderBlockable;
    const options = INTAKE_DECLINE_REASONS.map((r) => ({ value: r, label: tReason(r) }));
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tDecline('title')}
            description={tDecline('description', { title: request.title })}
            submitLabel={tDecline('submit')}
            onSubmit={async () => {
                try {
                    const next = await send<IntakeRequestDetail>(
                        'POST',
                        `/intake/requests/${encodeURIComponent(request.id)}/decline`,
                        { reason, explanation: explanation.trim() || null, remark: remark.trim() || null, ...(offerBlock && blockSender ? { blockSender: true } : {}) },
                        request.version,
                    );
                    onDone(next);
                    return null;
                } catch (err) {
                    return intakeRefusal(err, tDecline('failed'));
                }
            }}
        >
            <FormField label={tDecline('reason')}>
                <Combobox
                    id="intake-decline-reason"
                    selected={options.find((o) => o.value === reason) ?? null}
                    setSelected={(o) => o && setReason(o.value as IntakeDeclineReason)}
                    options={options}
                    caret
                />
            </FormField>
            {reason !== 'SPAM' && (
                <FormField label={tDecline('explanation')} description={tDecline('explanationHint')}>
                    <Textarea id="intake-decline-explanation" rows={3} maxLength={2000} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
                </FormField>
            )}
            <FormField label={tDecline('remark')} description={tDecline('remarkHint')}>
                <Textarea id="intake-decline-remark" rows={2} maxLength={2000} value={remark} onChange={(e) => setRemark(e.target.value)} />
            </FormField>
            {offerBlock && (
                <div className="flex items-start gap-tight">
                    <Checkbox id="intake-decline-block" checked={blockSender} onCheckedChange={(v) => setBlockSender(v === true)} />
                    <div className="space-y-tight">
                        <label htmlFor="intake-decline-block" className="text-sm text-content-emphasis">
                            {tDecline('blockSender')}
                        </label>
                        <p className="text-xs text-content-muted">{tDecline('blockSenderHint')}</p>
                    </div>
                </div>
            )}
        </SettingsFormModal>
    );
}

function MergeDialog({ request, open, onOpenChange, onDone, openRequests }: DialogProps & { openRequests: IntakeRequestRow[] }) {
    const tMerge = useTranslations('intake.merge');
    const { send } = useIntakeApi();
    const apiUrl = useTenantApiUrl();
    const [key, setKey] = useState('');
    const [targetRequestId, setTargetRequestId] = useState<string | null>(null);
    const requestOptions = openRequests.filter((r) => r.id !== request.id).map((r) => ({ value: r.id, label: r.title }));
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tMerge('title')}
            description={tMerge('description', { title: request.title })}
            submitLabel={tMerge('submit')}
            submitDisabled={!key.trim() && !targetRequestId}
            onSubmit={async () => {
                try {
                    let body: { workItemId: string } | { requestId: string };
                    if (key.trim()) {
                        const item = await apiGet<{ item?: { id: string }; id?: string }>(apiUrl(`/work-items/by-key/${encodeURIComponent(key.trim())}`));
                        const id = item.item?.id ?? item.id;
                        if (!id) return tMerge('notFound');
                        body = { workItemId: id };
                    } else {
                        body = { requestId: targetRequestId! };
                    }
                    const next = await send<IntakeRequestDetail>('POST', `/intake/requests/${encodeURIComponent(request.id)}/merge`, body, request.version);
                    onDone(next);
                    return null;
                } catch (err) {
                    return intakeRefusal(err, tMerge('failed'));
                }
            }}
        >
            <FormField label={tMerge('key')} description={tMerge('keyHint')}>
                <Input id="intake-merge-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder={tMerge('keyPlaceholder')} />
            </FormField>
            {requestOptions.length > 0 && (
                <FormField label={tMerge('request')}>
                    <Combobox
                        id="intake-merge-request"
                        selected={requestOptions.find((o) => o.value === targetRequestId) ?? null}
                        setSelected={(o) => setTargetRequestId(o?.value ?? null)}
                        options={requestOptions}
                        caret
                    />
                </FormField>
            )}
        </SettingsFormModal>
    );
}

function SnoozeDialog({ request, open, onOpenChange, onDone }: DialogProps) {
    const tSnooze = useTranslations('intake.snooze');
    const { send } = useIntakeApi();
    const tomorrow = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return toYMD(d) ?? '';
    }, []);
    const [until, setUntil] = useState<string>(tomorrow);
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tSnooze('title')}
            description={tSnooze('description', { title: request.title })}
            submitLabel={tSnooze('submit')}
            submitDisabled={!until}
            onSubmit={async () => {
                try {
                    const next = await send<IntakeRequestDetail>('POST', `/intake/requests/${encodeURIComponent(request.id)}/snooze`, { until }, request.version);
                    onDone(next);
                    return null;
                } catch (err) {
                    return intakeRefusal(err, tSnooze('failed'));
                }
            }}
        >
            <FormField label={tSnooze('until')}>
                <DatePicker id="intake-snooze-until" value={parseYMD(until)} onChange={(d) => setUntil(toYMD(d) ?? '')} />
            </FormField>
        </SettingsFormModal>
    );
}

function MoveDialog({ request, open, onOpenChange, onDone }: DialogProps) {
    const tMove = useTranslations('intake.move');
    const config = useWorkConfig();
    const { send } = useIntakeApi();
    const options = config.projects.filter((p) => !p.archived && p.id !== request.projectId).map((p) => ({ value: p.id, label: `${p.name} (${p.keyPrefix})` }));
    const [projectId, setProjectId] = useState<string | null>(null);
    return (
        <SettingsFormModal
            open={open}
            onOpenChange={onOpenChange}
            title={tMove('title')}
            description={tMove('description', { title: request.title })}
            submitLabel={tMove('submit')}
            submitDisabled={!projectId}
            onSubmit={async () => {
                try {
                    const next = await send<IntakeRequestDetail>('POST', `/intake/requests/${encodeURIComponent(request.id)}/move`, { projectId }, request.version);
                    onDone(next);
                    return null;
                } catch (err) {
                    return intakeRefusal(err, tMove('failed'));
                }
            }}
        >
            <FormField label={tMove('project')}>
                <Combobox
                    id="intake-move-project"
                    selected={options.find((o) => o.value === projectId) ?? null}
                    setSelected={(o) => setProjectId(o?.value ?? null)}
                    options={options}
                    caret
                />
            </FormField>
        </SettingsFormModal>
    );
}

export function IntakeDialog({ kind, openRequests, mayBlockSender, ...props }: DialogProps & { kind: IntakeDialogKind; openRequests: IntakeRequestRow[]; mayBlockSender: boolean }) {
    switch (kind) {
        case 'accept':
            return <AcceptDialog {...props} />;
        case 'decline':
            return <DeclineDialog {...props} mayBlockSender={mayBlockSender} />;
        case 'merge':
            return <MergeDialog {...props} openRequests={openRequests} />;
        case 'snooze':
            return <SnoozeDialog {...props} />;
        case 'move':
            return <MoveDialog {...props} />;
    }
}
