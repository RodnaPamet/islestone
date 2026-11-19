/**
 * Pure tests for the command-palette filter-chip helpers.
 *
 * Here we cover the algebra: empty-set passthrough, multi-select
 * intersection, count derivation, immutability. Islestone's hit kinds
 * are work items and projects (`@/lib/search/types`).
 */

import {
    countHitsByKind,
    filterHitsByKind,
    toggleKind,
} from '@/lib/palette/filter';
import { SEARCH_TYPE_DEFAULTS } from '@/lib/search/types';
import type { SearchHit, SearchHitType } from '@/lib/search/types';

function hit(id: string, type: SearchHitType): SearchHit {
    return {
        id,
        type,
        title: `${id}-title`,
        subtitle: null,
        badge: null,
        href: `/x/${id}`,
        score: 0,
        iconKey: 'work-item',
        category: 'X',
    };
}

const getKind = (h: SearchHit) => h.type;

// ─── filterHitsByKind ─────────────────────────────────────────────────

describe('filterHitsByKind', () => {
    it('passes everything through when active set is empty (no chips selected = all kinds)', () => {
        const hits = [hit('w1', 'workItem'), hit('p1', 'project')];
        expect(filterHitsByKind(hits, new Set(), getKind)).toEqual(hits);
    });

    it('keeps only hits whose kind is in the active set', () => {
        const hits = [
            hit('w1', 'workItem'),
            hit('p1', 'project'),
            hit('w2', 'workItem'),
        ];
        const out = filterHitsByKind(
            hits,
            new Set<SearchHitType>(['workItem']),
            getKind,
        );
        expect(out.map((h) => h.id).sort()).toEqual(['w1', 'w2']);
    });

    it('returns a new array — never mutates input', () => {
        const hits = [hit('w1', 'workItem'), hit('p1', 'project')];
        const before = JSON.stringify(hits);
        filterHitsByKind(hits, new Set<SearchHitType>(['workItem']), getKind);
        expect(JSON.stringify(hits)).toBe(before);
    });

    it('returns an empty array when no hit matches the active set', () => {
        const hits = [hit('w1', 'workItem')];
        const out = filterHitsByKind(
            hits,
            new Set<SearchHitType>(['project']),
            getKind,
        );
        expect(out).toEqual([]);
    });
});

// ─── toggleKind ───────────────────────────────────────────────────────

describe('toggleKind', () => {
    it('adds a kind that is not in the active set', () => {
        const out = toggleKind(new Set<SearchHitType>(['workItem']), 'project');
        expect([...out].sort()).toEqual(['project', 'workItem']);
    });

    it('removes a kind that IS in the active set', () => {
        const out = toggleKind(
            new Set<SearchHitType>(['workItem', 'project']),
            'project',
        );
        expect([...out]).toEqual(['workItem']);
    });

    it('returns a new Set — never mutates input', () => {
        const input = new Set<SearchHitType>(['workItem']);
        const before = [...input];
        toggleKind(input, 'project');
        expect([...input]).toEqual(before);
    });
});

// ─── countHitsByKind ──────────────────────────────────────────────────

describe('countHitsByKind', () => {
    it('zero-fills every kind so callers do not have to defensive-check', () => {
        // The zero-fill must cover every member of the union so callers
        // can index by any literal without a defensive existence check.
        // It is derived from SEARCH_TYPE_DEFAULTS, so a kind added there
        // is counted with no edit here.
        const out = countHitsByKind([], getKind);
        expect(out).toEqual({ workItem: 0, project: 0 });
        expect(Object.keys(out).sort()).toEqual(Object.keys(SEARCH_TYPE_DEFAULTS).sort());
    });

    it('counts each hit under its kind', () => {
        const hits = [
            hit('w1', 'workItem'),
            hit('w2', 'workItem'),
            hit('p1', 'project'),
        ];
        const out = countHitsByKind(hits, getKind);
        expect(out.workItem).toBe(2);
        expect(out.project).toBe(1);
    });

    it('counts the FULL list — independent of any filter that may be applied later', () => {
        const hits = [hit('w1', 'workItem'), hit('p1', 'project')];
        // Even if we then filter to 'workItem', the count for project
        // stays at 1 — the chip should still display "Projects (1)" so
        // the member can toggle it back on.
        const out = countHitsByKind(hits, getKind);
        expect(out.project).toBe(1);
    });
});
