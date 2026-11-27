'use client';

/**
 * The Time entry's tabs (sub-phase 3.4c; docs/porting/maps/3.4.md, "The
 * pages (3.4b)"): My time (whoever records or approves time), Timesheets for
 * whoever approves weeks, and Time totals for `time.view` (3.4d). Shown only
 * when there is more than one tab; each is asked on the server
 * (`timeAffordances`), never here.
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { NAV_PATHS } from '@/components/layout/nav-config';
import { useTenantHref } from '@/lib/tenant-context-provider';

export function TimeTabs({ approve, totals = false, myTime = true }: { approve: boolean; totals?: boolean; myTime?: boolean }) {
    const tTabs = useTranslations('time.tabs');
    const tenantHref = useTenantHref();
    const pathname = usePathname();
    const tabs: Array<{ key: 'myTime' | 'timesheets' | 'totals'; href: string }> = [
        ...(myTime ? [{ key: 'myTime' as const, href: tenantHref(NAV_PATHS.time) }] : []),
        ...(approve ? [{ key: 'timesheets' as const, href: tenantHref(NAV_PATHS.timesheets) }] : []),
        ...(totals ? [{ key: 'totals' as const, href: tenantHref(NAV_PATHS.timeTotals) }] : []),
    ];
    if (tabs.length < 2) return null;
    return (
        <nav aria-label={tTabs('label')} className="flex gap-tight border-b border-border-subtle" data-testid="time-tabs">
            {tabs.map((tab) => {
                const current = pathname === tab.href;
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
                        {tTabs(tab.key)}
                    </Link>
                );
            })}
        </nav>
    );
}
