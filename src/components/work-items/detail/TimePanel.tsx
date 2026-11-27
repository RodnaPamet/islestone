'use client';

/**
 * An item's Time panel (sub-phase 3.4b; owner decisions 260 to 267) on the
 * detail's Overview, page and sheet: "Time spent" (everyone's, for a
 * `time.view` holder; one's own otherwise) beside an hours estimate, "Add
 * time", "Start timer" (or "Timer on" with Stop when the caller's timer is on
 * this item), and the entries newest first, each one's own with Edit and
 * Delete (through the undo toast). Every button follows the GET's `viewer`,
 * asked on the server; nothing here asks a role or a key.
 *
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { TimeEntryDialog, type TimeEntryDraft } from '@/components/time/TimeEntryDialog';
import { useRegisterPaletteTimerAction } from '@/components/command-palette/workspace-access';
import { useRunningTimer, useTimeWrites } from '@/components/time/data/use-time';
import { formatDay, todayKey } from '@/components/time/time-format';
import { usePermissions, useTenantContext } from '@/lib/tenant-context-provider';
import type { TimeEntryData, WorkItemTimeData } from '@/lib/time/entries';
import { formatDuration } from '@/lib/work-items/estimate';

import { useWorkItemTime } from '../data/use-work-item-time';

type PanelEntry = WorkItemTimeData['entries'][number];

function EntriesPage({
    itemId,
    cursor,
    viewerId,
    onEdit,
    onDelete,
    onMore,
    isLast,
}: {
    itemId: string;
    cursor?: string;
    viewerId: string;
    onEdit: (entry: PanelEntry) => void;
    onDelete: (entry: PanelEntry) => void;
    onMore: (cursor: string) => void;
    isLast: boolean;
}) {
    const tEntries = useTranslations('workItems.time');
    const { data } = useWorkItemTime(itemId, cursor);
    if (!data) return null;
    return (
        <>
            {data.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-default gap-y-1 py-1 text-sm" data-testid="time-entry-row">
                    <span className="text-content-emphasis">{e.personName ?? tEntries('someone')}</span>
                    <span className="text-content-muted">{formatDay(e.workDate, 'date')}</span>
                    <span className="font-medium tabular-nums">{formatDuration(e.minutes ?? 0)}</span>
                    {e.billable && <span className="text-xs text-content-muted">{tEntries('billable')}</span>}
                    {e.description && <span className="w-full whitespace-pre-wrap text-content-default">{e.description}</span>}
                    {e.userId === viewerId && data.viewer.track && (
                        <span className="flex gap-tight">
                            <Button variant="ghost" size="sm" text={tEntries('edit')} onClick={() => onEdit(e)} />
                            <Button variant="ghost" size="sm" text={tEntries('delete')} onClick={() => onDelete(e)} />
                        </span>
                    )}
                </li>
            ))}
            {isLast && data.pageInfo.hasNextPage && data.pageInfo.nextCursor && (
                <li>
                    <Button variant="ghost" size="sm" text={tEntries('loadMore')} onClick={() => onMore(data.pageInfo.nextCursor!)} />
                </li>
            )}
        </>
    );
}

export function TimePanel({ itemId, itemKey, estimateMinutes }: { itemId: string; itemKey: string; estimateMinutes: number | null }) {
    const tTime = useTranslations('workItems.time');
    const { userId: viewerId } = useTenantContext();
    // The shell's own gate (the sidebar's): a caller who records no time never polls the timer route.
    const tracks = usePermissions().time?.track === true;
    const { data, error } = useWorkItemTime(itemId);
    const timer = useRunningTimer(tracks).data?.timer ?? null;
    const writes = useTimeWrites();
    const [cursors, setCursors] = useState<string[]>([]);
    const [adding, setAdding] = useState(false);
    const [editing, setEditing] = useState<TimeEntryData | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const timerHere = Boolean(timer && timer.entry.workItemId === itemId);
    // The palette's "Start timer on ISL-12" while this panel offers one (3.4b).
    const startAction = useMemo(
        () => (data?.viewer.track && !timerHere ? { key: itemKey, run: () => void writes.startTimer(itemId) } : null),
        [data?.viewer.track, timerHere, itemKey, itemId, writes],
    );
    useRegisterPaletteTimerAction('start', startAction);

    // A caller who may see no time gets nothing (a 403): the panel stays out of the way.
    if (error || !data) return null;
    const spent = data.totalMinutes ?? data.ownMinutes;

    const save = async (draft: TimeEntryDraft & { minutes: number }, entry?: TimeEntryData): Promise<string | null> => {
        const body = { workDate: draft.workDate, minutes: draft.minutes, billable: draft.billable, description: draft.description.trim() || null };
        const out = entry ? await writes.change(entry, body) : await writes.add({ workItemId: itemId, ...body });
        return out instanceof Error ? (out.reason ?? tTime('failed')) : null;
    };

    const start = async () => {
        const out = await writes.startTimer(itemId);
        setNotice(out instanceof Error ? (out.reason ?? tTime('failed')) : null);
    };
    const stop = async () => {
        const out = await writes.stopTimer();
        setNotice(out instanceof Error ? (out.reason ?? tTime('failed')) : out.discarded ? tTime('discarded') : null);
    };

    return (
        <section aria-labelledby={`time-${itemId}`} className="space-y-tight" data-testid="time-panel">
            <h2 id={`time-${itemId}`} className="text-sm font-semibold text-content-emphasis">
                {tTime('heading')}
            </h2>
            <p className="text-sm text-content-default" data-testid="time-summary">
                {data.totalMinutes === null ? tTime('yourTime', { spent: formatDuration(spent) }) : tTime('spent', { spent: formatDuration(spent) })}
                {estimateMinutes !== null && <span className="text-content-muted"> · {tTime('estimate', { estimate: formatDuration(estimateMinutes) })}</span>}
            </p>
            {data.viewer.track && (
                <div className="flex flex-wrap items-center gap-tight">
                    <Button variant="secondary" size="sm" text={tTime('add')} onClick={() => setAdding(true)} />
                    {timerHere ? (
                        <>
                            <span className="text-sm text-content-emphasis" role="status">
                                {tTime('timerOn')}
                            </span>
                            <Button variant="secondary" size="sm" text={tTime('stopTimer')} onClick={() => void stop()} />
                        </>
                    ) : (
                        <Button variant="ghost" size="sm" text={tTime('startTimer')} onClick={() => void start()} />
                    )}
                </div>
            )}
            {notice && (
                <p role="status" className="text-xs text-content-muted">
                    {notice}
                </p>
            )}
            {data.entries.length === 0 ? (
                <p className="text-sm text-content-muted">{tTime('none')}</p>
            ) : (
                <ul className="divide-y divide-border-subtle" aria-label={tTime('entries', { key: itemKey })}>
                    {[undefined, ...cursors].map((c, i, all) => (
                        <EntriesPage
                            key={c ?? 'first'}
                            itemId={itemId}
                            cursor={c}
                            viewerId={viewerId}
                            onEdit={setEditing}
                            onDelete={(e) => writes.remove(e)}
                            onMore={(next) => setCursors((list) => [...list, next])}
                            isLast={i === all.length - 1}
                        />
                    ))}
                </ul>
            )}
            {adding && (
                <TimeEntryDialog
                    open
                    onOpenChange={setAdding}
                    title={tTime('addTitle', { key: itemKey })}
                    initial={{ workItem: null, workDate: todayKey(), minutes: null, billable: false, description: '' }}
                    onSave={(d) => save(d)}
                />
            )}
            {editing && (
                <TimeEntryDialog
                    open
                    onOpenChange={(o) => !o && setEditing(null)}
                    title={tTime('editTitle', { key: itemKey })}
                    initial={{ workItem: null, workDate: editing.workDate, minutes: editing.minutes, billable: editing.billable, description: editing.description ?? '' }}
                    onSave={(d) => save(d, editing)}
                />
            )}
        </section>
    );
}
