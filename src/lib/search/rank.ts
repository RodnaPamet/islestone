/**
 * Pure ranking helpers for the workspace search (sub-phase 2.7b).
 *
 * Copied from inflect-compliance `src/lib/search/rank.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and cut to Islestone's
 * two hit types: the per-type baselines are work items above projects, and
 * the zero-filled counts name those two. The bands, the sort and the
 * cap-after-sort are unchanged.
 *
 * Pulled out of the usecase so the scoring rules are unit-
 * testable without touching Prisma. The function here is the
 * ONLY place that decides hit ordering — the API contract
 * promises score-DESC ordering, so a future change to the rule
 * lands in one place and propagates everywhere.
 *
 * Scoring rule (higher is better):
 *
 *   exact match on normalised title/code      → 100
 *   prefix match on normalised title/code     →  60
 *   substring match in normalised title       →  30
 *   substring match in normalised subtitle    →  10
 *   plus per-type baseline so ties break by
 *   "a member is more likely to want a work
 *    item than a project"                     → +0..1
 *
 * A work item's code is its key (`ISL-12`) and a project's its key prefix
 * (`ISL`), so a typed key is an exact match and ranks first. A word match
 * the full-text index found but no band names (the words in another order)
 * scores the baseline only, below every substring hit.
 *
 * Numbers are arbitrary but spaced so the bands are visually
 * obvious in test snapshots (a substring hit can't accidentally
 * outrank an exact hit even if the type baseline is high).
 */

import type { SearchHit, SearchHitType } from './types';

// ─── Per-type baseline ────────────────────────────────────────────────

/**
 * Tiebreak hint when two hits across different kinds match the
 * query equally well. Magnitudes are tiny relative to the
 * match-quality bands so ranking is dominated by relevance, not
 * type bias.
 */
const TYPE_BASELINE: Record<SearchHitType, number> = {
    workItem: 1,
    project: 0,
};

// ─── Normalise ────────────────────────────────────────────────────────

function normalise(s: string | null | undefined): string {
    return (s ?? '').trim().toLowerCase();
}

// ─── Rank ─────────────────────────────────────────────────────────────

export interface RankInput {
    type: SearchHitType;
    title: string;
    subtitle?: string | null;
    /** Optional code (a work item's key, a project's key prefix) — exact-match candidate. */
    code?: string | null;
}

export function computeRankScore(query: string, input: RankInput): number {
    const q = normalise(query);
    if (!q) return 0;
    const title = normalise(input.title);
    const subtitle = normalise(input.subtitle);
    const code = normalise(input.code);

    let score = 0;
    // Exact match on either the code or the title — strongest signal.
    if (code === q || title === q) {
        score += 100;
    } else if ((code !== '' && code.startsWith(q)) || title.startsWith(q)) {
        // Prefix — strong signal for "I started typing what I want".
        score += 60;
    } else if (title.includes(q)) {
        score += 30;
    } else if (subtitle.includes(q)) {
        score += 10;
    }
    return score + TYPE_BASELINE[input.type];
}

// ─── Sort + cap ────────────────────────────────────────────────────────

/**
 * Sort hits by score DESC with deterministic id tiebreaker. The
 * id tiebreak makes two equally-scored hits land in a stable
 * order across requests — useful for snapshot tests, useful for
 * people who can predict where the second-best match will sit.
 * Ids compare by code unit (`<`), never `localeCompare`, so the
 * order does not depend on the server's locale.
 */
export function sortHits(hits: ReadonlyArray<SearchHit>): SearchHit[] {
    return [...hits].sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        if (a.type !== b.type) return TYPE_BASELINE[b.type] - TYPE_BASELINE[a.type];
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Apply per-type cap AFTER ranking, so the highest-scoring hits
 * within each type survive even when the underlying DB returned
 * more rows than the cap allows.
 */
export function capPerType(
    hits: ReadonlyArray<SearchHit>,
    limit: number,
): { kept: SearchHit[]; perTypeCounts: Record<SearchHitType, number>; truncated: boolean } {
    const counts: Record<SearchHitType, number> = { workItem: 0, project: 0 };
    const kept: SearchHit[] = [];
    let truncated = false;
    // Iterate in score-DESC order (caller pre-sorts).
    for (const hit of hits) {
        if (counts[hit.type] < limit) {
            counts[hit.type] += 1;
            kept.push(hit);
        } else {
            truncated = true;
        }
    }
    return { kept, perTypeCounts: counts, truncated };
}
