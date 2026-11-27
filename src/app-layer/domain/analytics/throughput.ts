/**
 * Throughput (sub-phase 3.6a; docs/porting/maps/3.6.md, "Throughput"): the
 * number of items whose completion (as of the moment of reading, decision
 * 311) falls on each day of the window, in the scope's zone, summed per ISO
 * week (Monday to Sunday) for the charts. The median is over whole bins.
 *
 * Pure. Written fresh for Islestone.
 */
import { fromEpochDay, isoWeekday, type EpochDay } from '../schedule/calendar';
import { nearestRank } from './percentiles';

export interface ThroughputBinOut {
    start: string;
    end: string;
    count: number;
    /** False for a first or last week the window cuts. */
    whole: boolean;
}

/** Bins from per-day counts (days outside the window are ignored). */
export function binThroughput(perDay: ReadonlyMap<EpochDay, number>, fromDay: EpochDay, toDay: EpochDay, bin: 'day' | 'week'): { bins: ThroughputBinOut[]; total: number; median: number | null } {
    const bins: ThroughputBinOut[] = [];
    let total = 0;
    let open: { start: EpochDay; end: EpochDay; count: number } | null = null;
    const close = () => {
        if (!open) return;
        const whole = bin === 'day' || (isoWeekday(open.start) === 1 && isoWeekday(open.end) === 7);
        bins.push({ start: fromEpochDay(open.start), end: fromEpochDay(open.end), count: open.count, whole });
        open = null;
    };
    for (let d = fromDay; d <= toDay; d++) {
        const n = perDay.get(d) ?? 0;
        total += n;
        if (bin === 'day' || !open || isoWeekday(d) === 1) {
            close();
            open = { start: d, end: d, count: 0 };
        }
        open!.end = d;
        open!.count += n;
    }
    close();
    const wholeCounts = bins.filter((b) => b.whole).map((b) => b.count).sort((a, b) => a - b);
    return { bins, total, median: nearestRank(wholeCounts, 0.5) };
}
