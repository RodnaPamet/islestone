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
 * Written fresh for Islestone.
 */
interface FakeEvent {
    id: string;
    calendarId: string;
    clientId: string;
    body: Record<string, unknown>;
    cancelled: boolean;
    version: number;
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
    private seq = 0;
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
            if (cal && events && !id && method === 'GET') {
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
        const ev: FakeEvent = { id, calendarId: cal, clientId, body, cancelled: false, version: 1 };
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
        return this.json(200, { id, [versionKey]: versionKey === 'etag' ? `"${ev.version}"` : `ck${ev.version}` });
    }

    private remove(id: string): Response {
        if (this.failDeletes) return this.json(500, {});
        const ev = this.events.get(id);
        if (!ev || ev.cancelled) return this.json(410, {});
        // Google keeps a deleted event's id reserved (cancelled); Graph forgets it.
        if (this.calendars.get(ev.calendarId)?.provider === 'GOOGLE') ev.cancelled = true;
        else this.events.delete(id);
        return this.json(204, null);
    }
}
