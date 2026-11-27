/**
 * Time waiting (sub-phase 3.6b; docs/porting/maps/3.6.md, "Time waiting",
 * "Reads, routes and keys", "Privacy"; ADR 0014 §6, §11 and §12; owner
 * decisions 76, 313, 317, 329, 330 and 332).
 *
 *   - **The record and the review rows are the source**: a field wait is a
 *     run of an item's recorded rows naming one person in waiting on; a
 *     review wait is a reviewer's time asked on an open step (decision 317).
 *     Both count only while the item is live and its recorded project is in
 *     the scope and visible (decision 315), as elapsed working time on the
 *     item's own calendar (decision 313). Computed on every read by
 *     `domain/analytics/waiting.ts`; nothing stored, cached or audited.
 *   - **The scope** is every other analytics read's (`resolveScope`: the
 *     list's filters through `resolveListFiltersInTx`, status filters set
 *     aside, the scope's calendar zone for its days), bounded by the flow's
 *     item limit (20,000; 422 `ANALYTICS_TOO_LARGE`, never cut).
 *   - **Who sees which rows** (decision 329): every holder of
 *     `analytics.view` reads the totals and their own row; every party's row
 *     (and the one anonymous row of removed members) only with
 *     `analytics.people`, absent otherwise. A caller who is not a person (an
 *     API key, later an agent) reads the totals alone (decision 332).
 *   - **No figure per assignee** (decision 330): waits are grouped by whom an
 *     item waited on, never by its assignee.
 *
 * Never logs a person's figures. The waiting-now items' keys and titles are
 * read by id under the caller's visibility; no description, comment or
 * response text. Written fresh for Islestone.
 */
import { WorkingTimeMeter } from '../domain/analytics/elapsed';
import { fieldWaits, reviewWaits, waitingFigures, type PartyWaits } from '../domain/analytics/waiting';
import { formatKey } from '../domain/work-item-key';
import { assertCanViewAnalytics, mayReadAnalyticsPeople, readsWaitingAsPerson } from '../policies/analytics.policies';
import { MembershipRepository } from '../repositories/MembershipRepository';
import { WorkItemRepository } from '../repositories/WorkItemRepository';
import { WorkItemTransitionRepository } from '../repositories/WorkItemTransitionRepository';
import type { RequestContext } from '../types';
import { resolveScope, tooLarge, type AnalyticsQuery } from './analytics';
import { runInTenantContext } from '@/lib/db-context';
import {
    ANALYTICS_FLOW_ITEM_LIMIT,
    WAITING_NOW_LISTED,
    WAITING_NOW_LISTED_TOTAL,
    type WaitingParty,
    type WaitingPartyRow,
    type WaitingResponse,
} from '@/lib/analytics/types';

/** The one key every removed member's waits are grouped under (never a person's id). */
const FORMER = '\u0000former';

const ZERO: PartyWaits = { waited: 0, asReviewer: 0, items: 0, ended: { count: 0, p50: null, p85: null }, waitingNow: 0, now: [] };

/** Time waiting over the scope and window: the totals, the caller's row, and every party's row for `analytics.people`. */
export async function getTimeWaiting(ctx: RequestContext, query: AnalyticsQuery, now: Date = new Date()): Promise<WaitingResponse> {
    assertCanViewAnalytics(ctx);
    const asPerson = readsWaitingAsPerson(ctx);
    const everyone = asPerson && mayReadAnalyticsPeople(ctx);
    return runInTenantContext(ctx, async (db) => {
        const s = await resolveScope(db, ctx, query, now, { allCalendars: true });
        const empty = s.toDay < s.fromDay;
        const read = empty
            ? { items: 0, segments: [], spans: [] }
            : await WorkItemTransitionRepository.waitSpans(db, ctx, s.record, { start: s.start, asOf: s.asOf, itemLimit: ANALYTICS_FLOW_ITEM_LIMIT });
        if (read.items > ANALYTICS_FLOW_ITEM_LIMIT) throw tooLarge('items', read.items, ANALYTICS_FLOW_ITEM_LIMIT);

        const meters = new Map<string, WorkingTimeMeter>();
        const meterFor = (teamId: string) => {
            const cal = s.calendars.forTeam(teamId);
            let m = meters.get(cal.id);
            if (!m) {
                m = new WorkingTimeMeter({ compiled: cal.compiled, timeZone: cal.timeZone });
                meters.set(cal.id, m);
            }
            return m;
        };
        const R = s.asOf.getTime();
        const waits = [...fieldWaits(read.segments), ...reviewWaits(read.spans, read.segments, R)];

        // The parties: members by id (any status), every removed member as one row.
        const waitedOn = [...new Set(waits.map((w) => w.userId))];
        const lookup = asPerson ? [...new Set([...(everyone ? waitedOn : waitedOn.filter((u) => u === ctx.userId)), ctx.userId])] : [];
        const members = new Map((await MembershipRepository.partiesOf(db, ctx, lookup)).map((m) => [m.userId, m]));
        // Without the people key the other parties are never named, so they are never looked up: an unread id stays its own key.
        const partyOf = (userId: string) => (!everyone && userId !== ctx.userId ? userId : members.has(userId) ? userId : FORMER);
        const figures = waitingFigures(waits, read.segments, { start: s.start.getTime(), asOf: R }, meterFor, partyOf);

        // The rows shown, then their waiting-now items' keys and titles (read by id, bounded).
        const shown: Array<[string, PartyWaits]> = [];
        if (everyone) shown.push(...[...figures.parties].filter(([k]) => k === FORMER || members.has(k)));
        else if (asPerson) shown.push([ctx.userId, figures.parties.get(ctx.userId) ?? ZERO]);
        if (asPerson && !shown.some(([k]) => k === ctx.userId)) shown.push([ctx.userId, ZERO]);
        let budget = WAITING_NOW_LISTED_TOTAL;
        let cut = false;
        const listed = new Map<string, PartyWaits['now']>();
        for (const [k, p] of shown) {
            const take = Math.min(WAITING_NOW_LISTED, p.now.length, budget);
            if (take < Math.min(WAITING_NOW_LISTED, p.now.length)) cut = true;
            listed.set(k, p.now.slice(0, take));
            budget -= take;
        }
        const ids = [...new Set([...listed.values()].flat().map((n) => n.workItemId))];
        const labels = new Map((await WorkItemRepository.keyTitlesByIds(db, ctx, s.v, ids)).map((w) => [w.id, w]));

        const rowOf = (k: string, p: PartyWaits): WaitingPartyRow => {
            const m = members.get(k);
            const party: WaitingParty = k === FORMER || !m ? { kind: 'former' } : { kind: 'member', userId: m.userId, name: m.name, active: m.active };
            return {
                party,
                waited: p.waited,
                asReviewer: p.asReviewer,
                items: p.items,
                ended: p.ended,
                waitingNow: p.waitingNow,
                waitingNowItems: (listed.get(k) ?? []).flatMap((n) => {
                    const w = labels.get(n.workItemId);
                    return w ? [{ workItemId: n.workItemId, key: formatKey(w.keyPrefix, w.number), title: w.title, asReviewer: n.review, age: n.age }] : [];
                }),
            };
        };
        const byName = (a: WaitingPartyRow, b: WaitingPartyRow) => {
            const n = (r: WaitingPartyRow) => (r.party.kind === 'member' ? (r.party.name ?? '') : '￿');
            return n(a) < n(b) ? -1 : n(a) > n(b) ? 1 : 0;
        };
        const self = asPerson ? rowOf(ctx.userId, figures.parties.get(ctx.userId) ?? ZERO) : undefined;
        return {
            ...s.frame,
            totals: figures.totals,
            ...(self ? { self } : {}),
            ...(everyone ? { people: shown.map(([k, p]) => rowOf(k, p)).sort((a, b) => b.waited - a.waited || byName(a, b)) } : {}),
            waitingNowCut: cut,
            items: read.items,
        };
    });
}
