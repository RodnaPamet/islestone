/**
 * The timeline widget is SVAR's MIT core, and only that (roadmap 3.1b; ADR
 * 0010 §7; owner decision 182; the map's "Guard" paragraph):
 *
 *   - every `@svar-ui/*` package in `package-lock.json` is on the pinned list
 *     below at its pinned version and declares MIT; `wx-react-gantt` (the old
 *     name, GPL-3.0) and any `*-pro` / `*-trial` SVAR name never appear, and
 *     `package.json` pins `@svar-ui/react-gantt` exactly;
 *   - `src/` imports `@svar-ui/*` only from the one adapter file, and only
 *     the React package and its two plain stylesheets (`all.css` and
 *     `@svar-ui/react-core`'s stylesheet carry `@font-face` rules naming
 *     `cdn.svar.dev`, so neither is allowed);
 *   - every theme element the adapter renders passes `fonts={false}`, and the
 *     widget element is given only the props on a closed allowlist (none of
 *     the PRO options its types still declare);
 *   - the word "Gantt" names nothing in `src/` but the widget's own export
 *     in that import, and no copy in `messages/en.json` says it (ADR 0006).
 *
 * Moving to another version is a reviewed change to `PINNED`, after the
 * licence of every package is read again. The population comes from git; the
 * detectors prove themselves against a planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const ADAPTER = 'src/components/work-items/timeline/svar-adapter.tsx';

/** Every SVAR package the lockfile may hold, at the version whose licence was read (MIT, 2026-11-21). */
const PINNED = [
    '@svar-ui/comments-locales@2.6.2',
    '@svar-ui/core-locales@2.6.2',
    '@svar-ui/editor-locales@2.7.0',
    '@svar-ui/filter-locales@2.6.2',
    '@svar-ui/filter-store@2.6.2',
    '@svar-ui/gantt-data-provider@2.8.3',
    '@svar-ui/gantt-locales@2.8.3',
    '@svar-ui/gantt-store@2.8.3',
    '@svar-ui/grid-data-provider@2.7.6',
    '@svar-ui/grid-locales@2.7.6',
    '@svar-ui/grid-store@2.7.6',
    '@svar-ui/lib-data-provider@1.7.4',
    '@svar-ui/lib-dom@0.12.2',
    '@svar-ui/lib-dom@0.14.2',
    '@svar-ui/lib-react@1.3.0',
    '@svar-ui/lib-react@1.3.1',
    '@svar-ui/lib-state@1.10.1',
    '@svar-ui/react-comments@2.6.2',
    '@svar-ui/react-core@2.6.2',
    '@svar-ui/react-editor@2.7.1',
    '@svar-ui/react-filter@2.6.2',
    '@svar-ui/react-gantt@2.8.3',
    '@svar-ui/react-grid@2.7.7',
    '@svar-ui/react-menu@2.6.2',
    '@svar-ui/react-tasklist@2.6.2',
    '@svar-ui/react-toolbar@2.6.2',
    '@svar-ui/tasklist-locales@2.6.2',
];

/** What `src/` may import from SVAR, and only in the adapter. */
const ALLOWED_SPECIFIERS = ['@svar-ui/react-gantt', '@svar-ui/react-gantt/style.css', '@svar-ui/react-grid/style.css'];

/** The props the widget element may take: display and input only, none of PRO's. */
const ALLOWED_WIDGET_PROPS = [
    'tasks',
    'links',
    'scales',
    'start',
    'end',
    'cellWidth',
    'cellHeight',
    'scaleHeight',
    'lengthUnit',
    'durationUnit',
    'inclusiveEnd',
    'autoScale',
    'zoom',
    'readonly',
    'columns',
    'gridWidth',
    'cellBorders',
    'highlightTime',
    'taskTemplate',
    'init',
    'ref',
    'key',
];

/** The widget's themes: each must be given `fonts={false}`. */
const THEMES = ['Willow', 'WillowDark', 'Material'];

// ─── Detectors ────────────────────────────────────────────────────────────

/** Lockfile entries for SVAR packages, and their problems. */
function lockfileProblems(root: string): string[] {
    const problems: string[] = [];
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { packages: Record<string, { version?: string; license?: string }> };
    const pinned = new Set(PINNED);
    for (const [key, entry] of Object.entries(lock.packages)) {
        const name = key.replace(/^.*node_modules\//, '');
        if (name === 'wx-react-gantt' || /^wx-.*gantt/.test(name)) problems.push(`${name}: the GPL-3.0 predecessor`);
        if (!name.startsWith('@svar-ui/')) continue;
        if (/(?:-pro|-trial)(?:$|-)|\bpro\b/.test(name.slice('@svar-ui/'.length))) problems.push(`${name}: a PRO or trial package`);
        if (!pinned.has(`${name}@${entry.version}`)) problems.push(`${name}@${entry.version}: not on the pinned list`);
        if (entry.license !== 'MIT') problems.push(`${name}@${entry.version}: declares ${entry.license ?? 'no licence'}`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps)) {
        if (name.startsWith('@svar-ui/') && name !== '@svar-ui/react-gantt') problems.push(`package.json: ${name} (only @svar-ui/react-gantt is a direct dependency)`);
        if (name === 'wx-react-gantt') problems.push('package.json: wx-react-gantt');
    }
    if (deps['@svar-ui/react-gantt'] !== '2.8.3') problems.push(`package.json: @svar-ui/react-gantt is ${deps['@svar-ui/react-gantt'] ?? 'missing'}, not exactly 2.8.3`);
    return problems;
}

function moduleSpecifiers(sf: ts.SourceFile): Array<{ spec: string; node: ts.Node }> {
    const out: Array<{ spec: string; node: ts.Node }> = [];
    const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            out.push({ spec: node.moduleSpecifier.text, node });
        } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0]!)) {
            const callee = node.expression;
            if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
                out.push({ spec: (node.arguments[0] as ts.StringLiteralLike).text, node });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

const isScript = (rel: string) => /\.(?:tsx?|jsx?|mjs|cjs)$/.test(rel);

/** `src/` imports of SVAR outside the adapter or outside the allowlist; CSS `@import`s of it anywhere. */
function importProblems(root: string): string[] {
    const problems: string[] = [];
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/'))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (rel.endsWith('.css')) {
            if (/@import[^;]*@svar-ui/.test(text)) problems.push(`${rel}: a CSS @import of @svar-ui`);
            continue;
        }
        if (!isScript(rel)) continue;
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        for (const { spec } of moduleSpecifiers(sf)) {
            if (!spec.startsWith('@svar-ui/') && spec !== 'wx-react-gantt') continue;
            if (rel !== ADAPTER) problems.push(`${rel}: imports ${spec} (only ${ADAPTER} may)`);
            else if (!ALLOWED_SPECIFIERS.includes(spec)) problems.push(`${rel}: imports ${spec} (not on the allowlist)`);
        }
    }
    return problems;
}

/** The adapter's widget element props and theme `fonts`. */
function adapterProblems(root: string): string[] {
    const file = path.join(root, ADAPTER);
    if (!fs.existsSync(file)) return [`${ADAPTER}: missing`];
    const sf = ts.createSourceFile(ADAPTER, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const problems: string[] = [];
    const widgetNames = new Set<string>();
    const themeNames = new Set<string>();
    for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== '@svar-ui/react-gantt') continue;
        const bindings = stmt.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) problems.push(`${ADAPTER}: a namespace import hides which parts are used`);
        if (bindings && ts.isNamedImports(bindings)) {
            for (const el of bindings.elements) {
                const imported = (el.propertyName ?? el.name).text;
                if (imported === 'Gantt') widgetNames.add(el.name.text);
                else if (THEMES.includes(imported)) themeNames.add(el.name.text);
                else if (!el.isTypeOnly && !stmt.importClause?.isTypeOnly && /^[A-Z]/.test(imported) && !/^I[A-Z]/.test(imported)) {
                    problems.push(`${ADAPTER}: imports the component ${imported} (the timeline renders no toolbar, editor, menu or PRO view)`);
                }
            }
        }
    }
    if (widgetNames.size === 0) problems.push(`${ADAPTER}: does not render the widget`);
    let widgetElements = 0;
    let themeElements = 0;
    const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = node.tagName.getText(sf);
            const attrs = node.attributes.properties;
            if (widgetNames.has(tag)) {
                widgetElements++;
                for (const a of attrs) {
                    if (ts.isJsxSpreadAttribute(a)) problems.push(`${ADAPTER}: a spread on the widget hides its props`);
                    else if (!ALLOWED_WIDGET_PROPS.includes(a.name.getText(sf))) problems.push(`${ADAPTER}: the widget is given ${a.name.getText(sf)} (not on the allowlist)`);
                }
            }
            if (themeNames.has(tag)) {
                themeElements++;
                const fonts = attrs.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === 'fonts');
                const value = fonts?.initializer && ts.isJsxExpression(fonts.initializer) ? fonts.initializer.expression : undefined;
                if (!value || value.kind !== ts.SyntaxKind.FalseKeyword) problems.push(`${ADAPTER}: <${tag}> without fonts={false} (it would load cdn.svar.dev)`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    if (widgetElements === 0) problems.push(`${ADAPTER}: renders no widget element`);
    if (themeElements === 0) problems.push(`${ADAPTER}: renders no theme (its fonts must be switched off explicitly)`);
    return problems;
}

/** "Gantt" names nothing in `src/` but the import of the widget; no copy says it. */
function vocabularyProblems(root: string): string[] {
    const problems: string[] = [];
    for (const rel of gitFiles(root).filter((r) => r.startsWith('src/') && isScript(r))) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        if (!/Gantt/.test(text)) continue;
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (node: ts.Node) => {
            if (ts.isIdentifier(node) && /Gantt/.test(node.text)) {
                const inWidgetImport = rel === ADAPTER && ts.isImportSpecifier(node.parent) && node.parent.propertyName === node && node.text === 'Gantt';
                if (!inWidgetImport) problems.push(`${rel}: the identifier ${node.text}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    const messages = path.join(root, 'messages/en.json');
    if (fs.existsSync(messages) && /gantt/i.test(fs.readFileSync(messages, 'utf8'))) problems.push('messages/en.json: copy says "Gantt"');
    return problems;
}

// ─── The repository ───────────────────────────────────────────────────────

describe('the timeline widget is the MIT core only (decision 182)', () => {
    it('the lockfile holds only the pinned, MIT SVAR packages, and no GPL or PRO name', () => {
        expect(lockfileProblems(REPO_ROOT)).toEqual([]);
    });

    it('the lockfile does hold the widget (the population is real)', () => {
        const lock = fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8');
        expect(lock).toContain('"node_modules/@svar-ui/react-gantt"');
    });

    it('src/ imports SVAR only from the adapter, and only the package and its two plain stylesheets', () => {
        expect(importProblems(REPO_ROOT)).toEqual([]);
    });

    it('the adapter gives its theme fonts={false} and the widget only allowlisted props', () => {
        expect(adapterProblems(REPO_ROOT)).toEqual([]);
    });

    it('"Gantt" names nothing but the widget in its import, and no copy says it (ADR 0006)', () => {
        expect(vocabularyProblems(REPO_ROOT)).toEqual([]);
    });
});

// ─── The detectors, against a planted repository ──────────────────────────

describe('the detectors, against a planted repository', () => {
    let root: string;

    const write = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    };

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-svar-core-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        write(
            'package-lock.json',
            JSON.stringify({
                packages: {
                    '': {},
                    'node_modules/@svar-ui/react-gantt': { version: '2.8.3', license: 'MIT' },
                    'node_modules/@svar-ui/gantt-store': { version: '2.9.0', license: 'MIT' },
                    'node_modules/@svar-ui/react-gantt-pro': { version: '2.8.3', license: 'SEE LICENSE' },
                    'node_modules/wx-react-gantt': { version: '1.3.1', license: 'GPL-3.0' },
                },
            }),
        );
        write('package.json', JSON.stringify({ dependencies: { '@svar-ui/react-gantt': '^2.8.3', '@svar-ui/react-core': '2.6.2' } }));
        write(ADAPTER, [
            "import '@svar-ui/react-gantt/all.css';",
            "import { Gantt, Willow, Toolbar } from '@svar-ui/react-gantt';",
            'export default function A() {',
            '    return <Willow><Gantt tasks={[]} criticalPath={{ type: "strict" }} {...rest} /></Willow>;',
            '}',
        ].join('\n'));
        write('src/components/other.tsx', "import { Grid } from '@svar-ui/react-grid';\nexport const GanttLike = Grid;\n");
        write('src/components/theme.css', "@import '@svar-ui/react-core/all.css';\n");
        write('messages/en.json', JSON.stringify({ a: 'Open the Gantt chart' }));
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('flags an unpinned version, a PRO name, a non-MIT licence, the GPL predecessor and a loose pin', () => {
        const problems = lockfileProblems(root);
        expect(problems).toEqual(
            expect.arrayContaining([
                '@svar-ui/gantt-store@2.9.0: not on the pinned list',
                '@svar-ui/react-gantt-pro: a PRO or trial package',
                '@svar-ui/react-gantt-pro@2.8.3: declares SEE LICENSE',
                'wx-react-gantt: the GPL-3.0 predecessor',
                'package.json: @svar-ui/react-core (only @svar-ui/react-gantt is a direct dependency)',
                'package.json: @svar-ui/react-gantt is ^2.8.3, not exactly 2.8.3',
            ]),
        );
        expect(problems.some((p) => p.startsWith('@svar-ui/react-gantt@2.8.3'))).toBe(false);
    });

    it('flags an import outside the adapter, a stylesheet off the allowlist and a CSS @import', () => {
        expect(importProblems(root)).toEqual(
            expect.arrayContaining([
                `${ADAPTER}: imports @svar-ui/react-gantt/all.css (not on the allowlist)`,
                'src/components/other.tsx: imports @svar-ui/react-grid (only src/components/work-items/timeline/svar-adapter.tsx may)',
                'src/components/theme.css: a CSS @import of @svar-ui',
            ]),
        );
    });

    it('flags a theme without fonts={false}, a PRO prop, a spread and an extra component', () => {
        expect(adapterProblems(root)).toEqual(
            expect.arrayContaining([
                `${ADAPTER}: <Willow> without fonts={false} (it would load cdn.svar.dev)`,
                `${ADAPTER}: the widget is given criticalPath (not on the allowlist)`,
                `${ADAPTER}: a spread on the widget hides its props`,
                `${ADAPTER}: imports the component Toolbar (the timeline renders no toolbar, editor, menu or PRO view)`,
            ]),
        );
    });

    it('flags "Gantt" outside the import and in copy', () => {
        const problems = vocabularyProblems(root);
        expect(problems).toEqual(expect.arrayContaining(['src/components/other.tsx: the identifier GanttLike', `${ADAPTER}: the identifier Gantt`, 'messages/en.json: copy says "Gantt"']));
    });
});
