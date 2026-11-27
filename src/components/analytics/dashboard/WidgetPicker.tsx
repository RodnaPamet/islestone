'use client';

/**
 * "Add widget" and a widget's settings (sub-phase 3.6d; docs/porting/maps/3.6.md,
 * "Editing" and "What a widget is over"; owner decisions 327 and 328): the
 * type (when adding), an optional title, the window (the last 4, 8, 12, 26
 * or 52 weeks, or a team's current cycle), the type's own choices (bins, the
 * burn-up's measure, the forecast's history, share and basis) and the scope,
 * set with the list's own filter toolbar (status filters set aside, as every
 * analytics read sets them aside). "Start from a view" copies a saved view's
 * filters once; the widget never follows the view afterwards. Nothing is
 * written here: the page sends the whole widget list.
 *
 * Pattern only, no code copied: inflect-compliance's
 * `src/components/ui/dashboard-widgets/WidgetPicker.tsx` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (a typed picker over the widget
 * kinds with their defaults, the same dialog for add and reconfigure).
 * Written fresh for Islestone.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FilterProvider, useFilterContext, useFilters } from '@/components/ui/filter';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { useSavedViews } from '@/components/work-items/data/use-saved-views';
import { useMembers, useWorkConfig } from '@/components/work-items/data/use-work-config';
import { buildWorkItemFilterDefs } from '@/components/work-items/filter-defs';
import { DASHBOARD_LIMITS, DASHBOARD_WIDGET_TYPES, scopeFromView, type DashboardWidgetData, type DashboardWidgetTypeName, type WidgetScope, type WidgetShape, type WidgetWindow } from '@/lib/analytics/dashboard';
import { defaultWidgetShape, defaultWidgetSize } from '@/lib/analytics/default-dashboard';
import { ANALYTICS_SET_ASIDE_FILTERS, ANALYTICS_WINDOW_WEEKS } from '@/lib/analytics/types';

const SET_ASIDE: readonly string[] = ANALYTICS_SET_ASIDE_FILTERS;
const NO_SCOPE = {};
const DEFAULT = 'default';

/** The scope editor: the list's filter toolbar over its own state, reporting each change. */
function ScopeEditor({ initial, onChange }: { initial: WidgetScope; onChange: (scope: WidgetScope) => void }) {
    const tPicker = useTranslations('analytics.dashboards.picker');
    const tDefs = useTranslations('workItems');
    const config = useWorkConfig();
    const { members } = useMembers();
    const defs = useMemo(() => buildWorkItemFilterDefs(config, members, NO_SCOPE, (k, v) => tDefs(k, v)), [config, members, tDefs]);
    const offered = useMemo(() => defs.filters.filter((d) => !SET_ASIDE.includes(d.key)), [defs]);
    const ctx = useFilterContext(defs.filters, defs.filterKeys, { syncUrl: false, initialState: initial.filters });
    const { setSearch } = ctx;
    useEffect(() => {
        if (initial.q) setSearch(initial.q);
        // Once, as the editor mounts with this scope.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <FilterProvider value={ctx}>
            <ScopeReporter onChange={onChange} />
            <FilterToolbar filters={offered} searchId="widget-scope-search" searchPlaceholder={tPicker('searchPlaceholder')} />
        </FilterProvider>
    );
}

function ScopeReporter({ onChange }: { onChange: (scope: WidgetScope) => void }) {
    const { state, search } = useFilters();
    useEffect(() => {
        const filters: Record<string, string[]> = {};
        for (const [key, values] of Object.entries(state)) if (values.length > 0 && !key.startsWith('cf.')) filters[key] = [...values];
        onChange(search.trim() ? { filters, q: search.trim() } : { filters });
    }, [state, search, onChange]);
    return null;
}

export interface WidgetPickerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The widget being changed, or null to add one. */
    editing: DashboardWidgetData | null;
    /** Answers the sentence to show when the write is refused, or null when it saved. */
    onSave: (widget: DashboardWidgetData) => Promise<string | null>;
}

export function WidgetPicker({ open, onOpenChange, editing, onSave }: WidgetPickerProps) {
    if (!open) return null;
    return <PickerDialog onOpenChange={onOpenChange} editing={editing} onSave={onSave} />;
}

function PickerDialog({ onOpenChange, editing, onSave }: Omit<WidgetPickerProps, 'open'>) {
    const t = useTranslations('analytics.dashboards.picker');
    const tTypes = useTranslations('analytics.dashboards.types');
    const tWindow = useTranslations('analytics.window');
    const config = useWorkConfig();
    const views = useSavedViews(undefined);
    const start = editing?.shape ?? defaultWidgetShape('THROUGHPUT');
    const [type, setType] = useState<DashboardWidgetTypeName>(start.type);
    const [shape, setShape] = useState<WidgetShape>(start);
    const [title, setTitle] = useState(editing?.title ?? '');
    const [scope, setScope] = useState<WidgetScope>(start.config.scope);
    const [scopeKey, setScopeKey] = useState(0);
    const [leftOut, setLeftOut] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const typeOptions: ComboboxOption[] = DASHBOARD_WIDGET_TYPES.map((x) => ({ value: x, label: tTypes(x) }));
    const teamsWithCycles = useMemo(() => {
        const ids = new Set(config.cycles.map((c) => c.teamId));
        return config.teams.filter((team) => ids.has(team.id));
    }, [config]);
    const teamOptions: ComboboxOption[] = teamsWithCycles.map((team) => ({ value: team.id, label: team.name }));
    const viewOptions: ComboboxOption[] = views.views.map((v) => ({ value: v.id, label: v.project ? `${v.name} (${v.project.keyPrefix})` : v.name }));

    const chooseType = (next: DashboardWidgetTypeName) => {
        setType(next);
        const fresh = defaultWidgetShape(next);
        // The scope and window carry over to the new type.
        const carried = { ...fresh.config, scope } as WidgetShape['config'];
        if ('window' in carried && 'window' in shape.config) (carried as { window: WidgetWindow }).window = shape.config.window;
        setShape({ type: next, config: carried } as WidgetShape);
    };
    const setConfig = (patch: Record<string, unknown>) => setShape((s) => ({ ...s, config: { ...s.config, ...patch } }) as WidgetShape);
    const window = 'window' in shape.config ? shape.config.window : null;

    const startFromView = (id: string) => {
        const view = views.views.find((v) => v.id === id);
        if (!view) return;
        const copied = scopeFromView(view.config);
        setScope(copied.scope);
        setLeftOut(copied.leftOut);
        setScopeKey((k) => k + 1);
    };

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const finalShape = { ...shape, config: { ...shape.config, scope } } as WidgetShape;
        const widget: DashboardWidgetData = {
            id: editing?.id ?? `new-${Date.now().toString(36)}`,
            type,
            title: title.trim() ? title.trim() : null,
            shape: finalShape,
            position: editing?.position ?? { x: 0, y: 47 },
            size: editing?.size ?? defaultWidgetSize(type),
        };
        const refusal = await onSave(widget);
        setSaving(false);
        if (refusal) setError(refusal);
        else onOpenChange(false);
    };

    const heading = editing ? t('editTitle') : t('addTitle');
    const windowValue = window ? (window.kind === 'cycle' ? 'cycle' : String(window.weeks)) : null;
    return (
        <Modal
            showModal
            setShowModal={(v) => {
                const next = typeof v === 'function' ? v(true) : v;
                if (!next) onOpenChange(false);
            }}
            title={heading}
            onClose={() => onOpenChange(false)}
        >
            <Modal.Header title={heading} description={t('description')} />
            <Modal.Form onSubmit={submit}>
                <Modal.Body>
                    <div className="space-y-default" data-testid="widget-picker">
                        {!editing && (
                            <FormField label={t('type')}>
                                <Combobox id="widget-type-input" selected={typeOptions.find((o) => o.value === type) ?? null} setSelected={(o) => o && chooseType(o.value as DashboardWidgetTypeName)} options={typeOptions} hideSearch caret />
                            </FormField>
                        )}
                        <FormField label={t('titleLabel')} description={t('titleHint', { name: tTypes(type) })}>
                            <Input id="widget-title-input" value={title} maxLength={DASHBOARD_LIMITS.titleLength} placeholder={tTypes(type)} onChange={(e) => setTitle(e.target.value)} />
                        </FormField>
                        {window && (
                            <FormField label={tWindow('label')}>
                                <div className="space-y-tight">
                                    <ToggleGroup
                                        ariaLabel={tWindow('label')}
                                        options={[
                                            ...ANALYTICS_WINDOW_WEEKS.map((w) => ({ value: String(w), label: tWindow('weeks', { weeks: w }) })),
                                            ...(teamsWithCycles.length > 0 ? [{ value: 'cycle', label: t('currentCycle') }] : []),
                                        ]}
                                        selected={windowValue}
                                        selectAction={(v) =>
                                            setConfig({ window: v === 'cycle' ? { kind: 'cycle', teamId: window.kind === 'cycle' ? window.teamId : teamsWithCycles[0]!.id } : { kind: 'weeks', weeks: Number(v) } })
                                        }
                                    />
                                    {window.kind === 'cycle' && (
                                        <Combobox
                                            id="widget-cycle-team-input"
                                            selected={teamOptions.find((o) => o.value === window.teamId) ?? null}
                                            setSelected={(o) => o && setConfig({ window: { kind: 'cycle', teamId: o.value } })}
                                            options={teamOptions}
                                            caret
                                        />
                                    )}
                                </div>
                            </FormField>
                        )}
                        {shape.type === 'THROUGHPUT' && (
                            <FormField label={t('bin')}>
                                <ToggleGroup
                                    ariaLabel={t('bin')}
                                    options={[
                                        { value: 'week', label: t('binWeek') },
                                        { value: 'day', label: t('binDay') },
                                    ]}
                                    selected={shape.config.bin}
                                    selectAction={(v) => setConfig({ bin: v === 'day' ? 'day' : 'week' })}
                                />
                            </FormField>
                        )}
                        {shape.type === 'BURN_UP' && (
                            <FormField label={t('measure')}>
                                <ToggleGroup
                                    ariaLabel={t('measure')}
                                    options={(['items', 'points', 'hours'] as const).map((m) => ({ value: m, label: t(`measures.${m}`) }))}
                                    selected={shape.config.measure}
                                    selectAction={(v) => setConfig({ measure: v })}
                                />
                            </FormField>
                        )}
                        {shape.type === 'FORECAST' && (
                            <>
                                <FormField label={t('historyWeeks')}>
                                    <ToggleGroup
                                        ariaLabel={t('historyWeeks')}
                                        options={[{ value: DEFAULT, label: t('serverDefault') }, ...[4, 8, 12, 26].map((w) => ({ value: String(w), label: tWindow('weeks', { weeks: w }) }))]}
                                        selected={shape.config.historyWeeks ? String(shape.config.historyWeeks) : DEFAULT}
                                        selectAction={(v) => setConfig({ historyWeeks: v === DEFAULT ? undefined : Number(v) })}
                                    />
                                </FormField>
                                <FormField label={t('share')}>
                                    <ToggleGroup
                                        ariaLabel={t('share')}
                                        options={[{ value: DEFAULT, label: t('serverDefault') }, ...[25, 50, 75, 100].map((s) => ({ value: String(s), label: t('sharePercent', { share: s }) }))]}
                                        selected={shape.config.share ? String(shape.config.share) : DEFAULT}
                                        selectAction={(v) => setConfig({ share: v === DEFAULT ? undefined : Number(v) })}
                                    />
                                </FormField>
                                <FormField label={t('basedOn')}>
                                    <ToggleGroup
                                        ariaLabel={t('basedOn')}
                                        options={[{ value: DEFAULT, label: t('serverDefault') }, ...(['projects', 'team', 'workspace'] as const).map((b) => ({ value: b, label: t(`basedOnOptions.${b}`) }))]}
                                        selected={shape.config.basedOn ?? DEFAULT}
                                        selectAction={(v) => setConfig({ basedOn: v === DEFAULT ? undefined : v })}
                                    />
                                </FormField>
                            </>
                        )}
                        <FormField label={t('scope')} description={t('scopeHint')}>
                            <div className="space-y-tight">
                                <ScopeEditor key={scopeKey} initial={scope} onChange={setScope} />
                                {viewOptions.length > 0 && (
                                    <Combobox
                                        id="widget-from-view-input"
                                        selected={null}
                                        setSelected={(o) => o && startFromView(o.value)}
                                        options={viewOptions}
                                        placeholder={t('fromView')}
                                        caret
                                    />
                                )}
                                {leftOut.length > 0 && <p className="text-xs text-content-muted">{t('leftOut', { count: leftOut.length })}</p>}
                            </div>
                        </FormField>
                        {error && (
                            <p role="alert" className="text-sm text-content-error">
                                {error}
                            </p>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Modal.Actions>
                        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} text={t('cancel')} />
                        <Button type="submit" variant="primary" loading={saving} text={editing ? t('save') : t('add')} />
                    </Modal.Actions>
                </Modal.Footer>
            </Modal.Form>
        </Modal>
    );
}
