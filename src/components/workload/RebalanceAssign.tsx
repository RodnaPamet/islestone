'use client';

/**
 * "Assign to Ana" from the ways to rebalance (sub-phase 3.5c; owner decision
 * 299): the item's assign picker with the person already chosen, then the
 * existing assign write (`useWorkItemMutations().assign`: `POST
 * …/assign` with `If-Match`; `work_items.assign`, field sets, the audit entry
 * and the bells are the route's). The person may choose someone else or
 * cancel; nothing is written until they confirm. A work-item write re-reads
 * every mounted workload read, so the grid and the open week follow.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Modal } from '@/components/ui/modal';
import { useWorkItem } from '@/components/work-items/data/use-work-item-collab';
import { useWorkItemMutations } from '@/components/work-items/data/use-work-item-mutations';
import { AssigneePicker } from '@/components/work-items/pickers';
import type { WorkloadRebalanceItem } from '@/lib/workload/types';

import { hoursText } from './workload-model';

export interface RebalanceAssignRequest {
    item: WorkloadRebalanceItem;
    userId: string;
}

export function RebalanceAssign({ request, onDone }: { request: RebalanceAssignRequest; onDone: () => void }) {
    const tAssign = useTranslations('workload.rebalance.assign');
    const { data: row, error } = useWorkItem(request.item.id);
    const mutations = useWorkItemMutations();
    const [assigneeId, setAssigneeId] = useState<string | null>(request.userId);
    const [saving, setSaving] = useState(false);
    const suggested = request.item.assignTo.find((a) => a.userId === request.userId);
    const title = tAssign('title', { key: request.item.key });

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!row || !assigneeId || assigneeId === row.assigneeId) return;
        setSaving(true);
        try {
            await mutations.assign(row, assigneeId);
        } finally {
            setSaving(false);
            onDone();
        }
    };

    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onDone();
            }}
            title={title}
            onClose={onDone}
        >
            <Modal.Header title={title} description={request.item.title} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    {error && (
                        <p role="alert" className="text-sm text-content-error">
                            {tAssign('loadFailed')}
                        </p>
                    )}
                    {!row && !error && <p className="text-sm text-content-muted">{tAssign('loading', { key: request.item.key })}</p>}
                    {row && (
                        <FormField label={tAssign('assignee')} description={suggested ? tAssign('hint', { name: suggested.name ?? tAssign('someone'), hours: hoursText(suggested.freeMinutes) }) : undefined}>
                            <AssigneePicker id="workload-rebalance-assignee" value={assigneeId} onChange={setAssigneeId} label={tAssign('assignee')} />
                        </FormField>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" text={tAssign('cancel')} onClick={onDone} />
                        <Button
                            id="workload-rebalance-assign"
                            type="submit"
                            variant="primary"
                            text={tAssign('confirm')}
                            loading={saving}
                            disabled={!row || !assigneeId || assigneeId === row.assigneeId}
                        />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
