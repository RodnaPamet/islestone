/**
 * The scale seed's time entries (sub-phase 3.4b; docs/porting/maps/3.4.md,
 * "Performance"): about five entries on 60 % of the live items over the last
 * 26 weeks, by writers drawn as assignees are, and a full working week for
 * the heavy member every week (four entries a day, Monday to Friday), so a
 * person's week, an item's time and a project's time read real volume.
 *
 * Written as the database superuser in batches of 5,000, as the bulk half
 * writes items: minutes 15 to 240 (never past 24 hours in one person's day),
 * a fifth billable, a fifth with a description sanitised and encrypted with
 * the workspace's key by the real field-encryption function. No running
 * timer, no audit entry (the sample of usecase-written rows is the
 * integration suite's).
 *
 * 3.4c adds approved weeks, 3.4d rates at the three levels.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { encryptWithKey } from '../../src/lib/security/encryption';
import { sanitizePlainText } from '../../src/lib/security/sanitize';
import { getTenantDek } from '../../src/lib/security/tenant-key-manager';
import { weekStartOf } from '../../src/lib/time/week';

import { stream, zipf } from './random';
import { shortText } from './text';
import type { SeedEnv, SeedWorkspace } from './workspace';
import { DAY_MS, dayKey } from './workspace';

export const TIME_RATIOS = {
    /** Share of live items with time on them. */
    itemsWithTime: 0.6,
    /** Entries on each of those items. */
    entriesPerItem: 5,
    /** Weeks of history. */
    weeks: 26,
    /** The heavy member's entries per working day. */
    heavyPerDay: 4,
    billable: 0.2,
    described: 0.2,
} as const;

const MINUTES = [15, 30, 45, 60, 90, 120, 180, 240] as const;
const BATCH = 5_000;

export async function seedTimeEntries(env: SeedEnv, bulk: PrismaClient, ws: SeedWorkspace): Promise<number> {
    const dek = await getTenantDek(ws.tenantId);
    const rng = stream(env.seed, `${ws.slug}:time`);
    const items = await bulk.$queryRawUnsafe<Array<{ id: string; projectId: string }>>(
        `SELECT "id", "projectId" FROM "WorkItem" WHERE "tenantId" = $1 AND "deletedAt" IS NULL ORDER BY "id"`,
        ws.tenantId,
    );
    const writer = zipf(ws.writers.length);
    const days = TIME_RATIOS.weeks * 7;
    const used = new Map<string, number>();
    const rows: Prisma.TimeEntryCreateManyInput[] = [];
    const add = (userId: string, item: { id: string; projectId: string }, date: string): boolean => {
        const minutes = rng.pick(MINUTES);
        const key = `${userId}:${date}`;
        const before = used.get(key) ?? 0;
        if (before + minutes > 1_440) return false;
        used.set(key, before + minutes);
        const created = new Date(`${date}T17:00:00Z`);
        rows.push({
            id: rng.id(),
            tenantId: ws.tenantId,
            userId,
            createdByUserId: userId,
            workItemId: item.id,
            projectId: item.projectId,
            workDate: new Date(`${date}T00:00:00Z`),
            minutes,
            source: 'MANUAL',
            billable: rng.chance(TIME_RATIOS.billable),
            description: rng.chance(TIME_RATIOS.described) ? encryptWithKey(dek, sanitizePlainText(shortText(rng))) : null,
            createdAt: created,
            updatedAt: created,
        });
        return true;
    };

    for (const item of items) {
        if (!rng.chance(TIME_RATIOS.itemsWithTime)) continue;
        for (let n = 0; n < TIME_RATIOS.entriesPerItem; n++) {
            const date = dayKey(new Date(env.anchor.getTime() - rng.int(0, days - 1) * DAY_MS));
            // A writer whose day is full hands the entry to another, drawn evenly.
            if (!add(ws.writers[writer(rng)]!.userId, item, date)) add(rng.pick(ws.writers).userId, item, date);
        }
    }
    // The heavy member's full weeks: Monday to Friday of each of the last 26 weeks, up to today.
    const heavy = ws.members[0]!.userId;
    const thisMonday = weekStartOf(dayKey(env.anchor));
    for (let w = 0; w < TIME_RATIOS.weeks; w++) {
        for (let d = 0; d < 5; d++) {
            const at = new Date(new Date(`${thisMonday}T00:00:00Z`).getTime() - (w * 7 - d) * DAY_MS);
            if (at.getTime() > env.anchor.getTime()) continue;
            for (let n = 0; n < TIME_RATIOS.heavyPerDay; n++) add(heavy, rng.pick(items), dayKey(at));
        }
    }

    for (let i = 0; i < rows.length; i += BATCH) {
        // guardrail-allow: n+1 — a bounded batch insert, one statement per 5,000 rows.
        await bulk.timeEntry.createMany({ data: rows.slice(i, i + BATCH) });
    }
    env.log(`${ws.slug}: ${rows.length} time entries`);
    return rows.length;
}
