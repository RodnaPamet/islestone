/**
 * What calendar sync asks of a provider (roadmap 3.3b; ADR 0011 §3), and the
 * two writers behind it: Google Calendar v3 and Microsoft Graph v1.0.
 *
 * inflect-compliance declared the interface (`CalendarWriter` in
 * `calendar-reconcile-sweep.ts` at 5528464fc54a8681956f3b9ce23ca9c075f0420e)
 * and never implemented it; the implementations are new. Every event is the
 * same shape on both (decision 229): an all-day event on the due date (the
 * end exclusive, the next day), its summary the title, its description one
 * absolute link and nothing else, private, free, no location, attendees or
 * reminder overrides, and a private extended property holding Islestone's
 * client id so its own events can be found again. Every request goes through
 * `providerRequest` (fixed origins).
 *
 * Server-only. Written fresh for Islestone.
 */
import { ProviderHttpError } from '@/app-layer/integrations/http-errors';
import { nextDay, type DesiredSyncedEvent } from '@/app-layer/domain/calendar-sync';

import { providerRequest } from './provider-http';

/** The dedicated calendar's name (decision 228). */
export const ISLESTONE_CALENDAR_NAME = 'Islestone';
/** The extended property's name (Google) and Graph's property set id with it. */
export const CLIENT_ID_PROPERTY = 'islestone';
export const GRAPH_PROPERTY_ID = 'String {5f0b2c3e-7a41-4d6b-9e58-1c2d3a4b5c6d} Name islestone';

export interface FoundEvent {
    remoteEventId: string;
    remoteVersion: string | null;
    /** Google keeps a deleted event's id reserved; such an event is restored, never inserted again. */
    cancelled: boolean;
}

export interface CalendarWriter {
    createCalendar(): Promise<{ calendarId: string }>;
    /** Deletes the calendar only when it holds no event (decision 239). */
    deleteCalendarIfEmpty(calendarId: string): Promise<'deleted' | 'not_empty' | 'gone'>;
    find(calendarId: string, clientEventId: string): Promise<FoundEvent | null>;
    /** Inserts with the client id; a duplicate is found and adopted, never inserted twice. */
    insert(calendarId: string, clientEventId: string, event: DesiredSyncedEvent): Promise<{ remoteEventId: string; remoteVersion: string | null }>;
    patch(calendarId: string, remoteEventId: string, clientEventId: string, event: DesiredSyncedEvent, opts?: { restore?: boolean }): Promise<{ remoteVersion: string | null } | 'gone'>;
    /** A missing event (404, 410) counts as removed. */
    remove(calendarId: string, remoteEventId: string): Promise<void>;
}

const enc = encodeURIComponent;

function auth(accessToken: string): Record<string, string> {
    return { Authorization: `Bearer ${accessToken}` };
}

function json(accessToken: string): Record<string, string> {
    return { ...auth(accessToken), 'Content-Type': 'application/json' };
}

function str(v: unknown): string | null {
    return typeof v === 'string' && v ? v : null;
}

// ─── Google Calendar v3 ─────────────────────────────────────────────

const GOOGLE = 'https://www.googleapis.com/calendar/v3';

export function googleEventBody(clientEventId: string, event: DesiredSyncedEvent): Record<string, unknown> {
    return {
        summary: event.title,
        description: event.link,
        start: { date: event.dueDate },
        end: { date: nextDay(event.dueDate) },
        transparency: 'transparent',
        visibility: 'private',
        extendedProperties: { private: { [CLIENT_ID_PROPERTY]: clientEventId } },
    };
}

export function googleWriter(accessToken: string): CalendarWriter {
    const writer: CalendarWriter = {
        async createCalendar() {
            const res = await providerRequest(`${GOOGLE}/calendars`, { method: 'POST', headers: json(accessToken), body: JSON.stringify({ summary: ISLESTONE_CALENDAR_NAME }) });
            const id = str((res.json as { id?: unknown } | null)?.id);
            if (!res.ok || !id) throw new ProviderHttpError(res.status);
            return { calendarId: id };
        },
        async deleteCalendarIfEmpty(calendarId) {
            const list = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events?maxResults=1&showDeleted=false`, { method: 'GET', headers: auth(accessToken) });
            if (list.status === 404 || list.status === 410) return 'gone';
            if (!list.ok) throw new ProviderHttpError(list.status);
            const items = (list.json as { items?: unknown } | null)?.items;
            if (Array.isArray(items) && items.length > 0) return 'not_empty';
            const del = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}`, { method: 'DELETE', headers: auth(accessToken) });
            if (del.status === 404 || del.status === 410) return 'gone';
            if (!del.ok) throw new ProviderHttpError(del.status);
            return 'deleted';
        },
        async find(calendarId, clientEventId) {
            const q = new URLSearchParams({ privateExtendedProperty: `${CLIENT_ID_PROPERTY}=${clientEventId}`, showDeleted: 'true', maxResults: '5' });
            const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events?${q.toString()}`, { method: 'GET', headers: auth(accessToken) });
            if (!res.ok) throw new ProviderHttpError(res.status);
            const items = (res.json as { items?: unknown } | null)?.items;
            const first = Array.isArray(items) ? (items as Array<{ id?: unknown; etag?: unknown; status?: unknown }>).find((i) => str(i.id)) : undefined;
            if (!first) return null;
            return { remoteEventId: str(first.id)!, remoteVersion: str(first.etag), cancelled: first.status === 'cancelled' };
        },
        async insert(calendarId, clientEventId, event) {
            const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events`, {
                method: 'POST',
                headers: json(accessToken),
                body: JSON.stringify({ id: clientEventId, ...googleEventBody(clientEventId, event) }),
            });
            if (res.status === 409) {
                // The id exists already: an earlier insert went through, or a
                // deleted event keeps its id reserved. Adopt it with this content.
                const found = await writer.find(calendarId, clientEventId);
                if (!found) throw new ProviderHttpError(409);
                const patched = await writer.patch(calendarId, found.remoteEventId, clientEventId, event, { restore: found.cancelled });
                if (patched === 'gone') throw new ProviderHttpError(409);
                return { remoteEventId: found.remoteEventId, remoteVersion: patched.remoteVersion };
            }
            const id = str((res.json as { id?: unknown } | null)?.id);
            if (!res.ok || !id) throw new ProviderHttpError(res.status);
            return { remoteEventId: id, remoteVersion: str((res.json as { etag?: unknown }).etag) };
        },
        async patch(calendarId, remoteEventId, clientEventId, event, opts) {
            const body = { ...googleEventBody(clientEventId, event), ...(opts?.restore ? { status: 'confirmed' } : {}) };
            const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events/${enc(remoteEventId)}`, { method: 'PATCH', headers: json(accessToken), body: JSON.stringify(body) });
            if (res.status === 404 || res.status === 410) return 'gone';
            if (!res.ok) throw new ProviderHttpError(res.status);
            return { remoteVersion: str((res.json as { etag?: unknown } | null)?.etag) };
        },
        async remove(calendarId, remoteEventId) {
            const res = await providerRequest(`${GOOGLE}/calendars/${enc(calendarId)}/events/${enc(remoteEventId)}`, { method: 'DELETE', headers: auth(accessToken) });
            if (res.ok || res.status === 404 || res.status === 410) return;
            throw new ProviderHttpError(res.status);
        },
    };
    return writer;
}

// ─── Microsoft Graph v1.0 ───────────────────────────────────────────

const GRAPH = 'https://graph.microsoft.com/v1.0';

export function graphEventBody(event: DesiredSyncedEvent): Record<string, unknown> {
    return {
        subject: event.title,
        body: { contentType: 'text', content: event.link },
        start: { dateTime: `${event.dueDate}T00:00:00`, timeZone: 'UTC' },
        end: { dateTime: `${nextDay(event.dueDate)}T00:00:00`, timeZone: 'UTC' },
        isAllDay: true,
        sensitivity: 'private',
        showAs: 'free',
    };
}

export function graphWriter(accessToken: string): CalendarWriter {
    return {
        async createCalendar() {
            const res = await providerRequest(`${GRAPH}/me/calendars`, { method: 'POST', headers: json(accessToken), body: JSON.stringify({ name: ISLESTONE_CALENDAR_NAME }) });
            const id = str((res.json as { id?: unknown } | null)?.id);
            if (!res.ok || !id) throw new ProviderHttpError(res.status);
            return { calendarId: id };
        },
        async deleteCalendarIfEmpty(calendarId) {
            const list = await providerRequest(`${GRAPH}/me/calendars/${enc(calendarId)}/events?$top=1&$select=id`, { method: 'GET', headers: auth(accessToken) });
            if (list.status === 404) return 'gone';
            if (!list.ok) throw new ProviderHttpError(list.status);
            const value = (list.json as { value?: unknown } | null)?.value;
            if (Array.isArray(value) && value.length > 0) return 'not_empty';
            const del = await providerRequest(`${GRAPH}/me/calendars/${enc(calendarId)}`, { method: 'DELETE', headers: auth(accessToken) });
            if (del.status === 404) return 'gone';
            if (!del.ok) throw new ProviderHttpError(del.status);
            return 'deleted';
        },
        async find(calendarId, clientEventId) {
            const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${GRAPH_PROPERTY_ID}' and ep/value eq '${clientEventId}')`;
            const q = new URLSearchParams({ $filter: filter, $select: 'id,changeKey', $top: '1' });
            const res = await providerRequest(`${GRAPH}/me/calendars/${enc(calendarId)}/events?${q.toString()}`, { method: 'GET', headers: auth(accessToken) });
            if (!res.ok) throw new ProviderHttpError(res.status);
            const value = (res.json as { value?: unknown } | null)?.value;
            const first = Array.isArray(value) ? (value as Array<{ id?: unknown; changeKey?: unknown }>).find((v) => str(v.id)) : undefined;
            return first ? { remoteEventId: str(first.id)!, remoteVersion: str(first.changeKey), cancelled: false } : null;
        },
        async insert(calendarId, clientEventId, event) {
            // `transactionId` makes Graph refuse a redundant create on a retry.
            const res = await providerRequest(`${GRAPH}/me/calendars/${enc(calendarId)}/events`, {
                method: 'POST',
                headers: json(accessToken),
                body: JSON.stringify({
                    ...graphEventBody(event),
                    transactionId: clientEventId,
                    singleValueExtendedProperties: [{ id: GRAPH_PROPERTY_ID, value: clientEventId }],
                }),
            });
            const id = str((res.json as { id?: unknown } | null)?.id);
            if (!res.ok || !id) throw new ProviderHttpError(res.status);
            return { remoteEventId: id, remoteVersion: str((res.json as { changeKey?: unknown }).changeKey) };
        },
        async patch(_calendarId, remoteEventId, _clientEventId, event) {
            const res = await providerRequest(`${GRAPH}/me/events/${enc(remoteEventId)}`, { method: 'PATCH', headers: json(accessToken), body: JSON.stringify(graphEventBody(event)) });
            if (res.status === 404 || res.status === 410) return 'gone';
            if (!res.ok) throw new ProviderHttpError(res.status);
            return { remoteVersion: str((res.json as { changeKey?: unknown } | null)?.changeKey) };
        },
        async remove(_calendarId, remoteEventId) {
            const res = await providerRequest(`${GRAPH}/me/events/${enc(remoteEventId)}`, { method: 'DELETE', headers: auth(accessToken) });
            if (res.ok || res.status === 404 || res.status === 410) return;
            throw new ProviderHttpError(res.status);
        },
    };
}
