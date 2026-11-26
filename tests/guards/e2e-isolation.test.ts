/**
 * End-to-end isolation (Hardening H2g, owner decision 180;
 * docs/porting/maps/H2.md part 7). Three rules over the Playwright suite, each
 * a way for one spec to depend on another that `fullyParallel` and a single
 * retry would hide:
 *
 *   1. **No cross-test cascade.** A top-level (module- or describe-scoped)
 *      mutable binding written inside one `test()` and read inside another
 *      fails:
 *
 *        ```ts
 *        let resourceId: string;
 *        test('A creates it', async () => { resourceId = await createThing(); });
 *        test('B uses it', async () => { await page.goto(`/x/${resourceId}`); });
 *        ```
 *
 *      When A fails, B and every later reader fail with it, and under
 *      `fullyParallel` B may run first. Create the resource inside the test
 *      that needs it (or in a `beforeEach`), or collapse the steps into one
 *      `test()` with `test.step(...)`.
 *   2. **Signed-in specs use the per-test workspace.** A spec that calls
 *      `signInAs`, `goto('/t/…')` (or `safeGoto`) or sends a request to
 *      `/api/t/…` imports `test` from `./fixtures` (`isolatedTenant`,
 *      `authedPage`), never from `@playwright/test`. Islestone has no seeded
 *      workspace: a spec that reaches a workspace without the fixture would be
 *      reaching one another spec made.
 *   3. **The server keeps the bypass.** Every spec reaches the Playwright
 *      server from the one loopback address, and the rate limits are keyed by
 *      IP; `AUTH_TEST_MODE=1` (with the `NEXT_TEST_MODE=1` that lets a
 *      production build accept it) is what keeps the specs from sharing one
 *      budget and failing by order. While the base URL is loopback, the
 *      webServer must set both.
 *
 * Copied from inflect-compliance `tests/guards/e2e-isolation.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (BUSL-1.1) and edited: the
 * population comes from git (`gitFiles()`), not a directory walk; the
 * cascade detector is rewritten on the TypeScript AST and its symbols, so a
 * test-local binding that shares a name with a top-level one, a shorthand
 * property and a destructuring write are judged by the binding they name, not
 * by spelling; the shared-seed allowlist is replaced by rule 2 (Islestone has
 * no seeded workspace); rules 3 and the nightly run's check are new; every
 * detector proves itself on a planted repository. `BASELINE` is empty.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as ts from 'typescript';

import { isRateLimitBypassed } from '@/lib/security/rate-limit-middleware';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

/**
 * Specs that still break a rule, each with a written reason. EMPTY: H2g
 * cleared every case. Adding an entry needs a reviewed reason; an entry whose
 * spec no longer offends fails the stale check.
 */
const BASELINE: ReadonlyArray<{ file: string; rule: 'cascade' | 'fixture'; reason: string }> = [];

const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'fail']);
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']);

// ─── Parsing ───────────────────────────────────────────────────────────────

interface Parsed {
    sf: ts.SourceFile;
    checker: ts.TypeChecker;
}

/** One file as a program of its own (no lib, no imports followed): enough for local symbols. */
function parse(fileName: string, text: string): Parsed {
    const options: ts.CompilerOptions = { noLib: true, noResolve: true, allowJs: false, target: ts.ScriptTarget.Latest, types: [] };
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const host: ts.CompilerHost = {
        getSourceFile: (name) => (name === fileName ? sf : undefined),
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => undefined,
        getCurrentDirectory: () => '/',
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => name === fileName,
        readFile: (name) => (name === fileName ? text : undefined),
    };
    const program = ts.createProgram({ rootNames: [fileName], options, host });
    return { sf: program.getSourceFile(fileName) ?? sf, checker: program.getTypeChecker() };
}

function readSpec(root: string, rel: string): Parsed {
    return parse(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
}

function specFiles(root: string): string[] {
    return gitFiles(root).filter((rel) => /^tests\/e2e\/.+\.spec\.ts$/.test(rel));
}

// ─── Rule 1: cross-test cascades ───────────────────────────────────────────

/** `test(...)`, `test.only(...)`, `test.skip(...)`, `test.fixme(...)`, `test.fail(...)`: its callback, if any. */
function testCallback(node: ts.Node): ts.FunctionLikeDeclaration | null {
    if (!ts.isCallExpression(node)) return null;
    const callee = node.expression;
    const isTest =
        (ts.isIdentifier(callee) && callee.text === 'test') ||
        (ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            callee.expression.text === 'test' &&
            TEST_MODIFIERS.has(callee.name.text));
    if (!isTest) return null;
    const fn = [...node.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
    return (fn as ts.FunctionLikeDeclaration | undefined) ?? null;
}

function testCallbacks(sf: ts.SourceFile): ts.FunctionLikeDeclaration[] {
    const found: ts.FunctionLikeDeclaration[] = [];
    const visit = (node: ts.Node): void => {
        const cb = testCallback(node);
        if (cb) found.push(cb);
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

function bindingNames(name: ts.BindingName): ts.Identifier[] {
    if (ts.isIdentifier(name)) return [name];
    return name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingNames(el.name)));
}

/** Every `let`/`var` binding declared outside every test callback. `const` cannot be reassigned. */
function topLevelMutableSymbols(parsed: Parsed, callbacks: ts.FunctionLikeDeclaration[]): Map<ts.Symbol, string> {
    const inTest = (node: ts.Node) => callbacks.some((cb) => node.pos >= cb.pos && node.end <= cb.end);
    const symbols = new Map<ts.Symbol, string>();
    const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.Const) && !(node.flags & ts.NodeFlags.Using)) {
            for (const decl of node.declarations) {
                if (inTest(decl)) continue;
                for (const id of bindingNames(decl.name)) {
                    const sym = parsed.checker.getSymbolAtLocation(id);
                    if (sym) symbols.set(sym, id.text);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed.sf);
    return symbols;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
    return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** Is `id` written here: the target of an assignment (destructuring included) or of `++`/`--`? */
function isWrite(id: ts.Identifier): boolean {
    let child: ts.Node = id;
    let parent = id.parent;
    // Climb out of destructuring targets: `[a, b] = …`, `({ a, b: c } = …)`.
    while (
        ts.isShorthandPropertyAssignment(parent) ||
        (ts.isPropertyAssignment(parent) && parent.initializer === child) ||
        ts.isArrayLiteralExpression(parent) ||
        ts.isObjectLiteralExpression(parent) ||
        ts.isSpreadElement(parent) ||
        ts.isSpreadAssignment(parent) ||
        ts.isParenthesizedExpression(parent)
    ) {
        child = parent;
        parent = parent.parent;
    }
    if (ts.isBinaryExpression(parent) && parent.left === child && isAssignmentOperator(parent.operatorToken.kind)) return true;
    if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && child === id) {
        return parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken;
    }
    return false;
}

function symbolOf(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
    if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) return checker.getShorthandAssignmentValueSymbol(id.parent);
    return checker.getSymbolAtLocation(id);
}

interface Cascade {
    binding: string;
    writtenIn: number;
    readIn: number;
}

/** Each top-level mutable binding written in one test and read in another. */
function cascadesIn(parsed: Parsed): Cascade[] {
    const callbacks = testCallbacks(parsed.sf);
    if (callbacks.length < 2) return [];
    const candidates = topLevelMutableSymbols(parsed, callbacks);
    if (candidates.size === 0) return [];
    const writes = new Map<ts.Symbol, Set<number>>();
    const reads = new Map<ts.Symbol, Set<number>>();
    const note = (map: Map<ts.Symbol, Set<number>>, sym: ts.Symbol, i: number) => map.set(sym, (map.get(sym) ?? new Set()).add(i));
    callbacks.forEach((cb, i) => {
        const visit = (node: ts.Node): void => {
            // A test nested in a test belongs to the inner one.
            if (testCallback(node)) return;
            if (ts.isIdentifier(node)) {
                const sym = symbolOf(parsed.checker, node);
                if (sym && candidates.has(sym)) {
                    if (isWrite(node)) {
                        note(writes, sym, i);
                        // `x += 1`, `x++` read the old value too.
                        const p = node.parent;
                        if (!(ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken)) note(reads, sym, i);
                    } else {
                        note(reads, sym, i);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        if (cb.body) visit(cb.body);
    });
    const found: Cascade[] = [];
    for (const [sym, name] of candidates) {
        const w = [...(writes.get(sym) ?? [])];
        const r = [...(reads.get(sym) ?? [])];
        const pair = w.flatMap((wi) => r.filter((ri) => ri !== wi).map((ri) => [wi, ri] as const))[0];
        if (pair) found.push({ binding: name, writtenIn: pair[0], readIn: pair[1] });
    }
    return found;
}

function cascadeOffenders(root: string): string[] {
    return specFiles(root).flatMap((rel) => cascadesIn(readSpec(root, rel)).map((c) => `${rel}: \`${c.binding}\``));
}

// ─── Rule 2: signed-in specs import the fixture ───────────────────────────

/** The literal text an expression spells, with `\0` for each part it cannot know; null when none. */
function staticText(expr: ts.Expression, checker: ts.TypeChecker, depth = 0): string | null {
    if (depth > 4) return null;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isNumericLiteral(expr)) return expr.text;
    if (ts.isTemplateExpression(expr)) {
        return expr.head.text + expr.templateSpans.map((s) => (staticText(s.expression, checker, depth + 1) ?? '\0') + s.literal.text).join('');
    }
    if (ts.isParenthesizedExpression(expr)) return staticText(expr.expression, checker, depth + 1);
    if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = staticText(expr.left, checker, depth + 1);
        const right = staticText(expr.right, checker, depth + 1);
        return left === null && right === null ? null : (left ?? '\0') + (right ?? '\0');
    }
    if (ts.isIdentifier(expr)) {
        const decl = checker.getSymbolAtLocation(expr)?.valueDeclaration;
        if (decl && ts.isVariableDeclaration(decl) && decl.initializer && ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) {
            return staticText(decl.initializer, checker, depth + 1);
        }
    }
    return null;
}

/** What the spec does against a workspace: the first such call, or null. */
function workspaceReach(parsed: Parsed): string | null {
    let reach: string | null = null;
    const visit = (node: ts.Node): void => {
        if (reach) return;
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
            const textAt = (i: number) => {
                const arg = node.arguments[i];
                return arg ? staticText(arg, parsed.checker) : null;
            };
            if (name === 'signInAs') reach = 'signInAs(...)';
            else if (name === 'goto' && ts.isPropertyAccessExpression(callee) && textAt(0)?.startsWith('/t/')) reach = 'goto(/t/…)';
            else if (name === 'safeGoto' && textAt(1)?.startsWith('/t/')) reach = 'safeGoto(/t/…)';
            else if (name && HTTP_METHODS.has(name) && ts.isPropertyAccessExpression(callee) && textAt(0)?.includes('/api/t/')) reach = `${name}(/api/t/…)`;
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed.sf);
    return reach;
}

/** Does the spec import the `test` runner from `./fixtures`? */
function importsFixtureTest(sf: ts.SourceFile): boolean {
    return sf.statements.some(
        (s) =>
            ts.isImportDeclaration(s) &&
            ts.isStringLiteral(s.moduleSpecifier) &&
            s.moduleSpecifier.text === './fixtures' &&
            !s.importClause?.isTypeOnly &&
            !!s.importClause?.namedBindings &&
            ts.isNamedImports(s.importClause.namedBindings) &&
            s.importClause.namedBindings.elements.some((el) => !el.isTypeOnly && (el.propertyName ?? el.name).text === 'test'),
    );
}

function fixtureOffenders(root: string): string[] {
    return specFiles(root).flatMap((rel) => {
        const parsed = readSpec(root, rel);
        const reach = workspaceReach(parsed);
        return reach && !importsFixtureTest(parsed.sf) ? [`${rel}: ${reach}`] : [];
    });
}

// ─── Rule 3: the server keeps AUTH_TEST_MODE=1 while specs share loopback ──

function propertyOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
    for (const p of obj.properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) return p.initializer;
        if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
    }
    return null;
}

/** The `defineConfig({...})` object of a Playwright config. */
function configObject(sf: ts.SourceFile): ts.ObjectLiteralExpression | null {
    let found: ts.ObjectLiteralExpression | null = null;
    const visit = (node: ts.Node): void => {
        if (found) return;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineConfig') {
            const arg = node.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg)) found = arg;
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
}

const LOOPBACK = /^https?:\/\/(?:127\.\d+\.\d+\.\d+|localhost|\[::1\])(?:[:/]|\0|$)/;

/** What is wrong with the config's bypass, empty when it holds. */
function bypassProblems(root: string): string[] {
    const file = path.join(root, 'playwright.config.ts');
    if (!fs.existsSync(file)) return ['playwright.config.ts is missing'];
    const parsed = parse('playwright.config.ts', fs.readFileSync(file, 'utf8'));
    const config = configObject(parsed.sf);
    if (!config) return ['no defineConfig({...}) object'];
    const use = propertyOf(config, 'use');
    const baseExpr = use && ts.isObjectLiteralExpression(use) ? propertyOf(use, 'baseURL') : null;
    const baseURL = baseExpr ? staticText(baseExpr, parsed.checker) : null;
    if (baseURL === null) return ['use.baseURL cannot be read, so whether the specs share one address cannot be told'];
    if (!LOOPBACK.test(baseURL)) return [];
    const server = propertyOf(config, 'webServer');
    if (!server || !ts.isObjectLiteralExpression(server)) return [`the base URL is loopback (${baseURL.replace(/\0/g, '…')}) but there is no webServer object`];
    const commandExpr = propertyOf(server, 'command');
    const command = commandExpr ? (staticText(commandExpr, parsed.checker) ?? '') : '';
    const envExpr = propertyOf(server, 'env');
    const envValue = (key: string) => {
        const v = envExpr && ts.isObjectLiteralExpression(envExpr) ? propertyOf(envExpr, key) : null;
        return v ? staticText(v, parsed.checker) : null;
    };
    const sets = (key: string) => new RegExp(`(?:^|\\s)${key}=1(?:\\s|$)`).test(command) || envValue(key) === '1';
    return ['AUTH_TEST_MODE', 'NEXT_TEST_MODE']
        .filter((key) => !sets(key))
        .map((key) => `the webServer does not set ${key}=1 while every spec reaches it from loopback`);
}

// ─── The nightly isolation run ─────────────────────────────────────────────

function nightlyProblems(root: string): string[] {
    const file = path.join(root, '.github/workflows/perf.yml');
    if (!fs.existsSync(file)) return ['.github/workflows/perf.yml is missing'];
    const text = fs.readFileSync(file, 'utf8');
    const problems: string[] = [];
    if (!/playwright test\b[^\n]*--repeat-each=2\b[^\n]*--retries=0\b[^\n]*--workers=4\b/.test(text)) {
        problems.push('no `playwright test --repeat-each=2 --retries=0 --workers=4` step');
    }
    if (!/playwright test "\$spec"[^\n]*--retries=0/.test(text)) problems.push('no step running each spec file alone with --retries=0');
    return problems;
}

// ─── This repository ───────────────────────────────────────────────────────

describe('E2E isolation, in this repository', () => {
    it('no spec writes a top-level let/var in one test() and reads it in another', () => {
        const baselined = new Set(BASELINE.filter((b) => b.rule === 'cascade').map((b) => b.file));
        const unexpected = cascadeOffenders(REPO_ROOT).filter((o) => !baselined.has(o.split(':')[0]!));
        if (unexpected.length > 0) {
            throw new Error(
                'Cross-test cascade: a value set in one test() is read by another, so a failed or reordered ' +
                    'test breaks the next. Create it inside the test that needs it (or a beforeEach), or make the ' +
                    `steps one test() with test.step(...). See tests/e2e/fixtures.ts.\n  ${unexpected.join('\n  ')}`,
            );
        }
        expect(unexpected).toEqual([]);
    });

    it('every spec that reaches a workspace imports test from ./fixtures', () => {
        const baselined = new Set(BASELINE.filter((b) => b.rule === 'fixture').map((b) => b.file));
        const unexpected = fixtureOffenders(REPO_ROOT).filter((o) => !baselined.has(o.split(':')[0]!));
        if (unexpected.length > 0) {
            throw new Error(
                'These specs sign in or reach /t/… or /api/t/… without the per-test workspace. Import ' +
                    `{ test } from './fixtures' and use isolatedTenant / authedPage.\n  ${unexpected.join('\n  ')}`,
            );
        }
        expect(unexpected).toEqual([]);
    });

    it('BASELINE has no stale entries', () => {
        const offending = new Set([...cascadeOffenders(REPO_ROOT), ...fixtureOffenders(REPO_ROOT)].map((o) => o.split(':')[0]));
        expect(BASELINE.filter((b) => !offending.has(b.file))).toEqual([]);
    });

    it('the population is the real suite: every spec file, the signed-in ones among them', () => {
        const specs = specFiles(REPO_ROOT);
        expect(specs.length).toBeGreaterThanOrEqual(20);
        const reaching = specs.filter((rel) => workspaceReach(readSpec(REPO_ROOT, rel)) !== null);
        expect(reaching).toEqual(expect.arrayContaining(['tests/e2e/work-items.spec.ts', 'tests/e2e/reviews.spec.ts', 'tests/e2e/cycles.spec.ts']));
    });

    it('the fixture module wires isolatedTenant and authedPage through base.extend', () => {
        const parsed = parse('tests/e2e/fixtures.ts', fs.readFileSync(path.join(REPO_ROOT, 'tests/e2e/fixtures.ts'), 'utf8'));
        const exportsTest = parsed.sf.statements.find(
            (s): s is ts.VariableStatement =>
                ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'test'),
        );
        const init = exportsTest?.declarationList.declarations[0]?.initializer;
        expect(init && ts.isCallExpression(init) && init.expression.getText(parsed.sf)).toBe('base.extend');
        const fixtures = init && ts.isCallExpression(init) ? init.arguments[0] : undefined;
        expect(fixtures && ts.isObjectLiteralExpression(fixtures) && ['isolatedTenant', 'authedPage'].every((k) => propertyOf(fixtures, k))).toBe(true);
    });

    it('the Playwright server keeps AUTH_TEST_MODE=1 and NEXT_TEST_MODE=1 while the specs share loopback', () => {
        expect(bypassProblems(REPO_ROOT)).toEqual([]);
    });

    it('AUTH_TEST_MODE=1 is what bypasses the rate limits (the flag rule 3 pins still does its work)', () => {
        const saved = { AUTH_TEST_MODE: process.env.AUTH_TEST_MODE, NEXT_TEST_MODE: process.env.NEXT_TEST_MODE, RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED };
        try {
            process.env.RATE_LIMIT_ENABLED = '1';
            delete process.env.NEXT_TEST_MODE;
            delete process.env.AUTH_TEST_MODE;
            expect(isRateLimitBypassed()).toBe(false);
            process.env.AUTH_TEST_MODE = '1';
            expect(isRateLimitBypassed()).toBe(true);
        } finally {
            for (const [k, v] of Object.entries(saved)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    });

    it('the nightly run repeats every test twice with no retries on four workers, then each spec file alone', () => {
        expect(nightlyProblems(REPO_ROOT)).toEqual([]);
    });
});

// ─── The detectors, against a planted repository ──────────────────────────

describe('the detectors, against a planted repository', () => {
    let root: string;

    const plant = (files: Record<string, string>) => {
        for (const [rel, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    };

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-e2e-isolation-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant({
            // Rule 1.
            'tests/e2e/cascade.spec.ts': `
                import { test, expect } from './fixtures';
                let sharedId = '';
                test('creates', async () => { sharedId = 'abc'; });
                test('reads', async () => { expect(sharedId).toBe('abc'); });
            `,
            'tests/e2e/describe-cascade.spec.ts': `
                import { test, expect } from './fixtures';
                test.describe('d', () => {
                    let count = 0, other: string | undefined;
                    test('a', async () => { [other] = ['x']; count++; });
                    test.skip('b', async () => { expect({ other, count }).toBeTruthy(); });
                });
            `,
            'tests/e2e/shadowed.spec.ts': `
                import { test, expect } from './fixtures';
                let id = '';
                function helper() { let id = 'local'; return id; }
                test('a', async () => { let id = 'mine'; id = 'again'; expect(id).toBe('again'); });
                test('b', async () => { let id = 'theirs'; expect(id + helper()).toBeTruthy(); });
            `,
            'tests/e2e/before-each.spec.ts': `
                import { test, expect } from './fixtures';
                let slug = '';
                test.beforeEach(async () => { slug = 'acme'; });
                test('a', async () => { expect(slug).toBe('acme'); });
                test('b', async () => { expect(slug).toBe('acme'); });
            `,
            'tests/e2e/same-test.spec.ts': `
                import { test, expect } from './fixtures';
                let n = 0;
                test('a', async () => { n = 1; expect(n).toBe(1); });
                test('b', async () => { expect(1).toBe(1); });
                // test('c', async () => { expect(n).toBe(1); }) in a comment is not a test
                const s = "test('d', async () => { n; })";
            `,
            // Rule 2.
            'tests/e2e/sign-in.spec.ts': `
                import { test } from '@playwright/test';
                import { signInAs } from './e2e-utils';
                test('a', async ({ page }) => { await signInAs(page, creds); });
            `,
            'tests/e2e/goto.spec.ts': `
                import { expect, test } from '@playwright/test';
                const slug = 'x';
                test('a', async ({ page }) => { await page.goto(\`/t/\${slug}/my-work\`); });
            `,
            'tests/e2e/api.spec.ts': `
                import { test } from '@playwright/test';
                const base = \`/api/t/\${'x'}\`;
                test('a', async ({ request }) => { await request.post(\`\${base}/teams\`, { data: {} }); });
            `,
            'tests/e2e/safe-goto.spec.ts': `
                import { test } from '@playwright/test';
                import { safeGoto } from './e2e-utils';
                test('a', async ({ page }) => { await safeGoto(page, '/t/' + slug); });
            `,
            'tests/e2e/type-only.spec.ts': `
                import type { test } from './fixtures';
                import { test as run } from '@playwright/test';
                run('a', async ({ request }) => { await request.get('/api/t/x/teams'); });
            `,
            'tests/e2e/isolated.spec.ts': `
                import { expect, test as fixtureTest } from './fixtures';
                import type { Page } from '@playwright/test';
                const test = fixtureTest;
                test('a', async ({ authedPage }) => { await authedPage.goto('/t/x/my-work'); });
            `,
            'tests/e2e/fixture.spec.ts': `
                import { expect, test } from './fixtures';
                test('a', async ({ authedPage }) => { await authedPage.goto('/t/x/my-work'); await authedPage.request.get('/api/t/x/teams'); });
            `,
            'tests/e2e/public.spec.ts': `
                import { expect, test } from '@playwright/test';
                // signInAs(page) in prose, and '/t/x' in a string are not calls
                const note = 'signInAs /t/x /api/t/x';
                test('a', async ({ page, request }) => { await page.goto('/login'); await request.get('/api/livez'); await request.get('/api/auth/session'); });
            `,
            'tests/e2e/helpers.ts': `import { test } from '@playwright/test'; test('x', async ({ page }) => { await signInAs(page); });`,
        });
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds each cross-test cascade, by symbol, and nothing else', () => {
        expect(cascadeOffenders(root)).toEqual([
            'tests/e2e/cascade.spec.ts: `sharedId`',
            'tests/e2e/describe-cascade.spec.ts: `count`',
            'tests/e2e/describe-cascade.spec.ts: `other`',
        ]);
    });

    it('finds each spec that reaches a workspace without importing test from ./fixtures', () => {
        expect(fixtureOffenders(root)).toEqual([
            'tests/e2e/api.spec.ts: post(/api/t/…)',
            'tests/e2e/goto.spec.ts: goto(/t/…)',
            'tests/e2e/safe-goto.spec.ts: safeGoto(/t/…)',
            'tests/e2e/sign-in.spec.ts: signInAs(...)',
            'tests/e2e/type-only.spec.ts: get(/api/t/…)',
        ]);
    });

    describe('the bypass rule', () => {
        const config = (server: string, base = 'const BASE_URL = `http://127.0.0.1:${PORT}`;') => `
            import { defineConfig } from '@playwright/test';
            const PORT = 3100;
            ${base}
            export default defineConfig({ use: { baseURL: BASE_URL }, webServer: ${server} });
        `;

        it('holds with both flags on the command line, or in env', () => {
            plant({ 'playwright.config.ts': config('{ command: `AUTH_TEST_MODE=1 NEXT_TEST_MODE=1 PORT=${PORT} node s.mjs`, env: {} }') });
            expect(bypassProblems(root)).toEqual([]);
            plant({ 'playwright.config.ts': config("{ command: 'node s.mjs', env: { AUTH_TEST_MODE: '1', NEXT_TEST_MODE: '1' } }") });
            expect(bypassProblems(root)).toEqual([]);
        });

        it('fails when the server loses AUTH_TEST_MODE=1 (or NEXT_TEST_MODE=1) while the base URL is loopback', () => {
            plant({ 'playwright.config.ts': config('{ command: `NEXT_TEST_MODE=1 PORT=${PORT} node s.mjs`, env: {} }') });
            expect(bypassProblems(root)).toEqual(['the webServer does not set AUTH_TEST_MODE=1 while every spec reaches it from loopback']);
            plant({ 'playwright.config.ts': config("{ command: 'AUTH_TEST_MODE=0 NEXT_TEST_MODE=1 node s.mjs', env: { AUTH_TEST_MODE: '0' } }") });
            expect(bypassProblems(root)).toHaveLength(1);
            plant({ 'playwright.config.ts': config("{ command: 'AUTH_TEST_MODE=1 node s.mjs' }", "const BASE_URL = 'http://localhost:3100';") });
            expect(bypassProblems(root)).toEqual(['the webServer does not set NEXT_TEST_MODE=1 while every spec reaches it from loopback']);
        });

        it('does not apply to a base URL that is not loopback, and fails closed on one it cannot read', () => {
            plant({ 'playwright.config.ts': config("{ command: 'node s.mjs' }", "const BASE_URL = 'https://staging.example.test';") });
            expect(bypassProblems(root)).toEqual([]);
            plant({ 'playwright.config.ts': config("{ command: 'node s.mjs' }", 'const BASE_URL = computeBase();') });
            expect(bypassProblems(root)).toEqual(['use.baseURL cannot be read, so whether the specs share one address cannot be told']);
        });
    });

    it('the nightly check fails without the repeat run or the one-file runs', () => {
        plant({ '.github/workflows/perf.yml': 'jobs:\n  e2e:\n    steps:\n      - run: npx playwright test --retries=0\n' });
        expect(nightlyProblems(root)).toHaveLength(2);
        plant({
            '.github/workflows/perf.yml':
                'jobs:\n  e2e:\n    steps:\n      - run: npx playwright test --repeat-each=2 --retries=0 --workers=4\n' +
                '      - run: for spec in a; do npx playwright test "$spec" --retries=0 --workers=1; done\n',
        });
        expect(nightlyProblems(root)).toEqual([]);
    });
});
