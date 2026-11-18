/**
 * No module a `'use client'` file can reach imports the server env module.
 *
 * `src/env.ts` holds the server variables' schema. Their values never reach a
 * browser, but the schema is ordinary module code: if any `'use client'` file
 * reaches it through any chain of imports, `next build` ships every key name
 * and validator in that route's client JavaScript, and t3-env would throw on
 * the first server key read in the browser. Client code reads
 * `@/env-client`, which declares `NEXT_PUBLIC_` variables only.
 *
 * There is no allowlist. A client-reachable module that needs a variable
 * declares it in `src/env-client.ts` with the `NEXT_PUBLIC_` prefix, which is
 * the only kind a browser can read anyway; if it needs a server variable, it
 * is not really client code and the server part moves behind a server module.
 *
 * One edge is a boundary, not a path: an import of a module whose directive
 * prologue holds `'use server'`. Next.js bundles a server-reference stub in
 * its place, so what that module imports stays on the server. The walk records
 * such edges in `serverBoundaries` and does not descend into them.
 *
 * The second half of this file plants a small repository in a temp directory
 * and runs the same check against it, so the guard is shown to catch a
 * violation (two hops away, through an alias, an index file, a re-export, a
 * `require()` and a dynamic import) rather than passing because it walked
 * nothing, and to stop at a `'use server'` module and nowhere else.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, REPO_ROOT } from '../helpers/git-files';
import type { BoundaryReport } from '../helpers/import-graph';
import {
    ALIAS_PREFIX,
    ALIAS_TARGET_DIR,
    analyseModule,
    checkClientEnvBoundary,
    formatChain,
} from '../helpers/import-graph';

const THIS_FILE = 'tests/guards/client-env-boundary.test.ts';

describe('the client env boundary in this repository', () => {
    let report: BoundaryReport;
    beforeAll(() => {
        report = checkClientEnvBoundary(REPO_ROOT);
    });

    it('no `use client` file can reach src/env.ts', () => {
        expect(report.violations.map((v) => formatChain(v.chain))).toEqual([]);
    });

    it("src/env.ts is not a 'use server' module, and no client edge stops at it as a boundary", () => {
        // A directive on the env module would turn a client import of it into a
        // server-reference stub. The walk refuses to treat it as a boundary
        // anyway; this pins the file itself too.
        const source = fs.readFileSync(path.join(REPO_ROOT, 'src/env.ts'), 'utf8');
        expect(analyseModule(source, 'src/env.ts').isServerReference).toBe(false);
        expect(report.serverBoundaries.filter((b) => b.to === 'src/env.ts')).toEqual([]);
    });

    it('every local import in the client graph resolves to a file', () => {
        // An unresolved `@/x` would be an edge the walk silently dropped.
        expect(report.unresolved).toEqual([]);
    });

    it('every import() and require() in the client graph has a literal specifier', () => {
        // A computed specifier is an edge nobody can follow; write it literally.
        expect(report.opaque).toEqual([]);
    });

    it('imports none of its own workspace packages from client code until the walk can follow them', () => {
        // A workspace package's source is bundled like any local file, but the
        // walker does not resolve bare specifiers yet (sub-phase 1.2 adds that).
        expect(report.workspaceImports).toEqual([]);
    });

    it('took its population from git, and that population is this work tree', () => {
        expect(report.population).toEqual(expect.arrayContaining(['src/env.ts', 'src/env-client.ts', THIS_FILE]));
        expect(report.population.filter((p) => /^(node_modules|\.next)\//.test(p))).toEqual([]);
        // Every client entry comes from that population.
        expect(report.clientEntries.filter((e) => !report.population.includes(e))).toEqual([]);
    });

    it('resolves `@/` exactly as tsconfig.json declares it', () => {
        const tsconfig = ts.readConfigFile(path.join(REPO_ROOT, 'tsconfig.json'), ts.sys.readFile);
        expect(tsconfig.error).toBeUndefined();
        const paths = (tsconfig.config as { compilerOptions: { paths: Record<string, string[]> } }).compilerOptions
            .paths;
        expect(paths).toEqual({ [`${ALIAS_PREFIX}*`]: [`./${ALIAS_TARGET_DIR}/*`] });
    });
});

/** The keys of each property of the object literal passed to `createEnv`. */
function createEnvBlocks(file: string): Record<string, string[]> {
    const source = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const blocks: Record<string, string[]> = {};
    let calls = 0;
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createEnv') {
            calls++;
            const [options] = node.arguments;
            if (options && ts.isObjectLiteralExpression(options)) {
                for (const prop of options.properties) {
                    if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) continue;
                    blocks[prop.name.getText(sf)] = prop.initializer.properties.map((p) => p.name?.getText(sf) ?? '?');
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(calls).toBe(1);
    return blocks;
}

describe('the two env modules keep their halves', () => {
    it('src/env-client.ts declares only NEXT_PUBLIC_ client variables, and no server block', () => {
        const blocks = createEnvBlocks('src/env-client.ts');
        expect(blocks.client?.length).toBeGreaterThan(0);
        expect({
            notPublic: (blocks.client ?? []).filter((k) => !k.startsWith('NEXT_PUBLIC_')),
            server: blocks.server ?? null,
            shared: blocks.shared ?? null,
        }).toEqual({ notPublic: [], server: null, shared: null });
    });

    it('src/env.ts declares server variables only', () => {
        const blocks = createEnvBlocks('src/env.ts');
        expect(blocks.server?.length).toBeGreaterThan(0);
        expect({
            client: blocks.client ?? null,
            publicInServer: (blocks.server ?? []).filter((k) => k.startsWith('NEXT_PUBLIC_')),
        }).toEqual({ client: null, publicInServer: [] });
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    const plant = (files: Record<string, string>) => {
        for (const [rel, content] of Object.entries(files)) {
            const file = path.join(root, rel);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, content);
        }
    };

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-env-guard-'));
        // A repository of its own, so the population really comes from git.
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant({
            '.gitignore': 'src/generated/\n',
            'src/env.ts': 'export const env = { DATABASE_URL: "x" };\n',
            'src/env-client.ts': 'export const env = { NEXT_PUBLIC_APP_URL: "x" };\n',

            // Two hops: client -> relative module -> @/env.
            'src/components/badge.tsx': [
                '﻿// A comment may precede the directive.',
                "'use client';",
                "import { label } from './format';",
                'export const Badge = () => label;',
            ].join('\n'),
            'src/components/format.ts': "import { env } from '@/env';\nexport const label = String(env);\n",

            // Alias to an index file, a re-export, then require() of a relative path.
            'src/app/panel.tsx': '"use client";\nimport { settings } from "@/lib/settings";\nexport { settings };\n',
            'src/lib/settings/index.ts': "export { settings } from './read';\n",
            'src/lib/settings/read.ts': "const m = require('../../env');\nexport const settings = m;\n",

            // A dynamic import is still bundled for the client.
            'src/components/lazy.tsx': "'use client';\nexport const load = () => import('./heavy');\n",
            'src/components/heavy.ts': "export * from '@/env';\n",

            // Clean: the client env module is not the server one.
            'src/components/link.tsx': "'use client';\nimport { env } from '@/env-client';\nexport const href = env;\n",

            // Clean: type-only edges are erased at compile time.
            'src/components/typed.tsx': [
                "'use client';",
                "import type { env } from '@/env';",
                "import { type env as Env2 } from '@/env';",
                "export type { env as E } from '@/env';",
                'export type T = typeof env | typeof Env2;',
            ].join('\n'),

            // Clean: a server module may import the server env.
            'src/server/report.ts': "import { env } from '@/env';\nexport const r = env;\n",

            // Clean: a directive after an import is not a directive.
            'src/components/late.tsx': "import '@/env';\n'use client';\n",

            // Clean: git ignores it, so it is not part of the population.
            'src/generated/ignored.tsx': "'use client';\nimport '@/env';\n",
        });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('names every offending client file with its shortest chain, and nothing else', () => {
        const report = checkClientEnvBoundary(root);

        expect(report.violations).toEqual([
            {
                entry: 'src/app/panel.tsx',
                chain: ['src/app/panel.tsx', 'src/lib/settings/index.ts', 'src/lib/settings/read.ts', 'src/env.ts'],
            },
            {
                entry: 'src/components/badge.tsx',
                chain: ['src/components/badge.tsx', 'src/components/format.ts', 'src/env.ts'],
            },
            {
                entry: 'src/components/lazy.tsx',
                chain: ['src/components/lazy.tsx', 'src/components/heavy.ts', 'src/env.ts'],
            },
        ]);
        expect(report.clientEntries).toEqual([
            'src/app/panel.tsx',
            'src/components/badge.tsx',
            'src/components/lazy.tsx',
            'src/components/link.tsx',
            'src/components/typed.tsx',
        ]);
        expect(report.population).not.toContain('src/generated/ignored.tsx');
        expect(report.reached.has('src/env-client.ts')).toBe(true);
        expect(report.unresolved).toEqual([]);
        expect(report.opaque).toEqual([]);
        expect(report.workspaceImports).toEqual([]);
        expect(report.serverBoundaries).toEqual([]);
    });

    it('also walks from the files Next.js ships to the browser without a directive', () => {
        plant({
            // Loaded in the browser by convention, with no 'use client'.
            'src/instrumentation-client.ts': "import { env } from '@/env';\nexport const e = env;\n",
            'instrumentation-client.js': "require('./src/components/format');\n",
            // Pages Router files are client code by default...
            'src/pages/legacy.tsx': "import { label } from '../components/format';\nexport default () => label;\n",
            'pages/_app.tsx': "import '@/env';\nexport default () => null;\n",
            // ...except API routes and _document, which run only on the server.
            'src/pages/api/report.ts': "import { env } from '@/env';\nexport default () => env;\n",
            'pages/_document.tsx': "import '@/env';\nexport default () => null;\n",
            // Tests are never bundled.
            'tests/unit/env.test.ts': "'use client';\nimport '@/env';\n",
        });

        const report = checkClientEnvBoundary(root);
        const chains = Object.fromEntries(report.violations.map((v) => [v.entry, v.chain]));
        expect(chains['src/instrumentation-client.ts']).toEqual(['src/instrumentation-client.ts', 'src/env.ts']);
        expect(chains['instrumentation-client.js']).toEqual(['instrumentation-client.js', 'src/components/format.ts', 'src/env.ts']);
        expect(chains['src/pages/legacy.tsx']).toEqual(['src/pages/legacy.tsx', 'src/components/format.ts', 'src/env.ts']);
        expect(chains['pages/_app.tsx']).toEqual(['pages/_app.tsx', 'src/env.ts']);
        expect(report.clientEntries).not.toEqual(expect.arrayContaining(['src/pages/api/report.ts']));
        expect(report.clientEntries).not.toContain('pages/_document.tsx');
        expect(report.clientEntries).not.toContain('tests/unit/env.test.ts');
    });

    it("reports a client import of the repository's own workspace package, which it cannot follow yet", () => {
        plant({
            'packages/ui/package.json': JSON.stringify({ name: '@acme/ui', version: '0.0.0' }),
            'packages/ui/src/button.tsx': "import { env } from '../../../src/env';\nexport const Button = env;\n",
            'src/components/toolbar.tsx': "'use client';\nimport { Button } from '@acme/ui/button';\nimport React from 'react';\nexport const T = [Button, React];\n",
        });

        const report = checkClientEnvBoundary(root);
        expect(report.workspaceImports).toEqual([{ from: 'src/components/toolbar.tsx', specifier: '@acme/ui/button' }]);
    });

    it("stops at a 'use server' module, whose imports stay on the server, and at nothing else", () => {
        plant({
            // Clean: client -> 'use server' module -> @/env. Next.js ships a stub for save().
            'src/components/save-button.tsx': [
                "'use client';",
                "import { save } from '@/app/actions';",
                'export const SaveButton = () => save;',
            ].join('\n'),
            'src/app/actions.ts': [
                '// Server Functions.',
                "'use server';",
                "import { env } from '@/env';",
                'export async function save() {',
                '    return String(env);',
                '}',
            ].join('\n'),

            // Still a violation: client -> plain module -> @/env, beside the boundary.
            'src/components/status.tsx': [
                "'use client';",
                "import { save } from '@/app/actions';",
                "import { label } from './format';",
                'export const Status = () => [save, label];',
            ].join('\n'),

            // Still a violation: 'use server' after an import is not a directive, so
            // this module is bundled like any other.
            'src/components/late-server.tsx': "'use client';\nimport { run } from '@/app/not-actions';\nexport const L = run;\n",
            'src/app/not-actions.ts': "import { env } from '@/env';\n'use server';\nexport async function run() {\n    return env;\n}\n",

            // Still a violation: a 'use server' inside a function body marks that one
            // function, not the module.
            'src/components/inline.tsx': "'use client';\nimport { act } from '@/lib/inline-action';\nexport const I = act;\n",
            'src/lib/inline-action.ts': "import { env } from '@/env';\nexport async function act() {\n    'use server';\n    return env;\n}\n",
        });

        const report = checkClientEnvBoundary(root);
        const chains = Object.fromEntries(report.violations.map((v) => [v.entry, v.chain]));
        expect(chains['src/components/save-button.tsx']).toBeUndefined();
        expect(chains['src/components/status.tsx']).toEqual(['src/components/status.tsx', 'src/components/format.ts', 'src/env.ts']);
        expect(chains['src/components/late-server.tsx']).toEqual(['src/components/late-server.tsx', 'src/app/not-actions.ts', 'src/env.ts']);
        expect(chains['src/components/inline.tsx']).toEqual(['src/components/inline.tsx', 'src/lib/inline-action.ts', 'src/env.ts']);
        expect(report.serverBoundaries).toEqual([
            { from: 'src/components/save-button.tsx', to: 'src/app/actions.ts' },
            { from: 'src/components/status.tsx', to: 'src/app/actions.ts' },
        ]);
        // The boundary module is not part of the client graph, and it is not an entry.
        expect(report.reached.has('src/app/actions.ts')).toBe(false);
        expect(report.clientEntries).not.toContain('src/app/actions.ts');

        // Remove the directive and the same import is a violation again.
        plant({ 'src/app/actions.ts': "import { env } from '@/env';\nexport async function save() {\n    return String(env);\n}\n" });
        const without = checkClientEnvBoundary(root);
        expect(Object.fromEntries(without.violations.map((v) => [v.entry, v.chain]))['src/components/save-button.tsx']).toEqual([
            'src/components/save-button.tsx',
            'src/app/actions.ts',
            'src/env.ts',
        ]);
        expect(without.serverBoundaries).toEqual([]);
    });

    it('goes green when the offending edge is fixed, so the verdict follows the source', () => {
        plant({ 'src/components/format.ts': "import { env } from '@/env-client';\nexport const label = String(env);\n" });

        const entries = checkClientEnvBoundary(root).violations.map((v) => v.entry);
        expect(entries).toEqual(['src/app/panel.tsx', 'src/components/lazy.tsx']);
    });

    it('reports holes in the graph instead of treating them as "no edge"', () => {
        plant({
            'src/components/holes.tsx': [
                "'use client';",
                "import { gone } from '@/lib/does-not-exist';",
                'const name = "./heavy";',
                'export const load = () => import(name);',
                'export { gone };',
            ].join('\n'),
        });

        const report = checkClientEnvBoundary(root);
        expect(report.unresolved).toEqual([{ from: 'src/components/holes.tsx', specifier: '@/lib/does-not-exist' }]);
        expect(report.opaque).toEqual([{ from: 'src/components/holes.tsx', call: 'import(name)' }]);
    });

    it('refuses to run outside a git work tree rather than walk the directory', () => {
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-not-git-'));
        try {
            expect(() => checkClientEnvBoundary(bare)).toThrow();
        } finally {
            fs.rmSync(bare, { recursive: true, force: true });
        }
    });
});

describe('module facts', () => {
    it.each([
        ["'use client';", true],
        ['"use client"', true],
        ["'use strict';\n'use client';", true],
        ['/* licence */\n// note\n"use client";', true],
        ["const x = 1;\n'use client';", false],
        ["`use client`;", false],
        ["'use server';", false],
        ['', false],
    ])('%j is a client entry: %s', (source, expected) => {
        expect(analyseModule(source, 'x.tsx').isClientEntry).toBe(expected);
    });

    it.each([
        ["'use server';", true],
        ['"use server"\nexport async function f() {}', true],
        ["'use strict';\n'use server';", true],
        ['/* note */\n"use server";', true],
        ["import x from 'x';\n'use server';", false],
        ["export async function f() {\n    'use server';\n}", false],
        ["'use client';", false],
        ['', false],
    ])('%j is a server-reference module: %s', (source, expected) => {
        expect(analyseModule(source, 'x.ts').isServerReference).toBe(expected);
    });

    it('collects every bundled edge and skips type-only ones', () => {
        const facts = analyseModule(
            [
                "import a from 'a';",
                "import 'side-effect';",
                "import type { T } from 'type-only';",
                "import { type U } from 'all-types';",
                "import { type V, w } from 'mixed';",
                "export * from 'star';",
                "export type { X } from 'type-reexport';",
                "import fs = require('eq');",
                "const r = require('req');",
                'const d = import(`tpl`);',
                "type Q = typeof import('import-type');",
            ].join('\n'),
            'x.ts',
        );
        expect(facts.specifiers).toEqual(['a', 'side-effect', 'mixed', 'star', 'eq', 'req', 'tpl']);
        expect(facts.opaque).toEqual([]);
    });
});
