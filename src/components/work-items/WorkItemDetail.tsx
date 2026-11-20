'use client';

/**
 * A work item's detail, as a full page (`variant="page"`, inside
 * `EntityDetailLayout` with the prev/next stepper) and as the sheet the list
 * and the board open (`variant="sheet"`). Both render this one component and
 * read the same SWR keys (`useWorkItem` and the item's sub-resources), so a
 * change made in either is the other's at once, and in every list.
 *
 * Every field write is optimistic, versioned (`If-Match`) and rolled back on
 * refusal (`useWorkItemMutations`); a delete leaves every view at once and is
 * sent when the undo window closes.
 *
 * Copied in structure from inflect-compliance
 * `src/app/t/[tenantSlug]/(app)/tasks/[taskId]/page.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 2.3): the SWR query per
 * section, assign, watchers, delete after navigating away, comments,
 * activity and the prev/next stepper kept; the body extracted so the sheet
 * and the page share it; evidence, the reviewer, the checklist, the
 * resolution prompt, the source banner and the compliance links cut.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { EntityDetailLayout } from '@/components/layout/EntityDetailLayout';
import { DatePicker } from '@/components/ui/date-picker/date-picker';
import { parseYMD, toYMD } from '@/components/ui/date-picker/date-utils';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import { usePermissions, useTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { workItemPath } from '@/lib/work-item-paths';
import { isOverdue, localToday } from '@/lib/work-items/presentation';
import type { WorkItemRow } from '@/lib/work-items/types';

import { PriorityBadge, StateBadge } from './badges';
import { useListOrder } from './data/list-order';
import { useProjectCustomFields } from './data/use-custom-fields';
import { useWorkConfig } from './data/use-work-config';
import { useWorkItem, useWorkItemCollab } from './data/use-work-item-collab';
import { toRow, useWorkItemMutations } from './data/use-work-item-mutations';
import { ActivityPanel, CommentsPanel, LinksPanel, RelationsPanel, WatchersPanel } from './detail/collab-panels';
import { SubItemsPanel } from './detail/SubItemsPanel';
import { CustomFieldInput } from './fields/CustomFieldInput';
import { RepeatControl } from './detail/RepeatControl';
import { AssigneePicker, CyclePicker, LabelsPicker, MilestonePicker, PriorityPicker, StatePicker, TypePicker } from './pickers';

export type DetailTab = 'overview' | 'sub-items' | 'links' | 'comments' | 'activity';
const TABS: readonly DetailTab[] = ['overview', 'sub-items', 'links', 'comments', 'activity'];

export interface WorkItemDetailProps {
    workItemId: string;
    variant: 'page' | 'sheet';
    /** Open another item (a sub-item, the parent): the page navigates, the sheet switches. */
    onOpenItem?: (row: { id: string; key: string }) => void;
    /** Called after a delete leaves the view (the sheet closes; the page goes back to the project). */
    onDeleted?: () => void;
}

function PropertyRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
            {htmlFor ? (
                <label htmlFor={htmlFor} className="text-xs text-content-muted">
                    {label}
                </label>
            ) : (
                <span className="text-xs text-content-muted">{label}</span>
            )}
            <div className="min-w-0">{children}</div>
        </div>
    );
}

export function WorkItemDetail({ workItemId, variant, onOpenItem, onDeleted }: WorkItemDetailProps) {
    const t = useTranslations('workItems');
    const router = useRouter();
    const tenantHref = useTenantHref();
    const { tenantSlug } = useTenantContext();
    const perms = usePermissions().work_items;
    const config = useWorkConfig();
    const mutations = useWorkItemMutations();
    const collab = useWorkItemCollab(workItemId);
    const { data: item, error, isLoading } = useWorkItem(workItemId);
    const projectFields = useProjectCustomFields(item?.projectId);
    const [tab, setTab] = useState<DetailTab>('overview');
    const now = useHydratedNow();
    const order = useListOrder(tenantSlug);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    useEffect(() => {
        // Follow the server's text when it changes (another edit, a rollback).
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the editable copy tracks the cached item
        setTitle(item?.title ?? '');
    }, [item?.title]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the editable copy tracks the cached item
        setDescription(item?.description ?? '');
    }, [item?.description]);

    const row = useMemo<WorkItemRow | null>(() => (item ? toRow(item) : null), [item]);
    const openItem = (target: { id: string; key: string }) => {
        if (onOpenItem) onOpenItem(target);
        else router.push(tenantHref(workItemPath(target.key)));
    };

    const notFound = error && 'status' in error && (error as { status?: number }).status === 404;

    if (variant === 'sheet' && (isLoading || !item || !row)) {
        if (notFound) return <p role="alert">{t('detail.notFound')}</p>;
        if (error) return <p role="alert">{t('detail.loadFailed')}</p>;
        return <p aria-busy="true">{t('detail.loading')}</p>;
    }

    const project = item ? config.projectById.get(item.projectId) : undefined;
    const typeName = item ? (config.typeById.get(item.typeId)?.name ?? item.type?.name ?? null) : null;
    const overdue = item ? isOverdue(item.dueDate, item.stateCategory, now ? localToday(now) : null) : false;

    const saveTitle = () => {
        if (!row || !item) return;
        const next = title.trim();
        if (!next || next === item.title) {
            setTitle(item.title);
            return;
        }
        void mutations.updateFields(row, { title: next });
    };
    const saveDescription = () => {
        if (!row || !item) return;
        if ((item.description ?? '') === description) return;
        void mutations.updateFields(row, { description: description || null });
    };
    const changeLabels = (next: string[]) => {
        if (!item) return;
        const added = next.filter((id) => !item.labelIds.includes(id));
        const removed = item.labelIds.filter((id) => !next.includes(id));
        if (added.length) void collab.addLabels(added);
        for (const id of removed) collab.removeLabel(id);
    };
    const remove = () => {
        if (!row) return;
        mutations.remove(row, () => {
            if (onDeleted) onDeleted();
            else router.push(tenantHref(project ? `/projects/${project.keyPrefix}` : '/work-items'));
        });
    };

    const properties = item && row && (
        <div className="space-y-tight" aria-label={t('detail.properties')} role="group">
            <PropertyRow label={t('fields.state')} htmlFor={`state-${item.id}`}>
                <StatePicker
                    id={`state-${item.id}`}
                    teamId={item.teamId}
                    value={item.stateId}
                    current={{ id: item.state.id, name: item.state.name }}
                    disabled={!perms.edit}
                    onChange={(stateId) => void mutations.setState(row, stateId)}
                />
            </PropertyRow>
            <PropertyRow label={t('fields.assignee')} htmlFor={`assignee-${item.id}`}>
                <AssigneePicker
                    id={`assignee-${item.id}`}
                    value={item.assigneeId}
                    disabled={!perms.assign}
                    onChange={(assigneeId) => void mutations.assign(row, assigneeId)}
                />
            </PropertyRow>
            <PropertyRow label={t('fields.priority')} htmlFor={`priority-${item.id}`}>
                <PriorityPicker
                    id={`priority-${item.id}`}
                    value={item.priority}
                    disabled={!perms.edit}
                    onChange={(priority) => void mutations.updateFields(row, { priority })}
                />
            </PropertyRow>
            <PropertyRow label={t('fields.type')} htmlFor={`type-${item.id}`}>
                <TypePicker id={`type-${item.id}`} value={item.typeId} disabled={!perms.edit} onChange={(typeId) => void mutations.updateFields(row, { typeId })} />
            </PropertyRow>
            <PropertyRow label={t('fields.cycle')} htmlFor={`cycle-${item.id}`}>
                <CyclePicker
                    id={`cycle-${item.id}`}
                    teamId={item.teamId}
                    value={item.cycleId ?? null}
                    disabled={!perms.edit}
                    onChange={(cycleId) => void mutations.setCycle(row, cycleId)}
                />
            </PropertyRow>
            <PropertyRow label={t('fields.milestone')} htmlFor={`milestone-${item.id}`}>
                <MilestonePicker
                    id={`milestone-${item.id}`}
                    projectId={item.projectId}
                    value={item.milestoneId ?? null}
                    disabled={!perms.edit}
                    onChange={(milestoneId) => void mutations.setMilestone(row, milestoneId)}
                />
            </PropertyRow>
            <PropertyRow label={t('fields.repeat')}>
                <RepeatControl itemId={item.id} hasDueDate={item.dueDate !== null} archived={Boolean(item.project.archivedAt)} />
            </PropertyRow>
            <PropertyRow label={t('fields.labels')} htmlFor={`labels-${item.id}`}>
                <LabelsPicker id={`labels-${item.id}`} teamId={item.teamId} value={item.labelIds} disabled={!perms.edit} onChange={changeLabels} />
            </PropertyRow>
            <PropertyRow label={t('fields.dueDate')} htmlFor={`due-${item.id}`}>
                <DatePicker
                    id={`due-${item.id}`}
                    value={parseYMD(item.dueDate)}
                    disabled={!perms.edit}
                    clearable
                    onChange={(d) => void mutations.updateFields(row, { dueDate: toYMD(d) })}
                />
            </PropertyRow>
            {overdue && <p className="text-xs text-content-error">{t('detail.overdue')}</p>}
            {/* Sub-phase 2.4: the item's project's live custom fields. */}
            {projectFields
                .filter((f) => !f.archived && f.projectId === item.projectId)
                .map((field) => (
                    <PropertyRow key={field.id} label={field.name} htmlFor={`cf-${field.id}-${item.id}`}>
                        <CustomFieldInput
                            id={`cf-${field.id}-${item.id}`}
                            field={field}
                            value={item.customFields?.[field.id]}
                            disabled={!perms.edit}
                            onChange={(value) => void mutations.setCustomField(row, field.id, value)}
                        />
                    </PropertyRow>
                ))}
        </div>
    );

    const sectionFor = (key: DetailTab): ReactNode => {
        if (!item || !row) return null;
        switch (key) {
            case 'overview':
                return (
                    <div className="space-y-section">
                        {variant === 'sheet' && properties}
                        {perms.edit && <div className="space-y-tight">{titleEditor}</div>}
                        <section aria-labelledby={`description-${item.id}`} className="space-y-tight">
                            <h2 id={`description-${item.id}`} className="text-sm font-semibold text-content-emphasis">
                                {t('fields.description')}
                            </h2>
                            {perms.edit ? (
                                <>
                                    <Textarea
                                        aria-label={t('fields.description')}
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        rows={6}
                                    />
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        text={t('detail.saveDescription')}
                                        disabled={(item.description ?? '') === description}
                                        onClick={saveDescription}
                                    />
                                </>
                            ) : (
                                <p className="whitespace-pre-wrap text-sm">{item.description || t('detail.noDescription')}</p>
                            )}
                        </section>
                        <WatchersPanel workItemId={item.id} />
                    </div>
                );
            case 'sub-items':
                return <SubItemsPanel parent={row} canCreate={perms.create} canEdit={perms.edit} onOpen={openItem} />;
            case 'links':
                return (
                    <div className="space-y-section">
                        <RelationsPanel workItemId={item.id} canEdit={perms.edit} />
                        <LinksPanel workItemId={item.id} canEdit={perms.edit} />
                    </div>
                );
            case 'comments':
                return <CommentsPanel workItemId={item.id} />;
            case 'activity':
                return <ActivityPanel workItemId={item.id} />;
        }
    };

    const tabs = TABS.map((key) => ({
        key,
        label: t(`detail.tabs.${key}`),
        ...(key === 'sub-items' && item ? { count: item.counts.subItems } : {}),
        ...(key === 'comments' && item ? { count: item.counts.comments } : {}),
    }));

    const titleEditor = item && (
        <Input
            aria-label={t('fields.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveTitle();
                }
            }}
            className="text-base font-semibold"
        />
    );

    const meta = item && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-content-muted">
            <span className="font-mono">{item.key}</span>
            <StateBadge name={item.state?.name ?? config.stateById.get(item.stateId)?.name} category={item.stateCategory} />
            <PriorityBadge priority={item.priority} />
            {typeName && <span>{typeName}</span>}
            {project && <span>{project.name}</span>}
            {item.parent && (
                <span>
                    {t('detail.subItemOf')}{' '}
                    <button type="button" className="underline" onClick={() => openItem(item.parent!)}>
                        {item.parent.key}
                    </button>
                </span>
            )}
        </div>
    );

    const actions = perms.delete && item && (
        <Button variant="secondary" text={t('detail.deleteItem')} onClick={remove} />
    );

    if (variant === 'sheet') {
        return (
            <div className="space-y-section" data-testid="work-item-sheet-body">
                <div className="space-y-tight">
                    {meta}
                    <h2 className="text-lg font-semibold text-content-emphasis">{item!.title}</h2>
                    <div className="flex flex-wrap gap-tight">
                        <a href={tenantHref(workItemPath(item!.key))} className="text-sm text-content-info underline">
                            {t('detail.openFullPage')}
                        </a>
                        {actions}
                    </div>
                </div>
                <ToggleGroup
                    ariaLabel={t('detail.sections')}
                    options={tabs.map((x) => ({ value: x.key, label: x.label }))}
                    selected={tab}
                    selectAction={(v) => setTab(v as DetailTab)}
                />
                {sectionFor(tab)}
            </div>
        );
    }

    const ids = order;
    return (
        <EntityDetailLayout<DetailTab>
            back={{ smart: true }}
            title={item?.title ?? ''}
            prevNext={item ? { ids, currentId: item.key, hrefFor: (key) => tenantHref(workItemPath(key)), labelSingular: 'workItem' } : undefined}
            meta={meta}
            actions={actions || undefined}
            loading={isLoading && !item}
            error={notFound ? null : error ? t('detail.loadFailed') : null}
            empty={notFound ? { message: t('detail.notFound') } : null}
            tabs={tabs}
            activeTab={tab}
            onTabChange={setTab}
            rail={properties || undefined}
        >
            {sectionFor(tab)}
        </EntityDetailLayout>
    );
}
