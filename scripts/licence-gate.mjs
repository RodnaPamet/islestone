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
 *    its reason and the ADR that decided it.
 * 2. No source file under src/, packages/, scripts/ (or a source file at the
 *    repository root, such as next.config.ts) imports from an open-core `ee`
 *    folder or from a deny-listed package (roadmap 2.3 and 2.5).
 *
 * Exit status: 0 when both checks pass, 1 when either finds a problem, 2 when
 * the gate could not run (no lockfile, an unreadable exemptions file, not a
 * git work tree, a bad argument). Every non-zero exit says why.
 *
 * No dependencies: only Node's standard library, so the gate cannot be
 * weakened by the tree it checks.
 *
 * Which packages are "production"
 * -------------------------------
 * The population comes from package-lock.json (lockfileVersion 2 or 3), not
 * from node_modules. A lockfile lists every platform's optional binaries, so
 * the answer is the same on a Mac, on Linux CI and in the production image;
 * node_modules holds only the local platform's.
 *
 * - An entry flagged `"dev": true` is reachable only through devDependencies
 *   and is not production. That includes `"dev": true, "optional": true`, an
 *   optional dependency of a dev dependency.
 * - An entry flagged `"devOptional": true` IS production. npm sets that flag
 *   on a package that is both a dev dependency and reachable through an
 *   optional (or optional-peer) edge of a production package, and
 *   `npm ci --omit=dev` installs it: npm drops a devOptional package only when
 *   dev AND optional dependencies are both omitted. Next.js's optional peer
 *   on @playwright/test is why playwright shows up here. Leaving these out
 *   would check less than the production install contains.
 * - An entry flagged `"optional": true` (platform binaries such as
 *   @next/swc-* and sharp's @img/*) is production.
 *
 * npm's flags are not taken on trust. The gate also walks the lockfile itself,
 * from the root's dependencies, optionalDependencies and peerDependencies and
 * from every workspace, resolving each edge the way Node resolves a bare
 * specifier (nearest node_modules first). It checks the UNION of the two sets,
 * so a hand-edited or mis-computed `"dev": true` cannot hide a package that
 * production reaches; any disagreement is printed as a notice.
 *
 * Licence declarations
 * --------------------
 * The lockfile records each manifest's `license` (an object's `type`; a legacy
 * `licenses` array is not recorded at all). When an entry has no licence, the
 * gate reads node_modules/<location>/package.json, provided the installed
 * version matches the lockfile. When both exist, they must agree.
 *
 * - SPDX identifiers match case-insensitively (SPDX 2.3 Annex D); the
 *   operators AND, OR and WITH must be upper case.
 * - `A OR B` passes if either branch passes; `A AND B` only if both do.
 *   AND binds tighter than OR. Parentheses group.
 * - `L WITH exception` passes if L passes: an SPDX exception only adds
 *   permissions. `L+` ("or later") passes if L passes, since L may be chosen.
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
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Policy ─────────────────────────────────────────────────────────────────

/**
 * Licences a production dependency may carry, as canonical SPDX identifiers.
 * Roadmap 0.3 names MIT, Apache-2.0, BSD, ISC, MPL-2.0 (unmodified use) and
 * PostgreSQL. The rest are permissive or public-domain dedications with no
 * conditions beyond attribution: MIT-0, 0BSD, BlueOak-1.0.0, CC0-1.0,
 * Unlicense, Python-2.0. "BSD" means the 2- and 3-clause forms only; the
 * 4-clause advertising clause is not on the list.
 */
export const ALLOWED_LICENCES = Object.freeze([
    'MIT',
    'MIT-0',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    '0BSD',
    'BlueOak-1.0.0',
    'CC0-1.0',
    'Unlicense',
    'Python-2.0',
    'PostgreSQL',
    'MPL-2.0',
]);

/** Allowed licences whose condition the report repeats on every run. */
export const NOTICE_LICENCES = Object.freeze({
    'MPL-2.0':
        'allowed for unmodified use only. MPL-2.0 is file-level copyleft: a changed MPL file must be published under MPL-2.0, so patch it upstream instead.',
});

/**
 * Licences allowed for named data packages only.
 *
 * CC-BY-4.0 is a licence for works such as databases and documents, not for
 * software; it asks for attribution and has no copyleft. caniuse-lite is the
 * caniuse.com browser-support database with a small decoder, reached through
 * `next` (and browserslist) to pick build targets. It is data, so CC-BY-4.0
 * fits it. The same licence on a code package would be a mistake worth a
 * person's attention, so it passes only for the packages listed here. Add a
 * package after checking that it ships data, and say so in the pull request.
 */
export const DATA_ONLY_LICENCES = Object.freeze({
    'CC-BY-4.0': Object.freeze(['caniuse-lite']),
});

/**
 * Packages that may not be imported or installed in production at all,
 * whatever their declared licence says (roadmap 2.5): n8n (Sustainable Use),
 * Windmill (AGPL with a no-embed clause), @liveblocks/server (AGPL),
 * HyperFormula (GPL), Handsontable (commercial), planby (all rights
 * reserved), BlockNote's xl-* packages (GPL or paid). A trailing `*` matches
 * any package name with that prefix. An exemption cannot lift a deny-listed
 * package; removing one is a reviewed change to this list.
 */
export const DENIED_PACKAGES = Object.freeze([
    'n8n',
    'windmill',
    '@liveblocks/server',
    'hyperformula',
    'handsontable',
    'planby',
    '@blocknote/xl-*',
]);

/** Top-level directories whose source files the import scan reads. */
export const SCANNED_DIRECTORIES = Object.freeze(['src', 'packages', 'scripts']);

/**
 * Source files the import scan reads. Files at the repository root are read
 * too: next.config.ts runs in every production build and start.
 */
export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Never scanned, even if a future change widened the scanned directories:
 * the gate's own fixtures, which violate the policy on purpose.
 */
export const EXCLUDED_SOURCE_PREFIXES = Object.freeze(['tests/fixtures/licence-gate/']);

/** Where the exemptions live, relative to the repository root. */
export const DEFAULT_EXEMPTIONS_FILE = 'scripts/licence-exemptions.json';

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

const KNOWN_IDS = new Map(
    [...ALLOWED_LICENCES, ...Object.keys(DATA_ONLY_LICENCES)].map((id) => [id.toLowerCase(), id]),
);
const ALLOWED_SET = new Set(ALLOWED_LICENCES);
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
        if (exception === undefined || OPERATORS.has(exception) || !ID_STRING.test(exception)) {
            throw new SpdxSyntaxError('WITH must be followed by an exception identifier');
        }
        if (licence.type !== 'licence' || licence.ref) {
            throw new SpdxSyntaxError('WITH applies to a single SPDX licence identifier');
        }
        pos++;
        return { type: 'with', licence, exception };
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

function isConditional(id) {
    return id in NOTICE_LICENCES || id in DATA_ONLY_LICENCES;
}

/**
 * Judge a parsed expression against the allowlist for one package.
 * Returns `{ allowed, relied, problems }`: `relied` lists the licence ids
 * the passing reading depends on (for an OR, the branch with the fewest
 * conditional licences), `problems` says why a failing reading fails.
 */
export function evaluateExpression(ast, packageName) {
    switch (ast.type) {
        case 'licence': {
            const shown = ast.orLater ? `${ast.id}+` : ast.id;
            if (ast.ref) {
                return { allowed: false, relied: [], problems: [`${shown} is a custom licence reference, not on the allowlist`] };
            }
            if (ALLOWED_SET.has(ast.id)) return { allowed: true, relied: [ast.id], problems: [] };
            const dataOnly = DATA_ONLY_LICENCES[ast.id];
            if (dataOnly) {
                if (dataOnly.includes(packageName)) return { allowed: true, relied: [ast.id], problems: [] };
                return {
                    allowed: false,
                    relied: [],
                    problems: [
                        `${shown} is allowed only for the data-only packages listed in DATA_ONLY_LICENCES (${dataOnly.join(', ')}), and ${packageName} is not one`,
                    ],
                };
            }
            return { allowed: false, relied: [], problems: [`${shown} is not on the allowlist`] };
        }
        case 'with': {
            // An SPDX exception only adds permissions to its licence.
            const result = evaluateExpression(ast.licence, packageName);
            return result.allowed ? result : { ...result, problems: result.problems.map((p) => `${p} (with ${ast.exception})`) };
        }
        case 'and': {
            const results = ast.items.map((item) => evaluateExpression(item, packageName));
            const allowed = results.every((r) => r.allowed);
            return {
                allowed,
                relied: allowed ? [...new Set(results.flatMap((r) => r.relied))] : [],
                problems: results.flatMap((r) => r.problems),
            };
        }
        case 'or': {
            const results = ast.items.map((item) => evaluateExpression(item, packageName));
            const passing = results.filter((r) => r.allowed);
            if (passing.length === 0) {
                return {
                    allowed: false,
                    relied: [],
                    problems: [`no alternative is allowed: ${results.flatMap((r) => r.problems).join('; ')}`],
                };
            }
            const cost = (r) => r.relied.filter(isConditional).length;
            const best = passing.reduce((a, b) => (cost(b) < cost(a) ? b : a));
            return { allowed: true, relied: best.relied, problems: [] };
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
 * must exist. `version`, when given, binds the exemption to that exact
 * version, so an upgrade has to be re-read before it passes.
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
    if (pkg.declaration.kind === 'spdx' && exemption.licenceKey !== pkg.declaration.key) {
        return `it records "${exemption.licence}" but the package declares "${pkg.declaration.expression}"`;
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
            return { code: 'NOT_ALLOWED', reason: evaluation.problems.join('; ') };
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
        evaluation = evaluateExpression(pkg.declaration.ast, pkg.name);
        if (evaluation.allowed) {
            const notices = [];
            for (const id of evaluation.relied) {
                if (id in NOTICE_LICENCES) notices.push({ code: `NOTICE_${id}`, message: `${id}: ${NOTICE_LICENCES[id]}` });
                if (id in DATA_ONLY_LICENCES) notices.push({ code: `DATA_ONLY_${id}`, message: `${id}: allowed as a data-only package` });
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

// ─── The production tree, from the lockfile ─────────────────────────────────

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
    return new RegExp(`^${source.replace(/\/+$/, '')}$`);
}

function workspaceMatcher(rootEntry) {
    const declared = Array.isArray(rootEntry.workspaces)
        ? rootEntry.workspaces
        : isPlainObject(rootEntry.workspaces) && Array.isArray(rootEntry.workspaces.packages)
          ? rootEntry.workspaces.packages
          : [];
    const include = declared.filter((p) => typeof p === 'string' && !p.startsWith('!')).map(globToRegExp);
    const exclude = declared.filter((p) => typeof p === 'string' && p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));
    return (location) =>
        location !== '' &&
        !isNodeModulesPath(location) &&
        include.some((re) => re.test(location)) &&
        !exclude.some((re) => re.test(location));
}

/** Resolve a bare dependency name from a lockfile location, nearest node_modules first. */
function resolveFrom(packages, from, name) {
    const segments = from === '' ? [] : from.split('/');
    for (let i = segments.length; i >= 0; i--) {
        const prefix = segments.slice(0, i);
        if (prefix.length > 0 && prefix[prefix.length - 1] === 'node_modules') continue;
        const candidate = [...prefix, 'node_modules', name].join('/');
        if (isPlainObject(packages[candidate])) return candidate;
    }
    return null;
}

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

/**
 * The production packages a lockfile describes.
 *
 * Returns `{ lockfileVersion, packages: [{ name, version, location, declaration,
 * licenceSource, chain, mismatch }], skipped, notices, problems }` where
 * `problems` are tree-level failures (an unresolved production dependency,
 * a broken link, a lockfile licence the installed manifest contradicts).
 *
 * `readInstalled(location)` returns the installed package.json at that
 * location, or null.
 */
export function listProductionPackages(lock, { readInstalled = () => null } = {}) {
    if (!isPlainObject(lock)) throw new GateError('the lockfile is not a JSON object');
    if (![2, 3].includes(lock.lockfileVersion) || !isPlainObject(lock.packages)) {
        throw new GateError(
            `lockfileVersion ${JSON.stringify(lock.lockfileVersion)} has no "packages" map; regenerate package-lock.json with npm 7 or later`,
        );
    }
    const packages = lock.packages;
    const rootEntry = packages[''];
    if (!isPlainObject(rootEntry)) throw new GateError('the lockfile has no root entry ("")');
    const isWorkspace = workspaceMatcher(rootEntry);
    const notices = [];
    const problems = [];

    // 1. Walk the graph from the root and every workspace.
    const parentOf = new Map();
    const queue = [];
    const reach = (location, parent) => {
        if (parentOf.has(location)) return;
        parentOf.set(location, parent);
        queue.push(location);
    };
    reach('', null);
    for (const location of Object.keys(packages)) if (isWorkspace(location)) reach(location, '');
    while (queue.length > 0) {
        const from = queue.shift();
        const entry = packages[from];
        for (const edge of edgesOf(entry)) {
            let target = resolveFrom(packages, from, edge.name);
            if (target !== null && packages[target].link === true) {
                const resolved = typeof packages[target].resolved === 'string' ? packages[target].resolved : null;
                if (resolved === null || !isPlainObject(packages[resolved])) {
                    problems.push({
                        code: 'BROKEN_LINK',
                        location: target,
                        reason: `${target} is a link to ${JSON.stringify(resolved)}, which the lockfile does not describe`,
                    });
                    continue;
                }
                target = resolved;
            }
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

    // 2. npm's own flags, then the union of both views.
    const flagged = Object.keys(packages).filter(
        (location) => location !== '' && isPlainObject(packages[location]) && packages[location].link !== true && packages[location].dev !== true,
    );
    const candidates = new Set([...flagged, ...parentOf.keys()]);
    candidates.delete('');
    const devButReached = [...parentOf.keys()].filter((location) => location !== '' && packages[location].dev === true);
    if (devButReached.length > 0) {
        notices.push({
            code: 'DEV_FLAG_CONTRADICTED',
            message: `the lockfile flags ${devButReached.length} package(s) dev-only that production reaches; checked anyway: ${devButReached.join(', ')}`,
        });
    }
    const notReached = flagged.filter((location) => !parentOf.has(location));
    if (notReached.length > 0) {
        notices.push({
            code: 'FLAGGED_NOT_REACHED',
            message: `${notReached.length} non-dev lockfile entr(ies) are not reachable from the root; checked anyway: ${notReached.join(', ')}`,
        });
    }

    const nameAt = (location) => (location === '' ? '(root)' : (packages[location].name ?? nameFromLocation(location)));
    const chainTo = (location) => {
        if (!parentOf.has(location)) return null;
        const names = [];
        for (let at = location; at !== null && at !== ''; at = parentOf.get(at)) names.unshift(nameAt(at));
        return names;
    };

    // 3. Read each candidate's licence.
    const result = [];
    const skipped = [{ name: rootEntry.name ?? '(root)', location: '', why: 'the root package (Islestone itself)' }];
    let staleInstalls = 0;
    for (const location of [...candidates].sort()) {
        const entry = packages[location];
        const name = nameAt(location);
        const version = typeof entry.version === 'string' ? entry.version : null;
        if (isWorkspace(location) && (!present(entry.license) || entry.license === rootEntry.license)) {
            skipped.push({ name, location, why: 'a workspace package with the root licence (Islestone itself)' });
            continue;
        }
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
        result.push({ name, version, location, declaration, licenceSource, chain: chainTo(location), mismatch, workspace: isWorkspace(location) });
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
 * exemptions. Returns the dependency half of the report.
 */
export function checkDependencies(lock, { root, exemptions: rawExemptions = {}, readInstalled = () => null } = {}) {
    const tree = listProductionPackages(lock, { readInstalled });
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

// ─── Source imports ─────────────────────────────────────────────────────────

const REGEX_AFTER_WORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const IDENT_START = /[A-Za-z_$\u0080-￿]/;
const IDENT_PART = /[\w$\u0080-￿]/;

/**
 * A small JavaScript and TypeScript lexer: enough to tell an import
 * specifier from the same text in a comment, a regular expression or an
 * unrelated string. It skips comments, reads strings, template literals
 * (with `${…}` nesting) and regular-expression literals (by the usual
 * previous-token rule), and emits identifiers, punctuation, strings and
 * templates with their line numbers. An unterminated string or regular
 * expression ends at its line, so a misread (an apostrophe in JSX text, say)
 * cannot swallow the rest of the file.
 */
export function tokenizeSource(text) {
    const tokens = [];
    const stack = [];
    let i = 0;
    let line = 1;
    let last = null;
    const n = text.length;
    const emit = (token) => {
        tokens.push(token);
        last = token;
    };
    const regexAllowed = () => {
        if (last === null) return true;
        if (last.type === 'punct') return last.value !== ')' && last.value !== ']';
        if (last.type === 'ident') return REGEX_AFTER_WORDS.has(last.value);
        return false;
    };
    // Reads template text from `i` until its end or the next `${`.
    const readTemplate = (token) => {
        let chunk = '';
        while (i < n) {
            const c = text[i];
            if (c === '\\') {
                chunk += text[i + 1] ?? '';
                if (text[i + 1] === '\n') line++;
                i += 2;
            } else if (c === '`') {
                token.chunks.push(chunk);
                i++;
                last = token;
                return;
            } else if (c === '$' && text[i + 1] === '{') {
                token.chunks.push(chunk);
                token.substitutions++;
                stack.push({ kind: 'template', token });
                i += 2;
                last = { type: 'punct', value: '${' };
                return;
            } else {
                if (c === '\n') line++;
                chunk += c;
                i++;
            }
        }
        token.chunks.push(chunk);
        token.broken = true;
    };

    if (text.startsWith('#!')) {
        while (i < n && text[i] !== '\n') i++;
    }
    while (i < n) {
        const c = text[i];
        if (c === '\n') {
            line++;
            i++;
        } else if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') {
            i++;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? n : end + 2;
            for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
            i = stop;
        } else if (c === "'" || c === '"') {
            const startLine = line;
            let value = '';
            let j = i + 1;
            let broken = true;
            while (j < n) {
                const d = text[j];
                if (d === '\\') {
                    if (text[j + 1] === '\n') line++;
                    value += text[j + 1] ?? '';
                    j += 2;
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
            const token = { type: 'template', chunks: [], substitutions: 0, line, broken: false };
            emit(token);
            i++;
            readTemplate(token);
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
        } else if (IDENT_START.test(c)) {
            let j = i + 1;
            while (j < n && IDENT_PART.test(text[j])) j++;
            emit({ type: 'ident', value: text.slice(i, j), line });
            i = j;
        } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
            let j = i + 1;
            while (j < n && /[\w.]/.test(text[j])) j++;
            emit({ type: 'number', value: text.slice(i, j), line });
            i = j;
        } else if (c === '{') {
            stack.push({ kind: 'brace' });
            emit({ type: 'punct', value: '{', line });
            i++;
        } else if (c === '}') {
            const top = stack.pop();
            i++;
            if (top && top.kind === 'template') readTemplate(top.token);
            else emit({ type: 'punct', value: '}', line });
        } else {
            emit({ type: 'punct', value: c, line });
            i++;
        }
    }
    return tokens;
}

const isIdent = (token, value) => token !== undefined && token.type === 'ident' && token.value === value;
const isPunct = (token, value) => token !== undefined && token.type === 'punct' && token.value === value;

/**
 * Every module specifier in a source text: `import … from`, `export … from`,
 * `import '…'`, `import(…)`, `require(…)`, `require.resolve(…)`,
 * `import.meta.resolve(…)` and `import x = require(…)`.
 *
 * Returns `[{ specifier, line, kind, computed, chunks }]`. A template with
 * substitutions is `computed: true` with its static `chunks`; a call whose
 * argument is not a literal at all is `computed: true` with no chunks.
 */
export function extractSpecifiers(text) {
    const tokens = tokenizeSource(text);
    const out = [];
    const member = (k) => isPunct(tokens[k - 1], '.');
    for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        // A call whose argument is not a literal.
        if ((isIdent(t, 'import') || isIdent(t, 'require')) && !member(k) && isPunct(tokens[k + 1], '(')) {
            const arg = tokens[k + 2];
            if (arg !== undefined && arg.type !== 'string' && arg.type !== 'template' && !isPunct(arg, ')')) {
                out.push({ specifier: null, line: t.line, kind: `${t.value}()`, computed: true, chunks: [] });
            }
            continue;
        }
        if ((t.type !== 'string' && t.type !== 'template') || t.broken) continue;
        const [p1, p2, p3, p4, p5, p6] = [tokens[k - 1], tokens[k - 2], tokens[k - 3], tokens[k - 4], tokens[k - 5], tokens[k - 6]];
        let kind = null;
        if (isIdent(p1, 'from') && !member(k - 1)) kind = 'from';
        else if (isIdent(p1, 'import') && !member(k - 1)) kind = 'import';
        else if (isPunct(p1, '(')) {
            if (isIdent(p2, 'import') && !member(k - 2)) kind = 'import()';
            else if (isIdent(p2, 'require') && !member(k - 2)) kind = 'require()';
            else if (isIdent(p2, 'resolve') && isPunct(p3, '.') && isIdent(p4, 'require')) kind = 'require.resolve()';
            else if (isIdent(p2, 'resolve') && isPunct(p3, '.') && isIdent(p4, 'meta') && isPunct(p5, '.') && isIdent(p6, 'import')) {
                kind = 'import.meta.resolve()';
            }
        }
        if (kind === null) continue;
        if (t.type === 'string') out.push({ specifier: t.value, line: t.line, kind, computed: false, chunks: [t.value] });
        else if (t.substitutions === 0) out.push({ specifier: t.chunks[0], line: t.line, kind, computed: false, chunks: t.chunks });
        else out.push({ specifier: null, line: t.line, kind, computed: true, chunks: t.chunks });
    }
    return out;
}

function packageNameOf(specifier) {
    if (specifier === '' || /^[./#]/.test(specifier) || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
    const parts = specifier.split('/');
    if (specifier.startsWith('@')) return parts.length >= 2 && parts[1] !== '' ? `${parts[0]}/${parts[1]}` : null;
    return parts[0];
}

function eeFinding(shown) {
    return {
        code: 'EE_PATH',
        reason: `${shown} has an /ee path segment: open-core "ee" folders carry a commercial licence (roadmap 2.3, 2.5)`,
    };
}

function deniedFinding(name, shown) {
    return { code: 'DENIED_PACKAGE', reason: `${shown} imports ${name}, which is on the deny list (roadmap 2.5)` };
}

/**
 * The policy findings for one specifier, as `[{ code, reason }]` (empty when
 * it is fine), plus `unchecked` when a computed specifier's package cannot be
 * known statically.
 */
export function classifySpecifier(entry) {
    const findings = [];
    if (!entry.computed) {
        const spec = entry.specifier.replace(/\\/g, '/').split('?')[0];
        const shown = JSON.stringify(entry.specifier);
        if (/\/ee(?:\/|$)/i.test(spec)) findings.push(eeFinding(shown));
        const name = packageNameOf(spec);
        if (name !== null && isDeniedPackage(name)) findings.push(deniedFinding(name, shown));
        return { findings, unchecked: false };
    }
    const chunks = entry.chunks.map((chunk) => chunk.replace(/\\/g, '/'));
    if (chunks.length === 0) return { findings, unchecked: true };
    const shown = `\`${chunks.join('${…}')}\``;
    const lastIndex = chunks.length - 1;
    if (chunks.some((chunk, idx) => /\/ee\//i.test(chunk) || (idx === lastIndex && /\/ee$/i.test(chunk.split('?')[0])))) {
        findings.push(eeFinding(shown));
    }
    const head = chunks[0];
    if (head === '') return { findings, unchecked: true };
    if (/^[./#]/.test(head) || /^[a-z][a-z0-9+.-]*:/i.test(head)) return { findings, unchecked: false };
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
        return { findings, unchecked: false };
    }
    // The package name itself is computed. A prefix pattern can still match.
    for (const pattern of DENIED_PACKAGES) {
        if (pattern.endsWith('*') && head.startsWith(pattern.slice(0, -1))) {
            findings.push(deniedFinding(pattern, shown));
            return { findings, unchecked: false };
        }
    }
    return { findings, unchecked: true };
}

/** Scan one source text. Returns `{ failures: [{ line, specifier, kind, code, reason }], notices }`. */
export function scanSourceText(text) {
    const failures = [];
    const notices = [];
    for (const entry of extractSpecifiers(text)) {
        const { findings, unchecked } = classifySpecifier(entry);
        for (const finding of findings) {
            failures.push({ line: entry.line, specifier: entry.specifier, kind: entry.kind, code: finding.code, reason: finding.reason });
        }
        if (unchecked) {
            notices.push({ line: entry.line, code: 'COMPUTED_SPECIFIER', message: `a computed ${entry.kind} specifier cannot be checked statically` });
        }
    }
    return { failures, notices };
}

function gitEnvironment(root) {
    const env = { ...process.env };
    // A git hook exports GIT_DIR and friends; inherited, they would point git
    // at another repository than `root`.
    for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
    env.GIT_CEILING_DIRECTORIES = path.dirname(path.resolve(root));
    return env;
}

/** Whether a repository-relative path is in the import scan's population. */
export function isScannedSourcePath(relative) {
    if (EXCLUDED_SOURCE_PREFIXES.some((prefix) => relative.startsWith(prefix))) return false;
    if (!SOURCE_EXTENSIONS.includes(path.posix.extname(relative))) return false;
    const slash = relative.indexOf('/');
    return slash === -1 || SCANNED_DIRECTORIES.includes(relative.slice(0, slash));
}

/**
 * The files the import scan reads, as sorted repository-relative POSIX paths.
 * The population comes from git (tracked files plus untracked files that
 * .gitignore does not exclude), never from a directory walk with a skip
 * list. `root` must be the top of a git work tree; there is no fallback.
 */
export function listSourceFiles(root) {
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
    return [...new Set(stdout.split('\0').filter((p) => p.length > 0))]
        .filter(isScannedSourcePath)
        .filter((relative) => fs.existsSync(path.join(root, relative)))
        .sort();
}

/** Scan the given repository-relative files under `root`. */
export function scanSources(root, files) {
    const failures = [];
    const notices = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const result = scanSourceText(text);
        for (const failure of result.failures) failures.push({ file, ...failure });
        for (const notice of result.notices) notices.push({ file, ...notice });
    }
    return { scanned: files.length, files, failures, notices };
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

/**
 * Run both checks against the repository at `root`.
 * Throws GateError when the gate cannot run.
 */
export function runGate({ root = DEFAULT_ROOT, exemptionsFile = null } = {}) {
    const absoluteRoot = path.resolve(root);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
        throw new GateError(`${absoluteRoot} is not a directory`);
    }
    const lock = readJson(path.join(absoluteRoot, 'package-lock.json'), 'the lockfile');
    const exemptionsPath = path.resolve(absoluteRoot, exemptionsFile ?? DEFAULT_EXEMPTIONS_FILE);
    let exemptions = {};
    if (fs.existsSync(exemptionsPath)) exemptions = readJson(exemptionsPath, 'the exemptions file');
    else if (exemptionsFile !== null) throw new GateError(`the exemptions file ${exemptionsPath} does not exist`);
    const dependencies = checkDependencies(lock, { root: absoluteRoot, exemptions, readInstalled: installedReader(absoluteRoot) });
    const sources = scanSources(absoluteRoot, listSourceFiles(absoluteRoot));
    const problemCount = dependencies.failures.length + dependencies.exemptionProblems.length + sources.failures.length;
    return {
        ok: problemCount === 0,
        problemCount,
        root: absoluteRoot,
        exemptionsFile: path.relative(absoluteRoot, exemptionsPath).split(path.sep).join('/'),
        dependencies,
        sources,
    };
}

/** The human-readable report. */
export function formatReport(report) {
    const lines = [];
    const { dependencies: deps, sources } = report;
    lines.push(`Licence gate: ${report.ok ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(
        `Production dependencies: ${deps.checked} package(s) checked from package-lock.json (lockfileVersion ${deps.lockfileVersion}); skipped: ${deps.skipped.map((s) => s.name).join(', ')}`,
    );
    for (const f of deps.failures) {
        const id = f.name === null ? f.location : `${f.name}@${f.version}`;
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
        `Source imports: ${sources.scanned} file(s) scanned (${SCANNED_DIRECTORIES.map((d) => `${d}/`).join(', ')} and source files at the root)`,
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
            : `Result: FAIL, ${report.problemCount} problem(s). The policy is at the top of scripts/licence-gate.mjs; exemptions need a reason and an ADR.`,
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
