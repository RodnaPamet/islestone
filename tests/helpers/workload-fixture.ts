/**
 * A large, deterministic workload input (sub-phase 3.5b): 500 people, 20,000
 * counted items, about 12,500 dates of time off, 26 weeks, three calendars
 * with holidays. The performance test times `buildWorkload` on it; the time
 * zone test runs it under several process zones (`workload-under-tz.ts`).
 */
import { compileCalendar, type EpochDay } from '../../src/app-layer/domain/schedule/calendar';
import type { WorkloadInput, WorkloadItemSpec } from '../../src/app-layer/domain/workload/workload';

/** A deterministic pseudo-random sequence (mulberry32). */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function largeWorkload(itemCount = 20_000): WorkloadInput {
    const rand = rng(35);
    const monday: EpochDay = 20_795; // 2026-12-07
    const calendars = [
        compileCalendar({ id: 'ws', workingWeekdays: [1, 2, 3, 4, 5], holidays: Array.from({ length: 30 }, (_, k) => monday + k * 11) }),
        compileCalendar({ id: 'team-a', workingWeekdays: [1, 2, 3, 4, 5], holidays: Array.from({ length: 15 }, (_, k) => monday + k * 17) }),
        compileCalendar({ id: 'team-b', workingWeekdays: [7, 1, 2, 3, 4], holidays: [] }),
    ];
    const people = Array.from({ length: 500 }, (_, i) => {
        const timeOff = Array.from({ length: 25 }, (_, k) => ({ day: monday - 10 + ((i * 7 + k * 13) % 190), minutes: k % 3 === 0 ? 120 : null }));
        const rows = i % 4 === 0 ? [{ effectiveFrom: monday - 7 * 10, weeklyMinutes: 1440, calendarTeamId: i % 8 === 0 ? 'team-a' : null }] : [];
        return { userId: `u${i}`, person: { active: i % 50 !== 0, rows, timeOff: [...new Map(timeOff.map((t) => [t.day, t])).values()] } };
    });
    const teams = ['ws', 'team-a', 'team-b'];
    const items: WorkloadItemSpec[] = Array.from({ length: itemCount }, (_, i) => {
        const dated = rand() < 0.85;
        const start = monday + Math.floor(rand() * 200) - 40;
        return {
            id: `i${i}`,
            assigneeId: rand() < 0.05 ? null : `u${Math.floor(rand() * 500)}`,
            projectId: `p${i % 20}`,
            teamId: teams[i % 3]!,
            startDate: dated && rand() < 0.5 ? start : null,
            dueDate: dated ? start + Math.floor(rand() * 40) : null,
            estimateMinutes: 30 + Math.floor(rand() * 2400),
            spentMinutes: rand() < 0.3 ? Math.floor(rand() * 600) : 0,
        };
    });
    const byId = new Map(calendars.map((c) => [c.id, c]));
    return {
        firstMonday: monday,
        weekCount: 26,
        people,
        capacity: { defaultWeeklyMinutes: 2400, calendarFor: (t) => byId.get(t ?? 'ws') ?? calendars[0]! },
        items,
        calendarOfTeam: (t) => ({ calendar: byId.get(t) ?? calendars[0]!, today: monday + 2 }),
        share: { projectId: 'p3' },
    };
}

