'use client';

/**
 * My time's status line for the week shown (sub-phase 3.4c;
 * docs/porting/maps/3.4.md, "Acts"; owner decisions 256, 268 to 270): "Not
 * submitted", "Submitted 24 Nov", "Approved by Ana", "Returned by Ana:
 * <explanation>" or "Taken back", with Submit or Take back as the server
 * offers them (`viewer`, asked by `GET /timesheets/week`). An empty week asks
 * a confirmation before it is submitted. Nothing shows while approval is off
 * and the week was never submitted.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/hooks';
import { ApiClientError } from '@/lib/data/api-client';
import type { TimesheetWeekData } from '@/lib/time/timesheets';

import { useTimesheetWrites } from './data/use-timesheets';
import { formatDay } from './time-format';

export function TimesheetStatusLine({ week }: { week: TimesheetWeekData }) {
    const t = useTranslations('time.status');
    const writes = useTimesheetWrites();
    const toast = useToast();
    const [confirmEmpty, setConfirmEmpty] = useState(false);
    const [busy, setBusy] = useState(false);
    const sheet = week.timesheet;
    if (!week.approvalRequired && !sheet) return null;

    const run = async (write: () => Promise<unknown>) => {
        setBusy(true);
        const out = await write();
        setBusy(false);
        if (out instanceof ApiClientError) toast.error(out.message || t('failed'));
    };
    const submit = () => run(() => writes.submit(week.weekStart));
    const onSubmit = () => (week.sums.entries === 0 ? setConfirmEmpty(true) : void submit());

    const when = (iso: string | null) => (iso ? formatDay(iso.slice(0, 10), 'date') : '');
    let text: string;
    switch (sheet?.status) {
        case 'SUBMITTED':
            text = t('submitted', { date: when(sheet.submittedAt) });
            break;
        case 'APPROVED':
            text = t('approved', { name: sheet.decidedByName ?? t('anApprover'), date: when(sheet.decidedAt) });
            break;
        case 'RETURNED':
            text = t('returned', { name: sheet.decidedByName ?? t('anApprover') });
            break;
        case 'WITHDRAWN':
            text = t('withdrawn');
            break;
        default:
            text = t('notSubmitted');
    }

    return (
        <div className="space-y-tight rounded-md border border-border-subtle p-3" data-testid="timesheet-status">
            <div className="flex flex-wrap items-center gap-default">
                <p className="text-sm font-medium text-content-emphasis" data-testid="timesheet-status-text">
                    {text}
                </p>
                {week.viewer.submit && <Button id="timesheet-submit" variant="primary" size="sm" text={t('submit')} loading={busy} onClick={onSubmit} />}
                {week.viewer.withdraw && sheet && <Button id="timesheet-withdraw" variant="secondary" size="sm" text={t('withdraw')} loading={busy} onClick={() => void run(() => writes.withdraw(sheet))} />}
            </div>
            {sheet?.status === 'RETURNED' && sheet.returnExplanation && (
                <p className="whitespace-pre-wrap text-sm text-content-default" data-testid="timesheet-explanation">
                    {sheet.returnExplanation}
                </p>
            )}
            {week.timerOn && week.approvalRequired && !week.frozen && <p className="text-xs text-content-muted">{t('timerOn')}</p>}
            {week.frozen && <p className="text-xs text-content-muted">{t('frozen')}</p>}
            <ConfirmDialog
                showModal={confirmEmpty}
                setShowModal={setConfirmEmpty}
                title={t('emptyTitle')}
                description={t('emptyBody')}
                confirmLabel={t('submit')}
                cancelLabel={t('cancel')}
                onConfirm={() => {
                    setConfirmEmpty(false);
                    void submit();
                }}
            />
        </div>
    );
}
