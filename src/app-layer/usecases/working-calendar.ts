/**
 * Working calendars (roadmap 3.1a; ADR 0010 §5; owner decisions 189 to 193).
 *
 *   - **One workspace calendar** and, optionally, one per team that replaces
 *     it for the team's items (decision 189): a time zone, working weekdays
 *     and holidays. A workspace that never saved one counts Monday to Friday,
 *     no holidays, in `NOTIFICATIONS_TZ`; Settings shows that default, and
 *     the first change saves it.
 *   - **Holidays are entered by hand** (decision 190): "Copy last year's" and
 *     "Copy the workspace's holidays" are the browser's work over the same
 *     add route (`copyHolidaysToYear`); a date already there is skipped.
 *   - **Keys** (decision 193): read under `projects.view`, written under
 *     `admin.manage`, as teams, workflow states and types are.
 *   - **Changing a calendar changes no stored date** (ADR 0010 §5): review
 *     steps keep their `dueOn` (ADR 0009 §13); the schedule is computed.
 *   - **Audit**: `WORKING_CALENDAR_SET` (which calendar, time zone,
 *     weekdays), `WORKING_CALENDAR_HOLIDAYS_CHANGED` (the dates added and
 *     removed, never re-listing names), `WORKING_CALENDAR_REMOVED`.
 *
 * `resolveWorkingCalendars` is the one read of calendars for arithmetic: the
 * review engine, the due-reminder job and (3.1b) the timeline call it.
 *
 * Written fresh for Islestone.
 */
import { logEvent } from '../events/audit';
import {
    DEFAULT_WORKING_WEEKDAYS,
    compileCalendar,
    fromEpochDay,
    isKnownTimeZone,
    toEpochDay,
    type CalendarSpec,
    type CompiledCalendar,
    type IsoWeekday,
} from '../domain/schedule/calendar';
import { assertCanManageWorkConfig, assertCanReadWorkConfig } from '../policies/work-config.policies';
import { TeamRepository } from '../repositories/TeamRepository';
import { WorkingCalendarRepository, type WorkingCalendarArithmeticRow, type WorkingCalendarRow } from '../repositories/WorkingCalendarRepository';
import type { RequestContext } from '../types';
import { env } from '@/env';
import { runInTenantContext, type PrismaTx } from '@/lib/db-context';
import { badRequest, ConflictError, notFound } from '@/lib/errors/types';
import type { AddHolidaysInput, SetWorkingCalendarInput } from '@/lib/schemas/working-calendar';
import {
    WORKING_CALENDAR_LIMITS,
    type HolidaysAdded,
    type TeamWorkingCalendarData,
    type WorkingCalendarData,
    type WorkingCalendarsOverview,
} from '@/lib/scheduling/working-calendar';
import { sanitizePlainText } from '@/lib/security/sanitize';

/** The deployment's reminder zone: a workspace calendar's default (decision 191). */
function notificationsTz(): string {
    return (env.NOTIFICATIONS_TZ as string | undefined) || 'UTC';
}

/** The name a workspace calendar is saved under when none is given. */
const WORKSPACE_CALENDAR_NAME = 'Workspace';

// ─── Resolution: the calendar an item counts on ───────────────────────────

/** A calendar ready for arithmetic, with the zone "today" is read in. */
export interface ResolvedCalendar {
    /** The row's id, or `workspace-default` when nothing is saved. */
    id: string;
    /** False for the default a workspace counts on before an admin saves one. */
    saved: boolean;
    timeZone: string;
    spec: CalendarSpec;
    compiled: CompiledCalendar;
}

export interface WorkingCalendarSet {
    workspace: ResolvedCalendar;
    /** The team's calendar, else the workspace's (ADR 0010 §5). */
    forTeam(teamId: string | null | undefined): ResolvedCalendar;
    /** Every distinct calendar in the set (the workspace's first). */
    all(): ResolvedCalendar[];
}

const DEFAULT_ID = 'workspace-default';

function resolvedOf(row: WorkingCalendarArithmeticRow): ResolvedCalendar {
    const spec: CalendarSpec = {
        id: row.id,
        workingWeekdays: row.workingWeekdays as IsoWeekday[],
        holidays: row.holidayDays.map((d) => toEpochDay(d)),
    };
    return { id: row.id, saved: true, timeZone: row.timeZone, spec, compiled: compileCalendar(spec) };
}

/** Monday to Friday, no holidays, the deployment's time zone: a workspace with no calendar. */
export function defaultResolvedCalendar(): ResolvedCalendar {
    const spec: CalendarSpec = { id: DEFAULT_ID, workingWeekdays: DEFAULT_WORKING_WEEKDAYS, holidays: [] };
    return { id: DEFAULT_ID, saved: false, timeZone: notificationsTz(), spec, compiled: compileCalendar(spec) };
}

function setOf(rows: readonly WorkingCalendarArithmeticRow[]): WorkingCalendarSet {
    const ws = rows.find((r) => r.teamId === null);
    const workspace = ws ? resolvedOf(ws) : defaultResolvedCalendar();
    const teams = new Map(rows.filter((r) => r.teamId !== null).map((r) => [r.teamId!, resolvedOf(r)]));
    return {
        workspace,
        forTeam: (teamId) => (teamId ? teams.get(teamId) ?? workspace : workspace),
        all: () => [workspace, ...teams.values()],
    };
}

/**
 * The calendars of the workspace in `ctx` for arithmetic: the workspace's and
 * the named teams' (every team's when `teamIds` is omitted). Read inside the
 * caller's transaction.
 */
export async function resolveWorkingCalendars(db: PrismaTx, ctx: Pick<RequestContext, 'tenantId'>, teamIds?: readonly string[]): Promise<WorkingCalendarSet> {
    // One statement, the holidays' dates aggregated per calendar.
    const rows = await WorkingCalendarRepository.listForArithmetic(db, ctx, teamIds ? [...new Set(teamIds)] : undefined);
    return setOf(rows);
}

// ─── Reads ────────────────────────────────────────────────────────────────

function toDto(row: WorkingCalendarRow): WorkingCalendarData {
    return {
        id: row.id,
        teamId: row.teamId,
        name: row.name,
        timeZone: row.timeZone,
        workingWeekdays: row.workingWeekdays as IsoWeekday[],
        holidays: row.holidays.map((h) => ({ id: h.id, day: fromEpochDay(toEpochDay(h.day)), name: h.name })),
        version: row.version,
        isDefault: false,
    };
}

function defaultDto(): WorkingCalendarData {
    return {
        id: null,
        teamId: null,
        name: WORKSPACE_CALENDAR_NAME,
        timeZone: notificationsTz(),
        workingWeekdays: [...DEFAULT_WORKING_WEEKDAYS],
        holidays: [],
        version: 0,
        isDefault: true,
    };
}

async function loadTeam(db: PrismaTx, ctx: RequestContext, teamId: string) {
    const team = await TeamRepository.getById(db, ctx, teamId);
    if (!team) throw notFound('Team not found');
    return team;
}

/** The workspace's calendar (the default while none is saved) and which teams have their own (`projects.view`). */
export async function getWorkingCalendars(ctx: RequestContext): Promise<WorkingCalendarsOverview> {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        // One transaction client: its reads run one after another.
        const ws = await WorkingCalendarRepository.get(db, ctx, null);
        const teamRows = await WorkingCalendarRepository.teamCalendarIds(db, ctx);
        const teams = await TeamRepository.list(db, ctx);
        const byTeam = new Map(teamRows.map((r) => [r.teamId!, r.id]));
        return {
            workspace: ws ? toDto(ws) : defaultDto(),
            teams: teams.map((t) => ({ teamId: t.id, teamName: t.name, calendarId: byTeam.get(t.id) ?? null })),
        };
    });
}

/** One team's calendar, or `null` while it uses the workspace's (`projects.view`). */
export async function getTeamWorkingCalendar(ctx: RequestContext, teamId: string): Promise<TeamWorkingCalendarData> {
    assertCanReadWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const team = await loadTeam(db, ctx, teamId);
        const row = await WorkingCalendarRepository.get(db, ctx, team.id);
        return { teamId: team.id, teamName: team.name, calendar: row ? toDto(row) : null };
    });
}

// ─── Writes ───────────────────────────────────────────────────────────────

/** The weekdays as the database holds them: ascending, unique, 1 to 7, at least one. */
function cleanWeekdays(raw: readonly number[]): number[] {
    const days = [...new Set(raw)].sort((a, b) => a - b);
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
        throw badRequest('A working calendar needs at least one working weekday, each from Monday (1) to Sunday (7).', { reason: 'WEEKDAYS_INVALID' });
    }
    return days;
}

function cleanName(raw: string, max: number): string {
    const name = sanitizePlainText(raw).trim();
    if (!name || name.length > max) throw badRequest(`A name is 1 to ${max} characters.`, { reason: 'NAME_INVALID' });
    return name;
}

async function cleanTimeZone(db: PrismaTx, raw: string): Promise<string> {
    const timeZone = raw.trim();
    if (!isKnownTimeZone(timeZone) || !(await WorkingCalendarRepository.isKnownTimeZone(db, timeZone))) {
        throw badRequest(`${timeZone || 'That'} is not a time zone this workspace knows (an IANA name such as Europe/Sofia).`, { reason: 'TIME_ZONE_UNKNOWN' });
    }
    return timeZone;
}

async function setCalendar(ctx: RequestContext, teamId: string | null, input: SetWorkingCalendarInput): Promise<WorkingCalendarData> {
    assertCanManageWorkConfig(ctx);
    const workingWeekdays = cleanWeekdays(input.workingWeekdays);
    return runInTenantContext(ctx, async (db) => {
        const team = teamId ? await loadTeam(db, ctx, teamId) : null;
        const timeZone = await cleanTimeZone(db, input.timeZone);
        await WorkingCalendarRepository.lockWorkspaceCalendars(db, ctx);
        const before = await WorkingCalendarRepository.get(db, ctx, team?.id ?? null);
        const name = input.name !== undefined ? cleanName(input.name, WORKING_CALENDAR_LIMITS.nameMax) : before?.name ?? cleanName(team?.name ?? WORKSPACE_CALENDAR_NAME, WORKING_CALENDAR_LIMITS.nameMax);
        let id: string;
        const changedFields: string[] = [];
        if (!before) {
            id = (await WorkingCalendarRepository.create(db, ctx, { teamId: team?.id ?? null, name, timeZone, workingWeekdays })).id;
            changedFields.push('name', 'timeZone', 'workingWeekdays');
        } else {
            id = before.id;
            if (name !== before.name) changedFields.push('name');
            if (timeZone !== before.timeZone) changedFields.push('timeZone');
            if (workingWeekdays.join(',') !== before.workingWeekdays.join(',')) changedFields.push('workingWeekdays');
            if (changedFields.length === 0) return toDto(before);
            await WorkingCalendarRepository.update(db, ctx, id, { name, timeZone, workingWeekdays });
        }
        await logEvent(db, ctx, {
            action: 'WORKING_CALENDAR_SET',
            entityType: 'WorkingCalendar',
            entityId: id,
            details: team ? `Set the working calendar of the team ${team.name}` : 'Set the workspace working calendar',
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkingCalendar', operation: before ? 'updated' : 'created', changedFields },
            metadata: {
                scope: team ? 'team' : 'workspace',
                teamId: team?.id ?? null,
                timeZone,
                workingWeekdays,
                ...(before ? { fromTimeZone: before.timeZone, fromWorkingWeekdays: before.workingWeekdays } : {}),
            },
        });
        return toDto((await WorkingCalendarRepository.get(db, ctx, team?.id ?? null))!);
    });
}

/** Save the workspace's calendar (`admin.manage`). */
export function setWorkspaceWorkingCalendar(ctx: RequestContext, input: SetWorkingCalendarInput): Promise<WorkingCalendarData> {
    return setCalendar(ctx, null, input);
}

/** Give a team its own calendar, or change it (`admin.manage`). */
export async function setTeamWorkingCalendar(ctx: RequestContext, teamId: string, input: SetWorkingCalendarInput): Promise<TeamWorkingCalendarData> {
    await setCalendar(ctx, teamId, input);
    return getTeamWorkingCalendar(ctx, teamId);
}

/** A team goes back to the workspace's calendar; its own and its holidays are removed (`admin.manage`). */
export async function removeTeamWorkingCalendar(ctx: RequestContext, teamId: string): Promise<TeamWorkingCalendarData> {
    assertCanManageWorkConfig(ctx);
    await runInTenantContext(ctx, async (db) => {
        const team = await loadTeam(db, ctx, teamId);
        await WorkingCalendarRepository.lockWorkspaceCalendars(db, ctx);
        const row = await WorkingCalendarRepository.get(db, ctx, team.id);
        if (!row) throw notFound('The team has no working calendar of its own.');
        await WorkingCalendarRepository.remove(db, ctx, row.id);
        await logEvent(db, ctx, {
            action: 'WORKING_CALENDAR_REMOVED',
            entityType: 'WorkingCalendar',
            entityId: row.id,
            details: `Removed the working calendar of the team ${team.name}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkingCalendar', operation: 'deleted' },
            metadata: { scope: 'team', teamId: team.id, holidayCount: row.holidays.length },
        });
    });
    return getTeamWorkingCalendar(ctx, teamId);
}

/** The calendar a holiday change applies to: the workspace's is saved first when it is still the default. */
async function calendarForHolidays(db: PrismaTx, ctx: RequestContext, teamId: string | null): Promise<{ row: WorkingCalendarRow; label: string }> {
    const team = teamId ? await loadTeam(db, ctx, teamId) : null;
    await WorkingCalendarRepository.lockWorkspaceCalendars(db, ctx);
    const row = await WorkingCalendarRepository.get(db, ctx, team?.id ?? null);
    if (row) return { row, label: team ? `the team ${team.name}` : 'the workspace' };
    if (team) throw new ConflictError(`The team ${team.name} uses the workspace's calendar: give it its own first.`, { reason: 'NO_TEAM_CALENDAR' });
    const created = await WorkingCalendarRepository.create(db, ctx, {
        teamId: null,
        name: WORKSPACE_CALENDAR_NAME,
        timeZone: notificationsTz(),
        workingWeekdays: [...DEFAULT_WORKING_WEEKDAYS],
    });
    await logEvent(db, ctx, {
        action: 'WORKING_CALENDAR_SET',
        entityType: 'WorkingCalendar',
        entityId: created.id,
        details: 'Saved the workspace working calendar',
        detailsJson: { category: 'entity_lifecycle', entityName: 'WorkingCalendar', operation: 'created', changedFields: ['name', 'timeZone', 'workingWeekdays'] },
        metadata: { scope: 'workspace', teamId: null, timeZone: created.timeZone, workingWeekdays: created.workingWeekdays },
    });
    return { row: created, label: 'the workspace' };
}

function holidayDay(raw: string): Date {
    let epoch: number;
    try {
        epoch = toEpochDay(raw);
    } catch {
        throw badRequest(`${raw} is not a date.`, { reason: 'HOLIDAY_DATE_INVALID' });
    }
    const year = Number(raw.slice(0, 4));
    if (year < WORKING_CALENDAR_LIMITS.firstYear || year > WORKING_CALENDAR_LIMITS.lastYear) {
        throw badRequest(`A holiday falls between ${WORKING_CALENDAR_LIMITS.firstYear} and ${WORKING_CALENDAR_LIMITS.lastYear}.`, { reason: 'HOLIDAY_DATE_INVALID' });
    }
    return new Date(epoch * 86_400_000);
}

async function addHolidays(ctx: RequestContext, teamId: string | null, input: AddHolidaysInput): Promise<HolidaysAdded> {
    assertCanManageWorkConfig(ctx);
    const wanted = new Map<string, { day: Date; name: string }>();
    for (const h of input.holidays) {
        if (!wanted.has(h.day)) wanted.set(h.day, { day: holidayDay(h.day), name: cleanName(h.name, WORKING_CALENDAR_LIMITS.holidayNameMax) });
    }
    return runInTenantContext(ctx, async (db) => {
        const { row, label } = await calendarForHolidays(db, ctx, teamId);
        const have = new Set(row.holidays.map((h) => fromEpochDay(toEpochDay(h.day))));
        const added = [...wanted.keys()].filter((d) => !have.has(d)).sort();
        const skipped = [...wanted.keys()].filter((d) => have.has(d)).sort();
        if (row.holidays.length + added.length > WORKING_CALENDAR_LIMITS.holidaysPerCalendar) {
            throw badRequest(`A working calendar holds at most ${WORKING_CALENDAR_LIMITS.holidaysPerCalendar} holidays: remove past ones first.`, { reason: 'TOO_MANY_HOLIDAYS' });
        }
        if (added.length > 0) {
            await WorkingCalendarRepository.addHolidays(db, ctx, row.id, added.map((d) => wanted.get(d)!));
            await WorkingCalendarRepository.touch(db, ctx, row.id);
            await logEvent(db, ctx, {
                action: 'WORKING_CALENDAR_HOLIDAYS_CHANGED',
                entityType: 'WorkingCalendar',
                entityId: row.id,
                details: `Added ${added.length} holiday(s) to the working calendar of ${label}`,
                detailsJson: { category: 'entity_lifecycle', entityName: 'WorkingCalendarHoliday', operation: 'created' },
                metadata: { scope: row.teamId ? 'team' : 'workspace', teamId: row.teamId, added, removed: [] },
            });
        }
        const after = (await WorkingCalendarRepository.get(db, ctx, row.teamId))!;
        return { calendar: toDto(after), added, skipped };
    });
}

async function removeHoliday(ctx: RequestContext, teamId: string | null, holidayId: string): Promise<WorkingCalendarData> {
    assertCanManageWorkConfig(ctx);
    return runInTenantContext(ctx, async (db) => {
        const team = teamId ? await loadTeam(db, ctx, teamId) : null;
        await WorkingCalendarRepository.lockWorkspaceCalendars(db, ctx);
        const row = await WorkingCalendarRepository.get(db, ctx, team?.id ?? null);
        const holiday = row ? await WorkingCalendarRepository.getHoliday(db, ctx, row.id, holidayId) : null;
        if (!row || !holiday) throw notFound('Holiday not found');
        await WorkingCalendarRepository.removeHoliday(db, ctx, row.id, holiday.id);
        await WorkingCalendarRepository.touch(db, ctx, row.id);
        const day = fromEpochDay(toEpochDay(holiday.day));
        await logEvent(db, ctx, {
            action: 'WORKING_CALENDAR_HOLIDAYS_CHANGED',
            entityType: 'WorkingCalendar',
            entityId: row.id,
            details: `Removed a holiday from the working calendar of ${team ? `the team ${team.name}` : 'the workspace'}`,
            detailsJson: { category: 'entity_lifecycle', entityName: 'WorkingCalendarHoliday', operation: 'deleted' },
            metadata: { scope: team ? 'team' : 'workspace', teamId: team?.id ?? null, added: [], removed: [day] },
        });
        return toDto((await WorkingCalendarRepository.get(db, ctx, row.teamId))!);
    });
}

/** Add holidays to the workspace's calendar (`admin.manage`); dates already there are skipped. */
export function addWorkspaceHolidays(ctx: RequestContext, input: AddHolidaysInput): Promise<HolidaysAdded> {
    return addHolidays(ctx, null, input);
}

/** Add holidays to a team's own calendar (`admin.manage`). */
export function addTeamHolidays(ctx: RequestContext, teamId: string, input: AddHolidaysInput): Promise<HolidaysAdded> {
    return addHolidays(ctx, teamId, input);
}

export function removeWorkspaceHoliday(ctx: RequestContext, holidayId: string): Promise<WorkingCalendarData> {
    return removeHoliday(ctx, null, holidayId);
}

export function removeTeamHoliday(ctx: RequestContext, teamId: string, holidayId: string): Promise<WorkingCalendarData> {
    return removeHoliday(ctx, teamId, holidayId);
}
