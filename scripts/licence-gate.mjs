#!/usr/bin/env node
/**
 * Islestone's third-party intake gate (roadmap sub-phase 0.3, hardening gate H0).
 *
 *   node scripts/licence-gate.mjs [--json] [--root <dir>] [--exemptions <file>]
 *
 * Two checks, one verdict:
 *
 * 1. Every PRODUCTION dependency carries a licence on the allowlist below, or
 *    has a recorded exemption in scripts/licence-exemptions.json that names
 *    its reason and the ADR that decided it (an ADR that names the package).
 * 2. No source file in the repository imports from an open-core `ee` folder
 *    or from a deny-listed package (roadmap 2.3 and 2.5), and no file that
 *    can ship imports test code.
 *
 * Exit status: 0 when both checks pass, 1 when either finds a problem, 2 when
 * the gate could not run (no lockfile, no package.json, an unreadable
 * exemptions file, not a git work tree, a bad argument). Every non-zero exit
 * says why.
 *
 * No dependencies: only Node's standard library, so the gate cannot be
 * weakened by the tree it checks.
 *
 * Which packages are "production"
 * -------------------------------
 * The population comes from the lockfile npm installs from, not from
 * node_modules: npm-shrinkwrap.json when one exists (npm prefers it), else
 * package-lock.json (lockfileVersion 2 or 3). A lockfile lists every
 * platform's optional binaries, so the answer is the same on a Mac, on Linux
 * CI and in the production image.
 *
 * - An entry flagged `"dev": true` is reachable only through devDependencies
 *   and is not production, unless production reaches it anyway (below).
 * - An entry flagged `"devOptional": true` IS production: `npm ci --omit=dev`
 *   installs it, and drops it only when optional dependencies are omitted
 *   too. Next.js's optional peer on @playwright/test is why playwright shows
 *   up here.
 * - An entry flagged `"optional": true` (platform binaries such as
 *   @next/swc-* and sharp's @img/*) is production.
 *
 * Neither npm's flags nor the lockfile's root entry are taken on trust. The
 * gate walks the dependency graph itself, resolving each edge the way Node
 * resolves a bare specifier (nearest node_modules first). The walk starts
 * from the package.json files ON DISK, the root's and each workspace's
 * dependencies, optionalDependencies and peerDependencies, and from the
 * lockfile's copies of them; when the two disagree, that is a failure
 * (MANIFEST_LOCK_MISMATCH), because `npm ci` installs what package.json
 * declares. It also starts from every package that a file which can ship
 * imports, whatever its dev flag: Next.js bundles what `src/` imports from a
 * devDependency just as it bundles a dependency. The gate checks the union of
 * that walk and every entry npm flags as non-dev; disagreements are notices.
 *
 * Licence declarations
 * --------------------
 * The lockfile records each manifest's `license` (an object's `type`; a legacy
 * `licenses` array is not recorded at all). When an entry has no licence, the
 * gate reads node_modules/<location>/package.json, provided the installed
 * version matches the lockfile. When both exist, they must agree. A
 * workspace package's licence is read from its package.json in the
 * repository, which must agree with the lockfile.
 *
 * - SPDX identifiers match case-insensitively (SPDX 2.3 Annex D); the
 *   operators AND, OR and WITH must be upper case.
 * - `A OR B` passes if either branch passes; `A AND B` only if both do.
 *   AND binds tighter than OR. Parentheses group.
 * - `L WITH exception` passes only if L passes AND the exception is on
 *   ALLOWED_EXCEPTIONS, a frozen list of SPDX exceptions that only add
 *   permissions. Anything else after WITH fails (UNKNOWN_EXCEPTION): "MIT WITH
 *   Commons-Clause" takes the right to sell away and is not MIT (roadmap 2.5).
 * - `L+` ("or later") passes if L passes, since L may be chosen.
 * - A legacy `{ "type": "MIT" }` object reads as its type. A legacy
 *   `licenses` array reads as an OR of its entries, which is how npm's own
 *   documentation says to rewrite one; the report lists every package that
 *   relied on a legacy form.
 * - `SEE LICENSE IN <file>`, `UNLICENSED`, a missing or empty licence, a
 *   custom `LicenseRef-`, and anything that is not a valid SPDX expression
 *   FAIL, unless exempted. "SEE LICENSE IN" means a person must read the file
 *   and record what it says.
 *
 * The root package (Islestone itself: private, UNLICENSED) is skipped, and so
 * is each workspace package that declares the root's licence or none, because
 * that is Islestone's own code. A workspace package that declares ANOTHER
 * licence is checked like any dependency: ADR 0001 expects a ported
 * BUSL-1.1 `@inflect/ui` to need a recorded exception, not a free pass.
 *
 * The import scan
 * ---------------
 * Every file git lists (tracked, plus untracked files .gitignore does not
 * exclude) with a source extension is scanned: JavaScript and TypeScript, CSS
 * and its dialects (`@import`, `@use`, `@forward`, Tailwind's `@plugin`,
 * `@config` and `@reference`), and MDX's import and export blocks. Only the
 * gate's own fixtures are left out. Files on DEV_ONLY_PATHS (tests and
 * development-tool configuration) are scanned for `ee` and deny-listed imports
 * like any other; what they import is not treated as shipped, and a file that
 * can ship may not import them (IMPORTS_DEV_ONLY_PATH).
 *
 * Specifiers are read by a small lexer that decodes string escapes, folds
 * concatenations of literals, follows `require` aliases, `createRequire`,
 * `require.context`, `import.meta.webpackContext` and `new URL(…,
 * import.meta.url)`, and resolves `#` imports through package.json "imports"
 * and aliases through tsconfig.json "paths". A file the lexer cannot read to
 * the end (an unterminated template, comment or JSX element, or an unmatched
 * brace) fails (UNPARSEABLE) rather than hiding the imports after the point
 * where it lost its place. A specifier it cannot compute is a notice.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Policy ─────────────────────────────────────────────────────────────────

/**
 * Licences a production dependency may carry, as canonical SPDX identifiers:
 * exactly roadmap 0.3's list. "BSD" means the 2- and 3-clause forms; the
 * 4-clause advertising clause is not on it. Anything else (0BSD, CC0-1.0, the
 * Unlicense, CC-BY-4.0 data, LGPL) passes only through a recorded exemption;
 * ADR 0007 puts the open cases to the owner. Widening this list is an owner
 * decision, recorded in an ADR, never a change made to get a build through.
 */
export const ALLOWED_LICENCES = Object.freeze(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'PostgreSQL']);

/** Allowed licences whose condition the report repeats on every run. */
export const NOTICE_LICENCES = Object.freeze({
    'MPL-2.0':
        'allowed for unmodified use only. MPL-2.0 is file-level copyleft: a changed MPL file must be published under MPL-2.0, so patch it upstream instead.',
});

/**
 * SPDX licence exceptions that only ADD permissions to the licence they
 * follow (from the SPDX exceptions list). `L WITH X` passes only when X is on
 * this list and L passes. Any other text after WITH fails, however it is
 * spelled: a non-SPDX "exception" such as Commons Clause removes rights.
 * Adding an exception here is a reviewed change; an exemption is the way past
 * for a single package.
 */
export const ALLOWED_EXCEPTIONS = Object.freeze([
    'LLVM-exception',
    'Swift-exception',
    'Classpath-exception-2.0',
    'GCC-exception-2.0',
    'GCC-exception-3.1',
    'Autoconf-exception-2.0',
    'Autoconf-exception-3.0',
    'Bison-exception-2.2',
    'Font-exception-2.0',
    'Libtool-exception',
    'Linux-syscall-note',
    'LZMA-exception',
    'OpenJDK-assembly-exception-1.0',
    'Qt-GPL-exception-1.0',
    'Qt-LGPL-exception-1.1',
    'u-boot-exception-2.0',
    'WxWindows-exception-3.1',
    'LGPL-3.0-linking-exception',
    'Universal-FOSS-exception-1.0',
]);

/** Text after WITH that is refused by name, with the reason the report gives. */
const REFUSED_EXCEPTIONS = new Map([
    ['commons-clause', 'Commons Clause is not an SPDX exception: it removes the right to sell or host the software (roadmap 2.5)'],
]);

/**
 * Packages that may not be imported or installed at all, whatever their
 * declared licence says (roadmap 2.5): n8n and its libraries (Sustainable
 * Use), Windmill's embeddable UI (AGPL with a no-embed clause), task-master
 * (MIT plus Commons Clause), @liveblocks/server (AGPL), HyperFormula (GPL),
 * Handsontable and its framework wrappers (commercial), planby (all rights
 * reserved), BlockNote's xl-* packages (GPL or paid). A trailing `*` matches
 * any package name with that prefix. An exemption cannot lift a deny-listed
 * package; removing one is a reviewed change to this list.
 *
 * The npm package `windmill` is an unrelated BSD blog engine and is not here;
 * Windmill's client SDK (`windmill-client`, Apache-2.0) is not either.
 */
export const DENIED_PACKAGES = Object.freeze([
    'n8n',
    'n8n-*',
    '@n8n/*',
    'windmill-components',
    'task-master-ai',
    '@liveblocks/server',
    'hyperformula',
    'handsontable',
    '@handsontable/*',
    'planby',
    '@blocknote/xl-*',
]);

/** Extensions read as JavaScript or TypeScript. */
export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
/** Extensions read as stylesheets. */
export const STYLE_EXTENSIONS = Object.freeze(['.css', '.scss', '.sass', '.less', '.pcss']);
/** Extensions read as MDX (only the import and export blocks hold code). */
export const MDX_EXTENSIONS = Object.freeze(['.mdx']);

/** Never scanned: the gate's own fixtures, which break the policy on purpose. */
export const EXCLUDED_SOURCE_PREFIXES = Object.freeze(['tests/fixtures/licence-gate/']);

/**
 * Paths whose code no build or runtime ships. They are scanned for `ee` and
 * deny-listed imports like everything else, but the packages they import are
 * not production roots, and a file that can ship may not import them. A path
 * ending in `/` covers a directory; any other names one file (with or without
 * its extension). Every other scanned file is treated as able to ship, so a
 * new directory is checked by default.
 */
export const DEV_ONLY_PATHS = Object.freeze([
    { path: 'tests/', reason: 'test code: Jest and Playwright load it, no build or runtime does' },
    { path: 'eslint.config.mjs', reason: 'the ESLint configuration, loaded only by `npm run lint`' },
    { path: 'jest.config.mjs', reason: 'the Jest configuration' },
    { path: 'jest.setup.ts', reason: 'Jest setup, loaded only by Jest' },
    { path: 'playwright.config.ts', reason: 'the Playwright configuration' },
]);

/**
 * Bare specifiers a bundler supplies itself, so they are not in the lockfile.
 * Next.js aliases both to its own compiled copies.
 */
export const BUNDLER_PROVIDED_MODULES = Object.freeze(['server-only', 'client-only']);

/** Where the exemptions live, relative to the repository root. */
export const DEFAULT_EXEMPTIONS_FILE = 'scripts/licence-exemptions.json';

/** The lockfiles npm installs from, in the order npm prefers them. */
export const LOCKFILE_NAMES = Object.freeze(['npm-shrinkwrap.json', 'package-lock.json']);

const ADR_PATH = /^docs\/adr\/\d{4}-[a-z0-9][a-z0-9-]*\.md$/;
const EXEMPTION_FIELDS = new Set(['licence', 'reason', 'adr', 'version']);

/** Thrown when the gate cannot run at all (exit status 2). */
export class GateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GateError';
    }
}

// ─── SPDX expressions ───────────────────────────────────────────────────────

const KNOWN_IDS = new Map(ALLOWED_LICENCES.map((id) => [id.toLowerCase(), id]));
const ALLOWED_SET = new Set(ALLOWED_LICENCES);
const KNOWN_EXCEPTIONS = new Map(ALLOWED_EXCEPTIONS.map((id) => [id.toLowerCase(), id]));
const OPERATORS = new Set(['AND', 'OR', 'WITH']);
const ID_STRING = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const LICENSE_REF = /^(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+$/;

class SpdxSyntaxError extends Error {}

function tokenizeSpdx(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (/\s/.test(c)) {
            i++;
        } else if (c === '(' || c === ')') {
            tokens.push(c);
            i++;
        } else {
            let j = i;
            while (j < text.length && !/[\s()]/.test(text[j])) j++;
            tokens.push(text.slice(i, j));
            i = j;
        }
    }
    return tokens;
}

function licenceNode(token) {
    if (LICENSE_REF.test(token)) return { type: 'licence', id: token, ref: true, orLater: false };
    const orLater = token.endsWith('+');
    const bare = orLater ? token.slice(0, -1) : token;
    if (!ID_STRING.test(bare)) throw new SpdxSyntaxError(`"${token}" is not an SPDX licence identifier`);
    return { type: 'licence', id: KNOWN_IDS.get(bare.toLowerCase()) ?? bare, ref: false, orLater };
}

function joined(type, items) {
    const flat = items.flatMap((item) => (item.type === type ? item.items : [item]));
    return flat.length === 1 ? flat[0] : { type, items: flat };
}

/**
 * Parse an SPDX licence expression. Returns `{ ok: true, ast }` or
 * `{ ok: false, error }`; never throws on bad input.
 */
export function parseSpdxExpression(text) {
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'the expression is empty' };
    const tokens = tokenizeSpdx(text);
    let pos = 0;
    const unexpected = (t) =>
        /^(and|or|with)$/i.test(t) && !OPERATORS.has(t)
            ? new SpdxSyntaxError(`the operator "${t}" must be upper case`)
            : new SpdxSyntaxError(`unexpected "${t}"`);

    function primary() {
        const t = tokens[pos];
        if (t === undefined) throw new SpdxSyntaxError('the expression ends where a licence was expected');
        if (t === '(') {
            pos++;
            const inner = or();
            if (tokens[pos] !== ')') throw new SpdxSyntaxError('a "(" is never closed');
            pos++;
            return inner;
        }
        if (t === ')' || OPERATORS.has(t)) throw new SpdxSyntaxError(`"${t}" where a licence was expected`);
        if (/^(and|or|with)$/i.test(t)) throw unexpected(t);
        pos++;
        return licenceNode(t);
    }
    function withExpr() {
        const licence = primary();
        if (tokens[pos] !== 'WITH') return licence;
        pos++;
        const exception = tokens[pos];
        if (exception === undefined || OPERATORS.has(exception) || !(ID_STRING.test(exception) || LICENSE_REF.test(exception))) {
            throw new SpdxSyntaxError('WITH must be followed by an exception identifier');
        }
        if (licence.type !== 'licence' || licence.ref) {
            throw new SpdxSyntaxError('WITH applies to a single SPDX licence identifier');
        }
        pos++;
        return { type: 'with', licence, exception: KNOWN_EXCEPTIONS.get(exception.toLowerCase()) ?? exception };
    }
    function and() {
        const items = [withExpr()];
        while (tokens[pos] === 'AND') {
            pos++;
            items.push(withExpr());
        }
        return joined('and', items);
    }
    function or() {
        const items = [and()];
        while (tokens[pos] === 'OR') {
            pos++;
            items.push(and());
        }
        return joined('or', items);
    }

    try {
        const ast = or();
        if (pos < tokens.length) throw unexpected(tokens[pos]);
        return { ok: true, ast };
    } catch (error) {
        if (error instanceof SpdxSyntaxError) return { ok: false, error: error.message };
        throw error;
    }
}

function formatNode(node, parent, asKey) {
    switch (node.type) {
        case 'licence': {
            const id = asKey ? node.id.toLowerCase() : node.id;
            return node.orLater ? `${id}+` : id;
        }
        case 'with':
            return `${formatNode(node.licence, 'with', asKey)} WITH ${asKey ? node.exception.toLowerCase() : node.exception}`;
        case 'and':
        case 'or': {
            const parts = node.items.map((item) => formatNode(item, node.type, asKey));
            // AND and OR are commutative, so a comparison key ignores order.
            if (asKey) parts.sort();
            const text = parts.join(node.type === 'and' ? ' AND ' : ' OR ');
            const needsParens = node.type === 'or' ? parent === 'and' : parent === 'with';
            return needsParens ? `(${text})` : text;
        }
        default:
            throw new Error(`unknown SPDX node ${JSON.stringify(node)}`);
    }
}

/** The canonical text of a parsed expression: known identifiers in SPDX case, minimal parentheses. */
export function formatExpression(ast) {
    return formatNode(ast, null, false);
}

/** A comparison key: case-folded, operands sorted, so equivalent spellings compare equal. */
export function expressionKey(ast) {
    return formatNode(ast, null, true);
}

/**
 * Judge a parsed expression against the allowlist. Returns
 * `{ allowed, relied, problems, unknownException }`: `relied` lists the
 * licence ids the passing reading depends on (for an OR, the branch with the
 * fewest conditional licences), `problems` says why a failing reading fails,
 * and `unknownException` is true when the only reason a reading fails is an
 * exception that is not on ALLOWED_EXCEPTIONS.
 */
export function evaluateExpression(ast) {
    switch (ast.type) {
        case 'licence': {
            const shown = ast.orLater ? `${ast.id}+` : ast.id;
            if (ast.ref) {
                return { allowed: false, relied: [], problems: [`${shown} is a custom licence reference, not on the allowlist`], unknownException: false };
            }
            if (ALLOWED_SET.has(ast.id)) return { allowed: true, relied: [ast.id], problems: [], unknownException: false };
            return { allowed: false, relied: [], problems: [`${shown} is not on the allowlist`], unknownException: false };
        }
        case 'with': {
            const base = evaluateExpression(ast.licence);
            if (!base.allowed) return { ...base, problems: base.problems.map((p) => `${p} (with ${ast.exception})`) };
            if (KNOWN_EXCEPTIONS.has(ast.exception.toLowerCase())) return base;
            const refused = REFUSED_EXCEPTIONS.get(ast.exception.toLowerCase());
            return {
                allowed: false,
                relied: [],
                problems: [
                    refused ??
                        `"${ast.exception}" after WITH is not an SPDX exception that only adds permissions (ALLOWED_EXCEPTIONS); it may take rights away`,
                ],
                unknownException: true,
            };
        }
        case 'and': {
            const results = ast.items.map((item) => evaluateExpression(item));
            const allowed = results.every((r) => r.allowed);
            const failing = results.filter((r) => !r.allowed);
            return {
                allowed,
                relied: allowed ? [...new Set(results.flatMap((r) => r.relied))] : [],
                problems: results.flatMap((r) => r.problems),
                unknownException: !allowed && failing.every((r) => r.unknownException),
            };
        }
        case 'or': {
            const results = ast.items.map((item) => evaluateExpression(item));
            const passing = results.filter((r) => r.allowed);
            if (passing.length === 0) {
                return {
                    allowed: false,
                    relied: [],
                    problems: [`no alternative is allowed: ${results.flatMap((r) => r.problems).join('; ')}`],
                    unknownException: results.some((r) => r.unknownException),
                };
            }
            const cost = (r) => r.relied.filter((id) => id in NOTICE_LICENCES).length;
            const best = passing.reduce((a, b) => (cost(b) < cost(a) ? b : a));
            return { allowed: true, relied: best.relied, problems: [], unknownException: false };
        }
        default:
            throw new Error(`unknown SPDX node ${JSON.stringify(ast)}`);
    }
}

// ─── Licence declarations ───────────────────────────────────────────────────

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function present(value) {
    return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

function declarationFromString(text, legacy, raw) {
    const trimmed = text.trim();
    if (trimmed === '') return { kind: 'missing', raw, legacy };
    if (/^UNLICENSED$/i.test(trimmed)) return { kind: 'unlicensed', raw, legacy };
    const seeLicence = /^SEE LICEN[CS]E IN\s+(\S.*)$/i.exec(trimmed);
    if (seeLicence) return { kind: 'see-licence-in', file: seeLicence[1].trim(), raw, legacy };
    const parsed = parseSpdxExpression(trimmed);
    if (!parsed.ok) return { kind: 'invalid', error: parsed.error, raw, legacy };
    return { kind: 'spdx', ast: parsed.ast, expression: formatExpression(parsed.ast), key: expressionKey(parsed.ast), raw, legacy };
}

function declarationFromList(list, legacy, raw) {
    const asts = [];
    for (const item of list) {
        const text = typeof item === 'string' ? item : isPlainObject(item) && typeof item.type === 'string' ? item.type : null;
        if (text === null) {
            return { kind: 'invalid', error: 'a legacy licence list may hold only strings or { "type": … } objects', raw, legacy };
        }
        const parsed = parseSpdxExpression(text.trim());
        if (!parsed.ok) {
            return { kind: 'invalid', error: `the legacy list entry "${text}" is not an SPDX expression (${parsed.error})`, raw, legacy };
        }
        asts.push(parsed.ast);
    }
    if (asts.length === 0) return { kind: 'missing', raw, legacy };
    // npm's documentation rewrites a `licenses` array as an OR expression.
    const ast = joined('or', asts);
    return { kind: 'spdx', ast, expression: formatExpression(ast), key: expressionKey(ast), raw, legacy };
}

/**
 * Normalise a manifest's licence declaration (`{ license, licenses }`).
 *
 * Returns one of:
 *   { kind: 'spdx', ast, expression, key }
 *   { kind: 'see-licence-in', file }
 *   { kind: 'unlicensed' }
 *   { kind: 'missing' }
 *   { kind: 'invalid', error }
 * each with `raw` (the value read) and `legacy` (null, 'license-object',
 * 'license-array' or 'licenses-array').
 */
export function normaliseDeclaration(manifest) {
    const m = isPlainObject(manifest) ? manifest : {};
    if (present(m.license)) {
        const raw = m.license;
        if (typeof raw === 'string') return declarationFromString(raw, null, raw);
        if (Array.isArray(raw)) return declarationFromList(raw, 'license-array', raw);
        if (isPlainObject(raw)) {
            if (typeof raw.type === 'string') return declarationFromString(raw.type, 'license-object', raw);
            return { kind: 'invalid', error: 'the licence object has no "type"', raw, legacy: 'license-object' };
        }
        return { kind: 'invalid', error: `a licence of type ${typeof raw} is not a declaration`, raw, legacy: null };
    }
    if (present(m.licenses)) {
        const raw = m.licenses;
        return declarationFromList(Array.isArray(raw) ? raw : [raw], 'licenses-array', raw);
    }
    return { kind: 'missing', raw: m.license ?? m.licenses ?? null, legacy: null };
}

/** A key two declarations share exactly when they say the same thing. */
export function declarationKey(declaration) {
    if (declaration.kind === 'spdx') return `spdx:${declaration.key}`;
    if (declaration.kind === 'see-licence-in') return `see-licence-in:${declaration.file}`;
    if (declaration.kind === 'invalid') return `invalid:${JSON.stringify(declaration.raw)}`;
    return declaration.kind;
}

function describeDeclaration(declaration) {
    switch (declaration.kind) {
        case 'spdx':
            return declaration.expression;
        case 'see-licence-in':
            return `SEE LICENSE IN ${declaration.file}`;
        case 'unlicensed':
            return 'UNLICENSED';
        case 'missing':
            return 'no licence';
        default:
            return JSON.stringify(declaration.raw);
    }
}

// ─── Exemptions ─────────────────────────────────────────────────────────────

/**
 * Validate the exemptions file's content. An entry is
 *   "<package name>": { "licence": "<SPDX>", "reason": "…", "adr": "docs/adr/000N-….md", "version"?: "x.y.z" }
 * `licence` is the licence a person verified, as an SPDX expression
 * (`LicenseRef-…` for a proprietary one). `reason` and `adr` are required:
 * an exemption nobody can trace to a decision does not apply. The ADR file
 * must exist AND name the package, so an unrelated ADR cannot stand in for
 * the decision. `version`, when given, binds the exemption to that exact
 * version, so an upgrade has to be re-read before it passes; it is required
 * for a package whose declaration is not an SPDX expression (see
 * `judgePackage`).
 *
 * Returns `{ entries: Map<name, entry>, errors: [{ name, problem }] }`.
 * An invalid entry is reported and not applied.
 */
export function validateExemptions(raw, root) {
    const entries = new Map();
    const errors = [];
    if (!isPlainObject(raw)) {
        errors.push({ name: null, problem: 'the exemptions file must hold one JSON object keyed by package name' });
        return { entries, errors };
    }
    const adrTexts = new Map();
    const adrText = (adr) => {
        if (!adrTexts.has(adr)) adrTexts.set(adr, fs.readFileSync(path.join(root, adr), 'utf8'));
        return adrTexts.get(adr);
    };
    for (const [name, value] of Object.entries(raw)) {
        const problems = [];
        if (!isPlainObject(value)) {
            problems.push('must be an object with "licence", "reason" and "adr"');
        } else {
            for (const key of Object.keys(value)) {
                if (!EXEMPTION_FIELDS.has(key)) problems.push(`unknown field "${key}"`);
            }
            for (const key of ['licence', 'reason', 'adr']) {
                if (typeof value[key] !== 'string' || value[key].trim() === '') {
                    problems.push(`"${key}" is required and must be a non-empty string`);
                }
            }
            if (typeof value.licence === 'string' && value.licence.trim() !== '') {
                const parsed = parseSpdxExpression(value.licence.trim());
                if (!parsed.ok) problems.push(`"licence" is not an SPDX expression (${parsed.error})`);
            }
            if (typeof value.adr === 'string' && value.adr.trim() !== '') {
                const adr = value.adr.trim();
                if (!ADR_PATH.test(adr)) problems.push(`"adr" must be a repository path like docs/adr/0001-name.md, not "${adr}"`);
                else if (!fs.existsSync(path.join(root, adr))) problems.push(`"adr" names ${adr}, which does not exist`);
                else if (!adrText(adr).includes(name)) problems.push(`"adr" names ${adr}, which does not mention ${name}: cite the ADR that decided this package`);
            }
            if ('version' in value && (typeof value.version !== 'string' || value.version.trim() === '')) {
                problems.push('"version", when present, must be a non-empty string');
            }
        }
        if (problems.length > 0) {
            errors.push({ name, problem: problems.join('; ') });
            continue;
        }
        const licence = value.licence.trim();
        const ast = parseSpdxExpression(licence).ast;
        entries.set(name, {
            name,
            licence: formatExpression(ast),
            licenceKey: expressionKey(ast),
            reason: value.reason.trim(),
            adr: value.adr.trim(),
            version: typeof value.version === 'string' ? value.version.trim() : null,
        });
    }
    return { entries, errors };
}

/** Why an exemption does not cover this package, or null when it does. */
function exemptionMismatch(exemption, pkg) {
    if (exemption.version !== null && exemption.version !== pkg.version) {
        return `it is bound to version ${exemption.version} and the tree holds ${pkg.version}; re-read the licence and update the entry`;
    }
    if (pkg.declaration.kind === 'spdx') {
        if (exemption.licenceKey !== pkg.declaration.key) {
            return `it records "${exemption.licence}" but the package declares "${pkg.declaration.expression}"`;
        }
    } else if (exemption.version === null) {
        // Without an SPDX declaration there is nothing to bind the entry to
        // but the version a person read: the package could change its
        // "SEE LICENSE IN" file, or drop its licence, and keep the exemption.
        return `the package declares ${describeDeclaration(pkg.declaration)}, not an SPDX expression the entry can be bound to, so the entry must name the "version" whose licence was read`;
    }
    return null;
}

// ─── Deny list ──────────────────────────────────────────────────────────────

/** Whether a package name is on the deny list. */
export function isDeniedPackage(name) {
    return DENIED_PACKAGES.some((entry) => (entry.endsWith('*') ? name.startsWith(entry.slice(0, -1)) : name === entry));
}

// ─── Judging one package ────────────────────────────────────────────────────

function refusal(declaration, evaluation) {
    switch (declaration.kind) {
        case 'spdx':
            return { code: evaluation.unknownException ? 'UNKNOWN_EXCEPTION' : 'NOT_ALLOWED', reason: evaluation.problems.join('; ') };
        case 'see-licence-in':
            return {
                code: 'SEE_LICENCE_IN',
                reason: `the licence is only in ${declaration.file}: read that file, then record what it says in ${DEFAULT_EXEMPTIONS_FILE}`,
            };
        case 'unlicensed':
            return { code: 'UNLICENSED', reason: 'UNLICENSED means no licence is granted to use it' };
        case 'missing':
            return { code: 'MISSING', reason: 'no licence is declared' };
        default:
            return { code: 'INVALID', reason: `the declaration is not a valid SPDX expression (${declaration.error})` };
    }
}

/**
 * Judge one package: `pkg` is `{ name, version, location, declaration }`.
 * Returns `{ verdict: 'pass' | 'exempt' | 'fail', code?, reason?, relied,
 * notices, exemption, exemptionProblem }`.
 */
export function judgePackage(pkg, exemptions = new Map()) {
    const exemption = exemptions.get(pkg.name) ?? null;
    const base = { relied: [], notices: [], exemption: null, exemptionProblem: null };
    if (isDeniedPackage(pkg.name)) {
        return {
            ...base,
            verdict: 'fail',
            code: 'DENY_LISTED',
            reason: `${pkg.name} is on the deny list (roadmap 2.5) and may not be used in production, whatever its licence says; an exemption cannot lift it`,
        };
    }
    let evaluation = null;
    if (pkg.declaration.kind === 'spdx') {
        evaluation = evaluateExpression(pkg.declaration.ast);
        if (evaluation.allowed) {
            const notices = [];
            for (const id of evaluation.relied) {
                if (id in NOTICE_LICENCES) notices.push({ code: `NOTICE_${id}`, message: `${id}: ${NOTICE_LICENCES[id]}` });
            }
            if (pkg.declaration.legacy) {
                notices.push({ code: 'LEGACY_DECLARATION', message: `declared in the legacy ${pkg.declaration.legacy} form, read as "${pkg.declaration.expression}"` });
            }
            return {
                ...base,
                verdict: 'pass',
                relied: evaluation.relied,
                notices,
                exemptionProblem: exemption ? 'the exemption is not needed: the declared licence is already allowed; delete it' : null,
            };
        }
    }
    const refused = refusal(pkg.declaration, evaluation);
    if (exemption) {
        const mismatch = exemptionMismatch(exemption, pkg);
        if (mismatch === null) {
            return { ...base, verdict: 'exempt', exemption, relied: [], notices: [] };
        }
        return { ...base, verdict: 'fail', code: refused.code, reason: `${refused.reason}; the exemption does not apply: ${mismatch}` };
    }
    return { ...base, verdict: 'fail', code: refused.code, reason: refused.reason };
}

// ─── The production tree, from the lockfile and the manifests ───────────────

function isNodeModulesPath(location) {
    return location === 'node_modules' || location.startsWith('node_modules/') || location.includes('/node_modules/');
}

function nameFromLocation(location) {
    const marker = location.lastIndexOf('node_modules/');
    return marker === -1 ? path.posix.basename(location) : location.slice(marker + 'node_modules/'.length);
}

function globToRegExp(glob) {
    let source = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            source += '.*';
            i++;
        } else if (c === '*') {
            source += '[^/]*';
        } else {
            source += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        }
    }
    return new RegExp(`^${source.replace(/^\.\//, '').replace(/\/+$/, '')}$`);
}

function workspaceGlobs(manifest) {
    if (!isPlainObject(manifest)) return [];
    const declared = Array.isArray(manifest.workspaces)
        ? manifest.workspaces
        : isPlainObject(manifest.workspaces) && Array.isArray(manifest.workspaces.packages)
          ? manifest.workspaces.packages
          : [];
    return declared.filter((p) => typeof p === 'string');
}

/** A predicate telling whether a repository-relative directory is a workspace of `manifest`. */
export function workspaceMatcher(manifest) {
    const declared = workspaceGlobs(manifest);
    const include = declared.filter((p) => !p.startsWith('!')).map(globToRegExp);
    const exclude = declared.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));
    return (location) =>
        location !== '' &&
        !isNodeModulesPath(location) &&
        include.some((re) => re.test(location)) &&
        !exclude.some((re) => re.test(location));
}

/** Resolve a bare dependency name from a lockfile location, nearest node_modules first. */
export function resolveFrom(packages, from, name) {
    const segments = from === '' ? [] : from.split('/');
    for (let i = segments.length; i >= 0; i--) {
        const prefix = segments.slice(0, i);
        if (prefix.length > 0 && prefix[prefix.length - 1] === 'node_modules') continue;
        const candidate = [...prefix, 'node_modules', name].join('/');
        if (isPlainObject(packages[candidate])) return candidate;
    }
    return null;
}

const EDGE_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

function edgesOf(entry) {
    const edges = new Map();
    const deps = isPlainObject(entry.dependencies) ? entry.dependencies : {};
    const optional = isPlainObject(entry.optionalDependencies) ? entry.optionalDependencies : {};
    const peers = isPlainObject(entry.peerDependencies) ? entry.peerDependencies : {};
    const peerMeta = isPlainObject(entry.peerDependenciesMeta) ? entry.peerDependenciesMeta : {};
    for (const name of Object.keys(peers)) {
        edges.set(name, { name, optional: peerMeta[name]?.optional === true, peer: true });
    }
    for (const name of Object.keys(optional)) edges.set(name, { name, optional: true, peer: false });
    for (const name of Object.keys(deps)) edges.set(name, { name, optional: name in optional, peer: false });
    return [...edges.values()];
}

/** The union of two entries' edges; a name required by either is required. */
function unionEdges(a, b) {
    const edges = new Map();
    for (const edge of [...edgesOf(a), ...edgesOf(b)]) {
        const known = edges.get(edge.name);
        edges.set(edge.name, known ? { ...edge, optional: known.optional && edge.optional, peer: known.peer && edge.peer } : edge);
    }
    return [...edges.values()];
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isPlainObject(value)) {
        const keys = Object.keys(value).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

const COMPARED_MAPS = [...EDGE_FIELDS, 'peerDependenciesMeta', 'devDependencies'];

/** The fields on which package.json and its lockfile entry disagree. */
function manifestDisagreements(manifest, lockEntry, { root }) {
    const differs = [];
    for (const field of COMPARED_MAPS) {
        const a = isPlainObject(manifest[field]) ? manifest[field] : {};
        const b = isPlainObject(lockEntry[field]) ? lockEntry[field] : {};
        if (canonical(a) !== canonical(b)) differs.push(field);
    }
    if (declarationKey(normaliseDeclaration({ license: manifest.license })) !== declarationKey(normaliseDeclaration({ license: lockEntry.license }))) {
        differs.push('license');
    }
    if (root && canonical(workspaceGlobs(manifest)) !== canonical(workspaceGlobs(lockEntry))) differs.push('workspaces');
    if (!root && (manifest.name ?? null) !== (lockEntry.name ?? null)) differs.push('name');
    return differs;
}

/**
 * The production packages a lockfile describes.
 *
 * Options:
 *   - `readInstalled(location)`: the installed package.json at a node_modules
 *     location, or null.
 *   - `readManifest(location)`: the package.json in the repository at '' (the
 *     root) or a workspace directory, or null. The walk starts from these and
 *     each must agree with its lockfile entry. When omitted, the lockfile's
 *     own entries stand in for them; `runGate` always passes the real files.
 *   - `diskWorkspaces`: repository-relative directories that hold a
 *     package.json matching the root's workspace globs; each must be in the
 *     lockfile.
 *   - `extraRoots`: `[{ location, from }]`, lockfile locations that a file
 *     which can ship imports (`from` names the file). They are walked like
 *     the manifests' dependencies, whatever their dev flag.
 *
 * Returns `{ lockfileVersion, packages: [{ name, version, location, declaration,
 * licenceSource, chain, mismatch, workspace }], skipped, notices, problems }`
 * where `problems` are tree-level failures.
 */
export function listProductionPackages(lock, { readInstalled = () => null, readManifest = null, diskWorkspaces = null, extraRoots = [] } = {}) {
    if (!isPlainObject(lock)) throw new GateError('the lockfile is not a JSON object');
    if (![2, 3].includes(lock.lockfileVersion) || !isPlainObject(lock.packages)) {
        throw new GateError(
            `lockfileVersion ${JSON.stringify(lock.lockfileVersion)} has no "packages" map; regenerate the lockfile with npm 7 or later`,
        );
    }
    const packages = lock.packages;
    const rootEntry = packages[''];
    if (!isPlainObject(rootEntry)) throw new GateError('the lockfile has no root entry ("")');
    const manifestAt = (location) => {
        if (readManifest === null) return isPlainObject(packages[location]) ? packages[location] : null;
        const manifest = readManifest(location);
        return isPlainObject(manifest) ? manifest : null;
    };
    const rootManifest = manifestAt('');
    if (rootManifest === null) throw new GateError('there is no package.json at the repository root');
    const isWorkspace = workspaceMatcher(rootManifest);
    const notices = [];
    const problems = [];

    // 0. The manifests on disk against their lockfile entries.
    const lockWorkspaces = Object.keys(packages).filter((location) => isWorkspace(location) && isPlainObject(packages[location]));
    if (readManifest !== null) {
        const differs = manifestDisagreements(rootManifest, rootEntry, { root: true });
        if (differs.length > 0) {
            problems.push({
                code: 'MANIFEST_LOCK_MISMATCH',
                location: '',
                reason: `package.json and the lockfile's root entry disagree on ${differs.join(', ')}: npm installs what package.json declares, so run npm install and commit the lockfile`,
            });
        }
        for (const location of lockWorkspaces) {
            const manifest = manifestAt(location);
            if (manifest === null) {
                problems.push({ code: 'WORKSPACE_MISSING', location, reason: `the lockfile lists the workspace ${location}, which has no package.json in the repository` });
                continue;
            }
            const wsDiffers = manifestDisagreements(manifest, packages[location], { root: false });
            if (wsDiffers.length > 0) {
                problems.push({
                    code: 'MANIFEST_LOCK_MISMATCH',
                    location,
                    reason: `${location}/package.json and its lockfile entry disagree on ${wsDiffers.join(', ')}; run npm install and commit the lockfile`,
                });
            }
        }
    }
    if (Array.isArray(diskWorkspaces)) {
        for (const location of diskWorkspaces) {
            if (!isPlainObject(packages[location])) {
                problems.push({
                    code: 'WORKSPACE_NOT_IN_LOCKFILE',
                    location,
                    reason: `${location}/package.json is a workspace the lockfile does not describe; run npm install and commit the lockfile`,
                });
            }
        }
    }

    // 1. Walk the graph: first from the manifests, then from what shipped code imports.
    const parentOf = new Map();
    const importedBy = new Map();
    const queue = [];
    const reach = (location, parent) => {
        if (parentOf.has(location)) return;
        parentOf.set(location, parent);
        queue.push(location);
    };
    const follow = (target) => {
        if (target !== null && packages[target]?.link === true) {
            const resolved = typeof packages[target].resolved === 'string' ? packages[target].resolved : null;
            if (resolved === null || !isPlainObject(packages[resolved])) {
                problems.push({
                    code: 'BROKEN_LINK',
                    location: target,
                    reason: `${target} is a link to ${JSON.stringify(resolved)}, which the lockfile does not describe`,
                });
                return { broken: true };
            }
            return { target: resolved };
        }
        return { target };
    };
    const drain = () => {
        while (queue.length > 0) {
            const from = queue.shift();
            const entry = packages[from];
            const ownManifest = from === '' || isWorkspace(from) ? manifestAt(from) : null;
            const edges = ownManifest ? unionEdges(ownManifest, entry ?? {}) : edgesOf(entry);
            for (const edge of edges) {
                const followed = follow(resolveFrom(packages, from, edge.name));
                if (followed.broken) continue;
                const target = followed.target;
                if (target === null) {
                    if (edge.optional) continue;
                    const where = from === '' ? 'the root package' : from;
                    if (edge.peer) {
                        notices.push({ code: 'UNRESOLVED_PEER', message: `peer dependency ${edge.name} of ${where} is not in the lockfile` });
                    } else {
                        problems.push({
                            code: 'UNRESOLVED',
                            location: from,
                            reason: `${where} depends on ${edge.name}, which the lockfile does not resolve; run npm install and commit the lockfile`,
                        });
                    }
                    continue;
                }
                reach(target, from);
            }
        }
    };
    reach('', null);
    for (const location of lockWorkspaces) reach(location, '');
    drain();
    const fromManifests = new Set(parentOf.keys());
    for (const { location, from } of extraRoots) {
        const followed = follow(isPlainObject(packages[location]) ? location : null);
        if (followed.broken || followed.target === null) continue;
        if (!importedBy.has(followed.target)) importedBy.set(followed.target, from);
        reach(followed.target, null);
    }
    drain();

    // 2. npm's own flags, then the union of every view.
    const flagged = Object.keys(packages).filter(
        (location) => location !== '' && isPlainObject(packages[location]) && packages[location].link !== true && packages[location].dev !== true,
    );
    const candidates = new Set([...flagged, ...parentOf.keys()]);
    candidates.delete('');
    const devButReached = [...fromManifests].filter((location) => location !== '' && packages[location]?.dev === true);
    if (devButReached.length > 0) {
        notices.push({
            code: 'DEV_FLAG_CONTRADICTED',
            message: `the lockfile flags ${devButReached.length} package(s) dev-only that production reaches; checked anyway: ${devButReached.join(', ')}`,
        });
    }
    const bundledDev = [...parentOf.keys()].filter((location) => !fromManifests.has(location) && packages[location]?.dev === true);
    if (bundledDev.length > 0) {
        notices.push({
            code: 'DEV_DEPENDENCY_BUNDLED',
            message: `${bundledDev.length} dev-only package(s) ship because code that can ship imports them (or what they depend on); checked as production: ${bundledDev.join(', ')}`,
        });
    }
    const notReached = flagged.filter((location) => !parentOf.has(location));
    if (notReached.length > 0) {
        notices.push({
            code: 'FLAGGED_NOT_REACHED',
            message: `${notReached.length} non-dev lockfile entr(ies) are not reachable from the root; checked anyway: ${notReached.join(', ')}`,
        });
    }

    const nameAt = (location) => (location === '' ? '(root)' : (packages[location]?.name ?? nameFromLocation(location)));
    const chainTo = (location) => {
        if (!parentOf.has(location)) return null;
        const names = [];
        let at = location;
        for (; at !== null && at !== ''; at = parentOf.get(at)) {
            names.unshift(nameAt(at));
            if (parentOf.get(at) === null) break;
        }
        if (at !== null && importedBy.has(at)) names.unshift(importedBy.get(at));
        return names;
    };

    // 3. Read each candidate's licence.
    const rootLicenceKey = declarationKey(normaliseDeclaration(rootManifest));
    const result = [];
    const skipped = [{ name: rootManifest.name ?? rootEntry.name ?? '(root)', location: '', why: 'the root package (Islestone itself)' }];
    let staleInstalls = 0;
    for (const location of [...candidates].sort()) {
        const entry = packages[location];
        if (!isPlainObject(entry)) continue;
        if (isWorkspace(location)) {
            const manifest = manifestAt(location) ?? entry;
            const declaration = normaliseDeclaration(manifest);
            const name = manifest.name ?? nameAt(location);
            const version = typeof manifest.version === 'string' ? manifest.version : null;
            if (declaration.kind === 'missing' || declarationKey(declaration) === rootLicenceKey) {
                skipped.push({ name, location, why: 'a workspace package with the root licence (Islestone itself)' });
                continue;
            }
            result.push({ name, version, location, declaration, licenceSource: 'workspace', chain: chainTo(location), mismatch: null, workspace: true });
            continue;
        }
        const name = nameAt(location);
        const version = typeof entry.version === 'string' ? entry.version : null;
        const installed = readInstalled(location);
        const installedMatches = isPlainObject(installed) && installed.version === version;
        if (isPlainObject(installed) && !installedMatches) staleInstalls++;
        let declaration;
        let licenceSource;
        let mismatch = null;
        if (present(entry.license)) {
            declaration = normaliseDeclaration({ license: entry.license });
            licenceSource = 'lockfile';
            if (installedMatches) {
                const fromInstalled = normaliseDeclaration(installed);
                if (declarationKey(fromInstalled) !== declarationKey(declaration)) {
                    mismatch = `the lockfile records "${describeDeclaration(declaration)}" but the installed ${location}/package.json declares "${describeDeclaration(fromInstalled)}"`;
                }
            }
        } else if (installedMatches) {
            declaration = normaliseDeclaration(installed);
            licenceSource = 'installed';
            notices.push({ code: 'LICENCE_FROM_INSTALLED', message: `${name}@${version}: no licence in the lockfile; read ${location}/package.json` });
        } else {
            declaration = { kind: 'missing', raw: null, legacy: null };
            licenceSource = 'none';
        }
        result.push({ name, version, location, declaration, licenceSource, chain: chainTo(location), mismatch, workspace: false });
    }
    if (staleInstalls > 0) {
        notices.push({
            code: 'STALE_NODE_MODULES',
            message: `${staleInstalls} installed package(s) differ in version from the lockfile and were not used; run npm ci`,
        });
    }
    return { lockfileVersion: lock.lockfileVersion, packages: result, skipped, notices, problems };
}

/**
 * Judge every production package in a lockfile against the policy and the
 * exemptions. Takes the options of `listProductionPackages` plus `root` and
 * `exemptions`, and returns the dependency half of the report.
 */
export function checkDependencies(lock, { root, exemptions: rawExemptions = {}, ...treeOptions } = {}) {
    const tree = listProductionPackages(lock, treeOptions);
    const { entries, errors: exemptionErrors } = validateExemptions(rawExemptions, root);
    const failures = [...tree.problems.map((p) => ({ name: null, version: null, location: p.location, declared: null, code: p.code, reason: p.reason, chain: null }))];
    const notices = [...tree.notices];
    const exempted = [];
    const judged = [];
    const namesInTree = new Set();
    const exemptionProblems = [...exemptionErrors.map((e) => ({ name: e.name, problem: e.problem }))];
    for (const pkg of tree.packages) {
        namesInTree.add(pkg.name);
        const verdict = judgePackage(pkg, entries);
        const record = {
            name: pkg.name,
            version: pkg.version,
            location: pkg.location,
            declared: describeDeclaration(pkg.declaration),
            licenceSource: pkg.licenceSource,
            chain: pkg.chain,
            verdict: verdict.verdict,
            code: verdict.code ?? null,
            reason: verdict.reason ?? null,
            relied: verdict.relied,
        };
        if (pkg.mismatch !== null) {
            record.verdict = 'fail';
            record.code = 'LICENCE_MISMATCH';
            record.reason = pkg.mismatch;
        }
        judged.push(record);
        if (record.verdict === 'fail') failures.push(record);
        if (record.verdict === 'exempt') {
            exempted.push({ ...record, licence: verdict.exemption.licence, adr: verdict.exemption.adr, exemptionReason: verdict.exemption.reason });
        }
        for (const notice of verdict.notices) notices.push({ ...notice, message: `${pkg.name}@${pkg.version}: ${notice.message}` });
        if (verdict.exemptionProblem) exemptionProblems.push({ name: pkg.name, problem: verdict.exemptionProblem });
    }
    for (const name of entries.keys()) {
        if (!namesInTree.has(name)) {
            exemptionProblems.push({ name, problem: 'stale: no production package of that name is in the tree; delete the entry' });
        }
    }
    // One problem per name, in a stable order.
    const seen = new Set();
    const dedupedExemptionProblems = exemptionProblems.filter((p) => {
        const key = `${p.name}\0${p.problem}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return {
        lockfileVersion: tree.lockfileVersion,
        checked: judged.length,
        packages: judged,
        skipped: tree.skipped,
        failures,
        exempted,
        notices,
        exemptionProblems: dedupedExemptionProblems,
    };
}

// ─── Source text: strings, escapes and the lexer ────────────────────────────

const REGEX_AFTER_WORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const IDENT_START = /[A-Za-z_$\u0080-￿]/;
const IDENT_PART = /[\w$\u0080-￿‌‍]/;
const LINE_TERMINATORS = new Set(['\n', ' ', ' ']);

/**
 * Read one escape sequence at `text[i]` (the character after the
 * backslash). Returns `{ value, next }`: the decoded text and the index after
 * the sequence. A line continuation decodes to nothing.
 */
function readEscape(text, i) {
    const c = text[i];
    if (c === undefined) return { value: '', next: i };
    if (c === '\r') return { value: '', next: text[i + 1] === '\n' ? i + 2 : i + 1 };
    if (LINE_TERMINATORS.has(c)) return { value: '', next: i + 1 };
    const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v' };
    if (c in simple) return { value: simple[c], next: i + 1 };
    if (c === 'x' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
        return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 3), 16)), next: i + 3 };
    }
    if (c === 'u') {
        if (text[i + 1] === '{') {
            const end = text.indexOf('}', i + 2);
            const hex = end === -1 ? '' : text.slice(i + 2, end);
            if (/^[0-9a-f]{1,6}$/i.test(hex) && parseInt(hex, 16) <= 0x10ffff) return { value: String.fromCodePoint(parseInt(hex, 16)), next: end + 1 };
        } else if (/^[0-9a-f]{4}$/i.test(text.slice(i + 1, i + 5))) {
            return { value: String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16)), next: i + 5 };
        }
        return { value: 'u', next: i + 1 };
    }
    if (/[0-7]/.test(c)) {
        // Legacy octal escapes, allowed in sloppy-mode strings.
        const octal = /^[0-7]{1,3}/.exec(text.slice(i, i + 3))[0];
        const value = parseInt(octal, 8) <= 0o377 ? octal : octal.slice(0, 2);
        return { value: String.fromCharCode(parseInt(value, 8)), next: i + value.length };
    }
    return { value: c, next: i + 1 };
}

/** The value of a JavaScript string body, escapes decoded. */
export function decodeEscapes(body) {
    let out = '';
    for (let i = 0; i < body.length; ) {
        if (body[i] === '\\') {
            const { value, next } = readEscape(body, i + 1);
            out += value;
            i = next;
        } else {
            out += body[i];
            i++;
        }
    }
    return out;
}

/**
 * A small JavaScript, TypeScript and JSX lexer: enough to tell an import
 * specifier from the same text in a comment, a regular expression, JSX text
 * or an unrelated string. It decodes string and template escapes (and
 * escaped identifiers), reads templates with `${…}` nesting, reads regular
 * expressions by the usual previous-token rule, and with `jsx: true` reads
 * JSX elements, so text such as "Press `" or "/* notes" between tags is text.
 *
 * Returns `{ tokens, problems }`. A string or a regular expression that does
 * not end on its line ends there. Anything else left open at the end of the
 * file (a template, a block comment, a JSX element, a brace) is a problem:
 * the lexer lost its place, and the imports after that point were not read.
 */
export function tokenizeSource(text, { jsx = false } = {}) {
    const tokens = [];
    const problems = [];
    const stack = [];
    let i = 0;
    let line = 1;
    let last = null;
    const n = text.length;
    const emit = (token) => {
        tokens.push(token);
        last = token;
    };
    const countLines = (from, to) => {
        for (let k = from; k < to; k++) if (text[k] === '\n') line++;
    };
    const regexAllowed = () => {
        if (last === null) return true;
        if (last.type === 'punct') {
            if (last.value === ')' || last.value === ']') return false;
            // After a block, a statement (and so a regex) may start; after an
            // object literal, a slash divides.
            if (last.value === '}') return last.block === true;
            return true;
        }
        if (last.type === 'ident') return REGEX_AFTER_WORDS.has(last.value);
        return false;
    };
    // Whether a `{` here opens a block (true) or an object literal (false).
    const braceIsBlock = () => {
        if (last === null) return true;
        if (last.type === 'punct') return [')', ';', '{', '}', '=>'].includes(last.value);
        if (last.type === 'ident') return !REGEX_AFTER_WORDS.has(last.value);
        return false;
    };

    // Reads template text from `i` until its end or the next `${`.
    const readTemplate = (token) => {
        let raw = '';
        while (i < n) {
            const c = text[i];
            if (c === '\\') {
                const { value, next } = readEscape(text, i + 1);
                countLines(i, next);
                raw += value;
                i = next;
            } else if (c === '`') {
                token.chunks.push(raw);
                i++;
                last = token;
                return;
            } else if (c === '$' && text[i + 1] === '{') {
                token.chunks.push(raw);
                token.subs.push({ start: tokens.length, end: tokens.length });
                stack.push({ kind: 'template', token, line });
                i += 2;
                last = { type: 'punct', value: '${' };
                return;
            } else {
                if (c === '\n') line++;
                raw += c;
                i++;
            }
        }
        token.chunks.push(raw);
        token.broken = true;
        problems.push({ line: token.line, message: 'a template literal is never closed' });
    };

    // Reads JSX markup from `i`. `mode` is 'tag' (inside an opening tag, after
    // its name) or 'children'; `depth` counts the elements open around it.
    const readJsx = (mode, depth, openLine) => {
        while (i < n) {
            const c = text[i];
            if (c === '\n') {
                line++;
                i++;
                continue;
            }
            if (mode === 'tag') {
                if (c === '/' && text[i + 1] === '>') {
                    i += 2;
                    if (depth === 0) {
                        last = { type: 'punct', value: ')' };
                        return;
                    }
                    mode = 'children';
                } else if (c === '>') {
                    i++;
                    depth++;
                    mode = 'children';
                } else if (c === '{') {
                    stack.push({ kind: 'jsx-tag', depth, line: openLine });
                    i++;
                    last = { type: 'punct', value: '{' };
                    return;
                } else if (c === '"' || c === "'") {
                    // Attribute strings have no escapes and may span lines.
                    const end = text.indexOf(c, i + 1);
                    const stop = end === -1 ? n : end + 1;
                    countLines(i, stop);
                    i = stop;
                } else {
                    i++;
                }
            } else if (c === '{') {
                stack.push({ kind: 'jsx-children', depth, line: openLine });
                i++;
                last = { type: 'punct', value: '{' };
                return;
            } else if (c === '<') {
                let j = i + 1;
                while (j < n && /\s/.test(text[j])) j++;
                if (text[j] === '/') {
                    const end = text.indexOf('>', j);
                    if (end === -1) break;
                    countLines(i, end + 1);
                    i = end + 1;
                    depth--;
                    if (depth <= 0) {
                        last = { type: 'punct', value: ')' };
                        return;
                    }
                } else {
                    countLines(i, j);
                    i = j;
                    while (i < n && /[\w$.:-]/.test(text[i])) i++;
                    mode = 'tag';
                }
            } else {
                i++;
            }
        }
        i = n;
        problems.push({ line: openLine, message: 'a JSX element is never closed' });
    };
    // Whether a `<` at `i` opens a JSX element rather than a comparison or type parameters.
    const jsxStartsHere = () => {
        if (!jsx || !regexAllowed()) return false;
        const next = text[i + 1] ?? '';
        if (next === '>') return true;
        if (!IDENT_START.test(next)) return false;
        let j = i + 1;
        while (j < n && IDENT_PART.test(text[j])) j++;
        const rest = text.slice(j).replace(/^\s+/, '');
        // `<T,>(x) => x` and `<T extends U>(x) => x` are type parameters.
        return !rest.startsWith(',') && !/^extends\b/.test(rest);
    };

    if (text.startsWith('#!')) {
        while (i < n && text[i] !== '\n') i++;
    }
    while (i < n) {
        const c = text[i];
        if (c === '\n') {
            line++;
            i++;
        } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ' || c === ' ' || c === ' ') {
            i++;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            if (end === -1) {
                problems.push({ line, message: 'a block comment is never closed' });
                i = n;
            } else {
                countLines(i, end + 2);
                i = end + 2;
            }
        } else if (c === "'" || c === '"') {
            const startLine = line;
            let value = '';
            let j = i + 1;
            let broken = true;
            while (j < n) {
                const d = text[j];
                if (d === '\\') {
                    const { value: decoded, next } = readEscape(text, j + 1);
                    for (let k = j; k < next; k++) if (text[k] === '\n') line++;
                    value += decoded;
                    j = next;
                } else if (d === c) {
                    broken = false;
                    j++;
                    break;
                } else if (d === '\n') {
                    break;
                } else {
                    value += d;
                    j++;
                }
            }
            i = j;
            emit({ type: 'string', value, line: startLine, broken });
        } else if (c === '`') {
            const token = { type: 'template', chunks: [], subs: [], line, broken: false };
            emit(token);
            i++;
            readTemplate(token);
        } else if (c === '<' && jsxStartsHere()) {
            const openLine = line;
            i++;
            while (i < n && /[\w$.:-]/.test(text[i])) i++;
            readJsx('tag', 0, openLine);
        } else if (c === '/' && regexAllowed()) {
            let j = i + 1;
            let inClass = false;
            let closed = false;
            while (j < n && text[j] !== '\n') {
                const d = text[j];
                if (d === '\\') {
                    j += 2;
                    continue;
                }
                if (d === '[') inClass = true;
                else if (d === ']') inClass = false;
                else if (d === '/' && !inClass) {
                    closed = true;
                    break;
                }
                j++;
            }
            if (closed) {
                j++;
                while (j < n && /[a-z]/i.test(text[j])) j++;
                emit({ type: 'regex', value: text.slice(i, j), line });
                i = j;
            } else {
                emit({ type: 'punct', value: '/', line });
                i++;
            }
        } else if (IDENT_START.test(c) || (c === '\\' && text[i + 1] === 'u')) {
            let value = '';
            let j = i;
            while (j < n && (IDENT_PART.test(text[j]) || (text[j] === '\\' && text[j + 1] === 'u'))) {
                if (text[j] === '\\') {
                    const { value: decoded, next } = readEscape(text, j + 1);
                    value += decoded;
                    j = next;
                } else {
                    value += text[j];
                    j++;
                }
            }
            emit({ type: 'ident', value, line });
            i = j;
        } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            let j = i + 1;
            while (j < n && /[\w.]/.test(text[j])) j++;
            emit({ type: 'number', value: text.slice(i, j), line });
            i = j;
        } else if (c === '{') {
            const block = braceIsBlock();
            stack.push({ kind: 'brace', block, line });
            emit({ type: 'punct', value: '{', line });
            i++;
        } else if (c === '}') {
            const top = stack.pop();
            i++;
            if (top === undefined) {
                problems.push({ line, message: 'a "}" closes nothing' });
                emit({ type: 'punct', value: '}', line, block: true });
            } else if (top.kind === 'template') {
                top.token.subs[top.token.subs.length - 1].end = tokens.length;
                readTemplate(top.token);
            } else if (top.kind === 'jsx-tag') {
                readJsx('tag', top.depth, top.line);
            } else if (top.kind === 'jsx-children') {
                readJsx('children', top.depth, top.line);
            } else {
                emit({ type: 'punct', value: '}', line, block: top.block });
            }
        } else if (c === '?' && text[i + 1] === '.' && !/[0-9]/.test(text[i + 2] ?? '')) {
            emit({ type: 'punct', value: '?.', line });
            i += 2;
        } else if (c === '=' && text[i + 1] === '>') {
            emit({ type: 'punct', value: '=>', line });
            i += 2;
        } else {
            emit({ type: 'punct', value: c, line });
            i++;
        }
    }
    for (const frame of stack) {
        const what = { template: 'a template substitution', 'jsx-tag': 'a JSX attribute expression', 'jsx-children': 'a JSX child expression' }[frame.kind] ?? 'a "{"';
        problems.push({ line: frame.line, message: `${what} opened here is never closed` });
    }
    return { tokens, problems };
}

// ─── Source text: module specifiers ─────────────────────────────────────────

const isIdent = (token, value) => token !== undefined && token.type === 'ident' && token.value === value;
const isPunct = (token, value) => token !== undefined && token.type === 'punct' && token.value === value;
const isMember = (tokens, k) => isPunct(tokens[k - 1], '.') || isPunct(tokens[k - 1], '?.');

/** The index of the token that closes the bracket opened at `open`, or -1. */
function closing(tokens, open) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    for (let k = open; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.type !== 'punct') continue;
        if (t.value in pairs) stack.push(pairs[t.value]);
        else if (t.value === ')' || t.value === ']' || t.value === '}') {
            if (stack.pop() !== t.value) return -1;
            if (stack.length === 0) return k;
        }
    }
    return -1;
}

/** Fold tokens [start, end) to a string when they are only literals joined by `+`; otherwise null. */
function foldTokens(tokens, start, end) {
    let out = '';
    let k = start;
    let expectOperand = true;
    while (k < end) {
        const t = tokens[k];
        if (expectOperand) {
            if (t.type === 'string' && !t.broken) {
                out += t.value;
                k++;
            } else if (t.type === 'template' && !t.broken) {
                let value = t.chunks[0] ?? '';
                for (let s = 0; s < t.subs.length; s++) {
                    const sub = foldTokens(tokens, t.subs[s].start, t.subs[s].end);
                    if (sub === null) return null;
                    value += sub + (t.chunks[s + 1] ?? '');
                }
                out += value;
                // A substitution's tokens follow the template token in the stream.
                k = t.subs.length > 0 ? t.subs[t.subs.length - 1].end : k + 1;
            } else if (isPunct(t, '(')) {
                const close = closing(tokens, k);
                if (close === -1 || close >= end) return null;
                const inner = foldTokens(tokens, k + 1, close);
                if (inner === null) return null;
                out += inner;
                k = close + 1;
            } else {
                return null;
            }
            expectOperand = false;
        } else {
            if (!isPunct(t, '+')) return null;
            k++;
            expectOperand = true;
        }
    }
    return expectOperand ? null : out;
}

/** The static text pieces in tokens [start, end), for checking a specifier that cannot be computed. */
function staticPieces(tokens, start, end) {
    const pieces = [];
    for (let k = start; k < end; k++) {
        const t = tokens[k];
        if (t.type === 'string') pieces.push(t.value);
        else if (t.type === 'template') pieces.push(...t.chunks);
    }
    return pieces;
}

/** The first argument of the call whose `(` is at `open`: `{ start, end }`, or null. */
function firstArgument(tokens, open) {
    const close = closing(tokens, open);
    if (close === -1) return null;
    let depth = 0;
    for (let k = open + 1; k < close; k++) {
        const t = tokens[k];
        if (t.type !== 'punct') continue;
        if (t.value === '(' || t.value === '[' || t.value === '{') depth++;
        else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
        else if (t.value === ',' && depth === 0) return { start: open + 1, end: k, close };
    }
    return { start: open + 1, end: close, close };
}

/** Indices of `from` strings whose import or export declaration is type-only (erased at compile time). */
function typeOnlyDeclarations(tokens) {
    const typeOnly = new Set();
    // `{ type A, type B as C }`: whether every element is a type.
    const group = (open) => {
        const close = closing(tokens, open);
        if (close === -1) return null;
        const elements = [[]];
        for (let k = open + 1; k < close; k++) {
            if (isPunct(tokens[k], ',')) elements.push([]);
            else elements[elements.length - 1].push(tokens[k]);
        }
        const real = elements.filter((e) => e.length > 0);
        const allTypes = real.length > 0 && real.every((e) => isIdent(e[0], 'type') && e[1]?.type === 'ident' && !isIdent(e[1], 'as'));
        return { close, allTypes };
    };
    for (let k = 0; k < tokens.length; k++) {
        const keyword = tokens[k];
        if (!(isIdent(keyword, 'import') || isIdent(keyword, 'export')) || isMember(tokens, k)) continue;
        let p = k + 1;
        let typeKeyword = false;
        if (isIdent(tokens[p], 'type') && !isIdent(tokens[p + 1], 'from') && !isPunct(tokens[p + 1], ',') && !isPunct(tokens[p + 1], '=')) {
            typeKeyword = true;
            p++;
        }
        let only;
        if (keyword.value === 'export') {
            if (isPunct(tokens[p], '{')) {
                const g = group(p);
                if (g === null) continue;
                only = typeKeyword || g.allTypes;
                p = g.close + 1;
            } else if (isPunct(tokens[p], '*')) {
                p++;
                if (isIdent(tokens[p], 'as')) p += 2;
                only = typeKeyword;
            } else continue;
        } else {
            let valueBinding = false;
            let namedAllTypes = false;
            if (tokens[p]?.type === 'ident' && tokens[p].value !== 'from') {
                if (isPunct(tokens[p + 1], '=')) continue; // import x = require(…)
                valueBinding = true;
                p++;
                if (isPunct(tokens[p], ',')) p++;
            }
            if (isPunct(tokens[p], '{')) {
                const g = group(p);
                if (g === null) continue;
                namedAllTypes = g.allTypes;
                p = g.close + 1;
            } else if (isPunct(tokens[p], '*')) {
                valueBinding = true;
                p++;
                if (isIdent(tokens[p], 'as')) p += 2;
            } else if (!valueBinding) continue;
            only = typeKeyword || (!valueBinding && namedAllTypes);
        }
        if (only && isIdent(tokens[p], 'from') && tokens[p + 1]?.type === 'string') typeOnly.add(p + 1);
    }
    return typeOnly;
}

/** The identifiers that call `require`: `require` itself, its aliases, and createRequire's results. */
function requireNames(tokens) {
    const names = new Set(['require']);
    const factories = new Set(['createRequire']);
    for (let k = 0; k < tokens.length; k++) {
        // import { createRequire as make } from 'node:module'
        if (isIdent(tokens[k], 'createRequire') && isIdent(tokens[k + 1], 'as') && tokens[k + 2]?.type === 'ident') factories.add(tokens[k + 2].value);
        // const { createRequire: make } = require('node:module')
        if (isIdent(tokens[k], 'createRequire') && isPunct(tokens[k + 1], ':') && tokens[k + 2]?.type === 'ident') factories.add(tokens[k + 2].value);
    }
    for (let k = 0; k + 2 < tokens.length; k++) {
        const [a, eq, b] = [tokens[k], tokens[k + 1], tokens[k + 2]];
        if (a.type !== 'ident' || !isPunct(eq, '=')) continue;
        // const r = require;   (not a call: r is an alias)
        if (isIdent(b, 'require') && !isPunct(tokens[k + 3], '(') && !isPunct(tokens[k + 3], '.')) names.add(a.value);
        // const r = createRequire(import.meta.url);   const r = module.createRequire(…);
        if (b.type === 'ident' && factories.has(b.value) && isPunct(tokens[k + 3], '(')) names.add(a.value);
        if (b.type === 'ident' && isPunct(tokens[k + 3], '.') && tokens[k + 4]?.type === 'ident' && factories.has(tokens[k + 4].value)) {
            names.add(a.value);
        }
    }
    return { names, factories };
}

/**
 * Every module specifier in a JavaScript or TypeScript source text.
 *
 * Recognised: `import … from`, `export … from`, `import '…'`, `import(…)`,
 * `require(…)` (and `require?.(…)`, an alias of `require`, a function made by
 * `createRequire`, `module.require(…)`), `require.resolve(…)`,
 * `require.context(…)`, `import.meta.resolve(…)`,
 * `import.meta.webpackContext(…)`, `import.meta.glob(…)`,
 * `new URL(…, import.meta.url)` and `import x = require(…)`.
 *
 * Returns `{ specifiers: [{ specifier, line, kind, computed, chunks, typeOnly }],
 * problems }`. An argument made only of literals joined by `+` is folded to
 * its value. Anything else is `computed: true`, with the static `chunks` it
 * contains.
 */
export function extractSpecifiers(text, { jsx = true } = {}) {
    let lexed = tokenizeSource(text, { jsx });
    if (jsx && lexed.problems.length > 0) {
        // The JSX reading can be wrong where TypeScript puts type parameters at
        // the start of an expression (`type F = <T>(x: T) => T`). If reading
        // the file without JSX reaches the end cleanly, that reading stands.
        const plain = tokenizeSource(text, { jsx: false });
        if (plain.problems.length === 0) lexed = plain;
    }
    const { tokens, problems } = lexed;
    const out = [];
    const typeOnly = typeOnlyDeclarations(tokens);
    const { names: requires, factories } = requireNames(tokens);
    const fromCall = (open, kind, line, typeOnlyCall = false) => {
        const arg = firstArgument(tokens, open);
        if (arg === null || arg.start === arg.end) return;
        const folded = foldTokens(tokens, arg.start, arg.end);
        if (folded !== null) out.push({ specifier: folded, line, kind, computed: false, chunks: [folded], typeOnly: typeOnlyCall });
        else out.push({ specifier: null, line, kind, computed: true, chunks: staticPieces(tokens, arg.start, arg.end), typeOnly: typeOnlyCall });
    };
    // `(`, or `?.(`: the index of the `(` that calls the token before `k`.
    const callAt = (k) => (isPunct(tokens[k], '(') ? k : isPunct(tokens[k], '?.') && isPunct(tokens[k + 1], '(') ? k + 1 : -1);
    const metaCall = (k, method) =>
        isIdent(tokens[k], 'import') && isPunct(tokens[k + 1], '.') && isIdent(tokens[k + 2], 'meta') && isPunct(tokens[k + 3], '.') && isIdent(tokens[k + 4], method);

    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        if (t.type === 'ident' && !isMember(tokens, k)) {
            // import(…), including `typeof import('x')` in a type.
            if (t.value === 'import' && isPunct(tokens[k + 1], '(')) {
                fromCall(k + 1, 'import()', t.line, isIdent(tokens[k - 1], 'typeof'));
                continue;
            }
            for (const [method, kind] of [['resolve', 'import.meta.resolve()'], ['webpackContext', 'import.meta.webpackContext()'], ['glob', 'import.meta.glob()']]) {
                if (metaCall(k, method)) {
                    const open = callAt(k + 5);
                    if (open !== -1) fromCall(open, kind, t.line);
                }
            }
            if (requires.has(t.value)) {
                const open = callAt(k + 1);
                if (open !== -1) {
                    fromCall(open, 'require()', t.line);
                    continue;
                }
                for (const [method, kind] of [['resolve', 'require.resolve()'], ['resolveWeak', 'require.resolve()'], ['context', 'require.context()']]) {
                    if ((isPunct(tokens[k + 1], '.') || isPunct(tokens[k + 1], '?.')) && isIdent(tokens[k + 2], method)) {
                        const methodOpen = callAt(k + 3);
                        if (methodOpen !== -1) fromCall(methodOpen, kind, t.line);
                    }
                }
                continue;
            }
            // createRequire(import.meta.url)('x') and createRequire(…).resolve('x')
            if (factories.has(t.value) && isPunct(tokens[k + 1], '(')) {
                const close = closing(tokens, k + 1);
                if (close !== -1) {
                    const open = callAt(close + 1);
                    if (open !== -1) fromCall(open, 'require()', t.line);
                    else if (isPunct(tokens[close + 1], '.') && isIdent(tokens[close + 2], 'resolve')) {
                        const methodOpen = callAt(close + 3);
                        if (methodOpen !== -1) fromCall(methodOpen, 'require.resolve()', t.line);
                    }
                }
                continue;
            }
            // new URL('…', import.meta.url): an asset or a worker the bundler includes.
            if (t.value === 'new' && isIdent(tokens[k + 1], 'URL') && isPunct(tokens[k + 2], '(')) {
                const arg = firstArgument(tokens, k + 2);
                if (arg !== null && arg.end < arg.close && metaCall(arg.end + 1, 'url')) fromCall(k + 2, 'new URL()', t.line);
                continue;
            }
        }
        // module.require('x')
        if (isIdent(t, 'module') && isPunct(tokens[k + 1], '.') && isIdent(tokens[k + 2], 'require')) {
            const open = callAt(k + 3);
            if (open !== -1) fromCall(open, 'require()', t.line);
            continue;
        }
        if ((t.type !== 'string' && t.type !== 'template') || t.broken) continue;
        const p1 = tokens[k - 1];
        let kind = null;
        if (isIdent(p1, 'from') && !isMember(tokens, k - 1)) kind = 'from';
        else if (isIdent(p1, 'import') && !isMember(tokens, k - 1)) kind = 'import';
        if (kind === null) continue;
        const folded = foldTokens(tokens, k, k + 1);
        if (folded !== null) out.push({ specifier: folded, line: t.line, kind, computed: false, chunks: [folded], typeOnly: typeOnly.has(k) });
        else out.push({ specifier: null, line: t.line, kind, computed: true, chunks: staticPieces(tokens, k, k + 1), typeOnly: typeOnly.has(k) });
    }
    return { specifiers: out, problems };
}

/** Decode CSS escapes (`\` then one to six hex digits and an optional space, or `\` then a character). */
function decodeCssEscapes(text) {
    return text.replace(/\\(?:([0-9a-f]{1,6})[ \t\n]?|([^0-9a-f\n]))/gi, (_m, hex, char) =>
        hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : char,
    );
}

const STYLE_AT_RULES = ['import', 'use', 'forward', 'plugin', 'config', 'reference'];

/**
 * Every module specifier in a stylesheet: `@import`, Sass's `@use` and
 * `@forward`, and Tailwind's `@plugin`, `@config` and `@reference`, quoted or
 * in `url(…)`. Returns `{ specifiers, problems }`; an unterminated comment
 * is a problem.
 */
export function extractStyleSpecifiers(text) {
    const problems = [];
    // Blank out comments (keeping newlines), leaving strings intact.
    let cleaned = '';
    for (let i = 0; i < text.length; ) {
        const c = text[i];
        if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? text.length : end + 2;
            if (end === -1) problems.push({ line: cleaned.split('\n').length, message: 'a block comment is never closed' });
            cleaned += text.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
        } else if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
            cleaned += text.slice(i, j + 1);
            i = j + 1;
        } else {
            cleaned += c;
            i++;
        }
    }
    const specifiers = [];
    const rule = new RegExp(`@(${STYLE_AT_RULES.join('|')})\\s+(?:url\\(\\s*)?(?:(["'])((?:\\\\.|(?!\\2)[^\\\\\\n])*)\\2|([^\\s;'"()]+))`, 'gi');
    for (const match of cleaned.matchAll(rule)) {
        const raw = match[3] ?? match[4];
        const value = decodeCssEscapes(raw);
        const line = cleaned.slice(0, match.index).split('\n').length;
        specifiers.push({ specifier: value, line, kind: `@${match[1].toLowerCase()}`, computed: false, chunks: [value], typeOnly: false });
    }
    return { specifiers, problems };
}

/**
 * The module specifiers in an MDX file's import and export blocks: each run
 * of lines, outside a fenced code block, that starts at the margin with
 * `import` or `export` and continues to the next blank line.
 */
export function extractMdxSpecifiers(text) {
    const lines = text.split('\n');
    const specifiers = [];
    const problems = [];
    let fence = null;
    for (let index = 0; index < lines.length; index++) {
        const lineText = lines[index];
        const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(lineText);
        if (fence !== null) {
            if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            continue;
        }
        if (!/^(?:import|export)\b/.test(lineText)) continue;
        let end = index;
        while (end + 1 < lines.length && lines[end + 1].trim() !== '') end++;
        const block = extractSpecifiers(lines.slice(index, end + 1).join('\n'), { jsx: true });
        for (const s of block.specifiers) specifiers.push({ ...s, line: s.line + index });
        for (const p of block.problems) problems.push({ ...p, line: p.line + index });
        index = end;
    }
    return { specifiers, problems };
}

/** The specifiers of one file, read by the rules its extension calls for. */
export function specifiersOf(text, file) {
    const ext = path.posix.extname(file).toLowerCase();
    if (STYLE_EXTENSIONS.includes(ext)) return extractStyleSpecifiers(text);
    if (MDX_EXTENSIONS.includes(ext)) return extractMdxSpecifiers(text);
    // JSX is legal in .tsx and .jsx, and Next.js accepts it in .js too.
    return extractSpecifiers(text, { jsx: ['.tsx', '.jsx', '.js'].includes(ext) });
}

// ─── Source text: the policy ────────────────────────────────────────────────

/** The package name a bare specifier names, or null for a path, an alias, `#imports`, a URL or a built-in. */
export function packageNameOf(specifier) {
    if (specifier === '' || /^[./#~]/.test(specifier) || /^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('@/')) return null;
    const parts = specifier.split('/');
    if (specifier.startsWith('@')) return parts.length >= 2 && parts[0] !== '@' && parts[1] !== '' ? `${parts[0]}/${parts[1]}` : null;
    return parts[0];
}

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, m.split('/')[0]]));

function isBuiltin(specifier) {
    return specifier.startsWith('node:') || BUILTINS.has(specifier) || BUILTINS.has(specifier.split('/')[0]);
}

/**
 * Whether a path or specifier passes through an open-core `ee` folder: a
 * segment named `ee`, or n8n's convention of `.ee` in a directory name or
 * `.ee.` in a file name.
 */
export function hasEePath(text) {
    // A URL's host (cdn.example.ee) is not a folder.
    const spec = text.replace(/\\/g, '/').split('?')[0].replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
    return /\/ee(?:\/|$)/i.test(spec) || /(?:^|\/)[^/]*\.ee(?:\.[^/]*)?(?:\/|$)/i.test(spec);
}

function safeDecodeURI(text) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

function eeFinding(shown) {
    return {
        code: 'EE_PATH',
        reason: `${shown} goes through an "ee" folder: open-core "ee" code carries a commercial licence (roadmap 2.3, 2.5)`,
    };
}

function deniedFinding(name, shown) {
    return { code: 'DENIED_PACKAGE', reason: `${shown} imports ${name}, which is on the deny list (roadmap 2.5)` };
}

/**
 * The policy findings for one specifier on its own, as `[{ code, reason }]`
 * (empty when it is fine), plus `unchecked` when it is computed and so cannot
 * be fully checked. The specifier is checked as written and percent-decoded,
 * as a bundler or Node's URL resolution would read it.
 */
export function classifySpecifier(entry) {
    const findings = [];
    if (!entry.computed) {
        const shown = JSON.stringify(entry.specifier);
        const forms = [...new Set([entry.specifier, safeDecodeURI(entry.specifier)].map((s) => s.replace(/\\/g, '/')))];
        if (forms.some(hasEePath)) findings.push(eeFinding(shown));
        const denied = forms.map(packageNameOf).find((name) => name !== null && isDeniedPackage(name));
        if (denied) findings.push(deniedFinding(denied, shown));
        return { findings, unchecked: false };
    }
    const chunks = entry.chunks.map((chunk) => safeDecodeURI(chunk.replace(/\\/g, '/')));
    const shown = chunks.length === 0 ? `a ${entry.kind} argument` : `\`${chunks.join('${…}')}\``;
    if (chunks.some((chunk) => /\/ee\//i.test(chunk) || /(?:^|\/)[^/]*\.ee[./]/i.test(chunk)) || /\/ee$/i.test(chunks[chunks.length - 1] ?? '')) {
        findings.push(eeFinding(shown));
    }
    const head = chunks[0] ?? '';
    if (head !== '' && !/^[./#~]/.test(head)) {
        const slashes = head.startsWith('@') ? 2 : 1;
        let cut = -1;
        for (let s = 0, from = 0; s < slashes; s++) {
            cut = head.indexOf('/', from);
            if (cut === -1) break;
            from = cut + 1;
        }
        if (cut !== -1) {
            const name = head.slice(0, cut);
            if (isDeniedPackage(name)) findings.push(deniedFinding(name, shown));
        } else {
            // The package name itself is computed. A prefix pattern can still match.
            const pattern = DENIED_PACKAGES.find((p) => p.endsWith('*') && head.startsWith(p.slice(0, -1)));
            if (pattern) findings.push(deniedFinding(pattern, shown));
        }
    }
    return { findings, unchecked: true };
}

/**
 * Scan one source text on its own: the `ee` and deny-list findings of each
 * specifier, the problems that stopped the lexer, and a notice for each
 * specifier that cannot be computed. `file` picks the reader (JavaScript,
 * stylesheet or MDX) by its extension.
 *
 * Returns `{ failures: [{ line, specifier, kind, code, reason }], notices,
 * specifiers }`.
 */
export function scanSourceText(text, file = 'source.tsx') {
    const failures = [];
    const notices = [];
    const { specifiers, problems } = specifiersOf(text, file);
    for (const problem of problems) {
        failures.push({
            line: problem.line,
            specifier: null,
            kind: 'parse',
            code: 'UNPARSEABLE',
            reason: `${problem.message}, so the scan could not read the rest of the file; the imports after it were not checked`,
        });
    }
    for (const entry of specifiers) {
        const { findings, unchecked } = classifySpecifier(entry);
        for (const finding of findings) {
            failures.push({ line: entry.line, specifier: entry.specifier, kind: entry.kind, code: finding.code, reason: finding.reason });
        }
        if (unchecked) {
            notices.push({ line: entry.line, code: 'COMPUTED_SPECIFIER', message: `a computed ${entry.kind} specifier cannot be checked statically` });
        }
    }
    return { failures, notices, specifiers };
}

// ─── Source files: population and resolution ───────────────────────────────

function gitEnvironment(root) {
    const env = { ...process.env };
    // A git hook exports GIT_DIR and friends; inherited, they would point git
    // at another repository than `root`.
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    env.GIT_CEILING_DIRECTORIES = path.dirname(path.resolve(root));
    return env;
}

const SCANNED_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, ...STYLE_EXTENSIONS, ...MDX_EXTENSIONS]);

/** Whether a repository-relative path is in the import scan's population. */
export function isScannedSourcePath(relative) {
    if (EXCLUDED_SOURCE_PREFIXES.some((prefix) => relative.startsWith(prefix))) return false;
    if (relative.split('/').includes('node_modules')) return false;
    return SCANNED_EXTENSIONS.has(path.posix.extname(relative).toLowerCase());
}

function withoutExtension(relative) {
    const ext = path.posix.extname(relative);
    return ext ? relative.slice(0, -ext.length) : relative;
}

/** The DEV_ONLY_PATHS entry covering a repository-relative path, or null. */
export function devOnlyEntry(relative) {
    return (
        DEV_ONLY_PATHS.find((entry) =>
            entry.path.endsWith('/') ? relative === entry.path.slice(0, -1) || relative.startsWith(entry.path) : relative === entry.path || withoutExtension(relative) === withoutExtension(entry.path),
        ) ?? null
    );
}

/**
 * Every file git lists for the work tree (tracked, plus untracked files
 * .gitignore does not exclude), as sorted repository-relative POSIX paths.
 * Never a directory walk with a skip list. `root` must be the top of a git
 * work tree; there is no fallback.
 */
export function listRepositoryFiles(root) {
    let stdout;
    try {
        stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
            cwd: root,
            env: gitEnvironment(root),
            encoding: 'utf8',
            maxBuffer: 256 * 1024 * 1024,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    } catch (error) {
        const detail = (error.stderr ?? error.message ?? '').toString().trim().split('\n')[0];
        throw new GateError(`git could not list the files in ${root} (${detail}); the source scan needs a git work tree`);
    }
    return [...new Set(stdout.split('\0').filter((p) => p.length > 0))].filter((relative) => fs.existsSync(path.join(root, relative))).sort();
}

/** The files the import scan reads. */
export function listSourceFiles(root) {
    return listRepositoryFiles(root).filter(isScannedSourcePath);
}

/** Parse JSON that may hold comments and trailing commas (tsconfig.json). */
export function parseJsonc(text) {
    let out = '';
    for (let i = 0; i < text.length; ) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end === -1 ? text.length : end + 2;
        } else {
            out += c;
            i++;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Every string a package.json "imports" or "exports" target can resolve to, conditions flattened. */
function targetStrings(target) {
    if (typeof target === 'string') return [target];
    if (Array.isArray(target)) return target.flatMap(targetStrings);
    if (isPlainObject(target)) return Object.values(target).flatMap(targetStrings);
    return [];
}

/** Match a specifier against a pattern with at most one `*`; returns the text `*` stands for, or null. */
function matchPattern(pattern, specifier) {
    const star = pattern.indexOf('*');
    if (star === -1) return pattern === specifier ? '' : null;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.length < prefix.length + suffix.length || !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
    return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/**
 * How the repository resolves specifiers that are neither relative nor a
 * package: tsconfig.json "paths" and each package.json's "imports". Built
 * from the files in `root`.
 */
export function buildAliasResolver(root, repositoryFiles) {
    const tsconfigFile = path.join(root, 'tsconfig.json');
    const paths = [];
    if (fs.existsSync(tsconfigFile)) {
        let tsconfig;
        try {
            tsconfig = parseJsonc(fs.readFileSync(tsconfigFile, 'utf8'));
        } catch (error) {
            throw new GateError(`tsconfig.json cannot be read: ${error.message}`);
        }
        const options = isPlainObject(tsconfig.compilerOptions) ? tsconfig.compilerOptions : {};
        const base = typeof options.baseUrl === 'string' ? options.baseUrl : '.';
        for (const [pattern, targets] of Object.entries(isPlainObject(options.paths) ? options.paths : {})) {
            const list = Array.isArray(targets) ? targets.filter((t) => typeof t === 'string') : [];
            paths.push({ pattern, targets: list.map((t) => path.posix.normalize(path.posix.join(base, t))) });
        }
    }
    const importMaps = [];
    for (const relative of repositoryFiles) {
        if (path.posix.basename(relative) !== 'package.json' || relative.split('/').includes('node_modules')) continue;
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
        } catch {
            continue;
        }
        if (isPlainObject(manifest.imports)) importMaps.push({ dir: path.posix.dirname(relative), imports: manifest.imports });
    }
    // Deepest package first: a file uses the nearest package.json.
    importMaps.sort((a, b) => b.dir.length - a.dir.length);
    return {
        /** Repository-relative targets (or bare specifiers) a `#` or alias specifier names, or null when nothing matches. */
        resolve(specifier, fromFile) {
            if (specifier.startsWith('#')) {
                const owner = importMaps.find((m) => m.dir === '.' || fromFile.startsWith(`${m.dir}/`));
                if (!owner) return null;
                for (const [pattern, target] of Object.entries(owner.imports)) {
                    const star = matchPattern(pattern, specifier);
                    if (star === null) continue;
                    return targetStrings(target).map((t) => {
                        const filled = t.replaceAll('*', star);
                        return filled.startsWith('./') || filled.startsWith('../')
                            ? { path: path.posix.normalize(path.posix.join(owner.dir, filled)) }
                            : { bare: filled };
                    });
                }
                return null;
            }
            for (const { pattern, targets } of paths) {
                const star = matchPattern(pattern, specifier);
                if (star !== null) return targets.map((t) => ({ path: t.replaceAll('*', star) }));
            }
            return null;
        },
    };
}

/**
 * Scan the given repository-relative files under `root`.
 *
 * Besides each file's own findings (`scanSourceText`), this resolves `#`
 * imports and tsconfig aliases and checks what they point at, fails a file
 * that can ship when it imports a DEV_ONLY_PATHS path, and collects every
 * package a file imports by name (`packageImports`, with `shipped` telling
 * whether the importing file can ship) for the dependency check.
 */
export function scanSources(root, files, { resolver = buildAliasResolver(root, files) } = {}) {
    const failures = [];
    const notices = [];
    const packageImports = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const result = scanSourceText(text, file);
        for (const failure of result.failures) failures.push({ file, ...failure });
        for (const notice of result.notices) notices.push({ file, ...notice });
        const shipped = devOnlyEntry(file) === null;
        const declarationFile = /\.d\.[cm]?ts$/.test(file);
        const dir = path.posix.dirname(file);
        const checkPath = (target, entry, via) => {
            const shown = JSON.stringify(entry.specifier);
            // An alias can point into an ee folder its own text does not name.
            if (via !== '' && hasEePath(target) && !hasEePath(safeDecodeURI(entry.specifier))) {
                failures.push({ file, line: entry.line, specifier: entry.specifier, kind: entry.kind, ...eeFinding(`${shown}${via}`) });
            }
            const dev = devOnlyEntry(target);
            if (shipped && dev !== null) {
                failures.push({
                    file,
                    line: entry.line,
                    specifier: entry.specifier,
                    kind: entry.kind,
                    code: 'IMPORTS_DEV_ONLY_PATH',
                    reason: `${shown}${via} reaches ${target}, which is ${dev.reason}; code that can ship may not import it`,
                });
            }
        };
        const addPackage = (specifier, entry, via) => {
            const name = packageNameOf(specifier);
            if (name === null || isBuiltin(specifier)) return;
            if (via && isDeniedPackage(name)) failures.push({ file, line: entry.line, specifier: entry.specifier, kind: entry.kind, ...deniedFinding(name, `${JSON.stringify(entry.specifier)}${via}`) });
            packageImports.push({
                file,
                line: entry.line,
                specifier,
                name,
                shipped: shipped && !entry.typeOnly && !declarationFile,
                // In a stylesheet, `@import "base.css"` may be a relative file.
                style: STYLE_EXTENSIONS.includes(path.posix.extname(file).toLowerCase()),
            });
        };
        for (const entry of result.specifiers) {
            if (entry.computed) continue;
            const specifier = safeDecodeURI(entry.specifier.replace(/\\/g, '/').split('?')[0]);
            if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) && !specifier.startsWith('node:')) continue;
            if (specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
                checkPath(path.posix.normalize(path.posix.join(dir, specifier)), entry, '');
                continue;
            }
            const aliased = resolver.resolve(specifier, file);
            if (aliased !== null) {
                for (const target of aliased) {
                    if (target.path !== undefined) checkPath(target.path, entry, ` (resolved to ${target.path})`);
                    else {
                        if (hasEePath(target.bare)) failures.push({ file, line: entry.line, specifier: entry.specifier, kind: entry.kind, ...eeFinding(`${JSON.stringify(entry.specifier)} (resolved to ${target.bare})`) });
                        addPackage(target.bare, entry, ` (resolved to ${target.bare})`);
                    }
                }
                continue;
            }
            if (specifier.startsWith('#')) {
                failures.push({
                    file,
                    line: entry.line,
                    specifier: entry.specifier,
                    kind: entry.kind,
                    code: 'UNRESOLVED_IMPORT',
                    reason: `${JSON.stringify(entry.specifier)} matches no "imports" entry of the nearest package.json, so what it loads cannot be checked`,
                });
                continue;
            }
            addPackage(specifier, entry, '');
        }
    }
    return { scanned: files.length, files, failures, notices, packageImports };
}

/**
 * Resolve the packages that source files import through the lockfile, the
 * way Node does from each file's directory. A package that a shipped file
 * imports becomes a production root of the dependency walk, whatever its dev
 * flag. Every resolved package is checked against the deny list by its real
 * name, so an alias (`"sheet": "npm:hyperformula@…"`) does not hide one.
 *
 * Returns `{ roots: [{ location, from }], failures }`.
 */
export function resolveImportedPackages(lock, packageImports) {
    const packages = isPlainObject(lock?.packages) ? lock.packages : {};
    const roots = [];
    const failures = [];
    const seen = new Set();
    for (const imported of packageImports) {
        const dir = path.posix.dirname(imported.file);
        const location = resolveFrom(packages, dir === '.' ? '' : dir, imported.name);
        if (location === null) {
            if (imported.shipped && !imported.style && !BUNDLER_PROVIDED_MODULES.includes(imported.name)) {
                failures.push({
                    file: imported.file,
                    line: imported.line,
                    specifier: imported.specifier,
                    kind: 'package',
                    code: 'UNRESOLVED_IMPORT',
                    reason: `${imported.name} is imported by code that can ship but is not in the lockfile, so its licence cannot be checked; add it to package.json and run npm install`,
                });
            }
            continue;
        }
        const entry = packages[location];
        const target = entry.link === true && typeof entry.resolved === 'string' ? entry.resolved : location;
        const realName = packages[target]?.name ?? (target === location ? nameFromLocation(location) : imported.name);
        if (realName !== imported.name && isDeniedPackage(realName)) {
            failures.push({
                file: imported.file,
                line: imported.line,
                specifier: imported.specifier,
                kind: 'package',
                code: 'DENIED_PACKAGE',
                reason: `${JSON.stringify(imported.specifier)} imports ${imported.name}, an alias of ${realName}, which is on the deny list (roadmap 2.5)`,
            });
        }
        if (imported.shipped && !seen.has(location)) {
            seen.add(location);
            roots.push({ location, from: imported.file });
        }
    }
    return { roots, failures };
}

// ─── The gate ───────────────────────────────────────────────────────────────

const SCRIPT_PATH = fileURLToPath(import.meta.url);
/** The repository this copy of the gate lives in. */
export const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function readJson(file, what) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
        throw new GateError(`cannot read ${what} at ${file}: ${error.code ?? error.message}`);
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        throw new GateError(`${what} at ${file} is not valid JSON: ${error.message}`);
    }
}

function installedReader(root) {
    return (location) => {
        const file = path.join(root, location, 'package.json');
        if (!fs.existsSync(file)) return null;
        return readJson(file, 'an installed package manifest');
    };
}

function manifestReader(root) {
    return (location) => {
        const file = path.join(root, location, 'package.json');
        if (!fs.existsSync(file)) return null;
        return readJson(file, location === '' ? 'the root package.json' : `${location}/package.json`);
    };
}

/**
 * Run both checks against the repository at `root`.
 * Throws GateError when the gate cannot run.
 */
export function runGate({ root = DEFAULT_ROOT, exemptionsFile = null } = {}) {
    const absoluteRoot = path.resolve(root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
        throw new GateError(`${absoluteRoot} is not a directory`);
    }
    const lockfileName = LOCKFILE_NAMES.find((name) => fs.existsSync(path.join(absoluteRoot, name))) ?? 'package-lock.json';
    const lock = readJson(path.join(absoluteRoot, lockfileName), 'the lockfile');
    const readManifest = manifestReader(absoluteRoot);
    const rootManifest = readManifest('');
    if (rootManifest === null) throw new GateError(`there is no package.json in ${absoluteRoot}`);
    const exemptionsPath = path.resolve(absoluteRoot, exemptionsFile ?? DEFAULT_EXEMPTIONS_FILE);
    let exemptions = {};
    if (fs.existsSync(exemptionsPath)) exemptions = readJson(exemptionsPath, 'the exemptions file');
    else if (exemptionsFile !== null) throw new GateError(`the exemptions file ${exemptionsPath} does not exist`);

    const repositoryFiles = listRepositoryFiles(absoluteRoot);
    const isWorkspace = workspaceMatcher(rootManifest);
    const diskWorkspaces = repositoryFiles
        .filter((relative) => relative.endsWith('/package.json'))
        .map((relative) => path.posix.dirname(relative))
        .filter(isWorkspace);
    const sourceFiles = repositoryFiles.filter(isScannedSourcePath);
    const sources = scanSources(absoluteRoot, sourceFiles, { resolver: buildAliasResolver(absoluteRoot, repositoryFiles) });
    const imported = resolveImportedPackages(lock, sources.packageImports);
    sources.failures.push(...imported.failures);
    const notices = [];
    if (lockfileName !== 'package-lock.json') {
        notices.push({ code: 'SHRINKWRAP', message: `${lockfileName} is present, so npm installs from it and the gate reads it; package-lock.json is ignored` });
    }
    const dependencies = checkDependencies(lock, {
        root: absoluteRoot,
        exemptions,
        readInstalled: installedReader(absoluteRoot),
        readManifest,
        diskWorkspaces,
        extraRoots: imported.roots,
    });
    dependencies.notices.unshift(...notices);
    const problemCount = dependencies.failures.length + dependencies.exemptionProblems.length + sources.failures.length;
    return {
        ok: problemCount === 0,
        problemCount,
        root: absoluteRoot,
        lockfile: lockfileName,
        exemptionsFile: path.relative(absoluteRoot, exemptionsPath).split(path.sep).join('/'),
        dependencies,
        sources: {
            scanned: sources.scanned,
            files: sources.files,
            shippedFiles: sources.files.filter((f) => devOnlyEntry(f) === null).length,
            failures: sources.failures,
            notices: sources.notices,
            importedPackages: imported.roots.map((r) => r.location),
        },
    };
}

/** The human-readable report. */
export function formatReport(report) {
    const lines = [];
    const { dependencies: deps, sources } = report;
    lines.push(`Licence gate: ${report.ok ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(
        `Production dependencies: ${deps.checked} package(s) checked from ${report.lockfile} (lockfileVersion ${deps.lockfileVersion}); skipped: ${deps.skipped.map((s) => s.name).join(', ')}`,
    );
    for (const f of deps.failures) {
        const id = f.name === null ? f.location || '(root)' : `${f.name}@${f.version}`;
        lines.push(`  FAIL  ${id}  [${f.code}]${f.location && f.name !== null ? `  at ${f.location}` : ''}`);
        if (f.declared !== null) lines.push(`        declares: ${f.declared}`);
        lines.push(`        ${f.reason}`);
        if (f.chain) lines.push(`        reached through: ${f.chain.join(' > ')}`);
    }
    for (const e of deps.exempted) {
        lines.push(`  EXEMPT  ${e.name}@${e.version}  as ${e.licence}  (${e.adr})`);
    }
    if (deps.failures.length === 0) lines.push('  no dependency failures');
    lines.push('');
    lines.push(`Exemptions (${report.exemptionsFile}): ${deps.exempted.length} applied, ${deps.exemptionProblems.length} problem(s)`);
    for (const p of deps.exemptionProblems) lines.push(`  FAIL  ${p.name ?? '(file)'}: ${p.problem}`);
    lines.push('');
    lines.push(
        `Source imports: ${sources.scanned} file(s) scanned, every git-listed source file except ${EXCLUDED_SOURCE_PREFIXES.join(', ')}; ${sources.shippedFiles} can ship, the rest are on DEV_ONLY_PATHS`,
    );
    for (const f of sources.failures) {
        lines.push(`  FAIL  ${f.file}:${f.line}  [${f.code}]  ${f.reason}`);
    }
    if (sources.failures.length === 0) lines.push('  no import failures');
    const notices = [...deps.notices.map((n) => n.message), ...sources.notices.map((n) => `${n.file}:${n.line}: ${n.message}`)];
    if (notices.length > 0) {
        lines.push('');
        lines.push('Notices:');
        for (const message of notices) lines.push(`  - ${message}`);
    }
    lines.push('');
    lines.push(
        report.ok
            ? 'Result: PASS.'
            : `Result: FAIL, ${report.problemCount} problem(s). The policy is at the top of scripts/licence-gate.mjs; exemptions need a reason and an ADR that names the package.`,
    );
    return `${lines.join('\n')}\n`;
}

const USAGE = `Usage: node scripts/licence-gate.mjs [--json] [--root <dir>] [--exemptions <file>]

  --json               print the report as JSON
  --root <dir>         the repository to check (default: the one holding this script)
  --exemptions <file>  the exemptions file, relative to the root (default: ${DEFAULT_EXEMPTIONS_FILE})

Exit status: 0 pass, 1 policy problems found, 2 the gate could not run.
`;

function parseArgs(argv) {
    const options = { json: false, root: null, exemptions: null, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const eq = arg.indexOf('=');
        const flag = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg;
        if (flag === '--json' && eq === -1) options.json = true;
        else if (flag === '--help' || flag === '-h') options.help = true;
        else if (flag === '--root' || flag === '--exemptions') {
            const value = eq !== -1 ? arg.slice(eq + 1) : argv[++i];
            if (value === undefined || value === '') throw new GateError(`${flag} needs a value`);
            options[flag.slice(2)] = value;
        } else throw new GateError(`unknown argument "${arg}"`);
    }
    return options;
}

/** Run the CLI. Returns the exit status. */
export function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
    const cannotRun = (message, json, usage) => {
        if (json) io.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
        io.stderr.write(`licence gate: cannot run: ${message}\n${usage ? `\n${USAGE}` : ''}`);
        return 2;
    };
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        if (!(error instanceof GateError)) throw error;
        return cannotRun(error.message, argv.includes('--json'), true);
    }
    if (options.help) {
        io.stdout.write(USAGE);
        return 0;
    }
    try {
        const report = runGate({ root: options.root ?? DEFAULT_ROOT, exemptionsFile: options.exemptions });
        io.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
        return report.ok ? 0 : 1;
    } catch (error) {
        if (!(error instanceof GateError)) throw error;
        return cannotRun(error.message, options.json, false);
    }
}

function invokedDirectly() {
    if (!process.argv[1]) return false;
    try {
        return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(SCRIPT_PATH);
    } catch {
        return false;
    }
}

if (invokedDirectly()) process.exitCode = main();
