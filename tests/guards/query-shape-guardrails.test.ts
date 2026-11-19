/**
 * Query-shape guardrails over `src/app-layer/` (roadmap H2: "no query in a
 * loop"; sub-phase 2.2, which 1.3's map sent this guard to).
 *
 *   D1 — no Prisma READ call inside a loop body (`for`, `while`, `.forEach`,
 *        `.map`): the N+1 shape. A deliberate bounded loop (a batched drain,
 *        one page per pass) says so on its line or the three above:
 *        `// guardrail-allow: n+1 — <reason>`.
 *   D2 — every repository `findMany` is bounded with `take:`, or says why not:
 *        `// guardrail-allow: unbounded — <reason>`. The budget of unbounded
 *        reads is ZERO.
 *
 * The scan is lexical over comment-masked code, so a read named in a
 * comment counts for nothing. The population is read from git, and the
 * detectors are proved against a planted repository with one violation of
 * each kind, so the guard cannot pass by checking nothing.
 *
 * Copied in shape from inflect-compliance `tests/guardrails/query-shape-guardrails.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: D1 and D2 kept, the population
 * from git, `UNBOUNDED_FINDMANY_BUDGET = 0`, and `KNOWN_N_PLUS_ONE` empty (the
 * source's entries name compliance files).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { gitFiles } from '../helpers/git-files';

const ROOT = path.resolve(__dirname, '../..');

/**
 * Files whose reads in loops are known and bounded, with the reason. A new
 * entry is a review, not a way to make CI green; prefer the in-line marker.
 */
const KNOWN_N_PLUS_ONE: Readonly<Record<string, string>> = {
    'src/app-layer/jobs/key-rotation.ts':
        'The master-key sweep (1.5b) pages each manifest field by id, one bounded SELECT per page; the loop IS the keyset pager.',
    'src/app-layer/jobs/tenant-dek-rotation.ts':
        'The DEK sweep (1.5b) pages by id like key-rotation, and re-reads a single row only on the rare conflict path where the row moved under it.',
};

const UNBOUNDED_FINDMANY_BUDGET = 0;

const READ_RE = /\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|count|groupBy|aggregate)\s*\(|\$queryRaw/g;

function matching(code: string, open: number, o: string, c: string): number {
    let depth = 0;
    for (let i = open; i < code.length; i++) {
        if (code[i] === o) depth++;
        else if (code[i] === c && --depth === 0) return i;
    }
    return -1;
}

/** The [start, end) spans of every loop body in comment-masked code. */
function loopBodies(code: string): Array<[number, number]> {
    const spans: Array<[number, number]> = [];
    for (const m of code.matchAll(/\b(for|while)\s*\(/g)) {
        const open = code.indexOf('(', m.index!);
        const close = matching(code, open, '(', ')');
        if (close < 0) continue;
        const rest = code.slice(close + 1);
        const brace = rest.search(/\S/);
        if (rest[brace] === '{') {
            const start = close + 1 + brace;
            spans.push([start, matching(code, start, '{', '}')]);
        } else {
            spans.push([close + 1, code.indexOf(';', close + 1)]);
        }
    }
    for (const m of code.matchAll(/\.(forEach|map)\s*\(/g)) {
        const open = code.indexOf('(', m.index!);
        spans.push([open, matching(code, open, '(', ')')]);
    }
    return spans.filter(([a, b]) => a >= 0 && b > a);
}

const lineOf = (src: string, index: number) => src.slice(0, index).split('\n').length;

function allowed(lines: string[], line: number, marker: string): boolean {
    for (let l = Math.max(1, line - 3); l <= line; l++) if (lines[l - 1]?.includes(marker)) return true;
    return false;
}

/** D1 findings: `file:line` of each read inside a loop with no marker. */
export function readsInLoops(file: string, src: string): string[] {
    const code = codeOf(src);
    const lines = src.split('\n');
    const out = new Set<string>();
    for (const [a, b] of loopBodies(code)) {
        const body = code.slice(a, b);
        for (const m of body.matchAll(READ_RE)) {
            const line = lineOf(src, a + m.index!);
            if (!allowed(lines, line, 'guardrail-allow: n+1')) out.add(`${file}:${line}`);
        }
    }
    return [...out];
}

/** D2 findings: `file:line` of each `findMany(` call with no `take:` and no marker. */
export function unboundedFindMany(file: string, src: string): string[] {
    const code = codeOf(src);
    const lines = src.split('\n');
    const out: string[] = [];
    for (const m of code.matchAll(/\.findMany\s*\(/g)) {
        const open = code.indexOf('(', m.index!);
        const args = code.slice(open, matching(code, open, '(', ')') + 1);
        const line = lineOf(src, m.index!);
        if (!/\btake\s*(:|,|\}|\n)/.test(args) && !allowed(lines, line, 'guardrail-allow: unbounded')) out.push(`${file}:${line}`);
    }
    return out;
}

function scan(root: string) {
    const files = gitFiles(root).filter((f) => f.startsWith('src/app-layer/') && /\.tsx?$/.test(f));
    const d1: string[] = [];
    const d2: string[] = [];
    for (const f of files) {
        const src = readFileSync(path.join(root, f), 'utf8');
        d1.push(...readsInLoops(f, src));
        if (f.startsWith('src/app-layer/repositories/')) d2.push(...unboundedFindMany(f, src));
    }
    return { files, d1, d2 };
}

describe('query-shape guardrails (D1, D2)', () => {
    const result = scan(ROOT);

    it('reads its population from git, and it holds the work-item repositories', () => {
        expect(result.files.length).toBeGreaterThan(50);
        expect(result.files).toContain('src/app-layer/repositories/WorkItemRepository.ts');
    });

    it('D1: no Prisma read inside a loop, unless marked as a bounded pass', () => {
        expect(result.d1.filter((site) => !(site.split(':')[0]! in KNOWN_N_PLUS_ONE))).toEqual([]);
        for (const reason of Object.values(KNOWN_N_PLUS_ONE)) expect(reason.length).toBeGreaterThan(40);
    });

    it(`D2: unbounded repository findMany calls stay within the budget (${UNBOUNDED_FINDMANY_BUDGET})`, () => {
        // Named first, so a failure lists the sites.
        expect(result.d2.slice(UNBOUNDED_FINDMANY_BUDGET)).toEqual([]);
    });

    it('KNOWN_N_PLUS_ONE carries no stale entries', () => {
        for (const file of Object.keys(KNOWN_N_PLUS_ONE)) {
            expect(result.d1.some((site) => site.startsWith(`${file}:`))).toBe(true);
        }
    });
});

describe('the detectors, against a planted repository', () => {
    it('flag a read in a loop and an unbounded findMany, and pass the marked and bounded shapes', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'query-shape-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: dir });
            mkdirSync(path.join(dir, 'src/app-layer/repositories'), { recursive: true });
            writeFileSync(
                path.join(dir, 'src/app-layer/repositories/Planted.ts'),
                [
                    'export async function bad(db, ids) {',
                    '    for (const id of ids) {',
                    '        await db.workItem.findFirst({ where: { id }, take: 1 });',
                    '    }',
                    '    // a comment naming db.workItem.findMany( counts for nothing',
                    '    return db.workItem.findMany({ where: {} });',
                    '}',
                    'export async function good(db, ids) {',
                    '    for (;;) {',
                    '        // guardrail-allow: n+1 — a bounded drain',
                    '        const page = await db.workItem.findMany({ where: {}, take: 10 });',
                    '        if (page.length === 0) break;',
                    '    }',
                    '    return db.workItem.findMany({ where: { id: { in: ids } }, take: ids.length });',
                    '}',
                ].join('\n'),
            );
            const planted = scan(dir);
            expect(planted.files).toEqual(['src/app-layer/repositories/Planted.ts']);
            expect(planted.d1).toEqual(['src/app-layer/repositories/Planted.ts:3']);
            expect(planted.d2).toEqual(['src/app-layer/repositories/Planted.ts:6']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
