/**
 * Time waiting (sub-phase 3.6b; owner decisions 76, 313, 317 and 329; ADR
 * 0014 §6; docs/porting/maps/3.6.md, "Time waiting").
 *
 *   - **A field wait** is a maximal run of an item's consecutive rows naming
 *     the same person in `waitingOnUserId` while the item is live and in the
 *     read's scope (its recorded project visible, and the recorded filters).
 *     It starts at the run's first row and ends at the next row naming
 *     someone else or no one, at the item's deletion, when it leaves the
 *     scope, or runs on at the moment of reading `R`. A close always ends one
 *     (closing clears waiting on); a reopen restores nothing, so it starts
 *     none.
 *   - **A review wait** (decision 317): while a review step is open, each
 *     reviewer asked waits from the step's opening (or their being added,
 *     when later) until their response, their withdrawal or the step's end,
 *     read from the review rows (never rewritten once ended, ADR 0009 §4).
 *     It counts only while the item is live and in scope, judged on the
 *     record at each instant, as a field wait is.
 *   - **Measured** as elapsed working time on the item's own calendar
 *     (`elapsed.ts`, decision 313): over a window, each wait counts its
 *     overlap with the window; a wait's length is the whole wait. Pieces of
 *     one wait on one team are merged before they are measured, so a
 *     weekend inside a wait is removed even when the record has a row in it.
 *
 * The answer per party: the time waited in the window (and how much of it as
 * a reviewer), the items waited on, the waits that ended in the window with
 * their median and 85th percentile length, and what waits on them at `R`.
 * Totals across everyone: the time open items spent waiting on someone (each
 * instant of an item once, whoever it waited on) as a share of open item
 * time in the window. Which rows a caller sees is the usecase's (decision
 * 329), never this module's.
 *
 * Pure: no database, no clock, no zone but the calendars'. Every instant is
 * milliseconds. Written fresh for Islestone.
 */
import type { WorkflowStateCategory } from '@prisma/client';

import { toTenthsOfDays, type WorkingTimeMeter } from './elapsed';
import { nearestRank } from './percentiles';
import { compareFacts, type RecordFact } from './record';

const OPEN: ReadonlySet<WorkflowStateCategory> = new Set(['BACKLOG', 'UNSTARTED', 'STARTED']);

/** A row of the record as time waiting reads it: the picture, and whom it names in waiting on. */
export interface WaitFact extends RecordFact {
    waitingOnUserId: string | null;
}

/**
 * The time from one row of an item to its next (or to `R`), for a row whose
 * item is live and in scope. The SQL read returns these
 * (`WorkItemTransitionRepository.waitSpans`).
 */
export interface WaitSegment {
    workItemId: string;
    /** The row's position among ALL the item's rows up to `R` (1, 2, …): consecutive rows, consecutive positions. */
    ord: number;
    teamId: string;
    start: number;
    /** The next row's instant, or `R` for the item's last row. */
    end: number;
    /** No later row at or before `R`. */
    last: boolean;
    /** Backlog, Unstarted or Started. */
    open: boolean;
    waitingOnUserId: string | null;
}

/** A reviewer's time asked on an open step, from the review rows; `end` null while still asked at `R`. */
export interface ReviewSpan {
    workItemId: string;
    userId: string;
    start: number;
    end: number | null;
}

/** One stretch of a wait on one team's calendar. */
export interface WaitPiece {
    teamId: string;
    start: number;
    end: number;
}

export interface Wait {
    workItemId: string;
    userId: string;
    /** A reviewer's wait (decision 317), not a waiting-on wait. */
    review: boolean;
    /** In order, contiguous stretches of one team merged. */
    pieces: WaitPiece[];
    /** Still waiting at `R`. */
    running: boolean;
}

// ─── Segments from the record (the SQL read's rule, as a pure function) ──

/**
 * One item's segments up to `R` (ms), given its rows in the record's order:
 * every row at or before `R` that is live and in scope, to its next row or
 * to `R`.
 */
export function segmentsOf(rows: readonly WaitFact[], inScope: (row: WaitFact) => boolean, R: number): WaitSegment[] {
    const upTo = rows.filter((r) => r.at.getTime() <= R).sort(compareFacts);
    const out: WaitSegment[] = [];
    upTo.forEach((r, i) => {
        if (r.deleted || !inScope(r)) return;
        const next = upTo[i + 1];
        out.push({
            workItemId: r.workItemId,
            ord: i + 1,
            teamId: r.teamId,
            start: r.at.getTime(),
            end: next ? next.at.getTime() : R,
            last: !next,
            open: OPEN.has(r.stateCategory),
            waitingOnUserId: r.waitingOnUserId,
        });
    });
    return out;
}

/**
 * The segments a read needs (the SQL read returns exactly these): those
 * naming someone in waiting on, the open ones reaching into the window
 * (ending after `windowStart`), and every segment of an item with a review
 * span.
 */
export function relevantSegments(segments: readonly WaitSegment[], windowStart: number, reviewItems: ReadonlySet<string>): WaitSegment[] {
    return segments.filter((s) => s.waitingOnUserId !== null || (s.open && s.end > windowStart) || reviewItems.has(s.workItemId));
}

// ─── Waits ────────────────────────────────────────────────────────────────

/** Contiguous pieces on one team merged (`end` meets the next `start`). */
function mergePieces(pieces: readonly WaitPiece[]): WaitPiece[] {
    const out: WaitPiece[] = [];
    for (const p of pieces) {
        const prev = out[out.length - 1];
        if (prev && prev.teamId === p.teamId && prev.end === p.start) prev.end = p.end;
        else out.push({ ...p });
    }
    return out;
}

function byItemOrdered(segments: readonly WaitSegment[]): Map<string, WaitSegment[]> {
    const out = new Map<string, WaitSegment[]>();
    for (const s of segments) {
        const list = out.get(s.workItemId);
        if (list) list.push(s);
        else out.set(s.workItemId, [s]);
    }
    for (const list of out.values()) list.sort((a, b) => a.ord - b.ord);
    return out;
}

/**
 * The field waits in `segments`: runs of consecutive rows (consecutive
 * `ord`s) naming the same person. A wait of no length that ended is no wait.
 */
export function fieldWaits(segments: readonly WaitSegment[]): Wait[] {
    const out: Wait[] = [];
    for (const list of byItemOrdered(segments).values()) {
        let current: { wait: Wait; ord: number } | null = null;
        for (const s of list) {
            if (s.waitingOnUserId === null) {
                current = null;
                continue;
            }
            if (current && current.wait.userId === s.waitingOnUserId && current.ord === s.ord - 1) {
                current.wait.pieces.push({ teamId: s.teamId, start: s.start, end: s.end });
                current.wait.running = s.last;
                current.ord = s.ord;
                continue;
            }
            const wait: Wait = { workItemId: s.workItemId, userId: s.waitingOnUserId, review: false, pieces: [{ teamId: s.teamId, start: s.start, end: s.end }], running: s.last };
            out.push(wait);
            current = { wait, ord: s.ord };
        }
    }
    return finish(out);
}

/**
 * The review waits: each span intersected with its item's live, in-scope
 * segments. A span with no such stretch is no wait; one still asked at `R`
 * runs while the item's last segment reaches `R`.
 */
export function reviewWaits(spans: readonly ReviewSpan[], segments: readonly WaitSegment[], R: number): Wait[] {
    const items = byItemOrdered(segments);
    const out: Wait[] = [];
    for (const span of mergeSpans(spans)) {
        const end = span.end === null || span.end > R ? R : span.end;
        const stillAsked = span.end === null || span.end > R;
        const pieces: WaitPiece[] = [];
        let running = false;
        for (const s of items.get(span.workItemId) ?? []) {
            const a = Math.max(s.start, span.start);
            const b = Math.min(s.end, end);
            if (b < a || (b === a && !(stillAsked && s.last && b === R))) continue;
            pieces.push({ teamId: s.teamId, start: a, end: b });
            if (stillAsked && s.last && b === R) running = true;
        }
        if (pieces.length === 0) continue;
        out.push({ workItemId: span.workItemId, userId: span.userId, review: true, pieces, running });
    }
    return finish(out);
}

/**
 * One person's spans on one item merged where they overlap or meet. The
 * review rows never give one person two open steps of an item at once (one
 * open step per round, one live round per item), but a wait is never counted
 * twice if they did.
 */
function mergeSpans(spans: readonly ReviewSpan[]): ReviewSpan[] {
    const groups = new Map<string, ReviewSpan[]>();
    for (const sp of spans) {
        const k = `${sp.workItemId}\u0000${sp.userId}`;
        const list = groups.get(k);
        if (list) list.push(sp);
        else groups.set(k, [sp]);
    }
    const out: ReviewSpan[] = [];
    for (const list of groups.values()) {
        list.sort((a, b) => a.start - b.start);
        let cur: ReviewSpan | null = null;
        for (const sp of list) {
            if (cur && (cur.end === null || sp.start <= cur.end)) {
                cur.end = cur.end === null || sp.end === null ? null : Math.max(cur.end, sp.end);
            } else {
                cur = { ...sp };
                out.push(cur);
            }
        }
    }
    return out;
}

function finish(waits: Wait[]): Wait[] {
    return waits
        .map((w) => ({ ...w, pieces: mergePieces(w.pieces) }))
        .filter((w) => w.running || w.pieces[w.pieces.length - 1]!.end > w.pieces[0]!.start);
}

// ─── Figures ──────────────────────────────────────────────────────────────

/** A meter per team's calendar (the item's own calendar, decision 313). */
export type MeterFor = (teamId: string) => WorkingTimeMeter;

export interface WaitWindow {
    /** The window's first instant. */
    start: number;
    /** The moment of reading `R` (no later than the window's end). */
    asOf: number;
}

/** One wait waiting at `R`. */
export interface WaitingNow {
    workItemId: string;
    review: boolean;
    /** The whole wait so far, in working days to one decimal. */
    age: number;
}

/** The ended waits' lengths, in working days to one decimal (nearest rank). */
export interface EndedWaits {
    count: number;
    p50: number | null;
    p85: number | null;
}

export interface PartyWaits {
    /** Time waited in the window, working days to one decimal. */
    waited: number;
    /** Of which as a reviewer. */
    asReviewer: number;
    /** Distinct items with a wait in the window. */
    items: number;
    ended: EndedWaits;
    /** Distinct items waiting on the party at `R`. */
    waitingNow: number;
    /** The waits at `R`, the oldest first (a wait per item and kind). */
    now: WaitingNow[];
}

export interface WaitTotals {
    /** Time waited in the window, summed over the parties. */
    waited: number;
    asReviewer: number;
    /** The time open items spent waiting on someone in the window (each instant of an item once). */
    itemTimeWaiting: number;
    /** Open item time in the window (live, in scope, Backlog, Unstarted or Started). */
    openItemTime: number;
    /** `itemTimeWaiting / openItemTime`, to three decimals; null with no open item time. */
    share: number | null;
    items: number;
    ended: EndedWaits;
    /** Distinct items waiting on someone at `R`. */
    waitingNow: number;
}

export interface WaitingFigures {
    /** Per party key (as `partyOf` names it). */
    parties: Map<string, PartyWaits>;
    totals: WaitTotals;
}

function measure(meterFor: MeterFor, p: WaitPiece, from = p.start, to = p.end): number {
    const a = Math.max(from, p.start);
    const b = Math.min(to, p.end);
    return b > a ? meterFor(p.teamId).elapsedMs(new Date(a), new Date(b)) : 0;
}

function endedOf(lengths: number[]): EndedWaits {
    const sorted = [...lengths].sort((a, b) => a - b);
    return { count: sorted.length, p50: nearestRank(sorted, 0.5), p85: nearestRank(sorted, 0.85) };
}

/** Union per item and team of intervals, merged. */
function unionByItem(pieces: ReadonlyArray<WaitPiece & { workItemId: string }>): Array<WaitPiece & { workItemId: string }> {
    const groups = new Map<string, Array<WaitPiece & { workItemId: string }>>();
    for (const p of pieces) {
        const k = `${p.workItemId}\u0000${p.teamId}`;
        const list = groups.get(k);
        if (list) list.push(p);
        else groups.set(k, [p]);
    }
    const out: Array<WaitPiece & { workItemId: string }> = [];
    for (const list of groups.values()) {
        list.sort((a, b) => a.start - b.start || a.end - b.end);
        let cur: (WaitPiece & { workItemId: string }) | null = null;
        for (const p of list) {
            if (cur && p.start <= cur.end) cur.end = Math.max(cur.end, p.end);
            else {
                cur = { ...p };
                out.push(cur);
            }
        }
    }
    return out;
}

/** The overlap, per item and team, of two sets of merged intervals. */
function intersect(a: ReadonlyArray<WaitPiece & { workItemId: string }>, b: ReadonlyArray<WaitPiece & { workItemId: string }>): Array<WaitPiece & { workItemId: string }> {
    const key = (p: WaitPiece & { workItemId: string }) => `${p.workItemId}\u0000${p.teamId}`;
    const byKey = new Map<string, Array<WaitPiece & { workItemId: string }>>();
    for (const p of b) {
        const list = byKey.get(key(p));
        if (list) list.push(p);
        else byKey.set(key(p), [p]);
    }
    const out: Array<WaitPiece & { workItemId: string }> = [];
    for (const p of a) {
        for (const q of byKey.get(key(p)) ?? []) {
            const start = Math.max(p.start, q.start);
            const end = Math.min(p.end, q.end);
            if (end > start) out.push({ workItemId: p.workItemId, teamId: p.teamId, start, end });
        }
    }
    return out;
}

const touches = (w: Wait, win: WaitWindow) => w.pieces.some((p) => p.end > win.start && p.start < win.asOf) || (w.running && win.asOf >= win.start);

/**
 * The figures of `waits` over the window, grouped by `partyOf(userId)` (a
 * removed member's id maps to one shared key; the usecase decides), and the
 * totals across everyone over `segments` (open item time).
 */
export function waitingFigures(waits: readonly Wait[], segments: readonly WaitSegment[], win: WaitWindow, meterFor: MeterFor, partyOf: (userId: string) => string): WaitingFigures {
    interface Acc {
        waitedMs: number;
        reviewMs: number;
        items: Set<string>;
        ended: number[];
        nowItems: Set<string>;
        now: WaitingNow[];
    }
    const acc = new Map<string, Acc>();
    const all: Acc = { waitedMs: 0, reviewMs: 0, items: new Set(), ended: [], nowItems: new Set(), now: [] };
    const waitingPieces: Array<WaitPiece & { workItemId: string }> = [];
    for (const w of waits) {
        const end = w.pieces[w.pieces.length - 1]!.end;
        const endedInWindow = !w.running && end >= win.start && end <= win.asOf;
        // A wait wholly before the window says nothing about it (no party row for it).
        if (!touches(w, win) && !endedInWindow) continue;
        const key = partyOf(w.userId);
        let a = acc.get(key);
        if (!a) {
            a = { waitedMs: 0, reviewMs: 0, items: new Set(), ended: [], nowItems: new Set(), now: [] };
            acc.set(key, a);
        }
        const inWindow = w.pieces.reduce((sum, p) => sum + measure(meterFor, p, win.start, win.asOf), 0);
        const whole = w.pieces.reduce((sum, p) => sum + measure(meterFor, p), 0);
        for (const t of [a, all]) {
            t.waitedMs += inWindow;
            if (w.review) t.reviewMs += inWindow;
            if (touches(w, win)) t.items.add(w.workItemId);
            if (endedInWindow) t.ended.push(toTenthsOfDays(whole));
            if (w.running) {
                t.nowItems.add(w.workItemId);
                t.now.push({ workItemId: w.workItemId, review: w.review, age: toTenthsOfDays(whole) });
            }
        }
        for (const p of w.pieces) waitingPieces.push({ ...p, workItemId: w.workItemId });
    }

    const open = unionByItem(segments.filter((s) => s.open).map((s) => ({ workItemId: s.workItemId, teamId: s.teamId, start: s.start, end: s.end })));
    const openMs = open.reduce((sum, p) => sum + measure(meterFor, p, win.start, win.asOf), 0);
    // An item's instants waiting on anyone, within its open time (so the share is never above one).
    // Elapsed working time is not monotone in its span (a whole weekend inside a longer span is removed, one cut by a
    // shorter span's end is not), so a part can measure a little longer than its whole: held to the open time.
    const waitingMs = Math.min(openMs, intersect(unionByItem(waitingPieces), open).reduce((sum, p) => sum + measure(meterFor, p, win.start, win.asOf), 0));

    const party = (a: Acc): PartyWaits => ({
        waited: toTenthsOfDays(a.waitedMs),
        asReviewer: toTenthsOfDays(a.reviewMs),
        items: a.items.size,
        ended: endedOf(a.ended),
        waitingNow: a.nowItems.size,
        now: [...a.now].sort((x, y) => y.age - x.age || (x.workItemId < y.workItemId ? -1 : x.workItemId > y.workItemId ? 1 : 0)),
    });
    const parties = new Map<string, PartyWaits>();
    for (const [k, a] of acc) parties.set(k, party(a));
    return {
        parties,
        totals: {
            waited: toTenthsOfDays(all.waitedMs),
            asReviewer: toTenthsOfDays(all.reviewMs),
            itemTimeWaiting: toTenthsOfDays(waitingMs),
            openItemTime: toTenthsOfDays(openMs),
            share: openMs > 0 ? Math.round((waitingMs / openMs) * 1000) / 1000 : null,
            items: all.items.size,
            ended: endedOf(all.ended),
            waitingNow: all.nowItems.size,
        },
    };
}
