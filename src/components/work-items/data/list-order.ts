'use client';

/**
 * The order the last list or board showed, so the detail's prev/next stepper
 * steps through the items in the order the person saw them. The list
 * publishes the keys it displays; the detail reads them. Per tab
 * (`sessionStorage`), keyed per workspace through `uiStorageKey`; storage
 * that throws (private mode, quota) degrades to "no stepper".
 *
 * Written fresh for Islestone (sub-phase 2.3), in place of
 * inflect-compliance's `use-entity-list-ids.ts`, which re-fetched the list to
 * learn its order.
 */
import { useEffect, useState } from 'react';

import { uiStorageKey } from '@/lib/ui-storage';

const MAX_KEYS = 500;

function storageKey(tenantSlug: string): string {
    return uiStorageKey('work-items', 'order', tenantSlug);
}

export function publishListOrder(tenantSlug: string, keys: readonly string[]): void {
    try {
        window.sessionStorage.setItem(storageKey(tenantSlug), JSON.stringify(keys.slice(0, MAX_KEYS)));
    } catch {
        // Storage unavailable: the stepper simply does not render.
    }
}

export function readListOrder(tenantSlug: string): string[] {
    try {
        const raw = window.sessionStorage.getItem(storageKey(tenantSlug));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

/** The published order, read after mount (never during server render). */
export function useListOrder(tenantSlug: string): string[] {
    const [keys, setKeys] = useState<string[]>([]);
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser's storage after hydration
        setKeys(readListOrder(tenantSlug));
    }, [tenantSlug]);
    return keys;
}
