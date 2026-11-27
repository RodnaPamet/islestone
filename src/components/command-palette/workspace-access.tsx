'use client';

/**
 * What the open workspace lets the signed-in member reach, handed to the
 * command palette (owner decision, 2026-11-19; docs/HANDOFF.md row 40).
 *
 * The palette renders in `src/app/providers.tsx`, ABOVE the workspace's
 * `TenantProvider`, so it cannot read the member's permissions itself. The
 * shell, which sits inside the provider, REGISTERS the answer here on mount
 * (`RegisterPaletteWorkspaceAccess`, mounted by `AppShell`), as the assistant
 * launcher registers its presence (`assistant-open-context.tsx`). The answer
 * is `mayOpenSettings` from `@/components/layout/nav-config`, the rule the
 * sidebar's gear and the Settings page itself apply; nothing here restates
 * it.
 *
 * It is keyed by workspace slug, and the palette uses it only for the
 * workspace in the URL: during a switch, a stale answer for the previous
 * workspace never applies to the next one. No answer means no Settings row
 * (fail closed).
 *
 * Sub-phase 3.4b adds the timer's actions (the map's "Start timer on ISL-12"
 * and "Stop timer"): the top chrome's timer registers Stop while the person's
 * timer is on, and an item's Time panel registers Start while it is open and
 * offers one. Each is keyed by workspace and used only for the workspace in
 * the URL, as the access is; the panel and the chrome asked the server first.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { timeLandingOf, useMayOpenSettings, useMayOpenTime } from '@/components/layout/nav-config';
import { usePermissions, useTenantContext } from '@/lib/tenant-context-provider';

export interface PaletteWorkspaceAccess {
    tenantSlug: string;
    mayOpenSettings: boolean;
    /** The Time entry's rule (the sidebar's): `time.track`, `time.approve` or (3.4d) `time.view`. */
    mayOpenTime?: boolean;
    /** Where the Time entry opens (the sidebar's `timeLandingOf`): My time, or Time totals for a `time.view` holder alone. */
    timeLanding?: string;
}

/** The timer's actions the shell registers (3.4b). */
export interface PaletteTimerActions {
    tenantSlug: string;
    /** Set while the person's timer is on. */
    stop?: { key: string; run: () => void };
    /** Set while an item's Time panel offers a timer. */
    start?: { key: string; run: () => void };
}

interface PaletteWorkspaceAccessValue {
    access: PaletteWorkspaceAccess | null;
    setAccess: (next: PaletteWorkspaceAccess | null) => void;
    timer: PaletteTimerActions | null;
    setTimer: (update: (current: PaletteTimerActions | null) => PaletteTimerActions | null) => void;
}

const PaletteWorkspaceAccessContext = createContext<PaletteWorkspaceAccessValue | null>(null);

export function PaletteWorkspaceAccessProvider({ children }: { children: ReactNode }) {
    const [access, setAccess] = useState<PaletteWorkspaceAccess | null>(null);
    const [timer, setTimerState] = useState<PaletteTimerActions | null>(null);
    const setTimer = useCallback((update: (current: PaletteTimerActions | null) => PaletteTimerActions | null) => setTimerState(update), []);
    const value = useMemo(() => ({ access, setAccess, timer, setTimer }), [access, timer, setTimer]);
    return <PaletteWorkspaceAccessContext.Provider value={value}>{children}</PaletteWorkspaceAccessContext.Provider>;
}

/**
 * The registered access for `tenantSlug`, or null when none is registered
 * for that workspace (outside the provider, before the shell mounts, or for
 * another workspace).
 */
export function usePaletteWorkspaceAccess(tenantSlug: string | null): PaletteWorkspaceAccess | null {
    const access = useContext(PaletteWorkspaceAccessContext)?.access ?? null;
    return access && tenantSlug !== null && access.tenantSlug === tenantSlug ? access : null;
}

/** Registers the open workspace's access while mounted. Renders nothing. */
export function RegisterPaletteWorkspaceAccess() {
    const setAccess = useContext(PaletteWorkspaceAccessContext)?.setAccess;
    const { tenantSlug } = useTenantContext();
    const mayOpenSettings = useMayOpenSettings();
    const mayOpenTime = useMayOpenTime();
    const timeLanding = timeLandingOf(usePermissions());
    useEffect(() => {
        if (!setAccess) return;
        setAccess({ tenantSlug, mayOpenSettings, mayOpenTime, timeLanding });
        return () => setAccess(null);
    }, [setAccess, tenantSlug, mayOpenSettings, mayOpenTime, timeLanding]);
    return null;
}

/** The registered timer actions for `tenantSlug`, or null (another workspace, none registered). */
export function usePaletteTimerActions(tenantSlug: string | null): PaletteTimerActions | null {
    const timer = useContext(PaletteWorkspaceAccessContext)?.timer ?? null;
    return timer && tenantSlug !== null && timer.tenantSlug === tenantSlug ? timer : null;
}

/**
 * Registers one timer action (`stop` or `start`) for the open workspace while
 * `action` is set, and withdraws it on change or unmount. Renders nothing.
 */
export function useRegisterPaletteTimerAction(kind: 'stop' | 'start', action: { key: string; run: () => void } | null): void {
    const setTimer = useContext(PaletteWorkspaceAccessContext)?.setTimer;
    const { tenantSlug } = useTenantContext();
    const key = action?.key ?? null;
    const run = action?.run;
    useEffect(() => {
        if (!setTimer || key === null || !run) return;
        setTimer((current) => ({ ...(current?.tenantSlug === tenantSlug ? current : { tenantSlug }), [kind]: { key, run } }));
        return () =>
            setTimer((current) => {
                if (!current || current.tenantSlug !== tenantSlug || current[kind]?.key !== key) return current;
                const next = { ...current };
                delete next[kind];
                return next;
            });
    }, [setTimer, tenantSlug, kind, key, run]);
}
