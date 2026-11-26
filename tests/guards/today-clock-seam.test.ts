/**
 * The clock seam for "today" has one door (Hardening H2g, owner decision 180;
 * `src/lib/clock.ts`).
 *
 *   1. In Islestone's own `src/`, the date helpers that turn an instant into
 *      a day (`todayInTz`, `dayKeyInTz`, `todayIn`) never take a fresh clock
 *      read (`new Date()` or `Date.now()`) as that instant. A request asks
 *      `todayClock(zone)`, which the E2E server pins to `E2E_TODAY`; a job
 *      passes the `now` its runner gave it. A fresh read beside them would be
 *      a "today" the E2E server cannot fix, and a spec that crosses midnight
 *      would split across two days again.
 *   2. Only `src/env.ts`, `src/lib/clock.ts` and the startup refusal
 *      (`startup-test-clock-check.ts`, called from `instrumentation-node.ts`)
 *      name `E2E_TODAY`: nothing else reads the fixed day around the seam.
 *
 * Population: Islestone's own `src/` TypeScript from git (mirrored files out
 * of scope). The calls are found on the TypeScript AST, so a comment or a
 * string naming one is not a call. The detectors prove themselves on a
 * planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as ts from 'typescript';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

/** Each helper and the position of its instant argument. */
const DAY_HELPERS: Readonly<Record<string, number>> = { todayInTz: 0, dayKeyInTz: 0, todayIn: 1 };
/** The seam itself, and the two production refusals of the value. */
const E2E_TODAY_READERS = new Set([
    'src/env.ts',
    'src/lib/clock.ts',
    'src/lib/security/startup-test-clock-check.ts',
    'src/instrumentation-node.ts',
]);

function ownSources(root: string): string[] {
    const mirrorFile = path.join(root, 'ui-mirror.json');
    const mirrored = fs.existsSync(mirrorFile)
        ? new Set(Object.keys((JSON.parse(fs.readFileSync(mirrorFile, 'utf8')) as { files?: object }).files ?? {}))
        : new Set<string>();
    return gitFiles(root).filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel) && !rel.endsWith('.d.ts') && !mirrored.has(rel));
}

function isFreshClockRead(node: ts.Expression): boolean {
    if (ts.isNewExpression(node)) return ts.isIdentifier(node.expression) && node.expression.text === 'Date' && (node.arguments?.length ?? 0) === 0;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const callee = node.expression;
        return ts.isIdentifier(callee.expression) && callee.expression.text === 'Date' && callee.name.text === 'now';
    }
    return false;
}

function calleeName(call: ts.CallExpression): string | null {
    if (ts.isIdentifier(call.expression)) return call.expression.text;
    if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
    return null;
}

/** `file:line helper(...)` for every day helper fed a fresh clock read. */
function freshTodayReads(root: string): string[] {
    const found: string[] = [];
    for (const rel of ownSources(root)) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (node: ts.Node): void => {
            if (ts.isCallExpression(node)) {
                const name = calleeName(node);
                const at = name === null ? undefined : DAY_HELPERS[name];
                const arg = at === undefined ? undefined : node.arguments[at];
                if (arg && isFreshClockRead(arg)) {
                    found.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${name}`);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    return found;
}

function e2eTodayReaders(root: string): string[] {
    return ownSources(root).filter((rel) => !E2E_TODAY_READERS.has(rel) && /\bE2E_TODAY\b/.test(codeOf(fs.readFileSync(path.join(root, rel), 'utf8'))));
}

describe('the clock seam for "today", in this repository', () => {
    it('no date helper takes a fresh clock read as its instant (ask todayClock)', () => {
        expect(freshTodayReads(REPO_ROOT)).toEqual([]);
    });

    it('only the env schema, the seam and the startup refusal name E2E_TODAY', () => {
        expect(e2eTodayReaders(REPO_ROOT)).toEqual([]);
    });

    it('the seam is used (the population is not empty)', () => {
        const callers = ownSources(REPO_ROOT).filter((rel) => /\btodayClock\(/.test(codeOf(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))));
        expect(callers).toEqual(
            expect.arrayContaining([
                'src/app-layer/usecases/cycle.ts',
                'src/app-layer/usecases/recurrence.ts',
                'src/app-layer/usecases/work-item.ts',
                'src/app-layer/usecases/work-item-calendar.ts',
                'src/app-layer/usecases/work-item-shared.ts',
            ]),
        );
    });
});

describe('the detectors, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-today-seam-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant: Record<string, string> = {
            'ui-mirror.json': JSON.stringify({ files: { 'src/components/ui/mirrored.ts': 'x' } }),
            'src/components/ui/mirrored.ts': 'todayInTz(new Date(), tz);\n',
            'src/a.ts': 'const d = todayInTz(new Date(), tz);\n',
            'src/b.ts': 'const e = todayIn(zone, Date.now());\n',
            'src/c.tsx': 'const k = due.dayKeyInTz(new Date(), tz);\n',
            'src/ok.ts':
                '// todayInTz(new Date(), tz) in prose\nconst s = "todayIn(z, new Date())";\n' +
                'todayInTz(todayClock(tz), tz);\ntodayIn(zone, todayClock(zone, now));\ntodayIn(zone, row.startedAt);\n' +
                "todayInTz(new Date('2026-01-01'), tz);\ntodayIn(new Date(), zone);\n",
            'src/env.ts': 'E2E_TODAY: z.string(),\n',
            'src/lib/clock.ts': 'env.E2E_TODAY;\n',
            'src/reader.ts': 'const t = env.E2E_TODAY;\n',
            'src/prose.ts': '// E2E_TODAY is read by the clock\nexport const p = 1;\n',
        };
        for (const [rel, content] of Object.entries(plant)) {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        }
    });

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds each fresh clock read in the instant position, not prose, strings, the seam or a mirror', () => {
        expect(freshTodayReads(root)).toEqual(['src/a.ts:1 todayInTz', 'src/b.ts:1 todayIn', 'src/c.tsx:1 dayKeyInTz']);
    });

    it('finds a reader of E2E_TODAY outside the two allowed files, not prose', () => {
        expect(e2eTodayReaders(root)).toEqual(['src/reader.ts']);
    });
});
