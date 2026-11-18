// Tests for scripts/ui-drift.mjs. Run with: npm run test:scripts (node --test;
// Jest's projects match only .ts and .tsx tests, so it does not run this file).
//
// Every fixture lives in a fresh temp directory, removed when the file's tests
// finish: a throwaway git repository standing in for inflect-compliance, and a
// throwaway consumer root standing in for Islestone. The one test that reads
// the real packages/ui only reads it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/ui-drift.mjs');
const ZERO_SHA = '0'.repeat(40);

// Fixture git runs ignore the developer's global and system config, so a
// signing hook, a default-branch or an autocrlf setting cannot change the
// outcome.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ui-drift-${prefix}-`));
  fixtures.push(dir);
  return dir;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { env: FIXTURE_ENV, encoding: 'utf8' }).trim();
}

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function run(args, { env = FIXTURE_ENV } = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
  let json = null;
  if (args.includes('--json')) json = JSON.parse(res.stdout);
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function commitAll(repo, message) {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

/** A minimal upstream repository with a package under packages/ui. */
function makeUpstream({ name = 'inflect-compliance', extra = () => {} } = {}) {
  const dir = tmp('upstream');
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'package.json', JSON.stringify({ name, private: true }));
  write(dir, 'src/app.ts', 'export const outsideThePackage = true;\n');
  write(dir, 'packages/ui/package.json', '{"name":"@inflect/ui"}\n');
  write(dir, 'packages/ui/README.md', '# ui\n');
  write(dir, 'packages/ui/src/a.ts', 'export const a = 1;\n');
  write(dir, 'packages/ui/src/b/c.tsx', 'export const C = () => null;\n');
  extra(dir);
  const commit = commitAll(dir, 'initial package');
  return { dir, commit };
}

/** A consumer root with packages/ui pinned to the upstream commit. */
function makeConsumer(upstream, ref = upstream.commit) {
  const root = tmp('consumer');
  const res = run(['pin', upstream.dir, '--ref', ref, '--root', root, '--population', 'fs', '--json']);
  assert.equal(res.code, 0, res.stdout);
  return root;
}

const pkg = (root, rel = '') => path.join(root, 'packages/ui', rel);
const manifestPath = (root) => pkg(root, 'UPSTREAM.json');
const readManifestJson = (root) => JSON.parse(fs.readFileSync(manifestPath(root), 'utf8'));
const verifyArgs = (root, ...more) => ['verify', '--root', root, '--population', 'fs', '--json', ...more];
const gitVerifyArgs = (root) => ['verify', '--root', root, '--population', 'git', '--json'];
const auditArgs = (root, upstream) => ['audit', upstream.dir, '--root', root, '--json'];

/**
 * Rewrites UPSTREAM.json the way a hand edit would, but in canonical form, so
 * that only audit can tell. `change` gets {source, commit, path, executable,
 * files} with plain arrays and objects.
 */
async function editManifest(root, change) {
  const { serializeManifest } = await import(pathToFileURL(SCRIPT).href);
  const m = readManifestJson(root);
  change(m);
  const text = serializeManifest({
    source: m.source,
    commit: m.commit,
    path: m.path,
    executable: new Set(m.executable),
    files: new Map(Object.entries(m.files)),
  });
  fs.writeFileSync(manifestPath(root), text);
}

const sha256Of = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Creates a file whose name holds the byte 0xff; returns false where the filesystem refuses one. */
function writeNonUtf8(dir, prefix, content) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(Buffer.concat([Buffer.from(`${dir}/${prefix}`), Buffer.from([0xff]), Buffer.from('bad.ts')]), content);
    return true;
  } catch {
    return false;
  }
}

test('verify passes on an untouched pinned copy', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);

  const res = run(verifyArgs(root));
  assert.equal(res.code, 0);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.population, 'filesystem');
  assert.deepEqual(res.json.counts, {
    listed: 4,
    matching: 4,
    modified: 0,
    missing: 0,
    notRegular: 0,
    modeChanged: 0,
    unlisted: 0,
    badNames: 0,
    unreadable: 0,
  });

  const manifest = readManifestJson(root);
  assert.deepEqual(Object.keys(manifest), ['source', 'commit', 'path', 'executable', 'files']);
  assert.equal(manifest.source, 'inflect-compliance');
  assert.equal(manifest.commit, upstream.commit);
  assert.equal(manifest.path, 'packages/ui');
  assert.deepEqual(manifest.executable, []);
  // Only the package is copied, never the rest of the upstream repository.
  assert.deepEqual(Object.keys(manifest.files), ['README.md', 'package.json', 'src/a.ts', 'src/b/c.tsx']);
  assert.equal(fs.readFileSync(pkg(root, 'src/a.ts'), 'utf8'), 'export const a = 1;\n');

  const bound = run(auditArgs(root, upstream));
  assert.equal(bound.code, 0, bound.stdout);
  assert.equal(bound.json.ok, true);
  assert.equal(bound.json.counts.matching, 4);
});

test('a modified file fails verify and is named', () => {
  const root = makeConsumer(makeUpstream());
  fs.appendFileSync(pkg(root, 'src/a.ts'), '// a local edit\n');

  const res = run(verifyArgs(root));
  assert.equal(res.code, 1);
  assert.equal(res.json.ok, false);
  assert.deepEqual(res.json.modified.map((m) => m.path), ['src/a.ts']);
  assert.deepEqual(res.json.missing, []);
  assert.deepEqual(res.json.unlisted, []);

  const text = run(['verify', '--root', root, '--population', 'fs']);
  assert.equal(text.code, 1);
  assert.match(text.stdout, /^ {2}modified {4}src\/a\.ts$/m);
});

test('a listed file replaced by a symlink fails, even when the bytes it points at match', () => {
  const root = makeConsumer(makeUpstream());
  const real = path.join(path.dirname(root), `${path.basename(root)}-elsewhere.ts`);
  fixtures.push(real);
  fs.copyFileSync(pkg(root, 'src/a.ts'), real);
  fs.rmSync(pkg(root, 'src/a.ts'));
  fs.symlinkSync(real, pkg(root, 'src/a.ts'));

  const res = run(verifyArgs(root));
  assert.equal(res.code, 1);
  assert.deepEqual(res.json.notRegular, ['src/a.ts']);
});

test('a missing file fails verify and is named', () => {
  const root = makeConsumer(makeUpstream());
  fs.rmSync(pkg(root, 'src/b/c.tsx'));

  const res = run(verifyArgs(root));
  assert.equal(res.code, 1);
  assert.deepEqual(res.json.missing, ['src/b/c.tsx']);
  assert.deepEqual(res.json.modified, []);
});

test('a new file inside packages/ui that the manifest does not list fails verify', () => {
  const root = makeConsumer(makeUpstream());
  write(pkg(root), 'src/islestone-only.tsx', 'export const Mine = () => null;\n');
  write(pkg(root), 'src/deep/new/dir/x.ts', 'export {};\n');

  const res = run(verifyArgs(root));
  assert.equal(res.code, 1);
  assert.deepEqual(res.json.unlisted, ['src/deep/new/dir/x.ts', 'src/islestone-only.tsx']);
  assert.equal(res.json.counts.matching, 4);
});

test('git population follows .gitignore, still catches untracked files, and fs mode stays strict', () => {
  const root = makeConsumer(makeUpstream());
  git(root, 'init', '-q', '-b', 'main');
  write(root, '.gitignore', 'node_modules/\ntsconfig.tsbuildinfo\n*.generated.ts\n');
  // Build output a typecheck or an install can leave inside the package.
  write(pkg(root), 'tsconfig.tsbuildinfo', '{}');
  write(pkg(root), 'node_modules/some-dep/index.js', 'module.exports = 1;\n');
  // What a CI build step could generate before verify runs: git population
  // cannot see it, which is why CI runs fs population straight after checkout.
  write(pkg(root), 'src/x.generated.ts', 'export {};\n');

  const viaGit = run(gitVerifyArgs(root));
  assert.equal(viaGit.code, 0, viaGit.stdout);
  assert.equal(viaGit.json.population, 'git');

  const viaFs = run(verifyArgs(root));
  assert.equal(viaFs.code, 1);
  assert.deepEqual(viaFs.json.unlisted, ['node_modules/some-dep/index.js', 'src/x.generated.ts', 'tsconfig.tsbuildinfo']);

  write(pkg(root), 'src/untracked.ts', 'export {};\n');
  const untracked = run(gitVerifyArgs(root));
  assert.equal(untracked.code, 1);
  assert.deepEqual(untracked.json.unlisted, ['src/untracked.ts']);
});

test('compare lists the files changed, added and removed upstream since the pin', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  write(upstream.dir, 'packages/ui/src/a.ts', 'export const a = 2;\n');
  write(upstream.dir, 'packages/ui/src/d.ts', 'export const d = 4;\n');
  fs.rmSync(path.join(upstream.dir, 'packages/ui/README.md'));
  write(upstream.dir, 'src/app.ts', 'export const outsideThePackage = false;\n');
  const next = commitAll(upstream.dir, 'change the package');

  const res = run(['compare', upstream.dir, '--root', root, '--json']);
  assert.equal(res.code, 1);
  assert.equal(res.json.upToDate, false);
  assert.equal(res.json.pinned.commit, upstream.commit);
  assert.equal(res.json.pinned.known, true);
  assert.equal(res.json.pinned.matchesManifest, true);
  assert.equal(res.json.upstream.commit, next);
  assert.deepEqual(res.json.changed, ['src/a.ts']);
  assert.deepEqual(res.json.added, ['src/d.ts']);
  assert.deepEqual(res.json.removed, ['README.md']);
  assert.equal(res.json.counts.unchanged, 2);
  assert.deepEqual(res.json.history.commits.map((c) => c.subject), ['change the package']);

  const text = run(['compare', upstream.dir, '--root', root]);
  assert.equal(text.code, 1);
  assert.match(text.stdout, /^ {2}changed {5}src\/a\.ts$/m);
  assert.match(text.stdout, new RegExp(`pin ${upstream.dir} --ref ${next}$`, 'm'));

  // Compared against the pinned commit itself, nothing has moved.
  const atPin = run(['compare', upstream.dir, '--ref', upstream.commit, '--root', root, '--json']);
  assert.equal(atPin.code, 0);
  assert.equal(atPin.json.upToDate, true);
});

test('compare still reports up to date when later upstream commits leave the package alone', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  write(upstream.dir, 'src/app.ts', 'export const outsideThePackage = 2;\n');
  const next = commitAll(upstream.dir, 'outside the package');

  const res = run(['compare', upstream.dir, '--root', root, '--json']);
  assert.equal(res.code, 0, res.stdout);
  assert.equal(res.json.upToDate, true);
  assert.equal(res.json.upstream.commit, next);
  assert.equal(res.json.pinned.matchesManifest, true);
});

test('compare reads a commit, never the upstream working tree', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  write(upstream.dir, 'packages/ui/src/a.ts', 'export const a = "uncommitted";\n');

  const res = run(['compare', upstream.dir, '--root', root, '--json']);
  assert.equal(res.code, 0);
  assert.equal(res.json.upToDate, true);
  assert.equal(res.json.upstream.workingTreeDirty, true);
});

test('compare and audit refuse a checkout of a different product', () => {
  const root = makeConsumer(makeUpstream());
  const other = makeUpstream({ name: 'islestone' });

  const res = run(['compare', other.dir, '--root', root, '--json']);
  assert.equal(res.code, 2);
  assert.match(res.json.error, /"islestone".*pins "inflect-compliance"/);

  // The other repository does not hold the pinned commit at all.
  const audited = run(auditArgs(root, other));
  assert.equal(audited.code, 1);
  assert.equal(audited.json.problem, 'COMMIT_NOT_FOUND');
});

test('audit takes no --ref and needs a git checkout', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);

  const withRef = run(['audit', upstream.dir, '--ref', upstream.commit, '--root', root, '--json']);
  assert.equal(withRef.code, 2);
  assert.match(withRef.json.error, /does not take --ref/);

  const plainDir = tmp('plain');
  write(plainDir, 'package.json', '{"name":"inflect-compliance"}');
  const notGit = run(['audit', plainDir, '--root', root, '--json']);
  assert.equal(notGit.code, 2);
  assert.match(notGit.json.error, /git repository/);
});

test('pin refuses to overwrite a drifted copy, and takes a new commit when the copy is clean', () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  fs.rmSync(path.join(upstream.dir, 'packages/ui/src/b'), { recursive: true });
  write(upstream.dir, 'packages/ui/src/a.ts', 'export const a = 3;\n');
  const next = commitAll(upstream.dir, 'drop b');

  fs.appendFileSync(pkg(root, 'src/a.ts'), '// local\n');
  const refused = run(['pin', upstream.dir, '--ref', next, '--root', root, '--population', 'fs', '--json']);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.refused, 'LOCAL_DRIFT');
  assert.equal(fs.readFileSync(pkg(root, 'src/a.ts'), 'utf8'), 'export const a = 1;\n// local\n');

  fs.writeFileSync(pkg(root, 'src/a.ts'), 'export const a = 1;\n');
  const taken = run(['pin', upstream.dir, '--ref', next, '--root', root, '--population', 'fs', '--json']);
  assert.equal(taken.code, 0, taken.stdout);
  assert.equal(taken.json.previousCommit, upstream.commit);
  assert.deepEqual(
    { changed: taken.json.counts.changed, added: taken.json.counts.added, removed: taken.json.counts.removed },
    { changed: 1, added: 0, removed: 1 },
  );
  assert.equal(fs.existsSync(pkg(root, 'src/b')), false, 'the emptied directory is pruned');
  assert.equal(run(verifyArgs(root)).code, 0);
  assert.equal(run(auditArgs(root, upstream)).code, 0);
});

test('a manifest that pins nothing, or names a path outside the package, is refused rather than reported clean', () => {
  const root = makeConsumer(makeUpstream());
  const manifest = readManifestJson(root);

  fs.writeFileSync(manifestPath(root), JSON.stringify({ ...manifest, files: {} }));
  const empty = run(verifyArgs(root));
  assert.equal(empty.code, 2);
  assert.match(empty.json.error, /verifies nothing/);

  fs.writeFileSync(manifestPath(root), JSON.stringify({ ...manifest, files: { ...manifest.files, '../escape': '0'.repeat(64) } }));
  const escape = run(verifyArgs(root));
  assert.equal(escape.code, 2);
  assert.match(escape.json.error, /not a safe relative path/);

  fs.writeFileSync(manifestPath(root), JSON.stringify({ ...manifest, executable: ['src/not-listed.ts'] }));
  const execUnlisted = run(verifyArgs(root));
  assert.equal(execUnlisted.code, 2);
  assert.match(execUnlisted.json.error, /executable entry "src\/not-listed\.ts" is not a key of "files"/);
});

test('a manifest not in canonical form is refused: duplicate key, CRLF, reordered keys, other whitespace', () => {
  const root = makeConsumer(makeUpstream());
  const canonical = fs.readFileSync(manifestPath(root), 'utf8');
  fs.appendFileSync(pkg(root, 'src/a.ts'), '// edited\n');
  const editedHash = sha256Of(pkg(root, 'src/a.ts'));

  // The honest hash stays where a reader looks; JSON.parse keeps the later key.
  const dup = canonical.replace(/\n {2}\}\n\}\n$/, `,\n    "src/a.ts": "${editedHash}"\n  }\n}\n`);
  assert.notEqual(dup, canonical);
  const cases = {
    duplicateKey: dup,
    crlf: canonical.replace(/\n/g, '\r\n'),
    reordered: JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(canonical)).reverse()), null, 2) + '\n',
    compact: JSON.stringify(JSON.parse(canonical)),
    noTrailingNewline: canonical.slice(0, -1),
  };
  for (const [name, text] of Object.entries(cases)) {
    fs.writeFileSync(manifestPath(root), text);
    const res = run(verifyArgs(root));
    assert.equal(res.code, 2, `${name}: ${res.stdout}`);
    assert.match(res.json.error, /not in the canonical form/, name);
  }

  for (const [name, bytes] of Object.entries({
    bom: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonical)]),
    notUtf8: Buffer.concat([Buffer.from(canonical.slice(0, -3)), Buffer.from([0xff]), Buffer.from('}\n')]),
  })) {
    fs.writeFileSync(manifestPath(root), bytes);
    const res = run(verifyArgs(root));
    assert.equal(res.code, 2, `${name}: ${res.stdout}`);
    assert.match(res.json.error, /not valid (JSON|UTF-8)/, name);
  }

  // The canonical text itself still reads, and reports the edit.
  fs.writeFileSync(manifestPath(root), canonical);
  assert.equal(run(verifyArgs(root)).code, 1);
});

test('verify passes when a file and its manifest entry are edited together; audit and compare catch it', async () => {
  const upstream = makeUpstream();
  const compareAtPin = (root) => run(['compare', upstream.dir, '--ref', upstream.commit, '--root', root, '--json']);

  // (a) an edited file with its new hash in the manifest.
  const edited = makeConsumer(upstream);
  fs.appendFileSync(pkg(edited, 'src/a.ts'), '// islestone\n');
  const hash = sha256Of(pkg(edited, 'src/a.ts'));
  await editManifest(edited, (m) => {
    m.files['src/a.ts'] = hash;
  });
  assert.equal(run(verifyArgs(edited)).code, 0);
  let audited = run(auditArgs(edited, upstream));
  assert.equal(audited.code, 1);
  assert.equal(audited.json.problem, 'MANIFEST_DIFFERS');
  assert.deepEqual(audited.json.hashMismatch, ['src/a.ts']);
  assert.equal(compareAtPin(edited).json.upToDate, false);

  // (b) an Islestone-only file with a manifest key.
  const added = makeConsumer(upstream);
  write(pkg(added), 'src/islestone.tsx', 'export {};\n');
  const addedHash = sha256Of(pkg(added, 'src/islestone.tsx'));
  await editManifest(added, (m) => {
    m.files['src/islestone.tsx'] = addedHash;
  });
  assert.equal(run(verifyArgs(added)).code, 0);
  audited = run(auditArgs(added, upstream));
  assert.equal(audited.code, 1);
  assert.deepEqual(audited.json.notInUpstream, ['src/islestone.tsx']);

  // (c) a file deleted together with its key.
  const removed = makeConsumer(upstream);
  fs.rmSync(pkg(removed, 'src/a.ts'));
  await editManifest(removed, (m) => {
    delete m.files['src/a.ts'];
  });
  assert.equal(run(verifyArgs(removed)).code, 0);
  audited = run(auditArgs(removed, upstream));
  assert.equal(audited.code, 1);
  assert.deepEqual(audited.json.missingFromManifest, ['src/a.ts']);

  // (d) an invented commit.
  const forged = makeConsumer(upstream);
  await editManifest(forged, (m) => {
    m.commit = ZERO_SHA;
  });
  assert.equal(run(verifyArgs(forged)).code, 0);
  audited = run(auditArgs(forged, upstream));
  assert.equal(audited.code, 1);
  assert.equal(audited.json.problem, 'COMMIT_NOT_FOUND');
  const forgedCompare = run(['compare', upstream.dir, '--root', forged, '--json']);
  assert.equal(forgedCompare.code, 1);
  assert.equal(forgedCompare.json.upToDate, false);
  assert.equal(forgedCompare.json.pinned.known, false);
  assert.match(run(['compare', upstream.dir, '--root', forged]).stdout, /cannot vouch for the manifest/);

  // (e) a real commit the files were not copied from.
  write(upstream.dir, 'packages/ui/src/a.ts', 'export const a = 9;\n');
  const later = commitAll(upstream.dir, 'move a');
  const repointed = makeConsumer(upstream, upstream.commit);
  await editManifest(repointed, (m) => {
    m.commit = later;
  });
  assert.equal(run(verifyArgs(repointed)).code, 0);
  audited = run(auditArgs(repointed, upstream));
  assert.equal(audited.code, 1);
  assert.deepEqual(audited.json.hashMismatch, ['src/a.ts']);
});

test('compare flags a manifest that no longer matches its own pinned commit even when it matches the target', async () => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  write(upstream.dir, 'packages/ui/src/a.ts', 'export const a = 5;\n');
  commitAll(upstream.dir, 'change a');
  // Hand-copy the new upstream a.ts and its hash, keeping the old commit.
  fs.copyFileSync(path.join(upstream.dir, 'packages/ui/src/a.ts'), pkg(root, 'src/a.ts'));
  const hash = sha256Of(pkg(root, 'src/a.ts'));
  await editManifest(root, (m) => {
    m.files['src/a.ts'] = hash;
  });

  const res = run(['compare', upstream.dir, '--root', root, '--json']);
  assert.equal(res.json.counts.changed, 0);
  assert.equal(res.json.pinned.matchesManifest, false);
  assert.equal(res.json.upToDate, false);
  assert.equal(res.code, 1);
});

test('a file name that is not valid UTF-8 fails verify in git and fs population', (t) => {
  const root = makeConsumer(makeUpstream());
  if (!writeNonUtf8(pkg(root, 'src'), '', 'export {};\n')) {
    t.skip('this filesystem refuses a name that is not valid UTF-8');
    return;
  }
  git(root, 'init', '-q', '-b', 'main');

  for (const args of [verifyArgs(root), gitVerifyArgs(root)]) {
    const res = run(args);
    assert.equal(res.code, 1, res.stdout);
    assert.deepEqual(res.json.badNames, ['src/\\xffbad.ts']);
  }

  // Committed, too: git population reads names as bytes, so it is not dropped.
  commitAll(root, 'commit the bad name');
  const committed = run(gitVerifyArgs(root));
  assert.equal(committed.code, 1);
  assert.deepEqual(committed.json.badNames, ['src/\\xffbad.ts']);
});

test('pin refuses, and compare reports, an upstream file whose name is not valid UTF-8', (t) => {
  const upstream = makeUpstream();
  const root = makeConsumer(upstream);
  if (!writeNonUtf8(path.join(upstream.dir, 'packages/ui/src'), '', 'export {};\n')) {
    t.skip('this filesystem refuses a name that is not valid UTF-8');
    return;
  }
  const next = commitAll(upstream.dir, 'add a bad name');

  const compared = run(['compare', upstream.dir, '--root', root, '--json']);
  assert.equal(compared.code, 1);
  assert.equal(compared.json.upToDate, false);
  assert.deepEqual(compared.json.unsupported.map((u) => u.path), ['src/\\xffbad.ts']);

  const pinned = run(['pin', upstream.dir, '--ref', next, '--root', root, '--population', 'fs', '--json']);
  assert.equal(pinned.code, 2);
  assert.match(pinned.json.error, /src\/\\xffbad\.ts \(a name that is not valid UTF-8/);
  // Nothing was replaced.
  assert.equal(readManifestJson(root).commit, upstream.commit);
  assert.equal(run(verifyArgs(root)).code, 0);
});

test('a mode change fails verify, from the working tree and from the git index', () => {
  const root = makeConsumer(makeUpstream());
  fs.chmodSync(pkg(root, 'src/a.ts'), 0o755);

  const viaFs = run(verifyArgs(root));
  git(root, 'init', '-q', '-b', 'main');
  const viaGit = run(gitVerifyArgs(root));
  for (const res of [viaFs, viaGit]) {
    assert.equal(res.code, 1, res.stdout);
    assert.deepEqual(res.json.modeChanged, [{ path: 'src/a.ts', where: 'working tree', expected: '100644', actual: '100755' }]);
    assert.deepEqual(res.json.modified, []);
  }

  // The mode git would commit can change without touching the disk.
  fs.chmodSync(pkg(root, 'src/a.ts'), 0o644);
  commitAll(root, 'track');
  git(root, 'update-index', '--chmod=+x', 'packages/ui/src/a.ts');
  assert.equal(run(verifyArgs(root)).code, 0);
  const index = run(gitVerifyArgs(root));
  assert.equal(index.code, 1);
  assert.deepEqual(index.json.modeChanged, [{ path: 'src/a.ts', where: 'index', expected: '100644', actual: '100755' }]);
});

test('an executable upstream file is pinned at 100755, and losing the bit is caught by verify, audit and compare', async () => {
  const upstream = makeUpstream({
    extra: (dir) => {
      write(dir, 'packages/ui/bin/run.sh', '#!/bin/sh\necho ui\n');
      fs.chmodSync(path.join(dir, 'packages/ui/bin/run.sh'), 0o755);
    },
  });
  assert.match(git(upstream.dir, 'ls-files', '-s', 'packages/ui/bin/run.sh'), /^100755 /);
  const root = makeConsumer(upstream);
  assert.deepEqual(readManifestJson(root).executable, ['bin/run.sh']);
  assert.equal(fs.statSync(pkg(root, 'bin/run.sh')).mode & 0o777, 0o755);
  assert.equal(run(auditArgs(root, upstream)).code, 0);

  fs.chmodSync(pkg(root, 'bin/run.sh'), 0o644);
  const local = run(verifyArgs(root));
  assert.equal(local.code, 1);
  assert.deepEqual(local.json.modeChanged.map((m) => [m.path, m.actual]), [['bin/run.sh', '100644']]);

  // Dropping the bit from the manifest too makes verify pass again; audit and
  // compare still see that upstream holds the file at 100755.
  await editManifest(root, (m) => {
    m.executable = [];
  });
  assert.equal(run(verifyArgs(root)).code, 0);
  const audited = run(auditArgs(root, upstream));
  assert.equal(audited.code, 1);
  assert.deepEqual(audited.json.modeMismatch, ['bin/run.sh']);
  const compared = run(['compare', upstream.dir, '--ref', upstream.commit, '--root', root, '--json']);
  assert.equal(compared.json.upToDate, false);
  assert.deepEqual(compared.json.modeChanged, ['bin/run.sh']);
});

test('odd names round-trip: spaces, unicode, control characters, a leading dash, prototype keys, integer-like keys, an empty file', () => {
  const names = [
    'src/with space.ts',
    'src/ünïcødé.ts',
    'src/new\nline.ts',
    'src/tab\tname.ts',
    'src/-dash.ts',
    'src/empty.ts',
    '__proto__',
    'constructor',
    '10',
    '9',
  ];
  let created = true;
  const upstream = makeUpstream({
    extra: (dir) => {
      try {
        for (const n of names) write(path.join(dir, 'packages/ui'), n, n === 'src/empty.ts' ? '' : `// ${JSON.stringify(n)}\n`);
      } catch {
        created = false;
      }
    },
  });
  assert.ok(created, 'the fixture names could not be created on this filesystem');
  const root = makeConsumer(upstream);

  const manifestText = fs.readFileSync(manifestPath(root), 'utf8');
  // Byte order, which an object's own key order would not give for "10" and "9".
  assert.ok(manifestText.indexOf('"10"') < manifestText.indexOf('"9"'));
  assert.ok(manifestText.indexOf('"9"') < manifestText.indexOf('"README.md"'));
  for (const n of names) assert.ok(manifestText.includes(JSON.stringify(n)), n);
  assert.equal(fs.readFileSync(pkg(root, 'src/empty.ts')).length, 0);

  assert.equal(run(verifyArgs(root)).code, 0);
  git(root, 'init', '-q', '-b', 'main');
  const viaGit = run(gitVerifyArgs(root));
  assert.equal(viaGit.code, 0, viaGit.stdout);
  assert.equal(viaGit.json.counts.listed, 4 + names.length);
  commitAll(root, 'commit odd names');
  assert.equal(run(gitVerifyArgs(root)).code, 0);

  const compared = run(['compare', upstream.dir, '--ref', upstream.commit, '--root', root, '--json']);
  assert.equal(compared.json.upToDate, true, compared.stdout);
  assert.equal(run(auditArgs(root, upstream)).code, 0);

  // A local edit to a prototype-named file is still seen.
  fs.appendFileSync(pkg(root, '__proto__'), 'x\n');
  assert.deepEqual(run(verifyArgs(root)).json.modified.map((m) => m.path), ['__proto__']);
});

test('core.autocrlf=true rewrites the copy on checkout; a root `packages/ui/** -text` rule keeps it byte-identical', () => {
  const root = makeConsumer(makeUpstream());
  git(root, 'init', '-q', '-b', 'main');
  commitAll(root, 'pinned copy');

  const clone = (dir) => {
    const dest = tmp('clone');
    fs.rmSync(dest, { recursive: true });
    execFileSync('git', ['clone', '-q', '-c', 'core.autocrlf=true', dir, dest], { env: FIXTURE_ENV });
    return dest;
  };

  const converted = run(gitVerifyArgs(clone(root)));
  assert.notEqual(converted.code, 0, converted.stdout);
  assert.match(converted.json.error, /not in the canonical form/);

  write(root, '.gitattributes', 'packages/ui/** -text\n');
  commitAll(root, 'keep packages/ui byte-identical');
  const kept = run(gitVerifyArgs(clone(root)));
  assert.equal(kept.code, 0, kept.stdout);
});

test("the repository's own packages/ui matches its UPSTREAM.json", () => {
  // Read-only, against the real tree and the real environment. This is the
  // test that fails when somebody edits a file inside packages/ui.
  const res = run(['verify', '--json'], { env: process.env });
  assert.equal(res.code, 0, res.stdout);
  assert.ok(res.json.counts.listed > 0);
});
