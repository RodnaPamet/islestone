/**
 * The Workload page's read (sub-phases 3.5a and 3.5b; docs/porting/maps/3.5.md,
 * "The read" and "Rules no decision names (3.5b, as built)"; ADR 0013 §1 and
 * §6 to §9; owner decisions 284 to 298).
 *
 * `GET /workload?from&weeks&userId&projectId&teamId&recipientListId&over`
 * (`workload.view`): `from` a Monday not before the current week (400
 * `WORKLOAD_RANGE`), the current week when absent; at most 26 weeks. The
 * people are the ACTIVE members of every role but GUEST (decision 204) and
 * the deactivated members who still hold open work, at most 500 active ones,
 * read one past and refused 422 `WORKLOAD_TOO_LARGE`, never cut. Filters
 * narrow the PEOPLE (decision 297): named people (`me` the caller), the
 * people a workspace recipient list resolves to, those with counted work of
 * a project or team in the window, those over capacity in some week; a
 * person's cells always count all their visible work, and a project or team
 * filter reports its share beside it.
 *
 * Per person and week: the capacity (`domain/workload/capacity.ts`), the
 * hours of their counted work placed there and how far over capacity they
 * are (`domain/workload/allocation.ts`, `workload.ts`), and beside them "No
 * dates", "Not estimated", "Points work" and "Later". Work assigned to nobody
 * is one row of its own. Counted work (decision 292) is live, open, in a
 * visible, unarchived project, of a team estimating in hours, with a counted
 * estimate; its remaining minutes are its estimate less the time recorded on
 * it when the caller holds `time.view` (decision 295), else the estimate.
 * Never a time-off type (the time-off read selects none), never stored,
 * audited or logged per person.
 *
 * `GET /workload/cell?userId&week` (`workload.view`): the items that fill one
 * person's week, most minutes first, at most 200, each with its minutes and
 * why; listed only when the caller may read work items. For an over-capacity
 * week, the ways to rebalance it (3.5c, decision 299;
 * `domain/workload/options.ts`), worked out only for a signed-in person who
 * reads work items and may assign them or change their dates: nothing is
 * stored, and an option only opens an existing confirmation.
 *
 * Written fresh for Islestone.
 */
import { visibleProjects } from '../policies/project-visibility';
import { mayViewTime } from '../policies/time.policies';
import { mayAssignWorkItems, mayEditWorkItems, mayReadWorkItems } from '../policies/work-item.policies';
import { actsOnWorkloadAsPerson, assertCanViewWorkload } from '../policies/workload.policies';
import { ProjectRepository } from '../repositories/ProjectRepository';
import { TimeEntryRepository } from '../repositories/TimeEntryRepository';
import { WorkItemRepository, type WorkItemWorkloadRow } from '../repositories/WorkItemRepository';
import { WorkloadRepository, type WorkloadPersonRecord } from '../repositories/WorkloadRepository';
import type { RequestContext } from '../types';
import { fromEpochDay, isoWeekday, todayIn, toEpochDay, type EpochDay } from '../domain/schedule/calendar';
import { capacityByWeek, type CapacityPerson, type CapacityRowSpec, type TimeOffDaySpec } from '../domain/workload/capacity';
import { planRebalance, REBALANCE_LIMITS, type RebalanceOptions } from '../domain/workload/options';
import { buildWorkload, hasShareInWindow, isOverInWindow, type ItemCalendar, type WorkloadItemSpec, type WorkloadRowFigures } from '../domain/workload/workload';
import { resolveListRecipients } from '../notifications/recipient-list';
import { DEFAULT_WEEKLY_MINUTES } from './workload-capacity';
import { todayOfCalendars, workspaceToday } from './workload-shared';
import { resolveWorkingCalendars, type WorkingCalendarSet } from './working-calendar';
import { formatKey } from '../domain/work-item-key';
import { todayClock } from '@/lib/clock';
import { runInTenantReadContext, type PrismaTx } from '@/lib/db-context';
import { AppError, badRequest, notFound } from '@/lib/errors/types';
import { dateOnlyValue } from '@/lib/time/week';
import { WORKLOAD_LIMITS } from '@/lib/workload/time-off';
import type { WorkloadCellData, WorkloadCellItem, WorkloadData, WorkloadFiltersApplied, WorkloadPersonRow, WorkloadRebalance, WorkloadRebalanceItem } from '@/lib/workload/types';

/** The most capacity rows and time-off dates one read takes (500 people, 26 weeks). */
const CAPACITY_ROWS_TAKE = 20_000;
const TIME_OFF_ROWS_TAKE = 100_000;
/** The most assignees the unplaced counts return. */
const UNPLACED_GROUPS_TAKE = 50_000;

/** The `userId` of the cell for work assigned to nobody. */
export const UNASSIGNED_CELL = 'unassigned';

export interface WorkloadQuery {
    from?: string;
    weeks?: number;
    /** One person or several, comma-separated; `me` the caller. */
    userId?: string;
    projectId?: string;
    teamId?: string;
    recipientListId?: string;
    over?: 'true' | 'false';
}

function tooLarge(what: string, limit: number): AppError {
    return new AppError(`Workload ${what}; narrow it.`, 'WORKLOAD_TOO_LARGE', 422, true, { reason: 'WORKLOAD_TOO_LARGE', limit });
}

/** The window: its first Monday (not before the current week) and its weeks. */
function windowOf(calendars: WorkingCalendarSet, from: string | undefined, weekCount: number) {
    const { today, currentWeek, timeZone } = todayOfCalendars(calendars);
    const first = from ? toEpochDay(from) : currentWeek;
    if (isoWeekday(first) !== 1 || first < currentWeek) {
        throw badRequest('A workload read starts on a Monday, from the current week on.', { reason: 'WORKLOAD_RANGE' });
    }
    return { today, currentWeek, timeZone, first, weekCount, last: first + 7 * weekCount - 1 };
}

/** Each calendar's today in its own zone (decision 191), computed once per calendar. */
function itemCalendars(calendars: WorkingCalendarSet): (teamId: string) => ItemCalendar {
    const todayByCalendar = new Map<string, EpochDay>();
    for (const c of calendars.all()) todayByCalendar.set(c.id, todayIn(c.timeZone, todayClock(c.timeZone)));
    return (teamId) => {
        const c = calendars.forTeam(teamId);
        return { calendar: c.compiled, today: todayByCalendar.get(c.id)! };
    };
}

/** The capacity inputs of several people, read in ONE statement (the default, their rows, their time-off dates). */
async function capacityInputs(db: PrismaTx, ctx: RequestContext, people: readonly WorkloadPersonRecord[], first: EpochDay, last: EpochDay) {
    const read = await WorkloadRepository.capacityInputs(db, ctx, {
        userIds: people.map((p) => p.userId),
        from: fromEpochDay(first),
        to: fromEpochDay(last),
        rowsTake: CAPACITY_ROWS_TAKE,
        timeOffTake: TIME_OFF_ROWS_TAKE,
    });
    const rowsBy = new Map<string, CapacityRowSpec[]>();
    for (const r of read.rows) {
        const list = rowsBy.get(r.userId) ?? [];
        list.push({ effectiveFrom: toEpochDay(r.effectiveFrom), weeklyMinutes: r.weeklyMinutes, calendarTeamId: r.calendarTeamId });
        rowsBy.set(r.userId, list);
    }
    const offBy = new Map<string, TimeOffDaySpec[]>();
    for (const r of read.timeOff) {
        const list = offBy.get(r.userId) ?? [];
        list.push({ day: toEpochDay(r.day), minutes: r.minutes });
        offBy.set(r.userId, list);
    }
    const person = (p: WorkloadPersonRecord): CapacityPerson => ({ active: p.active, rows: rowsBy.get(p.userId) ?? [], timeOff: offBy.get(p.userId) ?? [] });
    return { defaultWeeklyMinutes: read.defaultWeeklyMinutes ?? DEFAULT_WEEKLY_MINUTES, person };
}

/** The counted items as plain data, each with its time spent when the caller may see it (decision 295). */
async function countedItems(db: PrismaTx, ctx: RequestContext, rows: readonly WorkItemWorkloadRow[]): Promise<{ items: WorkloadItemSpec[]; timeSpentCounted: boolean }> {
    const timeSpentCounted = mayViewTime(ctx);
    const spent = timeSpentCounted ? await TimeEntryRepository.totalsForItems(db, ctx, rows.map((r) => r.id)) : new Map<string, number>();
    return {
        timeSpentCounted,
        items: rows.map((r) => ({
            id: r.id,
            assigneeId: r.assigneeId,
            projectId: r.projectId,
            teamId: r.teamId,
            startDate: r.startDate ? toEpochDay(r.startDate) : null,
            dueDate: r.dueDate ? toEpochDay(r.dueDate) : null,
            estimateMinutes: r.estimateMinutes ?? 0,
            spentMinutes: timeSpentCounted ? (spent.get(r.id) ?? 0) : null,
        })),
    };
}

function personRow(p: WorkloadPersonRecord, figures: WorkloadRowFigures, unplaced: { notEstimated: number; pointsWork: { count: number; points: number } } | undefined): WorkloadPersonRow {
    return {
        userId: p.userId,
        name: p.name,
        active: p.active,
        capacity: figures.capacity.map((w) => w.capacityMinutes),
        weeklyMinutes: figures.capacity.map((w) => w.weeklyMinutes),
        timeOffMinutes: figures.capacity.map((w) => w.timeOffMinutes),
        timeOffDays: figures.capacity.map((w) => w.timeOffDays.map(fromEpochDay)),
        allocated: figures.allocated,
        over: figures.over,
        share: figures.share,
        later: figures.later,
        noDates: figures.noDates,
        notEstimated: unplaced?.notEstimated ?? 0,
        pointsWork: unplaced?.pointsWork ?? { count: 0, points: 0 },
    };
}

/** The named people of a `userId` filter (`me` the caller), each once. */
function namedPeople(ctx: RequestContext, userId: string | undefined): string[] | null {
    if (!userId) return null;
    return [...new Set(userId.split(',').map((id) => (id === 'me' ? ctx.userId : id)))];
}

export async function getWorkload(ctx: RequestContext, query: WorkloadQuery): Promise<WorkloadData> {
    assertCanViewWorkload(ctx);
    const weekCount = query.weeks ?? WORKLOAD_LIMITS.weeksDefault;
    if (weekCount < 1 || weekCount > WORKLOAD_LIMITS.weeksMax) throw badRequest(`A workload read covers 1 to ${WORKLOAD_LIMITS.weeksMax} weeks.`, { reason: 'WORKLOAD_RANGE' });
    const named = namedPeople(ctx, query.userId);
    const over = query.over === 'true';
    const filters: WorkloadFiltersApplied = {
        userIds: named,
        projectId: query.projectId ?? null,
        teamId: query.teamId ?? null,
        recipientListId: query.recipientListId ?? null,
        over,
    };

    return runInTenantReadContext(ctx, async (db) => {
        // Every calendar of the workspace in one read (bounded): today's zones and the people's and items' calendars.
        const calendars = await resolveWorkingCalendars(db, ctx);
        const win = windowOf(calendars, query.from, weekCount);
        const v = await visibleProjects(ctx, db);

        // The people a filter names (a list resolved at read time), else everybody.
        let only: string[] | null = named;
        if (query.recipientListId) {
            const resolved = await resolveListRecipients(db, ctx.tenantId, { listIds: [query.recipientListId], may: () => true });
            const listed = resolved.userIds;
            only = only ? only.filter((id) => listed.includes(id)) : [...listed];
        }
        // The unplaced counts first: every assignee with open work is a row of them, so the one people read can also
        // take the deactivated members who still hold some.
        const counts = await WorkItemRepository.workloadUnplacedCounts(db, ctx, v, { assigneeIds: only ?? undefined, take: UNPLACED_GROUPS_TAKE });
        const people = await WorkloadRepository.people(db, ctx, {
            take: WORKLOAD_LIMITS.personLimit + 1 + counts.length,
            userIds: only ?? undefined,
            holders: counts.map((c) => c.assigneeId),
        });
        if (people.filter((p) => p.active).length > WORKLOAD_LIMITS.personLimit) throw tooLarge(`shows at most ${WORKLOAD_LIMITS.personLimit} people`, WORKLOAD_LIMITS.personLimit);

        const capacity = await capacityInputs(db, ctx, people, win.first, win.last);
        const rows = await WorkItemRepository.listForWorkload(db, ctx, v, {
            assigneeIds: only ? people.map((p) => p.userId) : undefined,
            // Only the current week shows overdue work (on today); a later window reads what is due in it or after.
            dueOnOrAfter: win.first > win.currentWeek ? dateOnlyValue(fromEpochDay(win.first)) : null,
            take: WORKLOAD_LIMITS.itemLimit + 1,
        });
        if (rows.length > WORKLOAD_LIMITS.itemLimit) throw tooLarge(`places at most ${WORKLOAD_LIMITS.itemLimit} items`, WORKLOAD_LIMITS.itemLimit);
        const { items, timeSpentCounted } = await countedItems(db, ctx, rows);

        const share = query.projectId || query.teamId ? { projectId: query.projectId, teamId: query.teamId } : undefined;
        const figures = buildWorkload({
            firstMonday: win.first,
            weekCount,
            people: people.map((p) => ({ userId: p.userId, person: capacity.person(p) })),
            capacity: { defaultWeeklyMinutes: capacity.defaultWeeklyMinutes, calendarFor: (teamId) => calendars.forTeam(teamId).compiled },
            items,
            calendarOfTeam: itemCalendars(calendars),
            share,
        });
        const unplaced = new Map(counts.map((c) => [c.assigneeId, c] as const));

        const shown = people.filter((p) => {
            const row = figures.rows.get(p.userId)!;
            if (share && !hasShareInWindow(row)) return false;
            if (over && !isOverInWindow(row)) return false;
            return true;
        });
        const unassigned = figures.unassigned;
        const showUnassigned = only === null && !over && (unassigned.placedCount > 0 || unassigned.noDates.count > 0) && (!share || hasShareInWindow(unassigned));

        return {
            weeks: Array.from({ length: weekCount }, (_, i) => fromEpochDay(win.first + 7 * i)),
            today: fromEpochDay(win.today),
            timeZone: win.timeZone,
            people: shown.map((p) => personRow(p, figures.rows.get(p.userId)!, unplaced.get(p.userId))),
            unassigned: showUnassigned ? { allocated: unassigned.allocated, share: unassigned.share, later: unassigned.later, noDates: unassigned.noDates } : null,
            calendars: calendars.all().map((c) => ({ id: c.id, timeZone: c.timeZone })),
            timeSpentCounted,
            filters,
        };
    });
}

/**
 * The items that fill one person's week (or the unassigned's), with the week's figures and, for an
 * over-capacity week, the ways to rebalance it (3.5c).
 *
 * A viewer who could be offered a way (a signed-in person who reads work items and holds
 * `work_items.assign` or `work_items.edit`) has the counted work read over the options' window: every
 * member's when they may assign (the people on each item's project and their weeks), else the person's.
 * The statements stay the cell's: the calendars, the visibility, the items, their time, the people, their
 * capacity, the projects shown.
 */
export async function getWorkloadCell(ctx: RequestContext, query: { userId: string; week: string }): Promise<WorkloadCellData> {
    assertCanViewWorkload(ctx);
    const forUnassigned = query.userId === UNASSIGNED_CELL;
    const userId = query.userId === 'me' ? ctx.userId : query.userId;
    const itemsShown = mayReadWorkItems(ctx);
    // ADR 0003: only a signed-in person is offered a way to rebalance; an agent never computes one.
    const person = actsOnWorkloadAsPerson(ctx);
    const offered = { assign: itemsShown && person && mayAssignWorkItems(ctx), moveDates: itemsShown && person && mayEditWorkItems(ctx) };
    const mayRebalance = !forUnassigned && (offered.assign || offered.moveDates);

    return runInTenantReadContext(ctx, async (db) => {
        const calendars = await resolveWorkingCalendars(db, ctx);
        const win = windowOf(calendars, query.week, 1);
        const v = await visibleProjects(ctx, db);
        const cellAhead = (win.first - win.currentWeek) / 7;
        const tooFar = mayRebalance && cellAhead > REBALANCE_LIMITS.cellWeeksAhead;
        // The options' window: from the current week to some weeks after the cell's (`domain/workload/options.ts`).
        const options = mayRebalance && !tooFar ? { first: win.currentWeek, weekCount: cellAhead + 1 + REBALANCE_LIMITS.weeksAfterCell } : null;
        const readFrom = options ? options.first : win.first;
        const readTo = options ? options.first + 7 * options.weekCount - 1 : win.last;

        const personItems = async () =>
            WorkItemRepository.listForWorkload(db, ctx, v, {
                ...(forUnassigned ? { unassignedOnly: true } : { assigneeIds: [userId] }),
                // Only the current week shows overdue work (on today); a later cell reads what is due in it or after, unless options read from the current week.
                dueOnOrAfter: !options && win.first > win.currentWeek ? dateOnlyValue(fromEpochDay(win.first)) : null,
                take: WORKLOAD_LIMITS.itemLimit + 1,
            });
        let rows: WorkItemWorkloadRow[];
        let everyoneRead = false;
        if (options && offered.assign) {
            // Every member's counted work (the view's one read); above its bound, the person's alone and nobody to assign to.
            rows = await WorkItemRepository.listForWorkload(db, ctx, v, { take: WORKLOAD_LIMITS.itemLimit + 1 });
            everyoneRead = rows.length <= WORKLOAD_LIMITS.itemLimit;
            if (!everyoneRead) rows = await personItems();
        } else {
            rows = await personItems();
        }
        if (rows.length > WORKLOAD_LIMITS.itemLimit) throw tooLarge(`places at most ${WORKLOAD_LIMITS.itemLimit} items`, WORKLOAD_LIMITS.itemLimit);
        const { items: allItems, timeSpentCounted } = await countedItems(db, ctx, rows);
        const items = forUnassigned ? allItems.filter((i) => i.assigneeId === null) : allItems.filter((i) => i.assigneeId === userId);

        // The person, whatever their status, and the others holding work on the person's projects (ACTIVE ones only).
        const itemCalendar = itemCalendars(calendars);
        let peers: string[] = [];
        if (options && everyoneRead) {
            const projects = new Set(items.map((i) => i.projectId));
            peers = [...new Set(allItems.filter((i) => i.assigneeId !== null && i.assigneeId !== userId && projects.has(i.projectId)).map((i) => i.assigneeId!))];
        }
        const people = forUnassigned ? [] : await WorkloadRepository.people(db, ctx, { take: peers.length + 2, userIds: peers, holders: [], anyStatus: [userId] });
        const record = forUnassigned ? null : (people.find((p) => p.userId === userId) ?? null);
        if (!forUnassigned && !record) throw notFound('That person is not a member of this workspace.');
        const others = people.filter((p) => p.userId !== userId && p.active);

        const capacity = record ? await capacityInputs(db, ctx, [record, ...others], readFrom, readTo) : null;
        const calendarFor = (teamId: string | null) => calendars.forTeam(teamId).compiled;
        const figures = buildWorkload({
            firstMonday: win.first,
            weekCount: 1,
            people: record && capacity ? [{ userId: record.userId, person: capacity.person(record) }] : [],
            capacity: { defaultWeeklyMinutes: capacity?.defaultWeeklyMinutes ?? DEFAULT_WEEKLY_MINUTES, calendarFor },
            items,
            calendarOfTeam: itemCalendar,
        });
        const row = record ? figures.rows.get(record.userId)! : figures.unassigned;
        const filling = (figures.placed.get(record ? record.userId : null) ?? [])
            .filter((p) => p.placement.weeks[0]! > 0)
            .sort((a, b) => b.placement.weeks[0]! - a.placement.weeks[0]! || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
        const listed = itemsShown ? filling.slice(0, WORKLOAD_LIMITS.cellItems) : [];
        const over = row.over[0]! > 0;

        // The ways to rebalance an over-capacity week (decision 299): worked out in code, never stored.
        let plan: RebalanceOptions | null = null;
        if (options && over && record && capacity) {
            const weeks = Array.from({ length: options.weekCount }, (_, i) => options.first + 7 * i);
            const capacityCtx = { defaultWeeklyMinutes: capacity.defaultWeeklyMinutes, calendarFor };
            const rebalancePerson = (p: WorkloadPersonRecord) => ({
                userId: p.userId,
                name: p.name,
                capacity: capacityByWeek(capacity.person(p), weeks, capacityCtx).map((w) => w.capacityMinutes),
                items: allItems.filter((i) => i.assigneeId === p.userId),
            });
            plan = planRebalance({
                firstMonday: options.first,
                weekCount: options.weekCount,
                cellWeek: win.first,
                person: rebalancePerson(record),
                wholeDaysOff: capacity.person(record).timeOff.filter((t) => t.minutes === null).map((t) => t.day),
                others: everyoneRead ? others.map(rebalancePerson) : null,
                calendarOfTeam: itemCalendar,
                offer: offered,
            });
        }

        const byId = new Map(rows.map((r) => [r.id, r] as const));
        const shownIds = new Set([...listed.map((p) => p.item.id), ...(plan ? [...plan.items.map((i) => i.itemId), ...plan.dueDuringTimeOff.map((d) => d.itemId)] : [])]);
        const projectIds = [...new Set([...shownIds].map((id) => byId.get(id)?.projectId).filter((id): id is string => Boolean(id)))];
        const projects = projectIds.length > 0 ? await ProjectRepository.visibleByIds(db, ctx, v, projectIds) : [];
        const projectById = new Map(projects.map((p) => [p.id, p] as const));
        const keyOf = (id: string) => {
            const r = byId.get(id);
            const project = r ? projectById.get(r.projectId) : undefined;
            return r && project ? { r, project, key: formatKey(project.keyPrefix, r.number) } : null;
        };

        const cellItems: WorkloadCellItem[] = listed.flatMap((p) => {
            const k = keyOf(p.item.id);
            if (!k) return [];
            return [
                {
                    id: k.r.id,
                    key: k.key,
                    title: k.r.title,
                    projectId: k.project.id,
                    projectName: k.project.name,
                    startDate: dayString(k.r.startDate),
                    dueDate: dayString(k.r.dueDate),
                    estimateMinutes: p.item.estimateMinutes,
                    remainingMinutes: p.remainingMinutes,
                    minutes: p.placement.weeks[0]!,
                    reason: p.placement.reason,
                    workingDays: p.placement.workingDays,
                    from: fromEpochDay(p.placement.from),
                    to: fromEpochDay(p.placement.to),
                },
            ];
        });
        const rebalance: WorkloadRebalance | null = plan
            ? {
                  items: plan.items.flatMap((o): WorkloadRebalanceItem[] => {
                      const k = keyOf(o.itemId);
                      if (!k) return [];
                      return [
                          {
                              id: o.itemId,
                              key: k.key,
                              title: k.r.title,
                              projectId: k.project.id,
                              minutes: o.minutes,
                              startDate: dayString(k.r.startDate),
                              dueDate: dayString(k.r.dueDate),
                              assignTo: o.assignTo,
                              moveTo: o.moveTo
                                  ? {
                                        startDate: o.moveTo.startDate === null ? null : fromEpochDay(o.moveTo.startDate),
                                        dueDate: o.moveTo.dueDate === null ? null : fromEpochDay(o.moveTo.dueDate),
                                        from: fromEpochDay(o.moveTo.from),
                                        to: fromEpochDay(o.moveTo.to),
                                    }
                                  : null,
                          },
                      ];
                  }),
                  dueDuringTimeOff: plan.dueDuringTimeOff.flatMap((d) => {
                      const k = keyOf(d.itemId);
                      return k ? [{ id: d.itemId, key: k.key, title: k.r.title, dueDate: fromEpochDay(d.dueDate) }] : [];
                  }),
                  offered,
                  assignUnavailable: offered.assign && !everyoneRead,
                  searchWeeks: REBALANCE_LIMITS.searchWeeks,
              }
            : null;

        const week = row.capacity[0];
        return {
            userId: record ? record.userId : UNASSIGNED_CELL,
            name: record?.name ?? null,
            active: record?.active ?? true,
            week: fromEpochDay(win.first),
            capacityMinutes: week ? week.capacityMinutes : null,
            weeklyMinutes: week ? week.weeklyMinutes : null,
            allocatedMinutes: row.allocated[0]!,
            overMinutes: row.over[0]!,
            timeOff:
                record && capacity
                    ? capacity
                          .person(record)
                          .timeOff.filter((t) => t.day >= win.first && t.day <= win.last)
                          .map((t) => ({ day: fromEpochDay(t.day), minutes: t.minutes }))
                    : [],
            items: cellItems,
            moreItems: itemsShown ? filling.length - listed.length : 0,
            itemsShown,
            timeSpentCounted,
            rebalance,
            rebalanceNote: tooFar && over ? 'TOO_FAR_AHEAD' : null,
        };
    });
}

/** A stored date-only value as `YYYY-MM-DD`, or NULL. */
function dayString(d: Date | null): string | null {
    return d ? fromEpochDay(toEpochDay(d)) : null;
}

/** Today in the workspace calendar's zone (`workload.view`): the date the Workload page opens on. */
export async function getWorkloadToday(ctx: RequestContext): Promise<string> {
    assertCanViewWorkload(ctx);
    return runInTenantReadContext(ctx, async (db) => fromEpochDay((await workspaceToday(db, ctx)).today));
}
