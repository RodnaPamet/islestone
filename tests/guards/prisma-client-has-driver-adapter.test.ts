/**
 * Every Prisma client outside the tests is built with a driver adapter
 * (inflect-compliance #5242).
 *
 * Prisma 7 removed the built-in engine's connection handling: a client
 * constructed with no `adapter` throws `PrismaClientInitializationError` on
 * its first query. In inflect-compliance thirteen operator and seed scripts
 * still called `new PrismaClient()` and failed before doing any work.
 *
 * Scope: everything git tracks except `tests/` (whose clients are built by
 * the test helpers).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const CODE = /\.(ts|tsx|js|mjs|cjs)$/;
const OUT_OF_SCOPE = /^(tests)\//;

/** A `new PrismaClient(` call whose argument list never names `adapter`. */
function adapterlessCalls(raw: string): number {
    // Comments masked, so prose naming the call is not a call.
    const src = codeOf(raw);
    let count = 0;
    const re = /new PrismaClient\(/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        // Read to the matching close paren.
        let depth = 1;
        let i = m.index + m[0].length;
        for (; i < src.length && depth > 0; i++) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')') depth--;
        }
        if (!/\badapter\b/.test(src.slice(m.index, i))) count++;
    }
    return count;
}

function scan(root: string): { constructing: string[]; offenders: string[] } {
    const files = gitFiles(root).filter((f) => CODE.test(f) && !OUT_OF_SCOPE.test(f));
    const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    return {
        constructing: files.filter((f) => codeOf(read(f)).includes('new PrismaClient(')),
        offenders: files.filter((f) => adapterlessCalls(read(f)) > 0),
    };
}

describe('Prisma clients outside tests carry a driver adapter', () => {
    const report = scan(REPO_ROOT);

    it('reads the population (positive control): the app client is in it', () => {
        expect(report.constructing).toContain('src/lib/prisma.ts');
    });

    it('no file builds a client without one', () => {
        expect(report.offenders).toEqual([]);
    });

    it.each([
        ['new PrismaClient()', 1],
        ['new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })', 0],
        ['new PrismaClient({ log: ["warn"] })', 1],
        ['new PrismaClient({\n  adapter,\n  log: f(x),\n})', 0],
        ['// `new PrismaClient()` needs an adapter\nconst x = 1;', 0],
    ])('the detector: %s → %d', (src, expected) => {
        expect(adapterlessCalls(src)).toBe(expected);
    });
});

describe('the scan, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-prisma-adapter-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant('scripts/seed.ts', "import { PrismaClient } from '@prisma/client';\nconst p = new PrismaClient();\n");
        plant('src/lib/db.ts', 'const p = new PrismaClient({ adapter });\n');
        plant('tests/helper.ts', 'const p = new PrismaClient();\n');
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports the adapterless script, and not the adapter-built client or a test', () => {
        expect(scan(root)).toEqual({ constructing: ['scripts/seed.ts', 'src/lib/db.ts'], offenders: ['scripts/seed.ts'] });
    });
});
