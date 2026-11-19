/**
 * Multi-file schema durability ratchet.
 *
 * Locks in the multi-file Prisma schema layout so the repo can't silently
 * drift back to a monolithic `prisma/schema.prisma`:
 *
 *   1. The folder `prisma/schema/` exists and contains the domain files
 *      (base, enums, tenancy). A future change that deletes a domain file
 *      (collapsing the schema) trips this test; a new domain file adds
 *      coverage without breaking it.
 *
 *   2. `prisma.config.ts` names the folder as the schema. Prisma 7 reads
 *      every `.prisma` file in it; there is no preview flag involved.
 *
 *   3. NO file in the repo (outside this guard and the helper that owns the
 *      path constant) reads `prisma/schema.prisma` as if it were the
 *      canonical schema. A test that reads the schema uses
 *      `readPrismaSchema()` from `tests/helpers/prisma-schema.ts`.
 *
 * The last block runs the monolith-path scan on a planted repository.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { readPrismaSchema, readPrismaSchemaRaw } from '../helpers/prisma-schema';
import { codeOf } from '../helpers/source-blocks';

const SCHEMA_DIR = path.resolve(REPO_ROOT, 'prisma/schema');

const REQUIRED_DOMAIN_FILES = ['base.prisma', 'enums.prisma', 'tenancy.prisma'];

const THIS_FILE = 'tests/guards/prisma-schema-folder-coverage.test.ts';
const PATH_OWNER = 'tests/helpers/prisma-schema.ts';

/** Files under `root` that read `…/prisma/schema.prisma` with a real fs call. */
function monolithReaders(root: string): string[] {
    const re = /(?:readFileSync|existsSync|statSync)\([^)]*['"][^'"]*prisma\/schema\.prisma['"][^)]*\)/;
    return gitFiles(root)
        .filter((rel) => /\.tsx?$/.test(rel))
        .filter((rel) => rel !== PATH_OWNER && rel !== THIS_FILE)
        .filter((rel) => re.test(codeOf(fs.readFileSync(path.join(root, rel), 'utf-8'))));
}

describe('multi-file Prisma schema layout', () => {
    it('prisma/schema/ folder exists', () => {
        expect(fs.existsSync(SCHEMA_DIR)).toBe(true);
        expect(fs.statSync(SCHEMA_DIR).isDirectory()).toBe(true);
    });

    it('the monolithic prisma/schema.prisma does NOT exist', () => {
        // Prisma's auto-detection prefers the single-file form when both
        // layouts are present, which would silently revert the split.
        expect(fs.existsSync(path.resolve(REPO_ROOT, 'prisma/schema.prisma'))).toBe(false);
    });

    for (const fname of REQUIRED_DOMAIN_FILES) {
        it(`prisma/schema/${fname} exists`, () => {
            expect(fs.existsSync(path.join(SCHEMA_DIR, fname))).toBe(true);
        });
    }

    it('Prisma resolves the schema folder layout', () => {
        // Prisma 7 declares the location in `prisma.config.ts`. Pin the
        // config path so a future cleanup can't silently revert to the
        // monolith.
        const config = codeOf(fs.readFileSync(path.resolve(REPO_ROOT, 'prisma.config.ts'), 'utf-8'));
        expect(config).toMatch(/schema:\s*path\.join\(\s*'prisma',\s*'schema'\s*\)/);
    });

    it('base.prisma owns the only generator + datasource blocks', () => {
        // Other files in prisma/schema/ MUST NOT redeclare these — Prisma
        // rejects duplicates across the folder.
        const others = fs.readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma') && f !== 'base.prisma');
        expect(others.length).toBeGreaterThan(0);
        for (const f of others) {
            const src = codeOf(fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf-8'));
            expect(src).not.toMatch(/^\s*generator\s+\w+\s*\{/m);
            expect(src).not.toMatch(/^\s*datasource\s+\w+\s*\{/m);
        }
        const base = codeOf(fs.readFileSync(path.join(SCHEMA_DIR, 'base.prisma'), 'utf-8'));
        expect(base).toMatch(/^\s*generator\s+client\s*\{/m);
        expect(base).toMatch(/^\s*datasource\s+db\s*\{/m);
    });

    it('readPrismaSchema masks comments at the seam, preserving offsets', () => {
        const raw = readPrismaSchemaRaw();
        const masked = readPrismaSchema();
        const commentLines = (s: string) => s.split('\n').filter((l) => /^\s*\/\//.test(l)).length;

        // Positive control FIRST: with no comments to blank, everything below
        // passes vacuously.
        expect(commentLines(raw)).toBeGreaterThan(0);
        expect(masked).not.toEqual(raw);
        expect(masked).toEqual(codeOf(raw));

        // Offsets agree, so every indexOf/slice and /^…$/m anchor lines up
        // against either text.
        expect(masked.length).toEqual(raw.length);
        expect(masked.split('\n').length).toEqual(raw.split('\n').length);
        expect(commentLines(masked)).toBe(0);
    });

    it('no file reads the monolith path as a real file (only comments may mention it)', () => {
        // A test doing `fs.readFileSync('prisma/schema.prisma')` would fail at
        // runtime with an opaque message. Caught here so the message points at
        // the fix: use readPrismaSchema() from tests/helpers/prisma-schema.ts.
        expect(monolithReaders(REPO_ROOT)).toEqual([]);
    });
});

describe('the monolith-path scan, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-schema-folder-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant('tests/bad.test.ts', "import * as fs from 'fs';\nfs.readFileSync('prisma/schema.prisma', 'utf8');\n");
        plant('tests/comment.test.ts', "// fs.readFileSync('prisma/schema.prisma') is the old way\nexport {};\n");
        plant(PATH_OWNER, "import * as fs from 'fs';\nfs.existsSync('prisma/schema.prisma');\n");
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('reports the real read, and not the comment or the path owner', () => {
        expect(monolithReaders(root)).toEqual(['tests/bad.test.ts']);
    });
});
