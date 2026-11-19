// Tests for scripts/ui-mirror.mjs, the second shared-UI manifest (ui-mirror.json).
// Run with: npm run test:scripts (node --test).
//
// Each fixture is a fresh temp directory: a throwaway git repository standing
// in for inflect-compliance, and a consumer root standing in for Islestone.
// The last test reads the real ui-mirror.json and src/ files, read-only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { serializeMirrorManifest, validateMirrorManifest } from '../../scripts/ui-mirror.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(REPO, 'scripts/ui-mirror.mjs');
const FIXTURE_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

const fixtures = [];
after(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ui-mirror-${prefix}-`));
  fixtures.push(dir);
  return dir;
}
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: FIXTURE_ENV, encoding: 'utf8' }).trim();
const sha = (s) => createHash('sha256').update(s).digest('hex');
function write(root, rel, content) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}
function run(...args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], { env: FIXTURE_ENV, encoding: 'utf8' });
  return { code: res.status, json: JSON.parse(res.stdout), stderr: res.stderr };
}

const UPSTREAM_FILES = {
  'src/components/ui/a.tsx': 'export const A = 1;\n',
  'src/components/ui/b/c.ts': 'export const C = 2;\n',
  'src/components/ui/GUIDE.md': '# guide\n',
  'src/components/ui/stub.ts': 'export const upstreamStub = 3;\n',
  'src/lib/leaf.ts': 'export const leaf = 4;\n',
  'src/components/ui/skipped.tsx': 'export const notTaken = 5;\n',
};

function makeUpstream() {
  const dir = tmp('upstream');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'package.json', JSON.stringify({ name: 'inflect-compliance' }));
  for (const [rel, body] of Object.entries(UPSTREAM_FILES)) write(dir, rel, body);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return { dir, commit: git(dir, 'rev-parse', 'HEAD') };
}

/** A consumer that took a.tsx, b/c.ts and lib/leaf.ts, owns stub.ts, and excluded GUIDE.md. */
function makeConsumer(upstream) {
  const root = tmp('consumer');
  const taken = ['src/components/ui/a.tsx', 'src/components/ui/b/c.ts', 'src/lib/leaf.ts'];
  for (const rel of taken) write(root, rel, UPSTREAM_FILES[rel]);
  write(root, 'src/components/ui/stub.ts', 'export const islestoneStub = 3;\n');
  const manifest = {
    source: 'inflect-compliance',
    commit: upstream.commit,
    roots: ['src/components/ui'],
    files: new Map(taken.map((rel) => [rel, sha(UPSTREAM_FILES[rel])])),
    owned: new Map([['src/components/ui/stub.ts', 'Islestone stub']]),
    excluded: new Map([['src/components/ui/GUIDE.md', 'inflect guide']]),
  };
  fs.writeFileSync(path.join(root, 'ui-mirror.json'), serializeMirrorManifest(manifest));
  return root;
}

test('a faithful copy verifies clean and audits bound', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  const v = run('verify', '--root', root, '--population', 'fs');
  assert.equal(v.code, 0, JSON.stringify(v.json));
  assert.equal(v.json.checked, 3);
  const a = run('audit', up.dir, '--root', root);
  assert.equal(a.code, 0, JSON.stringify(a.json));
});

test('verify reports an edited file, an unlisted file, a missing owned file and a present exclusion', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  write(root, 'src/components/ui/a.tsx', 'export const A = 99;\n');
  write(root, 'src/components/ui/new.tsx', 'export const New = 1;\n');
  fs.rmSync(path.join(root, 'src/components/ui/stub.ts'));
  write(root, 'src/components/ui/GUIDE.md', '# guide\n');
  const v = run('verify', '--root', root, '--population', 'fs');
  assert.equal(v.code, 1);
  assert.deepEqual(v.json.modified.map((m) => m.path), ['src/components/ui/a.tsx']);
  assert.deepEqual(v.json.unlisted, ['src/components/ui/GUIDE.md', 'src/components/ui/new.tsx']);
  assert.deepEqual(v.json.ownedMissing, ['src/components/ui/stub.ts']);
  assert.deepEqual(v.json.excludedPresent, ['src/components/ui/GUIDE.md']);
});

test('a file outside the roots is checked by its hash, and a missing one is reported', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  fs.rmSync(path.join(root, 'src/lib/leaf.ts'));
  const v = run('verify', '--root', root, '--population', 'fs');
  assert.equal(v.code, 1);
  assert.deepEqual(v.json.missing, ['src/lib/leaf.ts']);
});

test('audit catches a file and its hash edited together, and a stale exclusion', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  const m = JSON.parse(fs.readFileSync(path.join(root, 'ui-mirror.json'), 'utf8'));
  write(root, 'src/components/ui/a.tsx', 'export const A = 99;\n');
  m.files['src/components/ui/a.tsx'] = sha('export const A = 99;\n');
  m.excluded['src/components/ui/gone.md'] = 'never existed upstream';
  const canonical = serializeMirrorManifest({
    ...m,
    files: new Map(Object.entries(m.files)),
    owned: new Map(Object.entries(m.owned)),
    excluded: new Map(Object.entries(m.excluded)),
  });
  fs.writeFileSync(path.join(root, 'ui-mirror.json'), canonical);
  assert.equal(run('verify', '--root', root, '--population', 'fs').code, 0, 'verify alone cannot tell');
  const a = run('audit', up.dir, '--root', root);
  assert.equal(a.code, 1);
  assert.deepEqual(a.json.differs, ['src/components/ui/a.tsx']);
  assert.deepEqual(a.json.staleExclusions, ['src/components/ui/gone.md']);
});

test('audit reports a commit the checkout does not have', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  const fresh = tmp('empty');
  git(fresh, 'init', '-q');
  const a = run('audit', fresh, '--root', root);
  assert.equal(a.code, 1);
  assert.equal(a.json.commitFound, false);
});

test('a manifest not in canonical form, or with an overlap, is refused', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  const file = path.join(root, 'ui-mirror.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(run('verify', '--root', root).code, 2);
  const problems = validateMirrorManifest({
    source: 's',
    commit: 'a'.repeat(40),
    roots: ['src/components/ui'],
    files: { 'src/components/ui/x.ts': 'b'.repeat(64) },
    owned: { 'src/components/ui/x.ts': 'mine' },
    excluded: {},
  });
  assert.ok(problems.some((p) => p.includes('listed in both')), problems.join('; '));
});

test('compare and pin take an upstream change, and pin refuses over a local edit', () => {
  const up = makeUpstream();
  const root = makeConsumer(up);
  write(up.dir, 'src/components/ui/a.tsx', 'export const A = 2;\n');
  write(up.dir, 'src/components/ui/added.tsx', 'export const Added = 1;\n');
  git(up.dir, 'add', '-A');
  git(up.dir, 'commit', '-q', '-m', 'change a, add a file');
  const c = run('compare', up.dir, '--root', root);
  assert.equal(c.code, 1);
  assert.deepEqual(c.json.changed, ['src/components/ui/a.tsx']);
  assert.deepEqual(c.json.added, ['src/components/ui/added.tsx']);

  write(root, 'src/components/ui/b/c.ts', 'local edit\n');
  const refused = run('pin', up.dir, '--ref', 'HEAD', '--root', root, '--population', 'fs');
  assert.equal(refused.code, 1);
  write(root, 'src/components/ui/b/c.ts', UPSTREAM_FILES['src/components/ui/b/c.ts']);

  const p = run('pin', up.dir, '--ref', 'HEAD', '--root', root, '--population', 'fs', '--add', 'src/components/ui/added.tsx');
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.equal(fs.readFileSync(path.join(root, 'src/components/ui/a.tsx'), 'utf8'), 'export const A = 2;\n');
  assert.equal(run('audit', up.dir, '--root', root).code, 0);
});

test('the real ui-mirror.json verifies against this repository', () => {
  const res = spawnSync(process.execPath, [SCRIPT, 'verify', '--json'], { encoding: 'utf8' });
  const json = JSON.parse(res.stdout);
  assert.equal(res.status, 0, JSON.stringify(json, null, 2));
  assert.ok(json.checked > 100, `expected the copied UI set, got ${json.checked} files`);
});
