/**
 * No hard-coded UI copy in Islestone's components (sub-phase 1.7).
 *
 * Every word a member reads is a catalogue key (`messages/en.json`, English
 * only, built key by key): CLAUDE.md, "Copy is in messages/en.json; add a key
 * rather than a literal". This guard finds the two shapes a literal takes in
 * JSX — a text node with a word in it, and a string literal on a copy
 * attribute (`aria-label`, `title`, `placeholder`, `alt`) — in every
 * Islestone-owned `.tsx` file under `src/components/`, by parsing each file
 * with the TypeScript compiler (so comments and code are never mistaken for
 * copy). It starts from an empty baseline: `ALLOWED` names the two literals
 * that are not copy, each with its reason.
 *
 * Mirrored files (`ui-mirror.json`) are inflect's, byte for byte, and out of
 * scope. Pages under `src/app` are not scanned yet: the 1.1 gallery is a
 * developer page in English on purpose, and `global-error.tsx` renders
 * outside the intl provider.
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guardrails/i18n-adoption-ratchet.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (the rule; the detector is new),
 * with the population from git and a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

/** `file: literal` → why it is not copy. */
const ALLOWED: Record<string, string> = {
    'src/components/command-palette/command-palette.tsx: Esc': 'a key cap: the name printed on the key',
    'src/components/layout/SidebarNav.tsx: IS': "the brand mark's initials, a glyph like the nav bar's",
};

const COPY_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt']);
const HAS_WORD = /[A-Za-z]{2,}/;

function literalsIn(file: string, source: string): string[] {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
            const text = node.text.replace(/\s+/g, ' ').trim();
            if (HAS_WORD.test(text)) out.push(text);
        } else if (
            ts.isJsxAttribute(node) &&
            COPY_ATTRIBUTES.has(node.name.getText(sf)) &&
            node.initializer &&
            ts.isStringLiteral(node.initializer) &&
            HAS_WORD.test(node.initializer.text)
        ) {
            out.push(node.initializer.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

function hardCodedCopy(root: string): string[] {
    const mirrorFile = path.join(root, 'ui-mirror.json');
    const mirrored = fs.existsSync(mirrorFile)
        ? new Set(Object.keys((JSON.parse(fs.readFileSync(mirrorFile, 'utf8')) as { files?: object }).files ?? {}))
        : new Set<string>();
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/components/') && rel.endsWith('.tsx') && !mirrored.has(rel))
        .flatMap((rel) => literalsIn(rel, fs.readFileSync(path.join(root, rel), 'utf8')).map((text) => `${rel}: ${text}`))
        .sort();
}

describe('no hard-coded UI copy in src/components', () => {
    const found = hardCodedCopy(REPO_ROOT);

    it('finds nothing but the allowed literals', () => {
        expect(found.filter((entry) => !(entry in ALLOWED))).toEqual([]);
    });

    it('every allowed literal is still there (no stale entries)', () => {
        expect(Object.keys(ALLOWED).filter((entry) => !found.includes(entry))).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-copy-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'ui-mirror.json': JSON.stringify({ files: { 'src/components/ui/mirrored.tsx': 'x' } }),
            'src/components/a.tsx': 'export const A = () => <p title="Help text">Hello there {name}</p>;\n',
            'src/components/b.tsx': "export const B = () => <p aria-label={t('k')} data-x=\"Not copy\">{t('k')} · 3</p>;\n",
            'src/components/c.tsx': '// <p>In a comment</p>\nexport const C = () => <input placeholder="Search…" alt="" />;\n',
            'src/components/ui/mirrored.tsx': 'export const M = () => <p>Mirrored copy</p>;\n',
            'src/app/page.tsx': 'export default () => <p>A page</p>;\n',
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds text nodes and copy attributes, and nothing else', () => {
        expect(hardCodedCopy(root)).toEqual([
            'src/components/a.tsx: Hello there',
            'src/components/a.tsx: Help text',
            'src/components/c.tsx: Search…',
        ]);
    });
});
