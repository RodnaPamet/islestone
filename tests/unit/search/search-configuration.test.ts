/**
 * The `islestone_bg_en` configuration's pure half (sub-phase 2.7f; ADR 0008
 * D2): the fixtures the startup and readiness checks run are the ones the
 * migration asserts, the text a vector is built from drops mention tokens and
 * is capped, the judge refuses a missing or wrong stem, and the snippet is a
 * bounded window around the match.
 */
import fs from 'node:fs';
import path from 'node:path';

import { checkSearchConfiguration } from '@/lib/search/configuration-check';
import {
    MAX_VECTORISED_LENGTH,
    SEARCH_CONFIGURATION,
    SEARCH_CONFIGURATION_FIXTURES,
    judgeFixtureReadings,
    searchableText,
} from '@/lib/search/configuration';
import { computeContentScore, computeRankScore } from '@/lib/search/rank';
import { buildSnippet } from '@/lib/search/snippet';
import { SNIPPET_LENGTH } from '@/lib/search/types';

const MIGRATION = path.join(__dirname, '../../../prisma/migrations/20261207120000_search_configuration/migration.sql');

describe('the configuration and its fixtures', () => {
    it('is islestone_bg_en', () => {
        expect(SEARCH_CONFIGURATION).toBe('islestone_bg_en');
    });

    it('the migration asserts exactly the fixtures the startup and readiness checks run', () => {
        const sql = fs.readFileSync(MIGRATION, 'utf8');
        const block = sql.slice(sql.indexOf('FOR f IN SELECT * FROM (VALUES'), sql.indexOf(') AS t(input, lexeme)'));
        const pairs = [...block.matchAll(/\('([^']+)', '([^']+)'\)/g)].map((m) => [m[1], m[2]]);
        expect(pairs).toEqual(SEARCH_CONFIGURATION_FIXTURES.map(([a, b]) => [a, b]));
    });

    it('the fixtures prove each arm: Bulgarian inflections, English words and an unknown Cyrillic word', () => {
        const inputs = SEARCH_CONFIGURATION_FIXTURES.map(([input]) => input);
        expect(inputs).toEqual(expect.arrayContaining(['задачата', 'срокът', 'running', 'щъркелоподобни']));
        expect(SEARCH_CONFIGURATION_FIXTURES.some(([input, lexeme]) => /\p{Script=Cyrillic}/u.test(input) && input !== lexeme)).toBe(true);
    });
});

describe('judgeFixtureReadings', () => {
    const all = SEARCH_CONFIGURATION_FIXTURES.map(([input, got]) => ({ input, got }));

    it('passes only when every fixture stems as pinned', () => {
        expect(judgeFixtureReadings(all)).toEqual({ ok: true });
    });

    it('refuses a wrong stem, naming it', () => {
        const r = judgeFixtureReadings(all.map((f) => (f.input === 'срокът' ? { ...f, got: 'срокът' } : f)));
        expect(r).toMatchObject({ ok: false, reason: 'fixture_mismatch' });
        expect(r.ok ? '' : r.detail).toContain('срокът');
    });

    it('refuses a missing fixture and a null answer', () => {
        expect(judgeFixtureReadings(all.slice(1)).ok).toBe(false);
        expect(judgeFixtureReadings(all.map((f, i) => (i === 0 ? { ...f, got: null } : f))).ok).toBe(false);
    });
});

describe('checkSearchConfiguration', () => {
    it('is `missing` when the database refuses the read, and never carries the driver text', async () => {
        const r = await checkSearchConfiguration(async () => {
            throw new Error('text search configuration "islestone_bg_en" does not exist at 10.0.0.5');
        });
        expect(r).toMatchObject({ ok: false, reason: 'missing' });
        expect(JSON.stringify(r)).not.toContain('10.0.0.5');
    });

    it('sends the fixtures as one array parameter, the configuration as a parameter cast to regconfig', async () => {
        const sent: Array<{ sql: string; values: unknown[] }> = [];
        const r = await checkSearchConfiguration(async (q) => {
            sent.push({ sql: q.sql, values: q.values });
            return SEARCH_CONFIGURATION_FIXTURES.map(([input, got]) => ({ input, got }));
        });
        expect(r).toEqual({ ok: true });
        expect(sent).toHaveLength(1);
        expect(sent[0]!.sql).toContain('::regconfig');
        expect(sent[0]!.values).toContainEqual(SEARCH_CONFIGURATION_FIXTURES.map(([input]) => input));
    });
});

describe('searchableText', () => {
    it('drops mention tokens, so a person\'s id never becomes a lexeme', () => {
        expect(searchableText('Ask <@ckuser123> and <@agent:x> today')).toBe('Ask   and   today');
    });

    it('is empty for nothing, whitespace or tokens only', () => {
        expect(searchableText(null)).toBe('');
        expect(searchableText('   ')).toBe('');
        expect(searchableText('<@u1> <@u2>')).toBe('');
    });

    it('caps the text vectorised', () => {
        expect(searchableText('a'.repeat(MAX_VECTORISED_LENGTH + 10))).toHaveLength(MAX_VECTORISED_LENGTH);
    });
});

describe('content ranking', () => {
    it('a description or comment match ranks below every title match, and orders by its rank', () => {
        const titleWords = computeRankScore('login timeout', { type: 'workItem', title: 'Timeout at login', code: 'ISL-1' });
        expect(computeContentScore(1)).toBeLessThan(titleWords);
        expect(computeContentScore(0.2)).toBeGreaterThan(computeContentScore(0.1));
        expect(computeContentScore(Number.NaN)).toBe(computeContentScore(0));
        expect(computeContentScore(5)).toBe(computeContentScore(1));
    });
});

describe('buildSnippet', () => {
    it('a short text is shown whole, folded, without tokens', () => {
        expect(buildSnippet('Ask  <@u1>\nabout the\tlogin', 'login')).toBe('Ask about the login');
    });

    it('a long text is a bounded window around the first match, with ellipses', () => {
        const text = `${'начало '.repeat(40)}проблемът със задачата е в базата ${'край '.repeat(40)}`;
        const snippet = buildSnippet(text, 'задача');
        expect(snippet).toContain('задачата');
        expect(snippet.startsWith('…')).toBe(true);
        expect(snippet.endsWith('…')).toBe(true);
        expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 2);
    });

    it('with no visible match, the start of the text', () => {
        const snippet = buildSnippet('x'.repeat(300), 'missing');
        expect(snippet).toBe(`${'x'.repeat(SNIPPET_LENGTH)}…`);
    });
});
