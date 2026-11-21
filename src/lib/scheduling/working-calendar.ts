/**
 * Working calendars as the browser and the server both see them (roadmap
 * 3.1a; ADR 0010 §5; owner decisions 189 to 193). Client-safe: shapes,
 * limits and the weekday order, nothing that decides who may write (the
 * Settings page receives that from the server).
 *
 * Written fresh for Islestone.
 */
import type { IsoWeekday } from '@/app-layer/domain/schedule/calendar';

export type { IsoWeekday } from '@/app-layer/domain/schedule/calendar';

export const WORKING_CALENDAR_LIMITS = {
    nameMax: 80,
    holidayNameMax: 80,
    /** Holidays one calendar holds: about thirty years of a country's. */
    holidaysPerCalendar: 500,
    /** Holidays one request adds ("Copy last year's" sends a year's). */
    holidaysPerRequest: 100,
    /** The years a holiday may fall in. */
    firstYear: 2000,
    lastYear: 2199,
} as const;

/** Monday first, as the Settings page lists them. */
export const WEEKDAY_ORDER: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export interface WorkingCalendarHolidayData {
    id: string;
    /** `YYYY-MM-DD`. */
    day: string;
    name: string;
}

export interface WorkingCalendarData {
    /** `null` while the workspace has never saved one: the default is shown (ADR 0010 §5). */
    id: string | null;
    /** `null` for the workspace's calendar. */
    teamId: string | null;
    name: string;
    timeZone: string;
    workingWeekdays: IsoWeekday[];
    /** Sorted by day. */
    holidays: WorkingCalendarHolidayData[];
    version: number;
    /** Nothing saved: Monday to Friday, no holidays, the deployment's time zone. */
    isDefault: boolean;
}

/** Settings → Working calendars: the workspace's calendar and which teams have their own. */
export interface WorkingCalendarsOverview {
    workspace: WorkingCalendarData;
    teams: Array<{ teamId: string; teamName: string; calendarId: string | null }>;
}

/** One team's calendar, or `null` while the team uses the workspace's. */
export interface TeamWorkingCalendarData {
    teamId: string;
    teamName: string;
    calendar: WorkingCalendarData | null;
}

/** What adding holidays did: dates already on the calendar are skipped, not refused. */
export interface HolidaysAdded {
    calendar: WorkingCalendarData;
    added: string[];
    skipped: string[];
}
