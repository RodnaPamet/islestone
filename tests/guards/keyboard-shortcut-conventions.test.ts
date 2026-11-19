/**
 * The keyboard-shortcut conventions (Epic 57; sub-phase 1.7):
 *
 *   1. No `document`/`window` `keydown` listener in Islestone's code. Every
 *      shortcut goes through `useKeyboardShortcut`, whose registry owns the
 *      one listener, the typing-safe guard and the palette's discoverability
 *      list. A second listener competes with it.
 *   2. Every `useKeyboardShortcut(...)` call passes a `description`. The
 *      command palette and the help overlay (`mod+/`) list each shortcut by
 *      it; without one the binding is undiscoverable.
 *
 * Population: Islestone's own `src/` files, from git. Mirrored files
 * (`ui-mirror.json`) are inflect's, byte for byte, and out of scope; so is
 * the hook itself, which owns the listener. Comments are masked
 * (`codeOf`), so prose naming a call is not a call.
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guardrails/keyboard-shortcut-conventions.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e, with the population from git and
 * a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const HOOK_FILES = new Set(['src/lib/hooks/use-keyboard-shortcut.tsx']);
const KEYDOWN_LISTENER = /\b(?:document|window)\s*\.\s*addEventListener\s*\(\s*['"`]keydown['"`]/g;

function ownSources(root: string): Array<{ rel: string; code: string }> {
    const mirrorFile = path.join(root, 'ui-mirror.json');
    const mirrored = fs.existsSync(mirrorFile)
        ? new Set(Object.keys((JSON.parse(fs.readFileSync(mirrorFile, 'utf8')) as { files?: object }).files ?? {}))
        : new Set<string>();
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.[jt]sx?$/.test(rel) && !mirrored.has(rel) && !HOOK_FILES.has(rel))
        .map((rel) => ({ rel, code: codeOf(fs.readFileSync(path.join(root, rel), 'utf8')) }));
}

/** The argument text of each `useKeyboardShortcut(` call, to its matching paren. */
function shortcutCalls(code: string): string[] {
    const calls: string[] = [];
    for (const m of code.matchAll(/\buseKeyboardShortcut\s*\(/g)) {
        let depth = 1;
        let i = (m.index ?? 0) + m[0].length;
        const start = i;
        for (; i < code.length && depth > 0; i++) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') depth--;
        }
        calls.push(code.slice(start, i - 1));
    }
    return calls;
}

function rawListeners(root: string): string[] {
    return ownSources(root).flatMap(({ rel, code }) => (code.match(KEYDOWN_LISTENER) ?? []).map(() => rel));
}

function undescribedShortcuts(root: string): string[] {
    return ownSources(root).flatMap(({ rel, code }) =>
        shortcutCalls(code)
            .filter((args) => !/\bdescription\s*:/.test(args))
            .map(() => rel),
    );
}

describe('keyboard shortcut conventions, in this repository', () => {
    it('no raw keydown listener outside the shared hook', () => {
        expect(rawListeners(REPO_ROOT)).toEqual([]);
    });

    it('every useKeyboardShortcut call carries a description', () => {
        expect(undescribedShortcuts(REPO_ROOT)).toEqual([]);
    });

    it('the shell registers its shortcuts through the hook (the population is not empty)', () => {
        const callers = ownSources(REPO_ROOT).filter(({ code }) => shortcutCalls(code).length > 0).map((f) => f.rel);
        expect(callers).toEqual(
            expect.arrayContaining([
                'src/components/app-shell/shortcut-help-overlay.tsx',
                'src/components/command-palette/command-palette-provider.tsx',
            ]),
        );
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-shortcuts-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'ui-mirror.json': JSON.stringify({ files: { 'src/components/ui/mirrored.tsx': 'x' } }),
            'src/lib/hooks/use-keyboard-shortcut.tsx': "window.addEventListener('keydown', () => {});\n",
            'src/components/ui/mirrored.tsx': "document.addEventListener('keydown', () => {});\n",
            'src/components/a.tsx': "document.addEventListener(\"keydown\", () => {});\n",
            'src/components/b.tsx': "window . addEventListener ( 'keydown', f );\n",
            'src/components/c.tsx': "// window.addEventListener('keydown', f) in prose\nexport const c = 1;\n",
            'src/components/d.tsx':
                "useKeyboardShortcut('mod+k', open, { description: t('open') });\nuseKeyboardShortcut('g', go, { enabled: f(1) });\n",
            'src/components/e.tsx': "useKeyboardShortcut('x', run);\n",
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds the raw listeners, not the hook, a mirror or prose', () => {
        expect(rawListeners(root)).toEqual(['src/components/a.tsx', 'src/components/b.tsx']);
    });

    it('finds each call without a description, nested parentheses and all', () => {
        expect(undescribedShortcuts(root)).toEqual(['src/components/d.tsx', 'src/components/e.tsx']);
    });
});
