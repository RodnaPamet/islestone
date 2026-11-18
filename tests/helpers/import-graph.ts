/**
 * The import graph a `'use client'` file pulls into the browser bundle, and the
 * check that `src/env.ts` (the server env schema) is not in it.
 *
 * Written for Islestone. The idea of walking the client graph from every
 * `'use client'` file comes from inflect-compliance's
 * `client-reachable-modules-import-no-server-env` guard: pattern only, no code
 * copied. PROVENANCE.md records it in its "Adopted" table.
 *
 * WHAT IS A ROOT. Every file Next.js ships to the browser without being
 * imported by another client file:
 *   - a file that opens with a `'use client'` directive;
 *   - `instrumentation-client.*` at the root or in `src/`, which Next.js loads
 *     in the browser with no directive;
 *   - every Pages Router file under `pages/` or `src/pages/`, which is client
 *     code by default, except `api/` routes and `_document`, which only ever
 *     run on the server.
 * Files under `tests/` are never roots: no bundle includes them.
 *
 * WHAT IS AN EDGE. Anything a bundler includes: value imports, side-effect
 * imports, re-exports, `import x = require()`, `require('x')` and
 * `import('x')` with a literal specifier (a dynamic import is still client
 * JavaScript, just in another chunk). `import type` and specifier lists that
 * are entirely `type` are erased at compile time and are not edges. A value
 * import used only as a type is ALSO erased by the compiler, but this walker
 * counts it; the `consistent-type-imports` lint rule makes such imports say
 * `type`, so the two agree.
 *
 * WHAT IS NOT WALKED. Bare specifiers (`react`, `next/link`, `node:fs`) are
 * packages. A bare specifier that names one of this repository's own
 * workspace packages (a git-listed `package.json` below the root) is NOT a
 * third-party package: its source is part of the client bundle. The walker
 * cannot follow one yet, so it reports each such import in
 * `workspaceImports` and the guard fails on it. Sub-phase 1.2, which adds the
 * first workspace package, teaches the walker to resolve them to source.
 *
 * WHAT IS REPORTED RATHER THAN GUESSED. A local specifier that resolves to no
 * file, and an `import()` / `require()` whose argument is not a literal. Both
 * are holes in the graph; treating them as "no edge" would report a module as
 * unreachable when the bundler may well include it.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import ts from 'typescript';

import { gitFiles, relativeTo } from './git-files';

/** Extensions parsed as modules, in the order a bare path tries them. */
export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** The `@/` alias, as tsconfig.json declares it (the guard asserts they agree). */
export const ALIAS_PREFIX = '@/';
export const ALIAS_TARGET_DIR = 'src';

export interface ModuleFacts {
    /** The file opens with a `'use client'` directive. */
    readonly isClientEntry: boolean;
    /** Literal specifiers of every bundled edge, in source order. */
    readonly specifiers: readonly string[];
    /** `import()` / `require()` calls whose argument is not a literal. */
    readonly opaque: readonly string[];
}

function scriptKindFor(fileName: string): ts.ScriptKind {
    if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
    if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
    if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}

function isSourceFile(file: string): boolean {
    return SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/**
 * A directive is a string-literal expression statement in the prologue: the
 * statements before the first one that is not such a literal. Comments and a
 * byte-order mark are trivia to the parser, so they may precede it; any
 * import or code before it means the file is not a client entry.
 */
function opensWithUseClient(sf: ts.SourceFile): boolean {
    for (const statement of sf.statements) {
        if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
        if (statement.expression.text === 'use client') return true;
    }
    return false;
}

function namedBindingsAllTypes(bindings: ts.NamedImportBindings | ts.NamedExportBindings | undefined): boolean {
    if (!bindings) return false;
    if (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) {
        return bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
    }
    return false;
}

export function analyseModule(source: string, fileName: string): ModuleFacts {
    const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
    const specifiers: string[] = [];
    const opaque: string[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const typeOnly =
                !!clause && (clause.isTypeOnly || (!clause.name && namedBindingsAllTypes(clause.namedBindings)));
            if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const typeOnly = node.isTypeOnly || namedBindingsAllTypes(node.exportClause);
            if (!typeOnly) specifiers.push(node.moduleSpecifier.text);
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            !node.isTypeOnly &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            specifiers.push(node.moduleReference.expression.text);
        } else if (ts.isCallExpression(node)) {
            const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
            const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
            if (isDynamicImport || isRequire) {
                const [arg] = node.arguments;
                if (arg && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
                else opaque.push(node.getText(sf));
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);

    return { isClientEntry: opensWithUseClient(sf), specifiers, opaque };
}

export type Resolution =
    | { readonly kind: 'file'; readonly file: string }
    | { readonly kind: 'package' }
    | { readonly kind: 'missing' };

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

/** Resolve one specifier the way the bundler and tsconfig's `@/` alias do. */
export function resolveSpecifier(specifier: string, fromFile: string, root: string): Resolution {
    let base: string;
    if (specifier.startsWith(ALIAS_PREFIX)) {
        base = path.join(root, ALIAS_TARGET_DIR, specifier.slice(ALIAS_PREFIX.length));
    } else if (specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')) {
        base = path.resolve(path.dirname(fromFile), specifier);
    } else {
        return { kind: 'package' };
    }

    const candidates = [
        base,
        ...SOURCE_EXTENSIONS.map((ext) => base + ext),
        // TypeScript lets `./x.js` name `./x.ts` (and so on).
        ...(/\.[cm]?jsx?$/.test(base)
            ? ['.ts', '.tsx', '.mts', '.cts'].map((ext) => base.replace(/\.[cm]?jsx?$/, ext))
            : []),
        ...SOURCE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
    ];
    const file = candidates.find(isFile);
    return file ? { kind: 'file', file } : { kind: 'missing' };
}

/** Why a repo-relative file is a root of the client graph, or null when it is not one. */
export function clientRootReason(relative: string, opensWithDirective: boolean): string | null {
    if (relative.startsWith('tests/') || !isSourceFile(relative)) return null;
    if (opensWithDirective) return "'use client'";
    if (/^(?:src\/)?instrumentation-client\.[cm]?[jt]sx?$/.test(relative)) return 'instrumentation-client';
    const pages = /^(?:src\/)?pages\/(.*)$/.exec(relative);
    if (pages) {
        const inside = pages[1] as string;
        if (inside.startsWith('api/') || /^_document\./.test(inside)) return null;
        return 'Pages Router';
    }
    return null;
}

/** The package name a bare specifier names (`@scope/name` or `name`), or null for a path or a URL. */
export function packageNameOf(specifier: string): string | null {
    if (specifier === '' || /^[./#]/.test(specifier) || specifier.startsWith(ALIAS_PREFIX)) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(specifier)) return null;
    const parts = specifier.split('/');
    if (specifier.startsWith('@')) return parts.length >= 2 && parts[1] !== '' ? `${parts[0]}/${parts[1]}` : null;
    return parts[0] ?? null;
}

/** The names of this work tree's own workspace packages: every git-listed package.json below the root. */
export function workspacePackageNames(root: string, population: readonly string[]): Set<string> {
    const names = new Set<string>();
    for (const rel of population) {
        if (!rel.endsWith('/package.json') || rel.startsWith('tests/')) continue;
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as { name?: unknown };
            if (typeof manifest.name === 'string' && manifest.name !== '') names.add(manifest.name);
        } catch {
            // An unreadable manifest names no package; the build would fail on it first.
        }
    }
    return names;
}

export interface BoundaryViolation {
    /** The `'use client'` file, repo-relative. */
    readonly entry: string;
    /** Shortest import chain from the entry to the server env module. */
    readonly chain: readonly string[];
}

export interface BoundaryReport {
    /** Repo-relative files git lists for the work tree. */
    readonly population: readonly string[];
    /** Repo-relative roots of the walk: see "WHAT IS A ROOT" above. */
    readonly clientEntries: readonly string[];
    /** Repo-relative files reachable from at least one client entry. */
    readonly reached: ReadonlySet<string>;
    readonly violations: readonly BoundaryViolation[];
    /** Local specifiers in the client graph that resolve to no file. */
    readonly unresolved: ReadonlyArray<{ readonly from: string; readonly specifier: string }>;
    /** Non-literal `import()` / `require()` calls in the client graph. */
    readonly opaque: ReadonlyArray<{ readonly from: string; readonly call: string }>;
    /** Imports of this repository's own workspace packages, which the walk cannot follow yet. */
    readonly workspaceImports: ReadonlyArray<{ readonly from: string; readonly specifier: string }>;
}

/**
 * Walk the client graph of the work tree at `root` and report every
 * `'use client'` file that can reach `serverEnvModule`.
 *
 * Nothing is cached between calls, so a test can edit a fixture and check
 * again.
 */
export function checkClientEnvBoundary(root: string, serverEnvModule = 'src/env.ts'): BoundaryReport {
    const target = path.join(root, serverEnvModule);
    const population = gitFiles(root);
    const rel = (file: string) => relativeTo(root, file);

    const factsCache = new Map<string, ModuleFacts>();
    const factsOf = (file: string): ModuleFacts => {
        let facts = factsCache.get(file);
        if (!facts) {
            facts = analyseModule(fs.readFileSync(file, 'utf8'), file);
            factsCache.set(file, facts);
        }
        return facts;
    };

    const workspaces = workspacePackageNames(root, population);
    const unresolved: Array<{ from: string; specifier: string }> = [];
    const opaque: Array<{ from: string; call: string }> = [];
    const workspaceImports: Array<{ from: string; specifier: string }> = [];
    const edgesCache = new Map<string, string[]>();
    const edgesOf = (file: string): string[] => {
        let edges = edgesCache.get(file);
        if (edges) return edges;
        edges = [];
        // Assets (CSS, JSON, images) are bundled but import nothing we parse.
        if (isSourceFile(file)) {
            const facts = factsOf(file);
            for (const call of facts.opaque) opaque.push({ from: rel(file), call });
            for (const specifier of facts.specifiers) {
                const r = resolveSpecifier(specifier, file, root);
                if (r.kind === 'file') edges.push(r.file);
                else if (r.kind === 'missing') unresolved.push({ from: rel(file), specifier });
                else if (workspaces.has(packageNameOf(specifier) ?? '')) workspaceImports.push({ from: rel(file), specifier });
            }
        }
        edgesCache.set(file, edges);
        return edges;
    };

    const clientEntries = population
        .filter((p) => !p.startsWith('tests/') && isSourceFile(p))
        .filter((p) => clientRootReason(p, factsOf(path.join(root, p)).isClientEntry) !== null)
        .map((p) => path.join(root, p));

    const reached = new Set<string>();
    const violations: BoundaryViolation[] = [];

    for (const entry of clientEntries) {
        // Breadth-first, so the chain reported is a shortest one.
        const parent = new Map<string, string | null>([[entry, null]]);
        const queue = [entry];
        for (let i = 0; i < queue.length; i++) {
            const file = queue[i] as string;
            reached.add(rel(file));
            for (const next of edgesOf(file)) {
                if (!parent.has(next)) {
                    parent.set(next, file);
                    queue.push(next);
                }
            }
        }
        if (parent.has(target)) {
            const chain: string[] = [];
            for (let f: string | null | undefined = target; f; f = parent.get(f)) chain.unshift(rel(f));
            violations.push({ entry: rel(entry), chain });
        }
    }

    const byFrom = <T extends { from: string }>(a: T, b: T) => a.from.localeCompare(b.from);
    return {
        population,
        clientEntries: clientEntries.map(rel),
        reached,
        violations,
        unresolved: dedupe(unresolved, (u) => `${u.from}\0${u.specifier}`).sort(byFrom),
        opaque: dedupe(opaque, (o) => `${o.from}\0${o.call}`).sort(byFrom),
        workspaceImports: dedupe(workspaceImports, (w) => `${w.from}\0${w.specifier}`).sort(byFrom),
    };
}

function dedupe<T>(items: readonly T[], key: (item: T) => string): T[] {
    const seen = new Map<string, T>();
    for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
    return [...seen.values()];
}

/** `a -> b -> c`, for failure messages. */
export function formatChain(chain: readonly string[]): string {
    return chain.join(' -> ');
}
