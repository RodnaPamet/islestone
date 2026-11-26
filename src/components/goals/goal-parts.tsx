'use client';

/**
 * The pieces the Roadmap entry's pages share (sub-phase 3.2b): the tab bar
 * between Goals and Initiatives (decision 222), a progress cell ("12 of 40
 * done", "No items", never 100 % of nothing; decision 212), the status and
 * health shown with their names (decision 205: "Status: Started · Health:
 * Completed"), the health control (a person holding `goals.manage`, as the
 * server offered it, decision 214) and the health history read from the
 * audit trail (decision 207).
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';

import { NAV_PATHS } from '@/components/layout/nav-config';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { memberLabel } from '@/components/work-items/data/use-work-config';
import { percentDone } from '@/app-layer/domain/progress';
import { useHydratedNow } from '@/lib/hooks/use-hydrated-now';
import type { HealthHistoryEntry, HealthValue, ProgressSummary } from '@/lib/goals/types';
import { useTenantHref } from '@/lib/tenant-context-provider';
import type { Member } from '@/lib/work-items/types';

import { useGoalWrites } from './use-goals';

export const HEALTH_OPTIONS: ReadonlyArray<HealthValue | 'none'> = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED', 'none'];
export const STATUS_OPTIONS = ['PLANNED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;

const HEALTH_TONE: Record<HealthValue, string> = {
    ON_TRACK: 'text-content-success',
    AT_RISK: 'text-content-warning',
    OFF_TRACK: 'text-content-error',
    COMPLETED: 'text-content-emphasis',
};

/** Goals | Initiatives (the Roadmap page joins them in 3.2c): links, the current one marked. */
export function RoadmapTabs() {
    const tTabs = useTranslations('roadmap');
    const tenantHref = useTenantHref();
    const pathname = usePathname();
    const tabs = [
        { key: 'goals', href: tenantHref(NAV_PATHS.roadmap) },
        { key: 'initiatives', href: tenantHref(NAV_PATHS.initiatives) },
    ] as const;
    return (
        <nav aria-label={tTabs('tabsLabel')} className="flex gap-tight border-b border-border-subtle" data-testid="roadmap-tabs">
            {tabs.map((tab) => {
                const current = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                return (
                    <Link
                        key={tab.key}
                        href={tab.href}
                        aria-current={current ? 'page' : undefined}
                        className={
                            current
                                ? 'border-b-2 border-[var(--brand-default)] px-3 py-2 text-sm font-medium text-content-emphasis'
                                : 'border-b-2 border-transparent px-3 py-2 text-sm text-content-muted hover:text-content-emphasis'
                        }
                    >
                        {tTabs(`tabs.${tab.key}`)}
                    </Link>
                );
            })}
        </nav>
    );
}

/** A progress bar with "12 of 40 done", "No items" for an empty scope, or the refused count. */
export function ProgressCell({ name, summary }: { name: string; summary: ProgressSummary }) {
    const tProgress = useTranslations('roadmap');
    if (summary.tooManyProjects !== null) return <span className="text-xs text-content-muted">{tProgress('progress.tooMany', { count: summary.tooManyProjects })}</span>;
    const p = summary.progress;
    if (!p || p.scope === 0) return <span className="text-xs text-content-muted">{tProgress('progress.noItems')}</span>;
    const percent = percentDone(p);
    return (
        <div className="min-w-32 space-y-1">
            <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={tProgress('progress.aria', { name, percent })}
            >
                <div className="h-full bg-content-success" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs text-content-muted tabular-nums">{tProgress('progress.done', { done: p.done, scope: p.scope })}</p>
        </div>
    );
}

/** The health value with its colour word, or "No health set". */
export function HealthText({ health }: { health: HealthValue | null }) {
    const tHealth = useTranslations('roadmap');
    if (!health) return <span className="text-content-muted">{tHealth('health.none')}</span>;
    return <span className={`font-medium ${HEALTH_TONE[health]}`}>{tHealth(`health.${health}`)}</span>;
}

/** "Status: Started · Health: Completed": both with their names, never one standing for the other (decision 205). */
export function StatusAndHealth({ status, health }: { status: string; health: HealthValue | null }) {
    const tBoth = useTranslations('roadmap');
    return (
        <span className="text-sm text-content-muted">
            {tBoth('statusIs', { status: tBoth(`status.${status}`) })} · {tBoth('healthIs', { health: tBoth(`health.${health ?? 'none'}`) })}
        </span>
    );
}

function useWhen() {
    const format = useFormatter();
    const now = useHydratedNow();
    return (at: string | Date) => {
        const d = new Date(at);
        return now ? format.relativeTime(d, now) : d.toISOString().slice(0, 10);
    };
}

/**
 * The health control (decisions 205 and 214): the four values and "No health
 * set", who set it and when. Offered only where the server said `setHealth`
 * and the record is not archived; otherwise the value is read-only.
 */
export function HealthControl({
    kind,
    record,
    editable,
    members,
}: {
    kind: 'goal' | 'initiative';
    record: { id: string; name: string; version: number; health: HealthValue | null; healthSetAt: string | Date | null; healthSetByUserId: string | null; archived: boolean };
    editable: boolean;
    members: ReadonlyMap<string, Member>;
}) {
    const tControl = useTranslations('roadmap');
    const writes = useGoalWrites();
    const when = useWhen();
    const setter = record.healthSetByUserId ? memberLabel(members.get(record.healthSetByUserId)) : null;
    return (
        <div className="space-y-tight" data-testid="health-control">
            {editable && !record.archived ? (
                <ToggleGroup
                    ariaLabel={tControl('healthControl.label', { name: record.name })}
                    options={HEALTH_OPTIONS.map((h) => ({ value: h, label: tControl(`health.${h}`) }))}
                    selected={record.health ?? 'none'}
                    selectAction={(value) => void writes.setHealth(kind, record.id, record.version, value === 'none' ? null : (value as HealthValue))}
                />
            ) : (
                <p className="text-sm">
                    <HealthText health={record.health} />
                    {record.archived && <span className="ml-2 text-xs text-content-muted">{tControl('healthControl.readOnly')}</span>}
                </p>
            )}
            <p className="text-xs text-content-muted">
                {record.healthSetAt
                    ? setter
                        ? tControl('healthControl.setBy', { name: setter, when: when(record.healthSetAt) })
                        : tControl('healthControl.setByUnknown', { when: when(record.healthSetAt) })
                    : tControl('healthControl.notSet')}
            </p>
        </div>
    );
}

/** The health history, newest first: values and who set them, never a written update (decision 207). */
export function HealthHistory({ entries, members }: { entries: HealthHistoryEntry[]; members: ReadonlyMap<string, Member> }) {
    const tHistory = useTranslations('roadmap');
    const when = useWhen();
    if (entries.length === 0) return <p className="text-sm text-content-muted">{tHistory('healthControl.historyEmpty')}</p>;
    return (
        <ol className="space-y-1 text-sm" data-testid="health-history">
            {entries.map((e) => (
                <li key={e.id}>
                    {tHistory('healthControl.historyRow', {
                        when: when(e.setAt),
                        from: tHistory(`health.${e.previous ?? 'none'}`),
                        to: tHistory(`health.${e.health ?? 'none'}`),
                    })}{' '}
                    <span className="text-content-muted">
                        {tHistory('healthControl.historyBy', { name: (e.setByUserId ? memberLabel(members.get(e.setByUserId)) : null) ?? tHistory('healthControl.someone') })}
                    </span>
                </li>
            ))}
        </ol>
    );
}
