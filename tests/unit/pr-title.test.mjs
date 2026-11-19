/**
 * scripts/check-pr-title.mjs (owner decision 51): the pattern a pull
 * request's title must match, and the command the PR title workflow runs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { test } from 'node:test';

import { checkPrTitle, MAX_LENGTH, TYPES } from '../../scripts/check-pr-title.mjs';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-pr-title.mjs', import.meta.url));

test('accepts every allowed type, with and without a scope or a breaking mark', () => {
    for (const type of TYPES) {
        assert.equal(checkPrTitle(`${type}: do the thing`).ok, true, type);
        assert.equal(checkPrTitle(`${type}(deploy): do the thing`).ok, true, type);
    }
    assert.deepEqual(checkPrTitle('feat(1.8)!: replace the stack'), { ok: true, type: 'feat', breaking: true });
    assert.deepEqual(checkPrTitle('fix(api/readyz): name the failed check'), { ok: true, type: 'fix', breaking: false });
});

test('refuses the titles this repository used before the rule', () => {
    for (const title of [
        '1.8: environments and delivery',
        'Feat: capitalised type',
        'feature: unknown type',
        'feat:missing space',
        'feat(): empty scope',
        'feat(Deploy): upper-case scope',
        'feat:  leading space in the subject',
        'feat: trailing space ',
        'feat: ',
        'WIP',
        '',
    ]) {
        assert.equal(checkPrTitle(title).ok, false, JSON.stringify(title));
    }
});

test('refuses a title over the length limit', () => {
    assert.equal(checkPrTitle(`feat: ${'x'.repeat(MAX_LENGTH)}`).ok, false);
    assert.equal(checkPrTitle(`feat: ${'x'.repeat(MAX_LENGTH - 6)}`).ok, true);
});

test('the command reads PR_TITLE and exits 0 or 1 with an annotation', () => {
    const run = (title) =>
        spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { PATH: process.env.PATH, PR_TITLE: title }, cwd: path.dirname(SCRIPT) });
    const good = run('docs(deploy): the runbook');
    assert.equal(good.status, 0);
    assert.match(good.stdout, /PR title OK: docs/);
    const bad = run('1.8: environments and delivery; $(touch /tmp/never)');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^::error title=PR title is not a Conventional Commit::/);
});
