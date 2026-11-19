/**
 * Structural ratchet — read-replica routing.
 *
 * Locks the primary/replica split:
 *   - the two clients (`prisma` + `prismaRead`) and the
 *     `runInTenantReadContext` helper exist, the helper READ ONLY;
 *   - the usecases listed in ROUTED_USECASES route through
 *     `runInTenantReadContext` (empty in sub-phase 1.3; analytics, 3.6, is
 *     the first expected entry);
 *   - NO write happens inside a read-context callback, in ANY file under
 *     src/ that opens one (population from git) — the read-after-write
 *     safety rule, scoped to the callback, since a usecase file can also
 *     contain legitimate write functions.
 *
 * The last block runs the write detector on a planted repository.
 * See docs/database-routing.md.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

// codeOf() masks comments at the READ SEAM: a comment mentioning
// `runInTenantReadContext(` must not satisfy the routing assertions below,
// and a write token inside a comment must not read as a write.
const readIn = (root: string, rel: string) =>
    fs.existsSync(path.join(root, rel)) ? codeOf(fs.readFileSync(path.join(root, rel), 'utf-8')) : '';
const read = (rel: string) => readIn(REPO_ROOT, rel);

const WRITE_TOKENS = [
    '.create(',
    '.createMany(',
    '.update(',
    '.updateMany(',
    '.delete(',
    '.deleteMany(',
    '.upsert(',
    '$executeRaw',
    'logEvent(',
    'appendAuditEntry(',
];

/**
 * Extract every `runInTenantReadContext( ... )` call's argument list by
 * balanced-paren matching, so the write-safety check is scoped to the read
 * callback — not the whole file.
 */
function readContextCallArgs(src: string): string[] {
    const out: string[] = [];
    const marker = 'runInTenantReadContext(';
    let i = src.indexOf(marker);
    while (i !== -1) {
        let depth = 0;
        const start = i + marker.length - 1; // at the '('
        let j = start;
        for (; j < src.length; j++) {
            if (src[j] === '(') depth++;
            else if (src[j] === ')') {
                depth--;
                if (depth === 0) break;
            }
        }
        out.push(src.slice(start + 1, j));
        i = src.indexOf(marker, j);
    }
    return out;
}

/** `file: token` for every write token inside a read-context callback under src/. */
function writesInReadContexts(root: string): string[] {
    const DEFINER = 'src/lib/db-context.ts';
    return gitFiles(root)
        .filter((rel) => rel.startsWith('src/') && /\.tsx?$/.test(rel) && rel !== DEFINER)
        .flatMap((rel) =>
            readContextCallArgs(readIn(root, rel)).flatMap((args) =>
                WRITE_TOKENS.filter((tok) => args.includes(tok)).map((tok) => `${rel}: ${tok}`),
            ),
        );
}

/** Usecase files whose dashboard/aggregation reads route to the replica. */
const ROUTED_USECASES: readonly string[] = [];

describe('read-replica clients + helper', () => {
    const prismaSrc = read('src/lib/prisma.ts');
    const ctxSrc = read('src/lib/db-context.ts');

    it('prisma.ts exports a prismaRead client', () => {
        expect(prismaSrc).toMatch(/export const prismaRead/);
    });

    it('db-context.ts exports runInTenantReadContext with a READ ONLY transaction on prismaRead', () => {
        expect(ctxSrc).toMatch(/export async function runInTenantReadContext/);
        expect(ctxSrc).toContain('SET TRANSACTION READ ONLY');
        expect(ctxSrc).toContain('prismaRead.$transaction(');
    });
});

describe('routed usecases use the replica', () => {
    // Jest throws on `it.each([])`, so the list is checked in one case.
    it('every ROUTED_USECASES entry exists and calls runInTenantReadContext', () => {
        const problems = ROUTED_USECASES.filter((rel) => !read(rel).includes('runInTenantReadContext('));
        expect(problems).toEqual([]);
    });
});

describe('read-after-write safety', () => {
    it('no file under src/ writes inside a read context', () => {
        expect(writesInReadContexts(REPO_ROOT)).toEqual([]);
    });
});

describe('the write detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-db-routing-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant(
            'src/app-layer/usecases/summary.ts',
            [
                'export const load = (ctx) => runInTenantReadContext(ctx, async (db) => {',
                '    const rows = await db.project.findMany();',
                '    await db.project.update({ where: { id: rows[0].id }, data: {} });',
                '    return rows;',
                '});',
                // A write OUTSIDE the read context is legitimate.
                'export const save = (ctx) => runInTenantContext(ctx, (db) => db.project.create({ data: {} }));',
            ].join('\n'),
        );
        plant(
            'src/app-layer/usecases/clean.ts',
            [
                'export const load = (ctx) => runInTenantReadContext(ctx, async (db) => {',
                '    // db.project.delete( is only a comment',
                '    return db.project.count();',
                '});',
            ].join('\n'),
        );
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports the write inside the read callback, and nothing else', () => {
        expect(writesInReadContexts(root)).toEqual(['src/app-layer/usecases/summary.ts: .update(']);
    });
});
