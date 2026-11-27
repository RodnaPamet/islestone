/**
 * The scale seed's estimates, capacity and time off (sub-phase 3.5b;
 * docs/porting/maps/3.5.md, "Performance (H2's rules)"), so the Workload
 * page's reads meet real volume:
 *
 *   - **Estimate units** (configuration, through `updateTeam`): at 10k the
 *     one team estimates in hours; at 100k the first three teams in hours,
 *     the fourth in points and the fifth not at all (the 20,000-item project
 *     is the fifth's, so the counted work stays under the read's bound).
 *   - **Estimates** on 60 % of the items of a team that estimates, drawn from
 *     their own stream (`estimateFor`) so the item plan's draws do not move:
 *     hours from 30 minutes to 3 days, points on a Fibonacci scale. The bulk
 *     writer and the sample both take them.
 *   - **Capacity** rows for a quarter of the members (a third of those part
 *     time, some on the first team's calendar), from Mondays in the past and
 *     the next weeks.
 *   - **Time off** for half the members: about 25 dates each over the past
 *     and next 26 weeks, whole days and part days, each type encrypted with
 *     the workspace's key by the real field-encryption function after the
 *     real padding (decision 287), so every ciphertext has one length.
 *
 * Capacity and time off are written as the database superuser in one
 * statement each, as the bulk half writes items: no audit entry (the
 * usecases' rows are the integration suite's).
 *
 * Written fresh for Islestone.
 */
import type { EstimateUnit, Prisma, PrismaClient } from '@prisma/client';

import { encryptWithKey } from '../../src/lib/security/encryption';
import { getTenantDek } from '../../src/lib/security/tenant-key-manager';
import { weekStartOf } from '../../src/lib/time/week';
import { padTimeOffType, TIME_OFF_TYPES } from '../../src/lib/workload/time-off';

import { stream } from './random';
import type { Shape } from './shapes';
import type { SeedEnv, SeedWorkspace } from './workspace';

// Not imported from `workspace.ts`, which imports this module for `seedEstimateUnit`.
const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export const WORKLOAD_RATIOS = {
    /** Share of a team's items carrying an estimate in its unit. */
    estimated: 0.6,
    /** Share of members with capacity rows, and of those part time. */
    withCapacity: 0.25,
    partTime: 1 / 3,
    /** Share of members with time off, and dates each (spread over ±26 weeks). */
    withTimeOff: 0.5,
    timeOffDates: 25,
    /** Share of time-off dates that are part days. */
    partDays: 0.3,
} as const;

const ESTIMATE_MINUTES = [30, 60, 90, 120, 180, 240, 360, 480, 720, 960, 1440] as const;
const ESTIMATE_POINTS = [1, 2, 3, 5, 8, 13] as const;

/** A team's estimate unit by its index: hours at 10k; hours, hours, hours, points, none at 100k. */
export function seedEstimateUnit(shape: Shape, teamIndex: number): EstimateUnit | null {
    if (shape.teams === 1) return 'HOURS';
    if (teamIndex <= 2) return 'HOURS';
    return teamIndex === 3 ? 'POINTS' : null;
}

/** The estimate columns of one planned item, from its own stream (never the item plan's). */
export function estimateFor(seed: string, slug: string, keyPrefix: string, index: number, unit: EstimateUnit | null): { estimateMinutes?: number; estimatePoints?: number } {
    if (unit === null) return {};
    const rng = stream(seed, `${slug}:estimate:${keyPrefix}:${index}`);
    if (!rng.chance(WORKLOAD_RATIOS.estimated)) return {};
    return unit === 'HOURS' ? { estimateMinutes: rng.pick(ESTIMATE_MINUTES) } : { estimatePoints: rng.pick(ESTIMATE_POINTS) };
}

/** Capacity rows and time off for the workspace's members. Returns the rows written. */
export async function seedCapacityAndTimeOff(env: SeedEnv, bulk: PrismaClient, ws: SeedWorkspace): Promise<{ capacityRows: number; timeOffDates: number }> {
    const rng = stream(env.seed, `${ws.slug}:workload`);
    const dek = await getTenantDek(ws.tenantId);
    const owner = ws.owner.userId;
    const thisMonday = new Date(`${weekStartOf(dayKey(env.anchor))}T00:00:00Z`).getTime();
    const capacity: Prisma.MemberCapacityCreateManyInput[] = [];
    const timeOff: Prisma.TimeOffCreateManyInput[] = [];
    for (const [i, member] of ws.members.entries()) {
        // The heavy member (index 0) always has both, so the read's one-person paths meet rows.
        if (i === 0 || rng.chance(WORKLOAD_RATIOS.withCapacity)) {
            const partTime = rng.chance(WORKLOAD_RATIOS.partTime);
            const onTeam = rng.chance(0.3);
            const weeks = [rng.int(-26, -1), rng.int(1, 12)];
            for (const w of weeks) {
                capacity.push({
                    id: rng.id(),
                    tenantId: ws.tenantId,
                    userId: member.userId,
                    effectiveFrom: new Date(thisMonday + w * 7 * DAY_MS),
                    weeklyMinutes: partTime ? rng.pick([1200, 1440, 1800]) : rng.pick([2250, 2400]),
                    calendarTeamId: onTeam ? ws.teams[0]!.id : null,
                    createdByUserId: owner,
                });
            }
        }
        if (i === 0 || rng.chance(WORKLOAD_RATIOS.withTimeOff)) {
            const days = new Set<number>();
            while (days.size < WORKLOAD_RATIOS.timeOffDates) days.add(rng.int(-26 * 7, 26 * 7));
            for (const d of days) {
                timeOff.push({
                    id: rng.id(),
                    tenantId: ws.tenantId,
                    userId: member.userId,
                    day: new Date(thisMonday + d * DAY_MS),
                    minutes: rng.chance(WORKLOAD_RATIOS.partDays) ? rng.pick([60, 120, 240]) : null,
                    type: encryptWithKey(dek, padTimeOffType(rng.pick(TIME_OFF_TYPES))),
                    createdByUserId: member.userId,
                    updatedByUserId: member.userId,
                });
            }
        }
    }
    await bulk.memberCapacity.createMany({ data: capacity });
    await bulk.timeOff.createMany({ data: timeOff });
    env.log(`${ws.slug}: ${capacity.length} capacity rows, ${timeOff.length} dates of time off`);
    return { capacityRows: capacity.length, timeOffDates: timeOff.length };
}
