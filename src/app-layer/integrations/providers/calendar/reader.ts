/**
 * What the calendar read-back asks of a provider (roadmap 3.3c; ADR 0011 §1;
 * docs/porting/maps/3.3.md, "The read-back"; owner decisions 225 and 232),
 * and the two readers behind it.
 *
 *   - Google Calendar v3: `events.list` on the Islestone calendar with the
 *     stored `syncToken` (deleted events included), page by page through
 *     `nextPageToken` on Islestone's own fixed-origin URL; the last page's
 *     `nextSyncToken` is the next cursor. A `410 Gone` (the token expired)
 *     resets to a full listing of the calendar, deleted events included. An
 *     event a listing does not name did not change.
 *   - Microsoft Graph v1.0: `calendarView` over the push window on the
 *     Islestone calendar (Graph's delta covers the primary calendar only),
 *     every page followed through `provider-next-link.ts` (pinned to Graph's
 *     origin, through `safeFetch`); times asked in UTC. An event a complete
 *     listing does not name was deleted, or moved out of the window: the
 *     caller asks for it by id (`get`) before it decides.
 *
 * A calendar the provider no longer has answers `'calendar_gone'`. Only what
 * the decision needs is read (id, version, deleted, the end and its zone):
 * never a title, a description or a person. Nothing is written.
 *
 * Server-only. Written fresh for Islestone.
 */
import { ProviderHttpError } from '@/app-layer/integrations/http-errors';
import type { RemoteEvent, RemoteEventTime } from '@/app-layer/domain/calendar-read-back';

import { providerRequest, type ProviderResponse } from './provider-http';
import { followProviderNextLink } from './provider-next-link';

/** The most pages one listing reads (250 Google events or 100 Graph events a page). */
export const READ_MAX_PAGES = 25;

export interface ReadBackListing {
    events: RemoteEvent[];
    /** Google: the next `syncToken` to store; null when the listing stopped short or the provider gave none. */
    nextCursor: string | null;
    /** Graph: the listing is complete over the window, so a recorded event it does not name was deleted or moved out. */
    absentMeansChanged: boolean;
}

export interface CalendarReader {
    read(calendarId: string, opts: { cursor: string | null; window: { from: string; to: string } }): Promise<ReadBackListing | 'calendar_gone'>;
    /** One event by id (Graph's absent events); `'gone'` when the provider no longer has it. */
    get(calendarId: string, remoteEventId: string): Promise<RemoteEvent | 'gone'>;
}

const enc = encodeURIComponent;

function str(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
}

function auth(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
}

function addDays(day: string, n: number): string {
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

// ─── Google Calendar v3 ─────────────────────────────────────────────

const GOOGLE = 'https://www.googleapis.com/calendar/v3';

interface GoogleTime {
    date?: unknown;
    dateTime?: unknown;
    timeZone?: unknown;
}

export function googleEventTime(end: GoogleTime | undefined): RemoteEventTime | null {
    if (!end) return null;
    const date = str(end.date);
    if (date) return { allDay: true, endDate: date };
    const dateTime = str(end.dateTime);
    if (dateTime) return { allDay: false, end: dateTime, timeZone: str(end.timeZone) };
    return null;
}

function googleEvent(raw: unknown): RemoteEvent | null {
    const e = raw as { id?: unknown; etag?: unknown; status?: unknown; end?: GoogleTime } | null;
    const id = str(e?.id);
    if (!id) return null;
    const deleted = e!.status === 'cancelled';
    return { remoteEventId: id, remoteVersion: str(e!.etag), deleted, time: deleted ? null : googleEventTime(e!.end) };
}

export function googleReader(accessToken: string): CalendarReader {
    return {
        async read(calendarId, opts) {
            let cursor = opts.cursor;
            let pageToken: string | null = null;
            let events: RemoteEvent[] = [];
            let pages = 0;
            for (;;) {
                const q = new URLSearchParams({ showDeleted: 'true', maxResults: '250' });
                if (cursor) q.set('syncToken', cursor);
                if (pageToken) q.set('pageToken', pageToken);
                const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events?${q.toString()}`, { method: 'GET', headers: auth(accessToken) });
                if (res.status === 410 && cursor) {
                    // The sync token expired: a full listing instead, from the first page.
                    cursor = null;
                    pageToken = null;
                    events = [];
                    pages = 0;
                    continue;
                }
                if (res.status === 404) return 'calendar_gone';
                if (!res.ok) throw new ProviderHttpError(res.status);
                const body = res.json as { items?: unknown; nextPageToken?: unknown; nextSyncToken?: unknown } | null;
                if (Array.isArray(body?.items)) events.push(...body.items.map(googleEvent).filter((e): e is RemoteEvent => e !== null));
                pageToken = str(body?.nextPageToken);
                if (!pageToken) return { events, nextCursor: str(body?.nextSyncToken), absentMeansChanged: false };
                pages += 1;
                // Stopped short: what was read is decided, and the stored cursor stays.
                if (pages >= READ_MAX_PAGES) return { events, nextCursor: null, absentMeansChanged: false };
            }
        },
        async get(calendarId, remoteEventId) {
            const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events/${enc(remoteEventId)}`, { method: 'GET', headers: auth(accessToken) });
            if (res.status === 404 || res.status === 410) return 'gone';
            if (!res.ok) throw new ProviderHttpError(res.status);
            return googleEvent(res.json) ?? 'gone';
        },
    };
}

// ─── Microsoft Graph v1.0 ───────────────────────────────────────────

const GRAPH = 'https://graph.microsoft.com/v1.0';
const GRAPH_SELECT = 'id,changeKey,isAllDay,isCancelled,end,originalEndTimeZone';

/** Graph writes `2026-12-01T22:00:00.0000000` with the zone apart; the read asks for UTC. */
function graphUtcInstant(t: { dateTime?: unknown; timeZone?: unknown } | undefined): string | null {
    const dateTime = str(t?.dateTime);
    const zone = str(t?.timeZone);
    if (!dateTime || (zone !== 'UTC' && zone !== 'Etc/UTC')) return null;
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(dateTime);
    if (!m) return null;
    const ms = (m[2] ?? '.000').slice(0, 4).padEnd(4, '0');
    return `${m[1]}${ms}Z`;
}

export function graphEventTime(raw: { isAllDay?: unknown; end?: { dateTime?: unknown; timeZone?: unknown }; originalEndTimeZone?: unknown }): RemoteEventTime | null {
    const instant = graphUtcInstant(raw.end);
    if (!instant) return null;
    const zone = str(raw.originalEndTimeZone);
    if (raw.isAllDay === true && instant.slice(11, 19) === '00:00:00') {
        // An all-day event comes back at midnight: its dates as written, the end exclusive.
        return { allDay: true, endDate: instant.slice(0, 10) };
    }
    return { allDay: false, end: instant, timeZone: zone };
}

function graphEvent(raw: unknown): RemoteEvent | null {
    const e = raw as { id?: unknown; changeKey?: unknown; isCancelled?: unknown; isAllDay?: unknown; end?: { dateTime?: unknown; timeZone?: unknown }; originalEndTimeZone?: unknown } | null;
    const id = str(e?.id);
    if (!id) return null;
    const deleted = e!.isCancelled === true;
    return { remoteEventId: id, remoteVersion: str(e!.changeKey), deleted, time: deleted ? null : graphEventTime(e!) };
}

export function graphReader(accessToken: string): CalendarReader {
    const headers = { ...auth(accessToken), Prefer: 'outlook.timezone="UTC"' };
    return {
        async read(calendarId, opts) {
            // The window, a day wider at each end: an all-day event's UTC midnights sit on its edges.
            const q = new URLSearchParams({
                startDateTime: `${addDays(opts.window.from, -1)}T00:00:00Z`,
                endDateTime: `${addDays(opts.window.to, 2)}T00:00:00Z`,
                $select: GRAPH_SELECT,
                $top: '100',
            });
            let res: ProviderResponse = await providerRequest(`${GRAPH}/me/calendars/${enc(calendarId)}/calendarView?${q.toString()}`, { method: 'GET', headers });
            if (res.status === 404) return 'calendar_gone';
            const events: RemoteEvent[] = [];
            for (let pages = 1; ; pages += 1) {
                if (!res.ok) throw new ProviderHttpError(res.status);
                const body = res.json as { value?: unknown; '@odata.nextLink'?: unknown } | null;
                if (Array.isArray(body?.value)) events.push(...body.value.map(graphEvent).filter((e): e is RemoteEvent => e !== null));
                const next = str(body?.['@odata.nextLink']);
                if (!next) return { events, nextCursor: null, absentMeansChanged: true };
                // Stopped short: an absent event proves nothing.
                if (pages >= READ_MAX_PAGES) return { events, nextCursor: null, absentMeansChanged: false };
                res = await followProviderNextLink(next, headers);
            }
        },
        async get(_calendarId, remoteEventId) {
            const res = await providerRequest(`${GRAPH}/me/events/${enc(remoteEventId)}?$select=${GRAPH_SELECT}`, { method: 'GET', headers });
            if (res.status === 404 || res.status === 410) return 'gone';
            if (!res.ok) throw new ProviderHttpError(res.status);
            return graphEvent(res.json) ?? 'gone';
        },
    };
}
