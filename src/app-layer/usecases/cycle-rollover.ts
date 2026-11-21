/**
 * The nightly cycle rollover for one workspace (sub-phase 2.5a, owner decision
 * 64), run by the `cycle-rollover` job as the workspace's system user: a
 * scheduled consequence of the teams' cycle settings, acting for nobody
 * (`CLAUDE.md`, "Job identity").
 *
 * Per team, in one transaction under the team's cycle lock:
 *   1. keep the schedule filled (`fillScheduleInTx`), so the next cycle exists;
 *   2. close every open cycle whose last day is before today, oldest first.
 *      The close is a conditional update (`claimClose`): a second or a
 *      concurrent run finds nothing to close and moves nothing.
 *   3. move the closed cycle's unfinished items (Backlog, Unstarted, Started;
 *      live, in a live and unarchived project) to the team's next cycle, or
 *      out of cycles when the team's `rollover` is NO_CYCLE or no next cycle
 *      exists. Items in archived projects and deleted items stay behind.
 *      Each move increases the item's version and is audited
 *      (`WORK_ITEM_CYCLE_CHANGED`, reason `rollover`); no bell and no mail.
 *   4. one counts-only `CYCLE_COMPLETED` entry per closed cycle.
 *
 * Written fresh for Islestone (docs/porting/maps/2.5.md, "Jobs").
 */
import { logEvent } from '../events/audit';
import { CycleRepository, type CycleRow } from '../repositories/CycleRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { cycleLabel, dayKey, nextCycleAfter } from '../domain/cycle';
import { fillScheduleInTx } from './cycle';
import { keyOf } from './work-item-shared';
import type { RequestContext } from '../types';
import type { PrismaTx } from '@/lib/db-context';
import { runInTenantContext } from '@/lib/db-context';

/** Items moved per page of a closed cycle. */
export const ROLLOVER_PAGE = 500;

export interface RolloverResult {
    teams: number;
    cyclesCreated: number;
    cyclesClosed: number;
    itemsMoved: number;
}

/** The teams the rollover visits: an enabled schedule, or an open cycle that has ended. */
async function teamsToVisit(db: PrismaTx, ctx: RequestContext, today: Date): Promise<string[]> {
    const [schedules, ended] = await Promise.all([CycleRepository.listSchedules(db, ctx), CycleRepository.endedOpen(db, ctx, today)]);
    return [...new Set([...schedules.filter((s) => s.enabled).map((s) => s.teamId), ...ended.map((c) => c.teamId)])].sort();
}

export async function rolloverWorkspaceCycles(ctx: RequestContext, today: Date, now: Date = new Date()): Promise<RolloverResult> {
    const result: RolloverResult = { teams: 0, cyclesCreated: 0, cyclesClosed: 0, itemsMoved: 0 };
    const teamIds = await runInTenantContext(ctx, (db) => teamsToVisit(db, ctx, today));
    for (const teamId of teamIds) {
        // guardrail-allow: n+1 — one transaction per team, so one team's failure leaves the others' work committed.
        const r = await runInTenantContext(ctx, (db) => rolloverTeamInTx(db, ctx, teamId, today, now));
        result.teams += 1;
        result.cyclesCreated += r.created;
        result.cyclesClosed += r.closed;
        result.itemsMoved += r.moved;
    }
    return result;
}

async function rolloverTeamInTx(db: PrismaTx, ctx: RequestContext, teamId: string, today: Date, now: Date) {
    await CycleRepository.lockTeamCycles(db, teamId);
    const schedule = await CycleRepository.getSchedule(db, ctx, teamId);
    const created = schedule ? await fillScheduleInTx(db, ctx, schedule, today) : 0;
    const rollover = schedule?.rollover ?? 'NEXT_CYCLE';

    let closed = 0;
    let moved = 0;
    const open = await CycleRepository.openForTeam(db, ctx, teamId);
    for (const cycle of open.filter((c) => c.endsOn.getTime() < today.getTime())) {
        if (!(await CycleRepository.claimClose(db, ctx, cycle.id, now))) continue;
        closed += 1;
        // Oldest first: a cycle closed earlier in this pass starts before this
        // one ends, so `nextCycleAfter` never picks it.
        const next = rollover === 'NEXT_CYCLE' ? nextCycleAfter(open, cycle.endsOn) : null;
        const counts = await WorkItemRepository.countsByCycle(db, ctx, { kind: 'ALL' }, [cycle.id]);
        const rolledOver = await moveUnfinishedInTx(db, ctx, cycle, next);
        moved += rolledOver;
        const done = counts.filter((c) => c.stateCategory === 'DONE').reduce((n, c) => n + c._count._all, 0);
        await logEvent(db, ctx, {
            action: 'CYCLE_COMPLETED',
            entityType: 'Cycle',
            entityId: cycle.id,
            details: `Completed ${cycleLabel(cycle)}: ${done} done, ${rolledOver} moved ${next ? `to ${cycleLabel(next)}` : 'out of cycles'}`,
            detailsJson: { category: 'status_change', entityName: 'Cycle', fromStatus: 'ended', toStatus: 'completed', reason: 'rollover' },
            metadata: {
                teamId,
                number: cycle.number,
                endsOn: dayKey(cycle.endsOn),
                completed: done,
                rolledOver,
                toCycleId: next?.id ?? null,
                rollover,
                ...(rollover === 'NEXT_CYCLE' && !next ? { noNextCycle: true } : {}),
            },
        });
    }
    return { created, closed, moved };
}

async function moveUnfinishedInTx(db: PrismaTx, ctx: RequestContext, from: CycleRow, to: CycleRow | null): Promise<number> {
    let moved = 0;
    for (;;) {
        // guardrail-allow: n+1 — a bounded drain: each page leaves the cycle, so the next read finds the rest.
        const page = await WorkItemRepository.rolloverCandidates(db, ctx, from.id, ROLLOVER_PAGE);
        if (page.length === 0) return moved;
        // The page locked in id order (pages ascend by id; decision 173).
        const locked = await WorkItemRepository.lockForWrite(db, ctx, page.map((r) => r.id));
        const count = await WorkItemRepository.moveCycle(db, ctx, locked, from.id, to?.id ?? null);
        moved += count;
        for (const r of page) {
            await logEvent(db, ctx, {
                action: 'WORK_ITEM_CYCLE_CHANGED',
                entityType: 'WorkItem',
                entityId: r.id,
                details: to ? `Moved ${keyOf(r)} from ${cycleLabel(from)} to ${cycleLabel(to)} (rolled over)` : `Took ${keyOf(r)} out of ${cycleLabel(from)} (rolled over)`,
                detailsJson: { category: 'custom', event: 'cycle_changed', fromCycleId: from.id, toCycleId: to?.id ?? null, reason: 'rollover' },
                metadata: { fromCycleId: from.id, toCycleId: to?.id ?? null, reason: 'rollover' },
            });
        }
        if (count < page.length) return moved;
    }
}
