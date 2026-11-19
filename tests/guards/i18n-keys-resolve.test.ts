/**
 * Every literal translation key a file calls resolves in `messages/en.json`.
 *
 * The catalogue is built key by key (the 1.2 and 1.7 maps): a namespace is
 * copied only where it is read, so a key a component calls and nobody added
 * is a real risk, and nothing else in CI compares the code to the catalogue.
 * In a browser a missing key renders as its dotted path.
 *
 * How a call is resolved: `const t = useTranslations('nav')` (or
 * `await getTranslations('nav')`) binds an identifier to a namespace in one
 * statement, so `t('settings')` reads `nav.settings`. An identifier bound
 * twice in one file (two components, two namespaces) is ambiguous to a static
 * reader, and so is a namespace call that is not a simple `const` binding;
 * those files are counted as UNBOUND and capped, and the rendered tests cover
 * them. Only LITERAL keys are checked: a computed key
 * (`t(\`sections.${key}\`)`) or a concatenated one is the rendered tests' job.
 * Comments are masked, so prose naming a key neither satisfies nor trips it.
 *
 * Written for Islestone from inflect-compliance's
 * `tests/guards/i18n-keys-resolve.test.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e (sub-phase 1.7): English only, the
 * population from git, and a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

/**
 * Files whose translator cannot be bound to one namespace (see the header).
 * A DOWNWARD ratchet: each is a file this guard does not read. At 1.7: the
 * sign-in and reset-password pages, the command palette and the nav bar
 * (each binds `t` in two components) and six mirrored primitives.
 */
const UNBOUND_CEILING = 10;

const NAMESPACE_CALL = /\b(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g;
const BINDING = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g;

function callsOn(code: string, ident: string): string[] {
    // Not preceded by a word char, `.` or `$`, so `t(` does not match inside
    // `tNav(` or `obj.t(`; the key must be a whole literal, followed by `)`
    // or `,`, so a concatenated key is skipped rather than half-read.
    const re = new RegExp(`(?<![\\w.$])${ident.replace(/\$/g, '\\$')}\\(\\s*(['"])([A-Za-z0-9_.-]+)\\1\\s*(?=[),])`, 'g');
    return [...code.matchAll(re)].map((m) => m[2] as string);
}

/** Fully-qualified keys a file calls, or null when the file cannot be bound. */
export function qualifiedKeys(source: string): string[] | null {
    const code = codeOf(source);
    const namespaces = [...code.matchAll(NAMESPACE_CALL)].map((m) => m[1] as string);
    if (namespaces.length === 0) return [];
    const bindings = [...code.matchAll(BINDING)].map((m) => ({ ident: m[1] as string, ns: m[2] as string }));
    const byIdent = new Map<string, Set<string>>();
    for (const b of bindings) byIdent.set(b.ident, (byIdent.get(b.ident) ?? new Set()).add(b.ns));
    const rebound = [...byIdent.values()].some((s) => s.size > 1) || byIdent.size !== bindings.length;
    if (bindings.length !== namespaces.length || rebound) return null;
    return bindings.flatMap((b) => callsOn(code, b.ident).map((key) => `${b.ns}.${key}`));
}

function resolves(catalog: unknown, dotted: string): boolean {
    let node: unknown = catalog;
    for (const part of dotted.split('.')) {
        if (!node || typeof node !== 'object' || !(part in node)) return false;
        node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string';
}

function scan(root: string): { missing: string[]; unbound: string[]; checked: number } {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'messages/en.json'), 'utf8'));
    const missing: string[] = [];
    const unbound: string[] = [];
    let checked = 0;
    for (const rel of gitFiles(root)) {
        if (!rel.startsWith('src/') || !/\.tsx?$/.test(rel)) continue;
        const keys = qualifiedKeys(fs.readFileSync(path.join(root, rel), 'utf8'));
        if (keys === null) {
            unbound.push(rel);
            continue;
        }
        for (const key of keys) {
            checked += 1;
            if (!resolves(catalog, key)) missing.push(`${rel}: ${key}`);
        }
    }
    return { missing: missing.sort(), unbound: unbound.sort(), checked };
}

describe('literal translation keys resolve in messages/en.json', () => {
    const result = scan(REPO_ROOT);

    it('checks a real population', () => {
        expect(result.checked).toBeGreaterThan(300);
    });

    it('every literal key resolves', () => {
        expect(result.missing).toEqual([]);
    });

    it('the files it cannot bind stay at or under the ceiling', () => {
        expect(result.unbound.length).toBeLessThanOrEqual(UNBOUND_CEILING);
    });
});

describe('the scanner, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-i18n-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'messages/en.json': JSON.stringify({ nav: { settings: 'Settings', inbox: 'Inbox' }, common: { search: 'Search' } }),
            'src/ok.tsx': "const t = useTranslations('nav');\nt('settings'); t('inbox', { n: 1 });\n",
            'src/two.tsx': "const t = useTranslations('nav');\nconst tc = useTranslations('common');\nt('search'); tc('search');\n",
            'src/server.tsx': "const t = await getTranslations('common');\nt(\"missing\");\n",
            'src/computed.tsx': "const t = useTranslations('nav');\nt(`x.${k}`); t('pre.' + k);\n",
            'src/prose.tsx': "const t = useTranslations('nav');\n// t('nowhere') in a comment\n",
            'src/rebound.tsx': "const t = useTranslations('nav');\nfunction B() { const t = useTranslations('common'); }\n",
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('reports each unresolved key against its own namespace, and skips computed keys and prose', () => {
        const result = scan(root);
        expect(result.missing).toEqual(['src/server.tsx: common.missing', 'src/two.tsx: nav.search']);
        expect(result.unbound).toEqual(['src/rebound.tsx']);
        expect(result.checked).toBe(5);
    });
});
