/**
 * The calendar read-back's pure rules (roadmap 3.3c; ADR 0011 §1 and §4; owner
 * decisions 225, 227, 230, 231 and 232): what day an event in a member's
 * calendar now means, and what the read-back does with one of Islestone's
 * events it read.
 *
 * THE DAY (decision 231). An all-day event means its last day: the day before
 * its exclusive end. A timed or multi-day event means the day its end falls on
 * in the event's own time zone, where an end at exactly midnight belongs to
 * the day before (an event from 22:00 to 00:00 is on the first day). The
 * zone is the event's own (`end.timeZone` at Google, `originalEndTimeZone` at
 * Microsoft), an IANA name or a Windows name mapped to IANA
 * (`WINDOWS_TIME_ZONES`); a zone neither names falls back to the offset the
 * provider wrote the time in (Google writes the calendar's offset; Graph is
 * asked for UTC), so the day is never guessed from the server's clock.
 *
 * THE DECISION. Only an event Islestone recorded is read (the caller matches
 * by `remoteEventId`; a person's own event is never imported). A version equal
 * to the one Islestone stored after its own write is Islestone's write, never
 * a person's change. A deleted event moves its row to REMOVED_IN_CALENDAR
 * (decision 232), or drops a row whose delete Islestone was retrying. A
 * changed event whose day is still the pushed day changed something else
 * (a title, the link, attendees): not read (decision 225). Otherwise the day
 * moved, and the caller decides whether it is applied.
 *
 * Pure: no database, no provider, no clock. Written fresh for Islestone.
 */
import type { SyncedEventState } from './calendar-sync';

/** When an event in a calendar ends, as the provider described it. */
export type RemoteEventTime =
    | {
          allDay: true;
          /** `YYYY-MM-DD`, exclusive (the day after the last day). */
          endDate: string;
      }
    | {
          allDay: false;
          /** RFC 3339: a date-time with an offset or `Z`. */
          end: string;
          /** The event's own zone (IANA or Windows), or null. */
          timeZone: string | null;
      };

/** One event the read-back read. */
export interface RemoteEvent {
    remoteEventId: string;
    remoteVersion: string | null;
    /** Deleted in the calendar (Google `cancelled`; Graph `isCancelled`, or gone). */
    deleted: boolean;
    /** Null for a deleted event, or a time the reader could not read. */
    time: RemoteEventTime | null;
}

/** The recorded row, reduced to what the decision reads. */
export interface ReadBackRow {
    remoteEventId: string;
    remoteVersion: string | null;
    /** `YYYY-MM-DD`. */
    pushedDueDate: string;
    state: SyncedEventState;
}

export type ReadBackDecision =
    | { kind: 'none' }
    /** Deleted in the calendar (decision 232): the row moves to REMOVED_IN_CALENDAR. */
    | { kind: 'removed' }
    /** Deleted while Islestone was retrying its own delete: the row goes. */
    | { kind: 'forget' }
    /** The day moved (decision 225): the caller applies or refuses it. */
    | { kind: 'moved'; movedTo: string };

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `day` is a real `YYYY-MM-DD` calendar day. */
export function isDay(day: string): boolean {
    const m = DAY_RE.exec(day);
    if (!m) return false;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.toISOString().slice(0, 10) === day;
}

/** The day before a `YYYY-MM-DD`. */
export function previousDay(day: string): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * Windows time zone names Microsoft may write as an event's zone, mapped to
 * IANA (CLDR's `windowsZones`, the "001" territory). The common ones; a name
 * not here falls back to the offset the time was written in.
 */
export const WINDOWS_TIME_ZONES: Readonly<Record<string, string>> = {
    'Dateline Standard Time': 'Etc/GMT+12',
    'UTC-11': 'Etc/GMT+11',
    'Hawaiian Standard Time': 'Pacific/Honolulu',
    'Alaskan Standard Time': 'America/Anchorage',
    'Pacific Standard Time': 'America/Los_Angeles',
    'US Mountain Standard Time': 'America/Phoenix',
    'Mountain Standard Time': 'America/Denver',
    'Central America Standard Time': 'America/Guatemala',
    'Central Standard Time': 'America/Chicago',
    'Canada Central Standard Time': 'America/Regina',
    'SA Pacific Standard Time': 'America/Bogota',
    'Eastern Standard Time': 'America/New_York',
    'Atlantic Standard Time': 'America/Halifax',
    'Newfoundland Standard Time': 'America/St_Johns',
    'E. South America Standard Time': 'America/Sao_Paulo',
    'Argentina Standard Time': 'America/Buenos_Aires',
    'UTC-02': 'Etc/GMT+2',
    'Azores Standard Time': 'Atlantic/Azores',
    'UTC': 'Etc/UTC',
    'GMT Standard Time': 'Europe/London',
    'Greenwich Standard Time': 'Atlantic/Reykjavik',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Central Europe Standard Time': 'Europe/Budapest',
    'Romance Standard Time': 'Europe/Paris',
    'Central European Standard Time': 'Europe/Warsaw',
    'W. Central Africa Standard Time': 'Africa/Lagos',
    'GTB Standard Time': 'Europe/Bucharest',
    'FLE Standard Time': 'Europe/Kiev',
    'E. Europe Standard Time': 'Europe/Chisinau',
    'Egypt Standard Time': 'Africa/Cairo',
    'South Africa Standard Time': 'Africa/Johannesburg',
    'Israel Standard Time': 'Asia/Jerusalem',
    'Turkey Standard Time': 'Europe/Istanbul',
    'Arabic Standard Time': 'Asia/Baghdad',
    'Arab Standard Time': 'Asia/Riyadh',
    'Russian Standard Time': 'Europe/Moscow',
    'E. Africa Standard Time': 'Africa/Nairobi',
    'Iran Standard Time': 'Asia/Tehran',
    'Arabian Standard Time': 'Asia/Dubai',
    'Afghanistan Standard Time': 'Asia/Kabul',
    'Pakistan Standard Time': 'Asia/Karachi',
    'West Asia Standard Time': 'Asia/Tashkent',
    'India Standard Time': 'Asia/Calcutta',
    'Nepal Standard Time': 'Asia/Katmandu',
    'Central Asia Standard Time': 'Asia/Almaty',
    'Bangladesh Standard Time': 'Asia/Dhaka',
    'Myanmar Standard Time': 'Asia/Rangoon',
    'SE Asia Standard Time': 'Asia/Bangkok',
    'China Standard Time': 'Asia/Shanghai',
    'Singapore Standard Time': 'Asia/Singapore',
    'W. Australia Standard Time': 'Australia/Perth',
    'Taipei Standard Time': 'Asia/Taipei',
    'Tokyo Standard Time': 'Asia/Tokyo',
    'Korea Standard Time': 'Asia/Seoul',
    'Cen. Australia Standard Time': 'Australia/Adelaide',
    'AUS Central Standard Time': 'Australia/Darwin',
    'E. Australia Standard Time': 'Australia/Brisbane',
    'AUS Eastern Standard Time': 'Australia/Sydney',
    'West Pacific Standard Time': 'Pacific/Port_Moresby',
    'Central Pacific Standard Time': 'Pacific/Guadalcanal',
    'New Zealand Standard Time': 'Pacific/Auckland',
    'UTC+12': 'Etc/GMT-12',
    'Fiji Standard Time': 'Pacific/Fiji',
    'Tonga Standard Time': 'Pacific/Tongatapu',
    'Samoa Standard Time': 'Pacific/Apia',
    'Line Islands Standard Time': 'Pacific/Kiritimati',
};

/** An IANA zone the runtime knows, for an IANA or Windows name; null when neither. */
export function resolveTimeZone(name: string | null): string | null {
    if (!name) return null;
    const candidate = WINDOWS_TIME_ZONES[name] ?? name;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: candidate });
        return candidate;
    } catch {
        return null;
    }
}

const RFC3339 = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** The local date and whether the local time is exactly midnight, of an instant in an IANA zone. */
function localIn(instant: Date, zone: string): { day: string; midnight: boolean } {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
            .formatToParts(instant)
            .map((p) => [p.type, p.value]),
    );
    return { day: `${parts.year}-${parts.month}-${parts.day}`, midnight: parts.hour === '00' && parts.minute === '00' && parts.second === '00' };
}

/**
 * The due date an event now means (decision 231): its last day, in its own
 * zone. Null when the provider's time cannot be read.
 */
export function eventLastDay(time: RemoteEventTime): string | null {
    if (time.allDay) return isDay(time.endDate) ? previousDay(time.endDate) : null;
    const m = RFC3339.exec(time.end);
    if (!m) return null;
    const instant = new Date(time.end);
    if (Number.isNaN(instant.getTime()) || !isDay(m[1]!)) return null;
    const zone = resolveTimeZone(time.timeZone);
    let local: { day: string; midnight: boolean };
    if (zone) {
        local = localIn(instant, zone);
    } else {
        // The offset the provider wrote the time in: the wall clock as written.
        local = { day: m[1]!, midnight: m[2] === '00' && m[3] === '00' && (m[4] ?? '00') === '00' };
    }
    return local.midnight ? previousDay(local.day) : local.day;
}

/** What the read-back does with one of Islestone's events it read. */
export function decideReadBack(row: ReadBackRow, remote: RemoteEvent): ReadBackDecision {
    if (!row.remoteEventId || row.remoteEventId !== remote.remoteEventId) return { kind: 'none' };
    if (remote.deleted) {
        if (row.state === 'PENDING_DELETE') return { kind: 'forget' };
        if (row.state === 'REMOVED_IN_CALENDAR') return { kind: 'none' };
        return { kind: 'removed' };
    }
    // A row deleted in the calendar, or on its way out, takes no change.
    if (row.state === 'REMOVED_IN_CALENDAR' || row.state === 'PENDING_DELETE') return { kind: 'none' };
    // Islestone's own write: never read back as a person's change.
    if (remote.remoteVersion !== null && remote.remoteVersion === row.remoteVersion) return { kind: 'none' };
    if (!remote.time) return { kind: 'none' };
    const day = eventLastDay(remote.time);
    if (!day || day === row.pushedDueDate) return { kind: 'none' };
    return { kind: 'moved', movedTo: day };
}
