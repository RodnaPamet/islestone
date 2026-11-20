'use client';

/**
 * A project's milestones (sub-phase 2.5b): each milestone in the project's
 * order with its due date, its progress (done of scope, cancelled items left
 * out) and a "late" mark, linking to the milestone's page. A viewer the
 * server offers `manageMilestones` may create, rename, re-date, move up or
 * down and delete (through the undo toast) while the project is not
 * archived. The list is the server's (`GET /projects/:id/milestones`), read
 * again after every write.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "UI touch points").
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { Plus } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { MilestoneAffordances, MilestoneData } from '@/lib/work-items/types';

import { MilestoneDialog } from './MilestoneDialog';
import { useMilestones, useMilestoneWrites } from './use-milestones';

export function milestonePercent(m: Pick<MilestoneData, 'progress'>): number {
    return m.progress.scope === 0 ? 0 : Math.round((m.progress.done / m.progress.scope) * 100);
}

export function MilestoneProgressBar({ milestone }: { milestone: MilestoneData }) {
    const tBar = useTranslations('milestones');
    const done = milestonePercent(milestone);
    return (
        <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={done}
            aria-label={tBar('progressAria', { name: milestone.name, percent: done })}
        >
            <div className="h-full bg-content-success" style={{ width: `${done}%` }} />
        </div>
    );
}

function MilestoneRow({
    milestone,
    href,
    editable,
    first,
    last,
    onEdit,
    onUp,
    onDown,
    onDelete,
}: {
    milestone: MilestoneData;
    href: string;
    editable: boolean;
    first: boolean;
    last: boolean;
    onEdit: () => void;
    onUp: () => void;
    onDown: () => void;
    onDelete: () => void;
}) {
    const tRow = useTranslations('milestones');
    const complete = milestone.progress.scope > 0 && milestone.progress.done === milestone.progress.scope;
    return (
        <li className="space-y-tight border-t border-border-subtle py-3 first:border-t-0" data-testid={`milestone-${milestone.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-tight">
                <div className="min-w-0">
                    <Link href={href} className="text-sm font-medium text-content-emphasis hover:underline">
                        {milestone.name}
                    </Link>
                    <p className="text-xs text-content-muted">
                        {milestone.dueDate ? tRow('due', { date: milestone.dueDate }) : tRow('noDueDate')}
                        {milestone.late && <span className="ml-2 font-medium text-content-error">{tRow('late')}</span>}
                        {complete && <span className="ml-2 font-medium text-content-success">{tRow('complete')}</span>}
                    </p>
                </div>
                <div className="flex items-center gap-tight text-xs text-content-muted">
                    <span>{tRow('progress', { done: milestone.progress.done, scope: milestone.progress.scope })}</span>
                    {editable && (
                        <>
                            <Button variant="ghost" size="sm" text={tRow('moveUp')} aria-label={tRow('moveUpNamed', { name: milestone.name })} disabled={first} onClick={onUp} />
                            <Button variant="ghost" size="sm" text={tRow('moveDown')} aria-label={tRow('moveDownNamed', { name: milestone.name })} disabled={last} onClick={onDown} />
                            <Button variant="ghost" size="sm" text={tRow('rowEdit')} aria-label={tRow('editNamed', { name: milestone.name })} onClick={onEdit} />
                            <Button variant="ghost" size="sm" text={tRow('rowDelete')} aria-label={tRow('deleteNamed', { name: milestone.name })} onClick={onDelete} />
                        </>
                    )}
                </div>
            </div>
            <MilestoneProgressBar milestone={milestone} />
        </li>
    );
}

export function MilestonesView({
    project,
    initialMilestones,
    affordances,
}: {
    project: { id: string; name: string; keyPrefix: string; archived: boolean };
    initialMilestones: MilestoneData[];
    affordances: MilestoneAffordances;
}) {
    const t = useTranslations('milestones');
    const tenantHref = useTenantHref();
    const { data } = useMilestones(project.id, initialMilestones);
    const writes = useMilestoneWrites(project.id);
    const milestones = useMemo(() => data ?? initialMilestones, [data, initialMilestones]);
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<MilestoneData | null>(null);
    const editable = affordances.manageMilestones && !project.archived;
    const base = `/projects/${encodeURIComponent(project.keyPrefix)}`;

    return (
        <DashboardLayout
            header={{
                title: t('title'),
                description: t('description', { project: project.name }),
                actions: editable ? <Button variant="primary" icon={<Plus />} text={t('new')} onClick={() => setCreating(true)} /> : undefined,
            }}
            data-testid="milestones-page"
        >
            <section aria-labelledby="milestones-list" className="space-y-default">
                <h2 id="milestones-list" className="text-lg font-semibold text-content-emphasis">
                    {t('listHeading')}
                </h2>
                {project.archived && <p className="text-sm text-content-muted">{t('archived')}</p>}
                {milestones.length === 0 ? (
                    <p className="text-sm text-content-muted">{editable ? t('emptyEditable') : t('empty')}</p>
                ) : (
                    <ul>
                        {milestones.map((m, i) => (
                            <MilestoneRow
                                key={m.id}
                                milestone={m}
                                href={tenantHref(`${base}/milestones/${m.id}`)}
                                editable={editable}
                                first={i === 0}
                                last={i === milestones.length - 1}
                                onEdit={() => setEditing(m)}
                                onUp={() => void writes.move(m.id, { beforeId: milestones[i - 1]!.id })}
                                onDown={() => void writes.move(m.id, { afterId: milestones[i + 1]!.id })}
                                onDelete={() => writes.remove(m, milestones)}
                            />
                        ))}
                    </ul>
                )}
            </section>
            {editable && (
                <>
                    <MilestoneDialog open={creating} onOpenChange={setCreating} projectId={project.id} />
                    <MilestoneDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} projectId={project.id} milestone={editing ?? undefined} />
                </>
            )}
        </DashboardLayout>
    );
}
