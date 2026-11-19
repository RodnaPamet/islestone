#!/usr/bin/env node
/**
 * ui-mirror: keeps the generic UI files Islestone copied from inflect-compliance
 * into its own `src/` (sub-phase 1.2, part B) byte-identical to the upstream
 * commit they were copied from. It is the second manifest beside
 * `packages/ui/UPSTREAM.json` (`scripts/ui-drift.mjs`), and it exists because
 * these files sit at inflect's own paths under `src/`, not inside one package
 * directory a single root check can cover (docs/porting/maps/1.2.md, section 0,
 * finding 4).
 *
 *   node scripts/ui-mirror.mjs verify [--population auto|git|fs] [--json]
 *   node scripts/ui-mirror.mjs audit <upstream-checkout> [--json]
 *   node scripts/ui-mirror.mjs compare <upstream-checkout> [--ref <rev>] [--json]
 *   node scripts/ui-mirror.mjs pin <upstream-checkout> --ref <commit> [--add <path>]... [--json]
 *
 * The manifest is `ui-mirror.json` at the repository root, in exactly the form
 * `serializeMirrorManifest` writes:
 *
 *   {"source":   "<upstream package.json name>",
 *    "commit":   "<40-hex sha>",
 *    "roots":    ["<directory whose every file must be accounted for>", ...],
 *    "files":    {"<path>": "<sha256>", ...},   upstream copies, byte-identical
 *    "owned":    {"<path>": "<why>", ...},      Islestone's own files, not hashed
 *    "excluded": {"<path>": "<why>", ...}}      upstream files inside a root, not taken
 *
 * Paths are repository-relative. A `files` or `owned` path may sit outside the
 * roots (a single copied file such as src/lib/format-bytes.ts); inside a root,
 * every file on disk must be in `files` or `owned`, or verify reports it.
 *
 *   verify   every `files` entry matches its hash; every `owned` entry exists;
 *            no `excluded` entry exists; nothing under a root is unlisted.
 *   audit    every `files` entry equals the upstream blob at `commit`, and
 *            every `excluded` entry exists upstream at `commit` (so an
 *            exclusion cannot outlive the file it excludes).
 *   compare  plan a sync: the listed files that changed or vanished upstream
 *            between `commit` and --ref, and the files added under the roots.
 *   pin      take a sync: rewrite every listed file (and each --add path) from
 *            upstream at --ref, and rewrite the manifest. Refuses while verify
 *            fails, so no local edit is overwritten.
 *
 * verify alone passes when a file and its hash are edited together; audit binds
 * the hashes to upstream. Exit codes as ui-drift: 0 clean/bound/up to date/
 * pinned, 1 drift/not bound/upstream differs/pin refused, 2 could not run.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isSafeRelPath, listPopulation } from './ui-drift.mjs';

export const MIRROR_MANIFEST = 'ui-mirror.json';
const KEYS = ['source', 'commit', 'roots', 'files', 'owned', 'excluded'];
const EXIT = { OK: 0, DRIFT: 1, ERROR: 2 };
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage:
  node scripts/ui-mirror.mjs verify [--root <dir>] [--population auto|git|fs] [--json]
  node scripts/ui-mirror.mjs audit <upstream-checkout> [--root <dir>] [--json]
  node scripts/ui-mirror.mjs compare <upstream-checkout> [--ref <rev>] [--root <dir>] [--json]
  node scripts/ui-mirror.mjs pin <upstream-checkout> --ref <commit> [--add <path>]... [--root <dir>] [--json]`;

export class UiMirrorError extends Error {}

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const under = (p, root) => p.startsWith(`${root}/`);

function git(cwd, args, { allowFail = false } = {}) {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (res.error || res.status !== 0) {
    if (allowFail) return null;
    const why = res.error ? res.error.message : res.stderr.toString('utf8').trim();
    throw new UiMirrorError(`git ${args[0]} failed in ${cwd}: ${why}`);
  }
  return res.stdout;
}

/** The bytes of `<rev>:<path>` in the checkout, or null when the path is absent there. */
function upstreamBlob(checkout, rev, rel) {
  const tree = git(checkout, ['ls-tree', '-z', rev, '--', rel], { allowFail: true });
  if (tree === null) return null;
  const rec = tree.toString('utf8').split('\0').find((r) => r.endsWith(`\t${rel}`));
  if (!rec || !rec.includes(' blob ')) return null;
  return git(checkout, ['cat-file', 'blob', rec.split(' ')[2].split('\t')[0]]);
}

function resolveCommit(checkout, rev) {
  const out = git(checkout, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { allowFail: true });
  return out === null ? null : out.toString('utf8').trim();
}

/** Returns the list of problems with a parsed manifest; empty means valid. */
export function validateMirrorManifest(obj) {
  if (!isObject(obj)) return ['it is not a JSON object'];
  const problems = [];
  const unknown = Object.keys(obj).filter((k) => !KEYS.includes(k));
  if (unknown.length) problems.push(`unknown key(s) ${unknown.join(', ')}; the keys are ${KEYS.join(', ')}`);
  if (typeof obj.source !== 'string' || obj.source.length === 0) problems.push('"source" must be a non-empty string');
  if (typeof obj.commit !== 'string' || !/^[0-9a-f]{40}$/.test(obj.commit)) {
    problems.push('"commit" must be a full 40-character lowercase commit sha');
  }
  if (!Array.isArray(obj.roots) || obj.roots.some((r) => !isSafeRelPath(r))) {
    problems.push('"roots" must be an array of relative directory paths');
  }
  for (const key of ['files', 'owned', 'excluded']) {
    if (!isObject(obj[key])) problems.push(`"${key}" must be an object keyed by path`);
  }
  if (problems.length) return problems;
  const files = Object.entries(obj.files);
  // A manifest that pins nothing verifies nothing; refuse it rather than pass.
  if (files.length === 0) problems.push('"files" is empty; a manifest that pins no file verifies nothing');
  for (const [rel, hash] of files) {
    if (!isSafeRelPath(rel)) problems.push(`files key ${JSON.stringify(rel)} is not a safe relative path`);
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      problems.push(`hash for ${JSON.stringify(rel)} is not a 64-character lowercase sha256`);
    }
  }
  for (const key of ['owned', 'excluded']) {
    for (const [rel, why] of Object.entries(obj[key])) {
      if (!isSafeRelPath(rel)) problems.push(`${key} key ${JSON.stringify(rel)} is not a safe relative path`);
      if (typeof why !== 'string' || why.trim().length === 0) problems.push(`${key} entry ${rel} needs a reason`);
    }
  }
  for (const rel of Object.keys(obj.excluded)) {
    if (!obj.roots.some((r) => under(rel, r))) {
      problems.push(`excluded entry ${rel} is not inside a root; an exclusion only means something inside one`);
    }
  }
  const seen = new Map();
  for (const key of ['files', 'owned', 'excluded']) {
    for (const rel of Object.keys(obj[key])) {
      if (seen.has(rel)) problems.push(`${rel} is listed in both "${seen.get(rel)}" and "${key}"`);
      seen.set(rel, key);
    }
  }
  if (new Set(obj.roots).size !== obj.roots.length) problems.push('"roots" lists a directory twice');
  return problems;
}

/** The one byte form of the manifest: KEYS order, every list and map sorted by byte order, LF, trailing newline. */
export function serializeMirrorManifest({ source, commit, roots, files, owned, excluded }) {
  const q = (s) => JSON.stringify(s);
  const map = (name, m, last) => {
    const rels = [...m.keys()].sort(byteOrder);
    const tail = last ? '' : ',';
    if (rels.length === 0) return [`  ${q(name)}: {}${tail}`];
    return [`  ${q(name)}: {`, rels.map((r) => `    ${q(r)}: ${q(m.get(r))}`).join(',\n'), `  }${tail}`];
  };
  const rs = [...roots].sort(byteOrder);
  return `${[
    '{',
    `  "source": ${q(source)},`,
    `  "commit": ${q(commit)},`,
    rs.length ? `  "roots": [\n${rs.map((r) => `    ${q(r)}`).join(',\n')}\n  ],` : '  "roots": [],',
    ...map('files', files),
    ...map('owned', owned),
    ...map('excluded', excluded, true),
    '}',
  ].join('\n')}\n`;
}

/** Reads and checks ui-mirror.json; refuses any bytes other than the canonical form. */
export function readMirrorManifest(root) {
  const file = path.join(root, MIRROR_MANIFEST);
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    throw new UiMirrorError(`${file} cannot be read: ${e.code || e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw));
  } catch (e) {
    throw new UiMirrorError(`${file} is not valid UTF-8 JSON: ${e.message}`);
  }
  const problems = validateMirrorManifest(obj);
  if (problems.length) throw new UiMirrorError(`${file} is malformed:\n  - ${problems.join('\n  - ')}`);
  const manifest = {
    source: obj.source,
    commit: obj.commit,
    roots: [...obj.roots],
    files: new Map(Object.entries(obj.files)),
    owned: new Map(Object.entries(obj.owned)),
    excluded: new Map(Object.entries(obj.excluded)),
  };
  if (!Buffer.from(serializeMirrorManifest(manifest), 'utf8').equals(raw)) {
    throw new UiMirrorError(
      `${file} is not in the canonical form pin writes (sorted keys, two-space indent, LF). ` +
        'A duplicate key, a reordered key and CRLF line endings are refused.',
    );
  }
  return manifest;
}

function regularFile(abs) {
  try {
    return fs.lstatSync(abs).isFile() ? 'file' : 'other';
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return 'missing';
    throw e;
  }
}

/** verify: the local files against ui-mirror.json. */
export function verify({ root = DEFAULT_ROOT, population = 'auto' } = {}) {
  const m = readMirrorManifest(root);
  const result = {
    mode: 'verify',
    commit: m.commit,
    population: null,
    checked: m.files.size,
    modified: [],
    missing: [],
    notRegular: [],
    ownedMissing: [],
    excludedPresent: [],
    unlisted: [],
    unreadable: [],
  };
  for (const [rel, expected] of [...m.files].sort(([a], [b]) => byteOrder(a, b))) {
    const abs = path.join(root, rel);
    const kind = regularFile(abs);
    if (kind === 'missing') result.missing.push(rel);
    else if (kind === 'other') result.notRegular.push(rel);
    else {
      const actual = sha256(fs.readFileSync(abs));
      if (actual !== expected) result.modified.push({ path: rel, expected, actual });
    }
  }
  for (const rel of [...m.owned.keys()].sort(byteOrder)) {
    if (regularFile(path.join(root, rel)) !== 'file') result.ownedMissing.push(rel);
  }
  for (const rel of [...m.excluded.keys()].sort(byteOrder)) {
    if (regularFile(path.join(root, rel)) !== 'missing') result.excludedPresent.push(rel);
  }
  for (const dir of m.roots) {
    const abs = path.join(root, dir);
    if (regularFile(abs) === 'missing') {
      result.missing.push(`${dir}/`);
      continue;
    }
    const pop = listPopulation(abs, population);
    result.population = pop.population;
    for (const rel of pop.files) {
      const full = `${dir}/${rel}`;
      if (!m.files.has(full) && !m.owned.has(full)) result.unlisted.push(full);
    }
    for (const rel of pop.nonRegular) result.notRegular.push(`${dir}/${rel}`);
    for (const rel of pop.badNames) result.unreadable.push({ path: `${dir}/${rel}`, reason: 'name is not valid UTF-8' });
    for (const u of pop.unreadable) result.unreadable.push({ path: `${dir}/${u.path}`, reason: u.reason });
  }
  result.ok = ['modified', 'missing', 'notRegular', 'ownedMissing', 'excludedPresent', 'unlisted', 'unreadable'].every(
    (k) => result[k].length === 0,
  );
  return result;
}

/** audit: ui-mirror.json against the upstream commit it names. */
export function audit({ root = DEFAULT_ROOT, checkout } = {}) {
  const m = readMirrorManifest(root);
  const result = { mode: 'audit', commit: m.commit, commitFound: false, sourceMismatch: null, differs: [], absent: [], staleExclusions: [] };
  if (resolveCommit(checkout, m.commit) !== m.commit) {
    result.ok = false;
    return result;
  }
  result.commitFound = true;
  const pkg = upstreamBlob(checkout, m.commit, 'package.json');
  const name = pkg ? JSON.parse(pkg.toString('utf8')).name : null;
  if (name !== m.source) result.sourceMismatch = { expected: m.source, actual: name };
  for (const [rel, expected] of [...m.files].sort(([a], [b]) => byteOrder(a, b))) {
    const blob = upstreamBlob(checkout, m.commit, rel);
    if (blob === null) result.absent.push(rel);
    else if (sha256(blob) !== expected) result.differs.push(rel);
  }
  for (const rel of [...m.excluded.keys()].sort(byteOrder)) {
    if (upstreamBlob(checkout, m.commit, rel) === null) result.staleExclusions.push(rel);
  }
  result.ok = !result.sourceMismatch && !result.differs.length && !result.absent.length && !result.staleExclusions.length;
  return result;
}

/** compare: what a sync from `commit` to `ref` would take. */
export function compare({ root = DEFAULT_ROOT, checkout, ref = 'HEAD' } = {}) {
  const m = readMirrorManifest(root);
  const target = resolveCommit(checkout, ref);
  if (!target) throw new UiMirrorError(`${ref} does not resolve to a commit in ${checkout}`);
  if (!resolveCommit(checkout, m.commit)) throw new UiMirrorError(`the pinned commit ${m.commit} is not in ${checkout}`);
  const result = { mode: 'compare', from: m.commit, to: target, changed: [], removed: [], added: [] };
  for (const [rel, expected] of [...m.files].sort(([a], [b]) => byteOrder(a, b))) {
    const blob = upstreamBlob(checkout, target, rel);
    if (blob === null) result.removed.push(rel);
    else if (sha256(blob) !== expected) result.changed.push(rel);
  }
  const diff = git(checkout, ['diff', '--name-only', '-z', '--diff-filter=A', m.commit, target, '--', ...m.roots]);
  result.added = diff.toString('utf8').split('\0').filter(Boolean).sort(byteOrder);
  result.upToDate = !result.changed.length && !result.removed.length && !result.added.length;
  return result;
}

/** pin: rewrite the listed files (and --add paths) from upstream at `ref`, then the manifest. */
export function pin({ root = DEFAULT_ROOT, checkout, ref, add = [], population = 'auto' } = {}) {
  if (!ref) throw new UiMirrorError('pin needs --ref <commit>');
  const before = verify({ root, population });
  if (!before.ok) return { mode: 'pin', ok: false, refused: 'verify fails; resolve the drift first', verify: before };
  const m = readMirrorManifest(root);
  const target = resolveCommit(checkout, ref);
  if (!target) throw new UiMirrorError(`${ref} does not resolve to a commit in ${checkout}`);
  const pkg = upstreamBlob(checkout, target, 'package.json');
  if (!pkg || JSON.parse(pkg.toString('utf8')).name !== m.source) {
    throw new UiMirrorError(`${checkout} at ${target} is not ${m.source}`);
  }
  for (const rel of add) {
    if (!isSafeRelPath(rel)) throw new UiMirrorError(`--add ${JSON.stringify(rel)} is not a safe relative path`);
    if (m.owned.has(rel) || m.excluded.has(rel)) throw new UiMirrorError(`--add ${rel} is listed as owned or excluded`);
  }
  const rels = [...new Set([...m.files.keys(), ...add])].sort(byteOrder);
  const blobs = new Map();
  for (const rel of rels) {
    const blob = upstreamBlob(checkout, target, rel);
    if (blob === null) {
      throw new UiMirrorError(`${rel} does not exist upstream at ${target}; remove it from "files" (and the tree) first`);
    }
    blobs.set(rel, blob);
  }
  const files = new Map();
  for (const [rel, blob] of blobs) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, blob);
    files.set(rel, sha256(blob));
  }
  const next = { ...m, commit: target, files };
  fs.writeFileSync(path.join(root, MIRROR_MANIFEST), serializeMirrorManifest(next));
  const after = verify({ root, population });
  return { mode: 'pin', ok: after.ok, commit: target, files: files.size, added: add, verify: after };
}

function render(result) {
  const lines = [];
  const list = (label, items) => {
    for (const it of items) lines.push(`  ${label}  ${typeof it === 'string' ? it : `${it.path}${it.reason ? ` (${it.reason})` : ''}`}`);
  };
  if (result.mode === 'verify') {
    lines.push(`ui-mirror verify: ${result.checked} mirrored file(s) at ${result.commit}, ${result.population ?? 'no'} population`);
    list('MODIFIED', result.modified);
    list('MISSING ', result.missing);
    list('NOT FILE', result.notRegular);
    list('OWNED MISSING', result.ownedMissing);
    list('EXCLUDED PRESENT', result.excludedPresent);
    list('UNLISTED', result.unlisted);
    list('UNREADABLE', result.unreadable);
    lines.push(result.ok ? 'Result: clean.' : 'Result: DRIFT. Never edit a mirrored file in place: fix it upstream and pin.');
  } else if (result.mode === 'audit') {
    if (!result.commitFound) lines.push(`ui-mirror audit: COMMIT_NOT_FOUND ${result.commit}`);
    if (result.sourceMismatch) lines.push(`  SOURCE  expected ${result.sourceMismatch.expected}, found ${result.sourceMismatch.actual}`);
    list('DIFFERS', result.differs);
    list('ABSENT ', result.absent);
    list('STALE EXCLUSION', result.staleExclusions);
    lines.push(result.ok ? `ui-mirror audit: bound to ${result.commit}.` : 'Result: NOT BOUND.');
  } else if (result.mode === 'compare') {
    lines.push(`ui-mirror compare: ${result.from} -> ${result.to}`);
    list('CHANGED', result.changed);
    list('REMOVED', result.removed);
    list('ADDED UNDER A ROOT', result.added);
    lines.push(result.upToDate ? 'Up to date.' : 'Something to sync (or to triage, for added files).');
  } else {
    lines.push(result.ok ? `ui-mirror pin: ${result.files} file(s) pinned at ${result.commit}.` : `ui-mirror pin refused: ${result.refused ?? 'verify fails after pin'}`);
    if (result.verify && !result.verify.ok) lines.push(render(result.verify).trimEnd());
  }
  return `${lines.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  const json = argv.includes('--json');
  try {
    const opts = { positionals: [], add: [] };
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      const value = () => {
        if (i + 1 >= argv.length) throw new UiMirrorError(`${a} needs a value`);
        i += 1;
        return argv[i];
      };
      if (a === '--json') continue;
      else if (a === '--root') opts.root = path.resolve(value());
      else if (a === '--population') opts.population = value();
      else if (a === '--ref') opts.ref = value();
      else if (a === '--add') opts.add.push(value());
      else if (a === '--help' || a === '-h') {
        out.write(`${USAGE}\n`);
        return EXIT.OK;
      } else if (a.startsWith('--')) throw new UiMirrorError(`unknown option ${a}\n${USAGE}`);
      else opts.positionals.push(a);
    }
    const [mode, ...extra] = opts.positionals;
    const args = { root: opts.root ?? DEFAULT_ROOT, population: opts.population ?? 'auto' };
    let result;
    if (mode === 'verify' && extra.length === 0) result = verify(args);
    else if (mode === 'audit' && extra.length === 1) result = audit({ ...args, checkout: extra[0] });
    else if (mode === 'compare' && extra.length === 1) result = compare({ ...args, checkout: extra[0], ref: opts.ref });
    else if (mode === 'pin' && extra.length === 1) result = pin({ ...args, checkout: extra[0], ref: opts.ref, add: opts.add });
    else throw new UiMirrorError(USAGE);
    out.write(json ? `${JSON.stringify(result, null, 2)}\n` : render(result));
    return (mode === 'compare' ? result.upToDate : result.ok) ? EXIT.OK : EXIT.DRIFT;
  } catch (e) {
    const message = e instanceof UiMirrorError || e?.constructor?.name === 'UiDriftError' ? e.message : `unexpected error: ${e?.stack ?? e}`;
    if (json) out.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else err.write(`ui-mirror: ${message}\n`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main();
}
