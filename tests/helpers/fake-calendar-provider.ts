/**
 * A fake Google Calendar and Microsoft Graph, installed at the fetch seam
 * calendar sync's one HTTP module uses (`provider-http.ts`), so no test makes
 * a real provider call (roadmap 3.3b; docs/porting/maps/3.3.md, "H3").
 *
 * It keeps calendars and events in memory, answers the token endpoints, and
 * records every request (method, URL, parsed body) so a test can read exactly
 * what left Islestone. Knobs: a refused refresh (`400 invalid_grant`), a
 * refused call (401), a throttle (429), a failing delete, an insert that the
 * provider stores and then "crashes" before Islestone hears back, and Google's
 * habit of not always refusing a second insert of one id.
 *
 * The read-back (3.3c): Google's `events.list` answers a `syncToken` with the
 * events changed since it (deleted ones included), pages by `pageToken`, hands
 * out a `nextSyncToken` on its last page and answers 410 to an expired one;
 * Graph's `calendarView` pages by an absolute `@odata.nextLink` (which the
 * test routes through the mocked `safeFetch`), and `GET /me/events/{id}`
 * finds one event. A person's own acts in their calendar are knobs too:
 * moving an event (`personMove`), deleting one (`personDelete`), deleting the
 * whole Islestone calendar (`personDeleteCalendar`).
 *
 * Written fresh for Islestone.
 */
interface FakeEvent {
    id: string;
    calendarId: string;
    clientId: string;
    body: Record<string, unknown>;
    cancelled: boolean;
    version: number;
    /** The change counter when it last changed (Google's sync tokens). */
    changedAt: number;
}

export interface RecordedRequest {
    method: string;
    url: string;
    body: unknown;
}

export class FakeCalendarProvider {
    requests: RecordedRequest[] = [];
    calendars = new Map<string, { provider: 'GOOGLE' | 'MICROSOFT'; name: string }>();
    events = new Map<string, FakeEvent>();
    /** `invalid_grant` on the next refresh grants. */
    refuseRefresh = false;
    /** 401 on every API call (a withdrawn grant). */
    refuseCalls = false;
    /** 429 on every API call. */
    throttle = false;
    /** 500 on every event delete. */
    failDeletes = false;
    /** Store the next N inserts, then throw as if the connection dropped. */
    crashAfterInserts = 0;
    /** Google refuses a second insert of an id with 409; off, it stores a duplicate (collisions are not guaranteed to be detected). */
    detectCollisions = true;
    /** Answer a code exchange without a refresh token. */
    noRefreshToken = false;
    /** Google answers 410 to any sync token handed out before this change counter. */
    syncTokensValidFrom = 0;
    /** Graph pages `calendarView` by this many events. */
    graphPageSize = 2;
    /** Graph answers a page link on this origin instead of its own (an SSRF attempt). */
    graphNextLinkOrigin = 'https://graph.microsoft.com';
    private seq = 0;
    private change = 0;
    private realFetch: typeof fetch | null = null;

    install(): this {
        this.realFetch = global.fetch;
        global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init ?? {})) as typeof fetch;
        return this;
    }

    uninstall(): void {
        if (this.realFetch) global.fetch = this.realFetch;
    }

    liveEvents(provider?: 'GOOGLE' | 'MICROSOFT'): FakeEvent[] {
        return [...this.events.values()].filter((e) => !e.cancelled && (!provider || this.calendars.get(e.calendarId)?.provider === provider));
    }

    /** What a provider API call sent, for content checks (token calls excluded). */
    apiBodies(): Array<Record<string, unknown>> {
        return this.requests.filter((r) => !r.url.includes('/token') && r.body && typeof r.body === 'object').map((r) => r.body as Record<string, unknown>);
    }

    /** The event Islestone pushed for a client id (live or deleted). */
    eventByClientId(clientId: string): FakeEvent | undefined {
        return [...this.events.values()].find((e) => e.clientId === clientId);
    }

    /**
     * A person moves an event in their calendar: to an all-day span, or to a
     * timed slot (Google: an RFC 3339 end with its zone; Graph: a UTC end and
     * the event's original zone). The version changes, as a provider's does.
     */
    personMove(id: string, to: { allDayEnd: string } | { endUtc: string; endLocal?: string; zone: string }): void {
        const ev = this.events.get(id);
        if (!ev) throw new Error(`no event ${id}`);
        const google = this.calendars.get(ev.calendarId)?.provider === 'GOOGLE';
        if ('allDayEnd' in to) {
            const end = to.allDayEnd;
            const start = new Date(`${end}T00:00:00Z`);
            start.setUTCDate(start.getUTCDate() - 1);
            const startDay = start.toISOString().slice(0, 10);
            ev.body = google
                ? { ...ev.body, start: { date: startDay }, end: { date: end } }
                : { ...ev.body, isAllDay: true, start: { dateTime: `${startDay}T00:00:00`, timeZone: 'UTC' }, end: { dateTime: `${end}T00:00:00`, timeZone: 'UTC' }, originalEndTimeZone: 'UTC' };
        } else {
            ev.body = google
                ? { ...ev.body, start: { dateTime: to.endLocal ?? to.endUtc, timeZone: to.zone }, end: { dateTime: to.endLocal ?? to.endUtc, timeZone: to.zone } }
                : { ...ev.body, isAllDay: false, end: { dateTime: to.endUtc.replace(/Z$/, '').replace(/\.\d+$/, ''), timeZone: 'UTC' }, originalEndTimeZone: to.zone };
        }
        ev.version += 1;
        ev.changedAt = ++this.change;
    }

    /** A person retitles an event (not read back). */
    personRetitle(id: string, title: string): void {
        const ev = this.events.get(id)!;
        ev.body = { ...ev.body, summary: title, subject: title };
        ev.version += 1;
        ev.changedAt = ++this.change;
    }

    /** A person deletes an event: Google keeps it cancelled, Graph forgets it. */
    personDelete(id: string): void {
        const ev = this.events.get(id)!;
        if (this.calendars.get(ev.calendarId)?.provider === 'GOOGLE') {
            ev.cancelled = true;
            ev.version += 1;
            ev.changedAt = ++this.change;
        } else {
            this.events.delete(id);
        }
    }

    /** A person deletes the whole Islestone calendar, and its events with it. */
    personDeleteCalendar(calendarId: string): void {
        this.calendars.delete(calendarId);
        for (const [id, ev] of this.events) if (ev.calendarId === calendarId) this.events.delete(id);
    }

    private googleItem(e: FakeEvent): Record<string, unknown> {
        if (e.cancelled) return { id: e.id, etag: `"${e.version}"`, status: 'cancelled' };
        return { id: e.id, etag: `"${e.version}"`, status: 'confirmed', start: e.body.start, end: e.body.end };
    }

    private graphItem(e: FakeEvent): Record<string, unknown> {
        return { id: e.id, changeKey: `ck${e.version}`, isCancelled: false, isAllDay: e.body.isAllDay, start: e.body.start, end: e.body.end, originalEndTimeZone: e.body.originalEndTimeZone ?? 'UTC' };
    }

    /** The date an event ends on (exclusive for all-day), for Graph's window. */
    private graphEndDay(e: FakeEvent): string {
        return String((e.body.end as { dateTime?: string } | undefined)?.dateTime ?? '').slice(0, 10);
    }

    private json(status: number, body: unknown): Response {
        return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }

    private async handle(url: string, init: RequestInit): Promise<Response> {
        const method = (init.method ?? 'GET').toUpperCase();
        let body: unknown = undefined;
        if (typeof init.body === 'string') body = JSON.parse(init.body);
        else if (init.body instanceof URLSearchParams) body = Object.fromEntries(init.body.entries());
        this.requests.push({ method, url, body });
        const u = new URL(url);

        // ── Token endpoints ──
        if (u.pathname.endsWith('/token')) {
            const form = body as Record<string, string>;
            if (form.grant_type === 'refresh_token' && this.refuseRefresh) return this.json(400, { error: 'invalid_grant', error_description: 'Token revoked for someone@example.com' });
            const token = { access_token: `at-${++this.seq}`, expires_in: 3600, ...(form.grant_type === 'authorization_code' && !this.noRefreshToken ? { refresh_token: `rt-${this.seq}` } : {}), scope: form.scope ?? 'granted-scope' };
            return this.json(200, token);
        }
        if (this.throttle) return this.json(429, {});
        if (this.refuseCalls) return this.json(401, { error: { message: 'Invalid Credentials' } });

        const google = u.origin === 'https://www.googleapis.com';
        const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        // Google: calendar/v3/calendars[/{cal}[/events[/{id}]]]; Graph: v1.0/me/calendars[/{cal}[/events]] | v1.0/me/events/{id}
        if (google) {
            const [, , , cal, events, id] = parts;
            if (!cal && method === 'POST') return this.newCalendar('GOOGLE', (body as { summary: string }).summary);
            if (cal && !events && method === 'DELETE') return this.dropCalendar(cal);
            if (cal && events && !id && method === 'GET' && !u.searchParams.get('privateExtendedProperty') && u.searchParams.get('maxResults') !== '1') {
                // The read-back's listing: by sync token, page by page.
                if (!this.calendars.has(cal)) return this.json(404, { error: { message: 'Not Found' } });
                const token = u.searchParams.get('syncToken');
                const since = token ? Number(token.replace('st-', '')) : -1;
                if (token && since < this.syncTokensValidFrom) return this.json(410, { error: { message: 'Sync token is no longer valid, a full sync is required.' } });
                const all = [...this.events.values()].filter((e) => e.calendarId === cal && (since < 0 || e.changedAt > since)).sort((x, y) => x.changedAt - y.changedAt);
                const offset = Number(u.searchParams.get('pageToken') ?? '0');
                const size = 2;
                const page = all.slice(offset, offset + size).map((e) => this.googleItem(e));
                const more = offset + size < all.length;
                return this.json(200, { items: page, ...(more ? { nextPageToken: String(offset + size) } : { nextSyncToken: `st-${this.change}` }) });
            }
            if (cal && events && id && method === 'GET') {
                const ev = this.events.get(id);
                if (!ev || ev.calendarId !== cal) return this.json(404, {});
                return this.json(200, this.googleItem(ev));
            }
            if (cal && events && !id && method === 'GET') {
                if (!this.calendars.has(cal)) return this.json(404, { error: { message: 'Not Found' } });
                const prop = u.searchParams.get('privateExtendedProperty');
                const showDeleted = u.searchParams.get('showDeleted') === 'true';
                const items = [...this.events.values()].filter((e) => e.calendarId === cal && (showDeleted || !e.cancelled) && (!prop || prop === `islestone=${e.clientId}`));
                return this.json(200, { items: items.slice(0, Number(u.searchParams.get('maxResults') ?? 250)).map((e) => ({ id: e.id, etag: `"${e.version}"`, status: e.cancelled ? 'cancelled' : 'confirmed' })) });
            }
            if (cal && events && !id && method === 'POST') {
                const b = body as Record<string, unknown> & { id: string; extendedProperties: { private: { islestone: string } } };
                if (this.events.has(b.id) && this.detectCollisions) return this.json(409, { error: { message: 'The requested identifier already exists.' } });
                return this.insert(cal, b.id && !this.events.has(b.id) ? b.id : `g-${++this.seq}`, b.extendedProperties.private.islestone, b, 'etag');
            }
            if (cal && events && id && method === 'PATCH') return this.patch(id, body as Record<string, unknown>, 'etag');
            if (cal && events && id && method === 'DELETE') return this.remove(id);
        } else {
            const [, , coll, cal, events] = parts;
            if (coll === 'calendars' && cal && events === 'calendarView' && method === 'GET') {
                if (!this.calendars.has(cal)) return this.json(404, { error: { code: 'ErrorItemNotFound' } });
                const from = (u.searchParams.get('startDateTime') ?? '').slice(0, 10);
                const to = (u.searchParams.get('endDateTime') ?? '').slice(0, 10);
                const inView = [...this.events.values()].filter((e) => e.calendarId === cal && !e.cancelled && this.graphEndDay(e) > from && this.graphEndDay(e) <= to).sort((x, y) => (x.id < y.id ? -1 : 1));
                const skip = Number(u.searchParams.get('$skip') ?? '0');
                const page = inView.slice(skip, skip + this.graphPageSize).map((e) => this.graphItem(e));
                const more = skip + this.graphPageSize < inView.length;
                const next = new URL(`${this.graphNextLinkOrigin}${u.pathname}`);
                u.searchParams.forEach((v, k) => next.searchParams.set(k, v));
                next.searchParams.set('$skip', String(skip + this.graphPageSize));
                return this.json(200, { value: page, ...(more ? { '@odata.nextLink': next.toString() } : {}) });
            }
            if (coll === 'events' && cal && !events && method === 'GET') {
                const ev = this.events.get(cal);
                if (!ev) return this.json(404, { error: { code: 'ErrorItemNotFound' } });
                return this.json(200, this.graphItem(ev));
            }
            if (coll === 'calendars' && !cal && method === 'POST') return this.newCalendar('MICROSOFT', (body as { name: string }).name);
            if (coll === 'calendars' && cal && !events && method === 'DELETE') return this.dropCalendar(cal);
            if (coll === 'calendars' && cal && events && method === 'GET') {
                const filter = u.searchParams.get('$filter');
                const m = filter ? /ep\/value eq '([0-9a-f]+)'/.exec(filter) : null;
                const items = [...this.events.values()].filter((e) => e.calendarId === cal && !e.cancelled && (!m || e.clientId === m[1]));
                return this.json(200, { value: items.slice(0, Number(u.searchParams.get('$top') ?? 100)).map((e) => ({ id: e.id, changeKey: `ck${e.version}` })) });
            }
            if (coll === 'calendars' && cal && events && method === 'POST') {
                const b = body as Record<string, unknown> & { transactionId: string };
                // Graph refuses a redundant create with the same transactionId: it answers the event it has.
                const existing = [...this.events.values()].find((e) => e.clientId === b.transactionId && !e.cancelled);
                if (existing) return this.json(201, { id: existing.id, changeKey: `ck${existing.version}` });
                return this.insert(cal, `m-${++this.seq}`, b.transactionId, b, 'changeKey');
            }
            if (coll === 'events' && cal && method === 'PATCH') return this.patch(cal, body as Record<string, unknown>, 'changeKey');
            if (coll === 'events' && cal && method === 'DELETE') return this.remove(cal);
        }
        return this.json(404, { error: { message: 'unknown route' } });
    }

    private newCalendar(provider: 'GOOGLE' | 'MICROSOFT', name: string): Response {
        const id = `${provider === 'GOOGLE' ? 'gcal' : 'mcal'}-${++this.seq}`;
        this.calendars.set(id, { provider, name });
        return this.json(200, { id });
    }

    private dropCalendar(cal: string): Response {
        if (!this.calendars.has(cal)) return this.json(404, {});
        this.calendars.delete(cal);
        return this.json(204, null);
    }

    private insert(cal: string, id: string, clientId: string, body: Record<string, unknown>, versionKey: 'etag' | 'changeKey'): Response {
        if (!this.calendars.has(cal)) return this.json(404, {});
        const ev: FakeEvent = { id, calendarId: cal, clientId, body, cancelled: false, version: 1, changedAt: ++this.change };
        this.events.set(id, ev);
        if (this.crashAfterInserts > 0) {
            this.crashAfterInserts -= 1;
            throw new TypeError('fetch failed: the connection dropped');
        }
        return this.json(200, { id, [versionKey]: versionKey === 'etag' ? '"1"' : 'ck1' });
    }

    private patch(id: string, body: Record<string, unknown>, versionKey: 'etag' | 'changeKey'): Response {
        const ev = this.events.get(id);
        if (!ev) return this.json(404, {});
        if (ev.cancelled && body.status !== 'confirmed') return this.json(404, {});
        ev.body = { ...ev.body, ...body };
        ev.cancelled = false;
        ev.version += 1;
        ev.changedAt = ++this.change;
        return this.json(200, { id, [versionKey]: versionKey === 'etag' ? `"${ev.version}"` : `ck${ev.version}` });
    }

    private remove(id: string): Response {
        if (this.failDeletes) return this.json(500, {});
        const ev = this.events.get(id);
        if (!ev || ev.cancelled) return this.json(410, {});
        // Google keeps a deleted event's id reserved (cancelled); Graph forgets it.
        if (this.calendars.get(ev.calendarId)?.provider === 'GOOGLE') {
            ev.cancelled = true;
            ev.changedAt = ++this.change;
        } else this.events.delete(id);
        return this.json(204, null);
    }
}
