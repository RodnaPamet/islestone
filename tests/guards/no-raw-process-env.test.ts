/**
 * No raw `process.env` read in `src/` outside the env modules.
 *
 * Server variables are read through `@/env` and `NEXT_PUBLIC_` ones through
 * `@/env-client`, so every variable is declared, validated and listed in
 * `.env.example`. The allowed readers:
 *
 * - the env modules themselves (`src/env.ts`, `src/env-client.ts`) and their
 *   shared flag reader `src/env-skip.ts`;
 * - the files mirrored byte-for-byte from inflect-compliance (`ui-mirror.json`),
 *   which are never edited here;
 * - `src/instrumentation.ts`, for `process.env.NEXT_RUNTIME` and nothing else
 *   (owner decision, 2026-11-19). Next.js inlines that literal per runtime, so
 *   the Edge bundle drops the Node-only startup checks; read through `@/env`,
 *   the branch survives the build and `next build` warns on `process.exit` and
 *   `crypto`.
 *
 * Comments are stripped before matching, so prose naming the rule is not a
 * read. The last block plants a repository with each kind of read and shows
 * each is judged as it should be, so the guard cannot pass by checking nothing.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const ENV_MODULES = new Set(['src/env.ts', 'src/env-client.ts', 'src/env-skip.ts']);

/** File → the only `process.env` members it may read. */
const NAMED_EXCEPTIONS: Record<string, readonly string[]> = {
    'src/instrumentation.ts': ['NEXT_RUNTIME'],
};

/** Every spelling of a `process.env` access, with the member when it names one. */
const READ = /\bprocess\s*(?:\.\s*env|\[\s*['"`]env['"`]\s*\])(?:\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|\s*\[\s*['"`]([^'"`]+)['"`]\s*\])?/g;

function mirroredFiles(root: string): Set<string> {
    const file = path.join(root, 'ui-mirror.json');
    if (!fs.existsSync(file)) return new Set();
    const mirror = JSON.parse(fs.readFileSync(file, 'utf8')) as { files?: Record<string, string> };
    return new Set(Object.keys(mirror.files ?? {}));
}

/** `file: member` for each read that breaks the rule (`<whole>` for a bare `process.env`). */
function violations(root: string): string[] {
    const mirrored = mirroredFiles(root);
    const out: string[] = [];
    for (const rel of gitFiles(root)) {
        if (!rel.startsWith('src/') || !/\.(?:[cm]?[jt]sx?)$/.test(rel) || rel.endsWith('.d.ts')) continue;
        if (ENV_MODULES.has(rel) || mirrored.has(rel)) continue;
        const code = codeOf(fs.readFileSync(path.join(root, rel), 'utf8'));
        const allowed = NAMED_EXCEPTIONS[rel] ?? [];
        for (const m of code.matchAll(READ)) {
            const member = m[1] ?? m[2];
            if (member && allowed.includes(member)) continue;
            out.push(`${rel}: ${member ?? '<whole>'}`);
        }
    }
    return out.sort();
}

describe('no raw process.env read in src/ outside the env modules', () => {
    it('finds none', () => {
        expect(violations(REPO_ROOT)).toEqual([]);
    });

    it('every named exception names a file that exists and still uses its exception', () => {
        for (const [rel, members] of Object.entries(NAMED_EXCEPTIONS)) {
            const code = codeOf(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
            for (const member of members) {
                expect(code).toContain(`process.env.${member}`);
            }
        }
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

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-raw-env-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        plant({
            '.gitignore': 'src/ignored/\n',
            'ui-mirror.json': JSON.stringify({ files: { 'src/components/ui/mirrored.tsx': 'x' } }),
            'src/env.ts': 'export const a = process.env.ANYTHING;\n',
            'src/env-client.ts': 'export const b = process.env.NEXT_PUBLIC_X;\n',
            'src/env-skip.ts': 'export const c = process.env.SKIP_ENV_VALIDATION;\n',
            'src/components/ui/mirrored.tsx': "export const d = process.env.NODE_ENV;\n",
            'src/instrumentation.ts':
                "export const e = process.env.NEXT_RUNTIME === 'nodejs';\nexport const f = process.env.NODE_ENV;\n",
            'src/lib/dotted.ts': 'export const g = process.env.SECRET;\n',
            'src/lib/optional.ts': 'export const h = process.env?.OTHER;\n',
            'src/lib/bracket.ts': "export const i = process['env']['KEY'];\n",
            'src/lib/whole.ts': 'export const j = { ...process.env };\n',
            'src/lib/commented.ts': '// process.env.SECRET is read through @/env\nexport const k = 1;\n',
            'src/ignored/also.ts': 'export const l = process.env.SECRET;\n',
            'scripts/outside.ts': 'export const m = process.env.SECRET;\n',
        });
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports exactly the reads that break the rule', () => {
        expect(violations(root)).toEqual([
            'src/instrumentation.ts: NODE_ENV',
            'src/lib/bracket.ts: KEY',
            'src/lib/dotted.ts: SECRET',
            'src/lib/optional.ts: OTHER',
            'src/lib/whole.ts: <whole>',
        ]);
    });
});
