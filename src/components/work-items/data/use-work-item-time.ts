'use client';

/**
 * An item's time (sub-phase 3.4b; owner decision 266), read through
 * `use-tenant-swr.ts` at the route's own path: its total and the caller's
 * own, its entries newest first, and what the caller may do (`viewer`, asked
 * on the server). Writes are `useTimeWrites` (`src/components/time/data/`),
 * which read this again after every change.
 *
 * Written fresh for Islestone.
 */
import { WORK_ITEM_TIME_PATH } from '@/components/time/data/use-time';
import { useTenantSWR } from '@/lib/data/use-tenant-swr';
import type { WorkItemTimeData } from '@/lib/time/entries';

export function useWorkItemTime(itemId: string | null, cursor?: string) {
    const path = itemId ? `${WORK_ITEM_TIME_PATH(itemId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` : null;
    return useTenantSWR<WorkItemTimeData>(path);
}
