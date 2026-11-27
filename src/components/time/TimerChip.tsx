'use client';

/**
 * The person's running timer in the top chrome (sub-phase 3.4b; owner
 * decisions 262 and 263): "ISL-12 · 0:42" linking to the item, with Stop, on
 * every workspace page while the timer is on; "Stopped counting at 12 hours"
 * once it reached the cap (no job stops it). One read, `GET
 * /time-entries/timer`, read again on window focus, so a timer started on
 * another device shows within one focus. Shown only to a holder of
 * `time.track` (the sidebar's gate), so nobody else polls the route. It also
 * registers the palette's "Stop timer".
 *
 * Written fresh for Islestone.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@inflect/ui/components/ui/button';
import { useRegisterPaletteTimerAction } from '@/components/command-palette/workspace-access';
import { useToast } from '@/components/ui/hooks';
import { useOptionalTenantContext, useTenantHref } from '@/lib/tenant-context-provider';
import { TIME_LIMITS } from '@/lib/time/entries';

import { useRunningTimer, useTimeWrites } from './data/use-time';
import { clockText } from './time-format';

/** The chip, inside a workspace whose member records time; nothing elsewhere. */
export function TimerChip() {
    const tenant = useOptionalTenantContext();
    if (!tenant || tenant.appPermissions.time?.track !== true) return null;
    return <RunningTimerChip />;
}

function RunningTimerChip() {
    const t = useTranslations('time.timer');
    const tenantHref = useTenantHref();
    const { data } = useRunningTimer(true);
    const writes = useTimeWrites();
    const toast = useToast();
    const timer = data?.timer ?? null;
    // The server's clock, ticking: the browser's clock moved by the skew the read showed,
    // so a skewed browser clock does not move the count.
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (!timer) return;
        const skew = Date.parse(timer.serverNow) - Date.now();
        const tick = () => setNow(Date.now() + skew);
        const first = window.setTimeout(tick, 0);
        const id = window.setInterval(tick, 15_000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(id);
        };
    }, [timer]);

    const itemKey = timer?.item.kind === 'visible' ? timer.item.key : null;
    const stop = useMemo(
        () =>
            timer
                ? {
                      key: itemKey ?? t('deletedItem'),
                      run: () => {
                          void writes.stopTimer().then((out) => {
                              if (out instanceof Error) toast.error(out.reason ?? t('failed'));
                              else if (out.discarded) toast.success(t('discarded'));
                          });
                      },
                  }
                : null,
        [timer, itemKey, writes, toast, t],
    );
    useRegisterPaletteTimerAction('stop', stop);

    if (!timer || !stop) return null;
    const minutes = Math.min(TIME_LIMITS.timerCapMinutes, (now - Date.parse(timer.timerStartedAt)) / 60_000);
    const capped = timer.stoppedCounting || minutes >= TIME_LIMITS.timerCapMinutes;
    const label = itemKey ?? t('deletedItem');

    return (
        <div className="hidden items-center gap-tight rounded-full border border-border-subtle px-2 py-0.5 text-sm md:flex" data-testid="timer-chip" role="status" aria-label={t('label', { key: label })}>
            {timer.item.kind === 'visible' ? (
                <Link href={tenantHref(`/work-items/${timer.item.key}`)} className="font-medium text-content-emphasis hover:underline">
                    {label}
                </Link>
            ) : (
                <span className="text-content-muted">{label}</span>
            )}
            <span className="tabular-nums text-content-default">{clockText(minutes)}</span>
            {capped && <span className="text-xs text-content-warning">{t('capped')}</span>}
            <Button variant="ghost" size="sm" text={t('stop')} onClick={stop.run} />
        </div>
    );
}
