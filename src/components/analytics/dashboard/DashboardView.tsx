'use client';

/**
 * The Analytics page as a dashboard (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Dashboards (3.6d)" and "Editing"; ADR 0014 §6; owner decisions 326 to
 * 328).
 *
 *   - **View mode** (the default): the widgets in their places on the
 *     mirrored grid, each its own read; the dashboards menu (the default
 *     composition, one's own and every shared one); "Customise" saves a
 *     personal copy of the default, "Duplicate" of any dashboard one can see.
 *   - **Edit mode** (a dashboard the caller may change, the server's
 *     `viewer.change`): drag and resize from the widget's handle, "Add
 *     widget", a widget's settings and its removal (through the undo toast).
 *     Each change sends the whole widget list with the dashboard's version as
 *     `If-Match`; a version conflict shows the server's layout with a
 *     "changed by someone else" toast. Rename, share and delete follow the
 *     server's affordances; nothing here asks a role or a key.
 *
 * Copied from inflect-compliance `src/app/org/[orgSlug]/(app)/PortfolioDashboard.tsx`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1, Inflect Ltd.) and
 * adapted: the view and edit modes, the header's Edit / Add widget / Done
 * cluster, the grid with its per-widget settings and removal buttons, and the
 * removal through the undo toast are kept; the org portfolio's data, KPI
 * header, onboarding states, reset-to-preset dialog and per-row PATCH calls
 * are replaced by Islestone's dashboards menu, the default composition in
 * code, Customise, Duplicate, rename, share and delete, and one versioned
 * write of the whole widget list.
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { GripDotsVertical } from '@inflect/ui/components/ui/icons/nucleo';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SettingsFormModal } from '@/components/settings/SettingsFormModal';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { DashboardGrid, type WidgetLayoutChange } from '@/components/ui/dashboard-widgets/DashboardGrid';
import { FormField } from '@/components/ui/form-field';
import { useLocalStorage, useToast } from '@/components/ui/hooks';
import { Input } from '@/components/ui/input';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { ApiClientError } from '@/lib/data/api-client';
import { DASHBOARD_LIMITS, type DashboardData, type DashboardListResponse, type DashboardPageAffordances, type DashboardVisibilityName, type DashboardWidgetData } from '@/lib/analytics/dashboard';
import { DEFAULT_DASHBOARD } from '@/lib/analytics/default-dashboard';
import { useTenantHref } from '@/lib/tenant-context-provider';
import { uiStorageKey } from '@/lib/ui-storage';

import { conflictDashboard, useDashboardList, useDashboardWrites } from '../data/use-dashboards';
import { DashboardWidgetView } from './WidgetView';
import { WidgetPicker } from './WidgetPicker';

/** The viewer's last dashboard opened (per viewer, `ui-storage`; decision 326). */
export const LAST_DASHBOARD_KEY = uiStorageKey('analytics', 'dashboard');
export const DEFAULT_ID = 'default';

/** Where a new widget goes: below every widget there is, within the grid's 0..47 rows. */
export function nextRow(widgets: readonly DashboardWidgetData[]): number {
    return Math.min(47, widgets.reduce((y, w) => Math.max(y, w.position.y + w.size.h), 0));
}

/** The server's refusal as a sentence, or the generic one. */
function refusalOf(err: unknown, fallback: string): string {
    return err instanceof ApiClientError && err.reason ? err.reason : fallback;
}

type Dialog = { kind: 'new' } | { kind: 'rename' } | null;

export interface DashboardViewProps {
    /** The dashboard shown; null for the default composition. */
    dashboard: DashboardData | null;
    affordances: DashboardPageAffordances;
    /** Today in the workspace calendar's zone. */
    today: string;
    /** Open in edit mode (a dashboard just made by Customise, Duplicate or New). */
    startEditing?: boolean;
}

export function DashboardView({ dashboard, affordances, today, startEditing = false }: DashboardViewProps) {
    const t = useTranslations('analytics.dashboards');
    const tPage = useTranslations('analytics');
    const tTypes = useTranslations('analytics.dashboards.types');
    const router = useRouter();
    const href = useTenantHref();
    const toast = useToast();
    const writes = useDashboardWrites();
    const list = useDashboardList();
    const [, setLast] = useLocalStorage<string>(LAST_DASHBOARD_KEY, DEFAULT_ID);

    const canChange = dashboard?.viewer.change === true;
    const [editMode, setEditMode] = useState(startEditing && canChange);
    const [widgets, setWidgetsState] = useState<DashboardWidgetData[]>(() => (dashboard ? dashboard.widgets : DEFAULT_DASHBOARD.widgets));
    const widgetsRef = useRef(widgets);
    const versionRef = useRef(dashboard?.version ?? 1);
    const savesRef = useRef(0);
    const pendingRef = useRef(0);
    const chainRef = useRef<Promise<unknown>>(Promise.resolve());
    const [pickerOpen, setPickerOpen] = useState(false);
    const [editing, setEditing] = useState<DashboardWidgetData | null>(null);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [name, setName] = useState('');
    const [visibility, setVisibility] = useState<DashboardVisibilityName>('PERSONAL');

    // Remember a saved dashboard as the viewer's last one; the default is remembered when chosen from the menu.
    const dashboardId = dashboard?.id ?? null;
    useEffect(() => {
        if (dashboardId) setLast(dashboardId);
    }, [dashboardId, setLast]);

    const place = useCallback((next: DashboardWidgetData[]) => {
        widgetsRef.current = next;
        setWidgetsState(next);
    }, []);

    /** Adopt the server's dashboard (a conflict, or a write's answer with nothing newer pending). */
    const adopt = useCallback(
        (d: DashboardData) => {
            versionRef.current = d.version;
            place(d.widgets);
        },
        [place],
    );

    /** Send the whole widget list on the version held, one write after another. */
    const save = useCallback(
        (next: readonly DashboardWidgetData[]): Promise<string | null> => {
            if (!dashboard) return Promise.resolve(null);
            pendingRef.current += 1;
            const run = chainRef.current.then(async () => {
                try {
                    const answer = await writes.setWidgets(dashboard.id, versionRef.current, next);
                    savesRef.current += 1;
                    versionRef.current = answer.version;
                    // Newer changes are on screen and on their way; only the last answer replaces them.
                    if (pendingRef.current === 1) place(answer.widgets);
                    return null;
                } catch (err) {
                    const server = conflictDashboard(err);
                    if (server) {
                        adopt(server);
                        toast.error(t('changedElsewhere'));
                        return t('changedElsewhere');
                    }
                    return refusalOf(err, t('failed'));
                } finally {
                    pendingRef.current -= 1;
                }
            });
            chainRef.current = run.catch(() => undefined);
            return run;
        },
        [adopt, dashboard, place, t, toast, writes],
    );

    const onLayoutChange = useCallback(
        (changes: WidgetLayoutChange[]) => {
            if (!editMode || changes.length === 0) return;
            const byId = new Map(changes.map((c) => [c.id, c]));
            const next = widgetsRef.current.map((w) => {
                const c = byId.get(w.id);
                return c ? { ...w, position: c.position, size: c.size } : w;
            });
            place(next);
            void save(next).then((refusal) => refusal && toast.error(refusal));
        },
        [editMode, place, save, toast],
    );

    const saveWidget = useCallback(
        async (widget: DashboardWidgetData): Promise<string | null> => {
            const current = widgetsRef.current;
            const exists = current.some((w) => w.id === widget.id);
            if (!exists && current.length >= DASHBOARD_LIMITS.widgets) return t('tooMany', { limit: DASHBOARD_LIMITS.widgets });
            const next = exists ? current.map((w) => (w.id === widget.id ? widget : w)) : [...current, { ...widget, position: { x: 0, y: nextRow(current) } }];
            place(next);
            return save(next);
        },
        [place, save, t],
    );

    const removeWidget = useCallback(
        (widget: DashboardWidgetData, title: string) => {
            const index = widgetsRef.current.findIndex((w) => w.id === widget.id);
            if (index < 0) return;
            const savesAtRemoval = savesRef.current;
            writes.removeWidget(title, {
                onLeave: () => place(widgetsRef.current.filter((w) => w.id !== widget.id)),
                commit: async () => {
                    const refusal = await save(widgetsRef.current);
                    if (refusal) throw new Error(refusal);
                },
                onUndo: () => {
                    if (widgetsRef.current.some((w) => w.id === widget.id)) return;
                    const next = [...widgetsRef.current];
                    next.splice(Math.min(index, next.length), 0, widget);
                    place(next);
                    // A layout write since the removal already dropped it on the server: put it back there too.
                    if (savesRef.current !== savesAtRemoval) void save(next);
                },
            });
        },
        [place, save, writes],
    );

    // ── Dashboards: open, make, copy, rename, share, delete ──

    const open = useCallback(
        (id: string, edit = false) => {
            if (id === DEFAULT_ID) setLast(DEFAULT_ID);
            router.push(href(id === DEFAULT_ID ? '/analytics' : `/analytics/dashboards/${id}${edit ? '?edit=1' : ''}`));
        },
        [href, router, setLast],
    );

    const copy = useCallback(
        async (named: string, from: readonly DashboardWidgetData[]) => {
            try {
                const created = await writes.create({ name: named, visibility: 'PERSONAL', widgets: [...from] });
                open(created.id, true);
            } catch (err) {
                toast.error(refusalOf(err, t('failed')));
            }
        },
        [open, t, toast, writes],
    );

    const submitDialog = async (): Promise<string | null> => {
        try {
            if (dialog?.kind === 'new') {
                const created = await writes.create({ name, visibility });
                open(created.id, true);
            } else if (dialog?.kind === 'rename' && dashboard) {
                const next = await writes.update({ ...dashboard, version: versionRef.current }, { name, visibility });
                versionRef.current = next.version;
            }
            return null;
        } catch (err) {
            const server = conflictDashboard(err);
            if (server) {
                adopt(server);
                return t('changedElsewhere');
            }
            return refusalOf(err, t('failed'));
        }
    };

    const remove = () => {
        if (!dashboard) return;
        writes.remove({ id: dashboard.id, name: dashboard.name }, { onLeave: () => open(DEFAULT_ID) });
    };

    const menuOptions = useMemo<ComboboxOption[]>(() => {
        const rows = (list.data as DashboardListResponse | undefined)?.dashboards ?? [];
        return [
            { value: DEFAULT_ID, label: t('defaultName') },
            ...rows.map((d) => ({
                value: d.id,
                label: d.visibility === 'SHARED' ? (d.mine ? t('menu.sharedMine', { name: d.name }) : d.createdByFormerMember ? t('menu.sharedFormer', { name: d.name }) : t('menu.shared', { name: d.name })) : d.name,
            })),
        ];
    }, [list.data, t]);
    const currentOption = menuOptions.find((o) => o.value === (dashboard?.id ?? DEFAULT_ID)) ?? menuOptions[0]!;

    const title = dashboard ? dashboard.name : tPage('title');
    const description = dashboard
        ? dashboard.visibility === 'SHARED'
            ? dashboard.mine
                ? t('describedSharedMine')
                : dashboard.createdByFormerMember
                  ? t('describedSharedFormer')
                  : t('describedShared')
            : t('describedPersonal')
        : t('describedDefault');

    const actions = (
        <div className="flex flex-wrap items-center gap-tight">
            <Combobox id="dashboard-menu-input" selected={currentOption} setSelected={(o) => o && open(o.value)} options={menuOptions} caret buttonProps={{ 'aria-label': t('menu.label') }} />
            {!dashboard && affordances.createPersonal && <Button variant="secondary" text={t('customise')} onClick={() => void copy(t('customisedName'), DEFAULT_DASHBOARD.widgets)} data-testid="dashboard-customise" />}
            {dashboard && affordances.createPersonal && !editMode && <Button variant="secondary" text={t('duplicate')} onClick={() => void copy(t('copyName', { name: dashboard.name }), widgetsRef.current)} />}
            {affordances.createPersonal && !editMode && (
                <Button
                    variant="secondary"
                    text={t('new')}
                    onClick={() => {
                        setName('');
                        setVisibility('PERSONAL');
                        setDialog({ kind: 'new' });
                    }}
                />
            )}
            {canChange && !editMode && <Button variant="secondary" text={t('edit')} onClick={() => setEditMode(true)} data-testid="dashboard-edit-toggle" />}
            {canChange && editMode && (
                <>
                    <Button
                        variant="secondary"
                        text={t('addWidget')}
                        onClick={() => {
                            setEditing(null);
                            setPickerOpen(true);
                        }}
                        data-testid="dashboard-add-widget"
                    />
                    <Button
                        variant="secondary"
                        text={t('rename')}
                        onClick={() => {
                            setName(dashboard!.name);
                            setVisibility(dashboard!.visibility);
                            setDialog({ kind: 'rename' });
                        }}
                    />
                    {dashboard!.viewer.delete && <Button variant="secondary" text={t('delete')} onClick={remove} />}
                    <Button variant="primary" text={t('done')} onClick={() => setEditMode(false)} data-testid="dashboard-edit-done" />
                </>
            )}
            {!canChange && dashboard?.viewer.delete && <Button variant="secondary" text={t('delete')} onClick={remove} />}
        </div>
    );

    return (
        <DashboardLayout header={{ title, description, actions, ...(dashboard ? { back: { smart: true as const } } : {}) }} data-testid="analytics-page">
            {widgets.length === 0 ? (
                <div className="rounded-md border border-border-subtle px-4 py-6 text-center" data-testid="dashboard-empty-state">
                    <p className="text-sm font-medium text-content-emphasis">{t('emptyTitle')}</p>
                    <p className="mt-1 text-xs text-content-muted">{canChange ? t('emptyEditor') : t('emptyReader')}</p>
                </div>
            ) : (
                <DashboardGrid<DashboardWidgetData>
                    widgets={widgets}
                    editable={editMode}
                    onLayoutChange={onLayoutChange}
                    rowHeight={56}
                    draggableHandle=".dashboard-drag-handle"
                    renderWidget={(w) => {
                        const widgetTitle = w.title ?? tTypes(w.type);
                        return (
                            <DashboardWidgetView
                                widget={w}
                                today={today}
                                actions={
                                    editMode ? (
                                        <>
                                            <span className="dashboard-drag-handle cursor-move select-none px-1 text-content-subtle" aria-hidden title={t('dragHint')} data-testid={`dashboard-drag-${w.id}`}>
                                                <GripDotsVertical className="size-4" />
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                text={t('widgetSettings')}
                                                aria-label={t('widgetSettingsAria', { name: widgetTitle })}
                                                onClick={() => {
                                                    setEditing(w);
                                                    setPickerOpen(true);
                                                }}
                                            />
                                            <Button variant="ghost" size="sm" text={t('removeWidget')} aria-label={t('removeWidgetAria', { name: widgetTitle })} onClick={() => removeWidget(w, widgetTitle)} />
                                        </>
                                    ) : undefined
                                }
                            />
                        );
                    }}
                />
            )}

            <WidgetPicker open={pickerOpen} onOpenChange={setPickerOpen} editing={editing} onSave={saveWidget} />

            <SettingsFormModal
                open={dialog !== null}
                onOpenChange={(v) => !v && setDialog(null)}
                title={dialog?.kind === 'rename' ? t('renameTitle') : t('newTitle')}
                submitLabel={dialog?.kind === 'rename' ? t('save') : t('create')}
                onSubmit={submitDialog}
                submitDisabled={!name.trim()}
            >
                <FormField label={t('name')} required>
                    <Input id="dashboard-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={DASHBOARD_LIMITS.nameLength} autoFocus />
                </FormField>
                {affordances.createShared && (
                    <FormField label={t('visibility')}>
                        <ToggleGroup
                            ariaLabel={t('visibility')}
                            options={[
                                { value: 'PERSONAL', label: t('personal') },
                                { value: 'SHARED', label: t('shared') },
                            ]}
                            selected={visibility}
                            selectAction={(v) => setVisibility(v === 'SHARED' ? 'SHARED' : 'PERSONAL')}
                        />
                    </FormField>
                )}
            </SettingsFormModal>
        </DashboardLayout>
    );
}
