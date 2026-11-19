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
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useMayOpenSettings } from '@/components/layout/nav-config';
import { useTenantContext } from '@/lib/tenant-context-provider';

export interface PaletteWorkspaceAccess {
    tenantSlug: string;
    mayOpenSettings: boolean;
}

interface PaletteWorkspaceAccessValue {
    access: PaletteWorkspaceAccess | null;
    setAccess: (next: PaletteWorkspaceAccess | null) => void;
}

const PaletteWorkspaceAccessContext = createContext<PaletteWorkspaceAccessValue | null>(null);

export function PaletteWorkspaceAccessProvider({ children }: { children: ReactNode }) {
    const [access, setAccess] = useState<PaletteWorkspaceAccess | null>(null);
    const value = useMemo(() => ({ access, setAccess }), [access]);
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
    useEffect(() => {
        if (!setAccess) return;
        setAccess({ tenantSlug, mayOpenSettings });
        return () => setAccess(null);
    }, [setAccess, tenantSlug, mayOpenSettings]);
    return null;
}
