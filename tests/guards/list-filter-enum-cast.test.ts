/**
 * List filters are validated, never `as`-cast onto a Prisma enum column
 * (sub-phase 2.2). A query-string value cast with `as WorkItemPriority` tells
 * the compiler it is valid; a comma-joined multi-select or another list's
 * value then reaches Prisma and fails as a 500. Every list repository parses
 * through `parseEnumListFilter` (`src/app-layer/domain/list-filter.ts`).
 *
 * Copied in shape from inflect-compliance `tests/guards/list-filter-enum-cast.test.ts`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the expected site is
 * `WorkItemRepository.ts`, the population is read from git, and the detector
 * is proved against a planted repository.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { codeOf } from '../helpers/source-blocks';
import { gitFiles } from '../helpers/git-files';

const ROOT = path.resolve(__dirname, '../..');
const ENUMS = ['WorkflowStateCategory', 'WorkItemPriority', 'WorkItemRelationType', 'Role', 'MembershipStatus'];
/** The list repositories that must parse their enum filters. */
const EXPECTED_SITES = ['src/app-layer/repositories/WorkItemRepository.ts'];

function scan(root: string) {
    const files = gitFiles(root).filter((f) => f.startsWith('src/app-layer/repositories/') && f.endsWith('.ts'));
    const casts: string[] = [];
    const parsers: string[] = [];
    for (const f of files) {
        const code = codeOf(readFileSync(path.join(root, f), 'utf8'));
        for (const m of code.matchAll(new RegExp(`\\bas\\s+(${ENUMS.join('|')})\\b`, 'g'))) casts.push(`${f}: as ${m[1]}`);
        if (/\bparseEnumListFilter\b/.test(code)) parsers.push(f);
    }
    return { files, casts, parsers };
}

describe('list filters are parsed, never cast', () => {
    const result = scan(ROOT);

    it('no repository casts a value onto a list enum', () => {
        expect(result.files.length).toBeGreaterThan(3);
        expect(result.casts).toEqual([]);
    });

    it('every list repository parses its enum filters through parseEnumListFilter', () => {
        expect(EXPECTED_SITES.filter((f) => !result.parsers.includes(f))).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    it('flags a cast and misses no parser', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'enum-cast-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: dir });
            mkdirSync(path.join(dir, 'src/app-layer/repositories'), { recursive: true });
            writeFileSync(
                path.join(dir, 'src/app-layer/repositories/Planted.ts'),
                "// as WorkItemPriority in a comment does not count\nexport const w = { priority: raw as WorkItemPriority };\n",
            );
            writeFileSync(path.join(dir, 'src/app-layer/repositories/Good.ts'), 'import { parseEnumListFilter } from "x";\n');
            const planted = scan(dir);
            expect(planted.casts).toEqual(['src/app-layer/repositories/Planted.ts: as WorkItemPriority']);
            expect(planted.parsers).toEqual(['src/app-layer/repositories/Good.ts']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
