#!/usr/bin/env node
/**
 * ui-drift: keeps Islestone's copy of `@inflect/ui` byte-identical to the
 * inflect-compliance commit it was copied from.
 *
 *   node scripts/ui-drift.mjs verify
 *   node scripts/ui-drift.mjs audit <upstream-checkout>
 *   node scripts/ui-drift.mjs compare <upstream-checkout> [--ref <rev>]
 *   node scripts/ui-drift.mjs pin <upstream-checkout> --ref <commit>
 *
 * `packages/ui` is upstream code. Islestone never edits a file in it. A fix
 * lands in inflect-compliance first and reaches Islestone through a sync,
 * which is `compare` to plan it and `pin` to take it, reviewed as one change.
 * This is the consumer half of inflect's docs/shared-ui-policy.md ("keep your
 * own manifest guard refusing local edits to vendored copies").
 *
 * Two checks, and neither is enough alone:
 *
 *   verify  the files in packages/ui equal UPSTREAM.json (no upstream needed);
 *   audit   UPSTREAM.json equals the upstream package at the commit it names.
 *
 * verify alone passes when a file and its manifest entry are edited together;
 * audit is what binds the manifest to upstream. Together they prove the files
 * are the upstream package at that commit.
 *
 * The manifest is `packages/ui/UPSTREAM.json`, in exactly the form `pin`
 * writes (`serializeManifest`); any other bytes are refused:
 *
 *   {"source": "<upstream package.json name>", "commit": "<40-hex sha>",
 *    "path": "<directory in the upstream repo>",
 *    "executable": ["<path of each file at git mode 100755>", ...],
 *    "files": {"<path relative to that directory>": "<sha256 of the bytes>"}}
 *
 * Exit codes: 0 clean (verify), bound (audit), up to date (compare) or pinned
 * (pin); 1 drift found (verify), the manifest does not match its commit
 * (audit), upstream differs or cannot be vouched for (compare), or pin refused
 * because the local copy has drifted; 2 usage error or a check that could not
 * run.
 *
 * No dependencies beyond Node's standard library and the `git` binary.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGE_DIR = 'packages/ui';
export const MANIFEST_NAME = 'UPSTREAM.json';
const MANIFEST_KEYS = ['source', 'commit', 'path', 'executable', 'files'];
const EXIT = { OK: 0, DRIFT: 1, ERROR: 2 };
const POPULATIONS = ['auto', 'git', 'fs'];
const MODE_FILE = '100644';
const MODE_EXEC = '100755';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage:
  node scripts/ui-drift.mjs verify [--root <dir>] [--population auto|git|fs] [--json]
  node scripts/ui-drift.mjs audit <upstream-checkout> [--root <dir>] [--json]
  node scripts/ui-drift.mjs compare <upstream-checkout> [--ref <rev>] [--root <dir>] [--json]
  node scripts/ui-drift.mjs pin <upstream-checkout> --ref <commit> [--root <dir>] [--json]

verify   Recompute the hash and executable bit of every file in packages/ui and
         fail on any file that differs from UPSTREAM.json, is missing, or is
         not listed in it. Proves the files match the manifest, nothing more.
audit    Fail unless UPSTREAM.json equals the upstream package at the commit
         it names: the commit must resolve in the checkout, and the file set,
         every hash and every mode must be equal. Binds the manifest to upstream.
compare  Report the files changed, added and removed upstream since the pinned
         commit. In a git checkout it compares a commit (--ref, default HEAD),
         never the working tree, and reports up to date only when the pinned
         commit is in the checkout and the manifest matches it.
pin      Replace packages/ui with the upstream package at --ref and rewrite
         UPSTREAM.json. Refuses while verify fails, so nothing local is lost.

--root        The Islestone repository root (default: the parent of scripts/).
--population  How verify finds the files in packages/ui: git (tracked plus
              untracked files not ignored), fs (every file on disk), or auto
              (git inside a work tree, fs otherwise). CI uses fs.
--json        Machine-readable output on stdout.

Exit codes: 0 clean / bound / up to date / pinned, 1 drift / not bound /
upstream differs / pin refused, 2 usage error or the check could not run.`;

export class UiDriftError extends Error {}

const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 12) : String(sha));
const isExecMode = (mode) => mode === MODE_EXEC;

/** A path as text output can show it: quoted when it holds a control character or edge spaces. */
const shown = (p) => (/[\x00-\x1f\x7f]/.test(p) || /^\s|\s$/.test(p) ? JSON.stringify(p) : p);

/** Bytes as printable ASCII with `\xHH` escapes, for a name that is not valid UTF-8. */
export function showBytes(buf) {
  let s = '';
  for (const b of buf) {
    s += b >= 0x20 && b < 0x7f && b !== 0x5c ? String.fromCharCode(b) : `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return s;
}

/**
 * Decodes a path git or the filesystem returned as bytes. Returns null when
 * the bytes are not valid UTF-8: decoding would replace them with U+FFFD and
 * name a different file, which is how such a file used to drop out of the
 * population, or be renamed by pin, without a word.
 */
function decodeName(buf) {
  const s = buf.toString('utf8');
  return Buffer.from(s, 'utf8').equals(buf) ? s : null;
}

/** Splits `git … -z` output on NUL, keeping each record as raw bytes. */
function splitZ(buf) {
  const out = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0) {
      if (i > start) out.push(buf.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Runs git with an argument vector (never a shell). GIT_OPTIONAL_LOCKS=0
 * keeps `git status` from refreshing the index, so reading an upstream
 * checkout never writes to it.
 */
function git(cwd, args, { input, allowFail = false } = {}) {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    input,
    maxBuffer: 1024 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (res.error) {
    if (allowFail) return null;
    throw new UiDriftError(`git could not be run: ${res.error.message}`);
  }
  if (res.status !== 0) {
    if (allowFail) return null;
    const stderr = res.stderr ? res.stderr.toString('utf8').trim() : '';
    throw new UiDriftError(`git ${args[0]} failed in ${cwd}: ${stderr}`);
  }
  return res.stdout;
}

function insideGitWorkTree(dir) {
  const out = git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  return out !== null && out.toString('utf8').trim() === 'true';
}

/**
 * A manifest key: well-formed Unicode, relative, forward slashes, no empty,
 * `.` or `..` segment.
 */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || p.length === 0 || !p.isWellFormed()) return false;
  if (p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** Returns the list of problems with a parsed manifest; empty means valid. */
export function validateManifest(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return ['it is not a JSON object'];
  const problems = [];
  const unknown = Object.keys(obj).filter((k) => !MANIFEST_KEYS.includes(k));
  if (unknown.length) problems.push(`unknown key(s) ${unknown.join(', ')}; the keys are ${MANIFEST_KEYS.join(', ')}`);
  if (typeof obj.source !== 'string' || obj.source.length === 0) problems.push('"source" must be a non-empty string');
  if (typeof obj.commit !== 'string' || !/^[0-9a-f]{40}$/.test(obj.commit)) {
    problems.push('"commit" must be a full 40-character lowercase commit sha');
  }
  if (!isSafeRelPath(obj.path)) problems.push('"path" must be a relative path such as packages/ui');
  const files = obj.files;
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    problems.push('"files" must be an object of path to sha256');
    return problems;
  }
  const entries = Object.entries(files);
  // A manifest that lists nothing verifies nothing, and every check over it
  // would pass. Refuse it rather than report an empty set as clean.
  if (entries.length === 0) problems.push('"files" is empty; a manifest that pins no file verifies nothing');
  for (const [rel, hash] of entries) {
    if (!isSafeRelPath(rel)) problems.push(`file key ${JSON.stringify(rel)} is not a safe relative path`);
    else if (rel === MANIFEST_NAME) problems.push(`file key ${MANIFEST_NAME} names the manifest itself`);
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      problems.push(`hash for ${JSON.stringify(rel)} is not a 64-character lowercase sha256`);
    }
  }
  const exec = obj.executable;
  if (!Array.isArray(exec)) {
    problems.push('"executable" must be an array of the listed paths at git mode 100755 (empty when there are none)');
  } else {
    const seen = new Set();
    for (const rel of exec) {
      if (typeof rel !== 'string' || !Object.hasOwn(files, rel)) {
        problems.push(`executable entry ${JSON.stringify(rel)} is not a key of "files"`);
      } else if (seen.has(rel)) {
        problems.push(`executable entry ${JSON.stringify(rel)} appears twice`);
      }
      seen.add(rel);
    }
  }
  return problems;
}

/**
 * The one byte form of a manifest: keys in MANIFEST_KEYS order, `executable`
 * and `files` sorted by byte order, two-space indent, LF line endings, one
 * trailing newline. Built by hand rather than with JSON.stringify of an
 * object, because an object enumerates integer-like keys first whatever order
 * they were added in.
 */
export function serializeManifest({ source, commit, path: upstreamPath, executable, files }) {
  const q = (s) => JSON.stringify(s);
  const exec = [...executable].sort(byteOrder);
  const rels = [...files.keys()].sort(byteOrder);
  const lines = ['{', `  "source": ${q(source)},`, `  "commit": ${q(commit)},`, `  "path": ${q(upstreamPath)},`];
  if (exec.length === 0) lines.push('  "executable": [],');
  else lines.push('  "executable": [', exec.map((rel) => `    ${q(rel)}`).join(',\n'), '  ],');
  if (rels.length === 0) lines.push('  "files": {}', '}');
  else lines.push('  "files": {', rels.map((rel) => `    ${q(rel)}: ${q(files.get(rel))}`).join(',\n'), '  }', '}');
  return `${lines.join('\n')}\n`;
}

/**
 * Reads and checks UPSTREAM.json. Returns {source, commit, path, executable:
 * Set, files: Map}. The bytes must equal `serializeManifest` of what they
 * parse to, so a duplicate key (JSON.parse keeps the last one, which a reader
 * of the file may not), a reordered key, other whitespace, CRLF line endings
 * or a BOM are all refused rather than read.
 */
export function readManifest(pkgDir) {
  const file = path.join(pkgDir, MANIFEST_NAME);
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') throw new UiDriftError(`${file} does not exist`);
    throw e;
  }
  if (!st.isFile()) throw new UiDriftError(`${file} is not a regular file`);
  const raw = fs.readFileSync(file);
  let text;
  try {
    // ignoreBOM keeps a byte-order mark in the text, where JSON.parse refuses it.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new UiDriftError(`${file} is not valid UTF-8`);
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new UiDriftError(`${file} is not valid JSON: ${e.message}`);
  }
  const problems = validateManifest(obj);
  if (problems.length) throw new UiDriftError(`${file} is malformed:\n  - ${problems.join('\n  - ')}`);
  const manifest = {
    source: obj.source,
    commit: obj.commit,
    path: obj.path,
    executable: new Set(obj.executable),
    files: new Map(Object.entries(obj.files)),
  };
  const canonical = Buffer.from(serializeManifest(manifest), 'utf8');
  if (!canonical.equals(raw)) {
    const want = canonical.toString('utf8').split('\n');
    const got = text.split('\n');
    let line = 0;
    while (line < want.length && want[line] === got[line]) line += 1;
    throw new UiDriftError(
      `${file} is not in the canonical form pin writes (first difference at line ${line + 1}). ` +
        'A duplicate key, a reordered key, other whitespace and CRLF line endings are all refused; ' +
        'the manifest is written by pin, never by hand.',
    );
  }
  return manifest;
}

/**
 * The files under `dir`, as paths relative to it. In git mode the population
 * is what git would commit (tracked files, plus untracked files that are not
 * ignored), which is the same population inflect's own source scans use. In
 * fs mode it is every entry on disk, with no skip list.
 *
 * Returns {population, files, nonRegular, badNames, unreadable}. `badNames`
 * holds names that are not valid UTF-8 (shown with \xHH escapes): a manifest
 * cannot hold them, so each one is a problem, never a silent skip.
 * `unreadable` holds entries git lists that could not be inspected, other
 * than files git itself reports as deleted from the working tree.
 */
export function listPopulation(dir, mode = 'auto') {
  if (!POPULATIONS.includes(mode)) {
    throw new UiDriftError(`--population must be one of ${POPULATIONS.join(', ')}, not ${JSON.stringify(mode)}`);
  }
  const inGit = mode === 'fs' ? false : insideGitWorkTree(dir);
  if (mode === 'git' && !inGit) throw new UiDriftError(`--population git: ${dir} is not inside a git work tree`);
  const files = [];
  const nonRegular = [];
  const badNames = [];
  const unreadable = [];
  const done = (population) => ({
    population,
    files: files.sort(byteOrder),
    nonRegular: nonRegular.sort(byteOrder),
    badNames: badNames.sort(byteOrder),
    unreadable: unreadable.sort((a, b) => byteOrder(a.path, b.path)),
  });
  if (inGit) {
    const listed = splitZ(git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.']));
    // Compared as raw bytes (latin1 maps each byte to one code unit).
    const deleted = new Set(splitZ(git(dir, ['ls-files', '-z', '--deleted', '--', '.'])).map((b) => b.toString('latin1')));
    const seen = new Set();
    for (const raw of listed) {
      const key = raw.toString('latin1');
      if (seen.has(key)) continue;
      seen.add(key);
      const name = decodeName(raw);
      if (name === null) {
        badNames.push(showBytes(raw));
        continue;
      }
      // git lists an embedded repository as a directory with a trailing slash.
      if (name.endsWith('/')) {
        nonRegular.push(name.slice(0, -1));
        continue;
      }
      let st;
      try {
        st = fs.lstatSync(path.join(dir, name));
      } catch (e) {
        // Only a file git itself reports as deleted may be skipped; anything
        // else that cannot be inspected is reported, never dropped.
        if ((e.code === 'ENOENT' || e.code === 'ENOTDIR') && deleted.has(key)) continue;
        unreadable.push({ path: name, reason: e.code || e.message });
        continue;
      }
      (st.isFile() ? files : nonRegular).push(name);
    }
    return done('git');
  }
  const walk = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true, encoding: 'buffer' })) {
      const name = decodeName(ent.name);
      if (name === null) {
        badNames.push(rel ? `${rel}/${showBytes(ent.name)}` : showBytes(ent.name));
        continue;
      }
      const r = rel ? `${rel}/${name}` : name;
      if (ent.isDirectory()) walk(path.join(abs, name), r);
      else if (ent.isFile()) files.push(r);
      else nonRegular.push(r);
    }
  };
  walk(dir, '');
  return done('filesystem');
}

/** `git ls-files -s` under `dir`: Map rel -> index mode, for tracked files with valid names. */
function indexModes(dir) {
  const modes = new Map();
  for (const rec of splitZ(git(dir, ['ls-files', '-s', '-z', '--', '.']))) {
    const tab = rec.indexOf(0x09);
    if (tab < 0) continue;
    const name = decodeName(rec.subarray(tab + 1));
    if (name === null) continue; // reported by listPopulation as a bad name
    modes.set(name, rec.subarray(0, tab).toString('utf8').split(' ')[0]);
  }
  return modes;
}

/** verify: the local copy against its own manifest. */
export function verify({ root = DEFAULT_ROOT, population = 'auto' } = {}) {
  const pkgDir = path.join(root, PACKAGE_DIR);
  if (!isDir(pkgDir)) throw new UiDriftError(`${PACKAGE_DIR} does not exist under ${root}`);
  const manifest = readManifest(pkgDir);
  const listed = [...manifest.files.keys()].sort(byteOrder);
  const modified = [];
  const missing = [];
  const notRegular = [];
  const modeChanged = [];
  // A Windows filesystem has no executable bit to read; the index check
  // below covers that case in git population.
  const checkDiskMode = process.platform !== 'win32';
  for (const rel of listed) {
    const abs = path.join(pkgDir, rel);
    let st;
    try {
      st = fs.lstatSync(abs);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
        missing.push(rel);
        continue;
      }
      throw e;
    }
    if (!st.isFile()) {
      notRegular.push(rel);
      continue;
    }
    const expected = manifest.files.get(rel);
    const actual = sha256(fs.readFileSync(abs));
    if (actual !== expected) modified.push({ path: rel, expected, actual });
    const wantExec = manifest.executable.has(rel);
    // git records 100755 exactly when the owner-execute bit is set.
    const isExec = (st.mode & 0o100) !== 0;
    if (checkDiskMode && isExec !== wantExec) {
      modeChanged.push({ path: rel, where: 'working tree', expected: wantExec ? MODE_EXEC : MODE_FILE, actual: wantExec ? MODE_FILE : MODE_EXEC });
    }
  }
  const pop = listPopulation(pkgDir, population);
  if (pop.population === 'git') {
    // The mode git would commit, which a chmod on a core.fileMode=false
    // checkout, or `git update-index --chmod`, changes without touching disk.
    const index = indexModes(pkgDir);
    for (const rel of listed) {
      const mode = index.get(rel);
      if (mode === undefined) continue;
      const want = manifest.executable.has(rel) ? MODE_EXEC : MODE_FILE;
      if (mode !== want) modeChanged.push({ path: rel, where: 'index', expected: want, actual: mode });
    }
  }
  modeChanged.sort((a, b) => byteOrder(a.path, b.path) || byteOrder(a.where, b.where));
  const unlisted = [...pop.files, ...pop.nonRegular]
    .filter((rel) => rel !== MANIFEST_NAME && !manifest.files.has(rel))
    .sort(byteOrder);
  const counts = {
    listed: listed.length,
    matching: listed.length - modified.length - missing.length - notRegular.length,
    modified: modified.length,
    missing: missing.length,
    notRegular: notRegular.length,
    modeChanged: modeChanged.length,
    unlisted: unlisted.length,
    badNames: pop.badNames.length,
    unreadable: pop.unreadable.length,
  };
  const problems = counts.modified + counts.missing + counts.notRegular + counts.modeChanged + counts.unlisted + counts.badNames + counts.unreadable;
  return {
    mode: 'verify',
    ok: problems === 0,
    root,
    packageDir: PACKAGE_DIR,
    upstream: { source: manifest.source, commit: manifest.commit, path: manifest.path },
    population: pop.population,
    counts,
    modified,
    missing,
    notRegular,
    modeChanged,
    unlisted,
    badNames: pop.badNames,
    unreadable: pop.unreadable,
  };
}

/** Resolves `ref` to a full commit sha, or null when the checkout does not have it. */
function tryResolveCommit(repo, ref) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.startsWith('-')) {
    throw new UiDriftError(`${JSON.stringify(ref)} is not a usable revision`);
  }
  const out = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  return out === null ? null : out.toString('utf8').trim();
}

function resolveCommit(repo, ref) {
  const commit = tryResolveCommit(repo, ref);
  if (commit === null) throw new UiDriftError(`${ref} does not name a commit in ${repo}`);
  return commit;
}

function packageNameOf(text, where) {
  let name;
  try {
    name = JSON.parse(text).name;
  } catch (e) {
    throw new UiDriftError(`${where} is not valid JSON: ${e.message}`);
  }
  if (typeof name !== 'string' || name.length === 0) throw new UiDriftError(`${where} has no "name"`);
  return name;
}

function packageNameAt(repo, commit) {
  const out = git(repo, ['cat-file', 'blob', `${commit}:package.json`], { allowFail: true });
  if (out === null) throw new UiDriftError(`the upstream repository has no package.json at ${commit}`);
  return packageNameOf(out.toString('utf8'), `package.json at ${commit}`);
}

/** Reads several blobs with one `git cat-file --batch`. */
function catFileBatch(repo, oids) {
  const unique = [...new Set(oids)];
  const map = new Map();
  if (unique.length === 0) return map;
  const out = git(repo, ['cat-file', '--batch'], { input: `${unique.join('\n')}\n` });
  let pos = 0;
  for (const oid of unique) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) throw new UiDriftError(`git cat-file returned a truncated answer for ${oid}`);
    const [, type, sizeText] = out.subarray(pos, nl).toString('utf8').split(' ');
    if (type !== 'blob') throw new UiDriftError(`git cat-file: ${oid} is not a blob`);
    const size = Number(sizeText);
    const start = nl + 1;
    if (!Number.isInteger(size) || start + size > out.length) {
      throw new UiDriftError(`git cat-file returned a truncated answer for ${oid}`);
    }
    map.set(oid, out.subarray(start, start + size));
    pos = start + size + 1;
  }
  return map;
}

/**
 * The files of `upstreamPath` at `commit`: Map rel -> {sha, mode, content},
 * plus the entries a manifest cannot represent (symlinks, submodules, names
 * that are not valid UTF-8 or not safe relative paths).
 */
function treeAt(repo, commit, upstreamPath) {
  const out = git(repo, ['ls-tree', '-r', '-z', '--full-tree', commit, '--', upstreamPath]);
  const prefix = Buffer.from(`${upstreamPath}/`, 'utf8');
  const entries = [];
  const unsupported = [];
  for (const rec of splitZ(out)) {
    const tab = rec.indexOf(0x09);
    if (tab < 0) continue;
    const [mode, type, oid] = rec.subarray(0, tab).toString('utf8').split(' ');
    const full = rec.subarray(tab + 1);
    if (full.length <= prefix.length || !full.subarray(0, prefix.length).equals(prefix)) continue;
    const relBytes = full.subarray(prefix.length);
    const rel = decodeName(relBytes);
    if (rel === null) {
      unsupported.push({ path: showBytes(relBytes), reason: 'a name that is not valid UTF-8, which a manifest cannot hold' });
    } else if (!isSafeRelPath(rel) || rel === MANIFEST_NAME) {
      unsupported.push({ path: rel, reason: 'a path a manifest cannot hold' });
    } else if (type !== 'blob' || (mode !== MODE_FILE && mode !== MODE_EXEC)) {
      unsupported.push({ path: rel, reason: `git mode ${mode} (${type}); only regular files can be pinned` });
    } else {
      entries.push({ rel, mode, oid });
    }
  }
  const blobs = catFileBatch(repo, entries.map((e) => e.oid));
  const files = new Map();
  for (const e of entries.sort((a, b) => byteOrder(a.rel, b.rel))) {
    const content = blobs.get(e.oid);
    files.set(e.rel, { sha: sha256(content), mode: e.mode, content });
  }
  return { files, unsupported };
}

function upstreamRepoRoot(checkout) {
  const abs = path.resolve(checkout);
  if (!isDir(abs)) throw new UiDriftError(`upstream checkout ${checkout} is not a directory`);
  if (!insideGitWorkTree(abs)) return { abs, isGit: false };
  const top = git(abs, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
  if (fs.realpathSync(top) !== fs.realpathSync(abs)) {
    throw new UiDriftError(`pass the root of the upstream repository (${top}), not a directory inside it`);
  }
  return { abs, isGit: true };
}

function readUpstream({ checkout, upstreamPath, ref }) {
  const { abs, isGit } = upstreamRepoRoot(checkout);
  if (isGit) {
    const commit = resolveCommit(abs, ref ?? 'HEAD');
    const name = packageNameAt(abs, commit);
    const { files, unsupported } = treeAt(abs, commit, upstreamPath);
    const status = git(abs, ['status', '--porcelain', '-z', '--', upstreamPath]);
    return { checkout: abs, kind: 'git', commit, name, files, unsupported, workingTreeDirty: status.length > 0 };
  }
  if (ref) throw new UiDriftError('--ref needs the upstream checkout to be a git repository');
  const pkgJson = path.join(abs, 'package.json');
  if (!fs.existsSync(pkgJson)) throw new UiDriftError(`${pkgJson} does not exist`);
  const name = packageNameOf(fs.readFileSync(pkgJson, 'utf8'), pkgJson);
  const dir = path.join(abs, upstreamPath);
  if (!isDir(dir)) throw new UiDriftError(`${dir} does not exist`);
  const pop = listPopulation(dir, 'fs');
  const files = new Map();
  for (const rel of pop.files) {
    const file = path.join(dir, rel);
    const mode = (fs.lstatSync(file).mode & 0o100) !== 0 ? MODE_EXEC : MODE_FILE;
    files.set(rel, { sha: sha256(fs.readFileSync(file)), mode, content: null });
  }
  const unsupported = [
    ...pop.nonRegular.map((rel) => ({ path: rel, reason: 'not a regular file' })),
    ...pop.badNames.map((rel) => ({ path: rel, reason: 'a name that is not valid UTF-8, which a manifest cannot hold' })),
  ];
  return { checkout: abs, kind: 'filesystem', commit: null, name, files, unsupported, workingTreeDirty: null };
}

/** The manifest's files against an upstream file map. */
function diffFileSets(manifest, upstreamFiles) {
  const changed = [];
  const added = [];
  const removed = [];
  const modeChanged = [];
  let unchanged = 0;
  for (const rel of [...manifest.files.keys()].sort(byteOrder)) {
    const up = upstreamFiles.get(rel);
    if (!up) {
      removed.push(rel);
      continue;
    }
    const sameMode = isExecMode(up.mode) === manifest.executable.has(rel);
    if (!sameMode) modeChanged.push(rel);
    if (up.sha !== manifest.files.get(rel)) changed.push(rel);
    else if (sameMode) unchanged += 1;
  }
  for (const rel of upstreamFiles.keys()) if (!manifest.files.has(rel)) added.push(rel);
  return { changed, added: added.sort(byteOrder), removed, modeChanged, unchanged };
}

const diffIsClean = (d) => d.changed.length + d.added.length + d.removed.length + d.modeChanged.length === 0;

/** The upstream commits touching the package between the pin and the target. */
function historySince(repo, pinned, target, upstreamPath) {
  if (pinned === target) return { pinnedKnown: true, pinnedIsAncestor: true, commits: [] };
  if (git(repo, ['cat-file', '-e', `${pinned}^{commit}`], { allowFail: true }) === null) {
    return { pinnedKnown: false, pinnedIsAncestor: null, commits: null };
  }
  const ancestor = git(repo, ['merge-base', '--is-ancestor', pinned, target], { allowFail: true }) !== null;
  const out = git(repo, ['log', '--format=%H%x09%s', `${pinned}..${target}`, '--', upstreamPath]).toString('utf8');
  const commits = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  return { pinnedKnown: true, pinnedIsAncestor: ancestor, commits };
}

/**
 * The manifest against the upstream package at the manifest's own commit.
 * Shared by audit and compare. Returns null when the commit is not in `repo`.
 */
function bindingAt(repo, manifest) {
  const commit = tryResolveCommit(repo, manifest.commit);
  if (commit === null || commit !== manifest.commit) return null;
  const tree = treeAt(repo, commit, manifest.path);
  return { tree, diff: diffFileSets(manifest, tree.files) };
}

/** compare: the pinned manifest against an upstream checkout. */
export function compare({ root = DEFAULT_ROOT, checkout, ref } = {}) {
  if (!checkout) throw new UiDriftError('compare needs the path to an upstream checkout');
  const manifest = readManifest(path.join(root, PACKAGE_DIR));
  const up = readUpstream({ checkout, upstreamPath: manifest.path, ref });
  if (up.name !== manifest.source) {
    throw new UiDriftError(`the upstream checkout is "${up.name}", but UPSTREAM.json pins "${manifest.source}"`);
  }
  if (up.files.size === 0) {
    throw new UiDriftError(`the upstream checkout has no files under ${manifest.path}; that is not a sync target`);
  }
  const d = diffFileSets(manifest, up.files);
  let history = null;
  // Whether the manifest equals the package at the commit it names. Without
  // that, "no difference from upstream" would vouch for a manifest whose
  // commit was never checked (a hand-edited or invented sha).
  let pinnedMatchesManifest = null;
  if (up.kind === 'git') {
    history = historySince(up.checkout, manifest.commit, up.commit, manifest.path);
    if (history.pinnedKnown) {
      if (manifest.commit === up.commit) {
        pinnedMatchesManifest = diffIsClean(d) && up.unsupported.length === 0;
      } else {
        const bound = bindingAt(up.checkout, manifest);
        pinnedMatchesManifest = bound !== null && diffIsClean(bound.diff) && bound.tree.unsupported.length === 0;
      }
    }
  }
  const sameFiles = diffIsClean(d) && up.unsupported.length === 0;
  const upToDate = up.kind === 'git' ? sameFiles && history.pinnedKnown && pinnedMatchesManifest === true : sameFiles;
  return {
    mode: 'compare',
    upToDate,
    pinned: {
      source: manifest.source,
      commit: manifest.commit,
      path: manifest.path,
      known: history ? history.pinnedKnown : null,
      matchesManifest: pinnedMatchesManifest,
    },
    upstream: { checkout: up.checkout, kind: up.kind, commit: up.commit, workingTreeDirty: up.workingTreeDirty },
    counts: {
      changed: d.changed.length,
      added: d.added.length,
      removed: d.removed.length,
      modeChanged: d.modeChanged.length,
      unchanged: d.unchanged,
      unsupported: up.unsupported.length,
    },
    changed: d.changed,
    added: d.added,
    removed: d.removed,
    modeChanged: d.modeChanged,
    unsupported: up.unsupported,
    history,
  };
}

/**
 * audit: UPSTREAM.json against the upstream package at the commit it names.
 * verify cannot see a file edited together with its manifest entry, a file
 * added or removed together with its key, or an invented commit; this does.
 */
export function audit({ root = DEFAULT_ROOT, checkout } = {}) {
  if (!checkout) throw new UiDriftError('audit needs the path to an upstream checkout');
  const manifest = readManifest(path.join(root, PACKAGE_DIR));
  const { abs, isGit } = upstreamRepoRoot(checkout);
  if (!isGit) throw new UiDriftError('audit needs the upstream checkout to be a git repository, to read the pinned commit');
  const base = {
    mode: 'audit',
    pinned: { source: manifest.source, commit: manifest.commit, path: manifest.path },
    upstream: { checkout: abs },
  };
  const bound = bindingAt(abs, manifest);
  if (bound === null) {
    return {
      ...base,
      ok: false,
      problem: 'COMMIT_NOT_FOUND',
      counts: { listed: manifest.files.size },
      hashMismatch: [],
      notInUpstream: [],
      missingFromManifest: [],
      modeMismatch: [],
      unsupported: [],
    };
  }
  const name = packageNameAt(abs, manifest.commit);
  if (name !== manifest.source) {
    throw new UiDriftError(`the upstream checkout is "${name}" at ${manifest.commit}, but UPSTREAM.json pins "${manifest.source}"`);
  }
  const { diff: d, tree } = bound;
  const ok = diffIsClean(d) && tree.unsupported.length === 0 && tree.files.size > 0;
  return {
    ...base,
    ok,
    problem: ok ? null : tree.files.size === 0 ? 'NO_UPSTREAM_PACKAGE' : 'MANIFEST_DIFFERS',
    counts: {
      listed: manifest.files.size,
      upstream: tree.files.size,
      matching: d.unchanged,
      hashMismatch: d.changed.length,
      notInUpstream: d.removed.length,
      missingFromManifest: d.added.length,
      modeMismatch: d.modeChanged.length,
      unsupported: tree.unsupported.length,
    },
    hashMismatch: d.changed,
    notInUpstream: d.removed,
    missingFromManifest: d.added,
    modeMismatch: d.modeChanged,
    unsupported: tree.unsupported,
  };
}

function pruneEmptyDirs(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const sub = path.join(dir, ent.name);
    pruneEmptyDirs(sub);
    if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub);
  }
}

/**
 * pin: replace packages/ui with the upstream package at a commit and rewrite
 * the manifest. Refuses while the local copy has drifted, so the only files it
 * ever deletes are ones it can prove are unchanged upstream copies.
 */
export function pin({ root = DEFAULT_ROOT, checkout, ref, population = 'auto' } = {}) {
  if (!checkout) throw new UiDriftError('pin needs the path to an upstream checkout');
  if (!ref) throw new UiDriftError('pin needs --ref <commit>: a pin names a commit, never a working tree');
  const pkgDir = path.join(root, PACKAGE_DIR);
  let previous = null;
  if (isDir(pkgDir) && fs.readdirSync(pkgDir).length > 0) {
    if (!fs.existsSync(path.join(pkgDir, MANIFEST_NAME))) {
      throw new UiDriftError(
        `${PACKAGE_DIR} holds files but no ${MANIFEST_NAME}; pin will not overwrite files it cannot prove came from upstream`,
      );
    }
    const local = verify({ root, population });
    if (!local.ok) return { mode: 'pin', ok: false, refused: 'LOCAL_DRIFT', verify: local };
    previous = readManifest(pkgDir);
  }
  const { abs, isGit } = upstreamRepoRoot(checkout);
  if (!isGit) throw new UiDriftError('pin needs the upstream checkout to be a git repository');
  const commit = resolveCommit(abs, ref);
  const source = packageNameAt(abs, commit);
  if (previous && source !== previous.source) {
    throw new UiDriftError(`the upstream checkout is "${source}", but UPSTREAM.json pins "${previous.source}"`);
  }
  const upstreamPath = previous ? previous.path : PACKAGE_DIR;
  const tree = treeAt(abs, commit, upstreamPath);
  if (tree.unsupported.length) {
    const list = tree.unsupported.map((u) => `${shown(u.path)} (${u.reason})`).join(', ');
    throw new UiDriftError(`${upstreamPath} at ${commit} holds entries a manifest cannot pin: ${list}`);
  }
  if (tree.files.size === 0) throw new UiDriftError(`${upstreamPath} at ${commit} holds no files`);

  if (previous) {
    for (const rel of previous.files.keys()) fs.rmSync(path.join(pkgDir, rel), { force: true });
    fs.rmSync(path.join(pkgDir, MANIFEST_NAME), { force: true });
    pruneEmptyDirs(pkgDir);
  }
  fs.mkdirSync(pkgDir, { recursive: true });
  const files = new Map();
  const executable = new Set();
  for (const [rel, f] of tree.files) {
    const dest = path.join(pkgDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
    fs.chmodSync(dest, isExecMode(f.mode) ? 0o755 : 0o644);
    files.set(rel, f.sha);
    if (isExecMode(f.mode)) executable.add(rel);
  }
  const manifest = { source, commit, path: upstreamPath, executable, files };
  fs.writeFileSync(path.join(pkgDir, MANIFEST_NAME), serializeManifest(manifest));

  const after = verify({ root, population });
  if (!after.ok) {
    throw new UiDriftError(`verify failed straight after the pin (${JSON.stringify(after.counts)}); see verify --json`);
  }
  const d = previous ? diffFileSets(previous, tree.files) : null;
  return {
    mode: 'pin',
    ok: true,
    previousCommit: previous ? previous.commit : null,
    upstream: { source, commit, path: upstreamPath, checkout: abs },
    counts: {
      files: tree.files.size,
      executable: executable.size,
      changed: d ? d.changed.length : null,
      added: d ? d.added.length : tree.files.size,
      removed: d ? d.removed.length : 0,
      modeChanged: d ? d.modeChanged.length : null,
    },
  };
}

function renderVerify(r) {
  const at = `${r.upstream.source}@${short(r.upstream.commit)}`;
  if (r.ok) {
    return (
      `ui-drift verify: OK. ${r.counts.listed} files in ${r.packageDir} match ${MANIFEST_NAME} (${at}, population: ${r.population}).\n` +
      `This proves the files match the manifest; audit proves the manifest matches upstream.\n`
    );
  }
  const lines = [`ui-drift verify: FAILED. ${r.packageDir} no longer matches ${MANIFEST_NAME} (${at}).`];
  for (const m of r.modified) lines.push(`  modified    ${shown(m.path)}`);
  for (const p of r.missing) lines.push(`  missing     ${shown(p)}`);
  for (const p of r.notRegular) lines.push(`  not a file  ${shown(p)}`);
  for (const m of r.modeChanged) lines.push(`  mode        ${shown(m.path)} (${m.where}: ${m.actual}, expected ${m.expected})`);
  for (const p of r.unlisted) lines.push(`  unlisted    ${shown(p)}`);
  for (const p of r.badNames) lines.push(`  bad name    ${p} (not valid UTF-8)`);
  for (const u of r.unreadable) lines.push(`  unreadable  ${shown(u.path)} (${u.reason})`);
  const c = r.counts;
  const n = c.modified + c.missing + c.notRegular + c.modeChanged + c.unlisted + c.badNames + c.unreadable;
  lines.push(`${n} problem(s) against ${c.listed} listed files (population: ${r.population}).`);
  lines.push(`Files in ${r.packageDir} are byte-for-byte upstream copies and are never edited in Islestone.`);
  lines.push('Islestone-specific UI goes outside packages/ui; a fix to a shared file lands in');
  lines.push(`${r.upstream.source} first and arrives through a sync (docs/porting/shared-ui.md).`);
  return `${lines.join('\n')}\n`;
}

function renderAudit(r) {
  const head = `ui-drift audit: ${r.pinned.source} ${r.pinned.path} at ${r.pinned.commit}`;
  if (r.problem === 'COMMIT_NOT_FOUND') {
    return (
      `${head}\n  FAILED: that commit is not in ${r.upstream.checkout}.\n` +
      '  Either UPSTREAM.json names a commit that does not exist upstream, or the checkout lacks it\n' +
      `  (a shallow clone): fetch it with git fetch --depth 1 <upstream-url> ${r.pinned.commit}.\n`
    );
  }
  const c = r.counts;
  if (r.ok) {
    return `${head}\n  OK: ${MANIFEST_NAME} lists exactly the ${c.upstream} files at that commit, with their hashes and modes.\n`;
  }
  const lines = [`${head}`, `  FAILED: ${MANIFEST_NAME} does not match the package at the commit it names.`];
  for (const p of r.hashMismatch) lines.push(`  hash differs          ${shown(p)}`);
  for (const p of r.notInUpstream) lines.push(`  not in upstream       ${shown(p)}`);
  for (const p of r.missingFromManifest) lines.push(`  missing from manifest ${shown(p)}`);
  for (const p of r.modeMismatch) lines.push(`  mode differs          ${shown(p)}`);
  for (const u of r.unsupported) lines.push(`  cannot pin            ${shown(u.path)} (${u.reason})`);
  if (r.problem === 'NO_UPSTREAM_PACKAGE') lines.push(`  ${r.pinned.path} holds no files at that commit.`);
  lines.push(`${MANIFEST_NAME} is written by pin and never edited; re-pin from upstream to repair it.`);
  return `${lines.join('\n')}\n`;
}

function renderCompare(r) {
  const lines = [`ui-drift compare: ${r.pinned.source} ${r.pinned.path}`];
  lines.push(`  pinned    ${r.pinned.commit}  (${MANIFEST_NAME})`);
  lines.push(`  upstream  ${r.upstream.commit ?? '(no commit: not a git checkout)'}  (${r.upstream.checkout})`);
  const c = r.counts;
  lines.push(`  ${c.changed} changed, ${c.added} added, ${c.removed} removed, ${c.modeChanged} mode changed, ${c.unchanged} unchanged`);
  for (const p of r.changed) lines.push(`  changed     ${shown(p)}`);
  for (const p of r.added) lines.push(`  added       ${shown(p)}`);
  for (const p of r.removed) lines.push(`  removed     ${shown(p)}`);
  for (const p of r.modeChanged) lines.push(`  mode        ${shown(p)}`);
  for (const u of r.unsupported) lines.push(`  cannot pin  ${shown(u.path)} (${u.reason})`);
  if (r.upstream.workingTreeDirty) {
    lines.push(`  note: the upstream working tree has uncommitted changes under ${r.pinned.path}; they are not compared.`);
  }
  if (r.upstream.kind !== 'git') {
    lines.push('  note: a checkout without git history cannot show that the manifest matches its pinned commit; run audit against a git checkout.');
  }
  if (r.history) {
    if (!r.history.pinnedKnown) {
      lines.push('  note: the pinned commit is not in this checkout (a shallow clone, or an invented sha), so compare');
      lines.push('        cannot vouch for the manifest and does not report up to date. Fetch the commit and run audit.');
    } else {
      if (r.pinned.matchesManifest === false) {
        lines.push(`  note: ${MANIFEST_NAME} does not match the package at its own pinned commit; run audit to see how.`);
      }
      if (r.history.pinnedIsAncestor === false) {
        lines.push('  note: the pinned commit is not an ancestor of the upstream commit (older, or another branch).');
      }
      if (r.history.commits.length) {
        lines.push(`  ${r.history.commits.length} upstream commit(s) touch ${r.pinned.path} since the pin:`);
        for (const h of r.history.commits) lines.push(`    ${h.sha.slice(0, 12)} ${h.subject}`);
      }
    }
  }
  if (r.upToDate) {
    lines.push('Up to date: nothing to sync.');
  } else if (r.upstream.commit) {
    lines.push(`To take it: node scripts/ui-drift.mjs pin ${r.upstream.checkout} --ref ${r.upstream.commit}`);
    lines.push(`then review the diff and commit ${PACKAGE_DIR} with its ${MANIFEST_NAME} as one change.`);
  }
  return `${lines.join('\n')}\n`;
}

function renderPin(r) {
  if (!r.ok) return renderVerify(r.verify).replace('ui-drift verify: FAILED.', 'ui-drift pin: REFUSED, the local copy has drifted.');
  const c = r.counts;
  const delta = c.changed === null
    ? `${c.added} added`
    : `${c.changed} changed, ${c.added} added, ${c.removed} removed, ${c.modeChanged} mode changed`;
  return (
    `ui-drift pin: ${PACKAGE_DIR} now holds ${r.upstream.source}@${r.upstream.commit} (${c.files} files; ${delta}).\n` +
    `Review the diff, then commit ${PACKAGE_DIR} with its ${MANIFEST_NAME} as one change.\n`
  );
}

function parseArgs(argv) {
  const opts = { json: false, help: false, root: DEFAULT_ROOT, ref: undefined, population: 'auto', positionals: [] };
  const valued = { '--root': 'root', '--ref': 'ref', '--population': 'population' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (flag in valued) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[(i += 1)];
      if (value === undefined || value === '') throw new UiDriftError(`${flag} needs a value`);
      opts[valued[flag]] = value;
    } else if (arg.startsWith('-')) throw new UiDriftError(`unknown option ${arg}`);
    else opts.positionals.push(arg);
  }
  opts.root = path.resolve(opts.root);
  return opts;
}

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  let opts = { json: argv.includes('--json') };
  let mode;
  try {
    opts = parseArgs(argv);
    [mode] = opts.positionals;
    if (opts.help) {
      out.write(`${USAGE}\n`);
      return EXIT.OK;
    }
    const extra = opts.positionals.slice(1);
    let result;
    let code;
    if (mode === 'verify') {
      if (extra.length) throw new UiDriftError('verify takes no positional arguments');
      if (opts.ref) throw new UiDriftError('verify does not take --ref');
      result = verify({ root: opts.root, population: opts.population });
      code = result.ok ? EXIT.OK : EXIT.DRIFT;
    } else if (mode === 'audit') {
      if (extra.length !== 1) throw new UiDriftError('audit takes exactly one argument, the upstream checkout');
      if (opts.ref) throw new UiDriftError("audit does not take --ref: it always reads the commit UPSTREAM.json names");
      result = audit({ root: opts.root, checkout: extra[0] });
      code = result.ok ? EXIT.OK : EXIT.DRIFT;
    } else if (mode === 'compare' || mode === 'pin') {
      if (extra.length !== 1) throw new UiDriftError(`${mode} takes exactly one argument, the upstream checkout`);
      const args = { root: opts.root, checkout: extra[0], ref: opts.ref, population: opts.population };
      result = mode === 'compare' ? compare(args) : pin(args);
      code = (mode === 'compare' ? result.upToDate : result.ok) ? EXIT.OK : EXIT.DRIFT;
    } else {
      throw new UiDriftError(mode ? `unknown mode ${JSON.stringify(mode)}\n${USAGE}` : USAGE);
    }
    if (opts.json) out.write(`${JSON.stringify(result, null, 2)}\n`);
    else out.write({ verify: renderVerify, audit: renderAudit, compare: renderCompare, pin: renderPin }[mode](result));
    return code;
  } catch (e) {
    const message = e instanceof UiDriftError ? e.message : `unexpected error: ${e && e.stack ? e.stack : e}`;
    if (opts.json) out.write(`${JSON.stringify({ mode: mode ?? null, error: message }, null, 2)}\n`);
    else err.write(`ui-drift: ${message}\n`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  process.exitCode = main();
}
