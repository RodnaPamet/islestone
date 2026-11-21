/**
 * The H2 permission matrix's static half (owner decisions 175 and 176;
 * `docs/porting/maps/H2.md`, part 3):
 *
 *   - every tenant route file under `src/app/api/t/[tenantSlug]/` (read
 *     from git) and every method it exports has at least one row in the
 *     hand-written table (`tests/integration/permission-matrix/table.ts`),
 *     and every row names a route and method that exist. A new tenant route
 *     without a row fails here, naming it; the integration suites then drive
 *     the row against every role;
 *   - the guest tripwire (decision 176): while a guest sees no project, every
 *     GUEST cell is tagged `until: '8.4'`; once 8.4 changes the rule
 *     (`resolveProjectVisibility` gives a guest projects, GUEST becomes
 *     assignable, or the visibility functions are rewritten), every tagged
 *     cell fails until it is rewritten and untagged.
 *
 * Both detectors are proved against planted inputs: a throwaway git
 * repository with a route the table lacks and a row naming a gone route, and
 * guest states before and after 8.4.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveProjectVisibility } from '@/app-layer/policies/project-visibility';
import { ASSIGNABLE_TENANT_ROLES } from '@/lib/roles';

import { gitEnvFor, gitFiles } from '../helpers/git-files';
import { declarationOf, functionBodyOf } from '../helpers/source-blocks';
import {
    ALL_ROWS,
    MATRIX_ROLES,
    PRE_8_4_VISIBILITY_SHA,
    TENANT_API_ROOT,
    c,
    exportedMethods,
    g,
    guestTripwire,
    outcomeOf,
    populationGaps,
    type GuestRuleState,
} from '../integration/permission-matrix/table';

const ROOT = path.resolve(__dirname, '../..');
const VISIBILITY = 'src/app-layer/policies/project-visibility.ts';

function routeSources(root: string): Map<string, string> {
    const files = gitFiles(root).filter((f) => f.startsWith(TENANT_API_ROOT) && f.endsWith('/route.ts'));
    return new Map(files.map((f) => [f, readFileSync(path.join(root, f), 'utf8')]));
}

/** The guest rule's code, comments dropped and whitespace collapsed, hashed. */
function visibilityFingerprint(src: string): string {
    const text = [declarationOf(src, 'ALL_PROJECT_ROLES'), functionBodyOf(src, 'visibleProjects'), functionBodyOf(src, 'resolveProjectVisibility')]
        .join('\n')
        .replace(/\s+/g, ' ')
        .trim();
    return createHash('sha256').update(text).digest('hex');
}

function guestRuleToday(): GuestRuleState {
    const v = resolveProjectVisibility({ role: 'GUEST', membershipRole: 'GUEST' });
    return {
        guestSeesNoProject: v.kind === 'GRANTED' && v.projectIds.length === 0,
        guestUnassignable: !(ASSIGNABLE_TENANT_ROLES as readonly string[]).includes('GUEST'),
        visibilitySourceSha: visibilityFingerprint(readFileSync(path.join(ROOT, VISIBILITY), 'utf8')),
    };
}

describe('the permission matrix covers every tenant route (decision 175)', () => {
    const files = routeSources(ROOT);

    it('reads a real population from git', () => {
        expect(files.size).toBeGreaterThan(100);
        expect([...files.values()].reduce((n, src) => n + exportedMethods(src).length, 0)).toBeGreaterThan(180);
    });

    it('every route file and exported method has a row, and every row names one that exists', () => {
        expect(populationGaps(files, ALL_ROWS)).toEqual({ missing: [], stale: [] });
    });

    it('every row has a cell for every role, and every cell an outcome the harness knows', () => {
        for (const row of ALL_ROWS) {
            for (const role of MATRIX_ROLES) {
                expect({ row: `${row.method} ${row.route}`, role, outcome: outcomeOf(row.expect[role]) }).toEqual({
                    row: `${row.method} ${row.route}`,
                    role,
                    outcome: expect.stringMatching(/^(ok|empty|denied|refused|hidden|archived)$/),
                });
            }
            // A `denied` cell asserts the AUTHZ_DENIED row names the route's key, so a row with one must name it.
            if (MATRIX_ROLES.some((r) => outcomeOf(row.expect[r]) === 'denied')) expect({ row: `${row.method} ${row.route}`, key: row.key }).toEqual({ row: `${row.method} ${row.route}`, key: expect.any(String) });
        }
    });

    it('the detector finds a planted route with no row and a row naming a route that is gone', () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'perm-matrix-'));
        try {
            execFileSync('git', ['init', '-q'], { cwd: dir, env: gitEnvFor() });
            const plant = (rel: string, body: string) => {
                mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
                writeFileSync(path.join(dir, rel), body);
            };
            plant(`${TENANT_API_ROOT}widgets/route.ts`, 'export const GET = withApiErrorHandling(async () => null);\nexport async function POST() { return null; }\n');
            plant(`${TENANT_API_ROOT}gadgets/[id]/route.ts`, '// export const DELETE is only a comment\nexport const PATCH = withApiErrorHandling(async () => null);\n');
            plant('src/app/api/elsewhere/route.ts', 'export const GET = 1;\n');
            const rows = [
                { route: 'widgets/route.ts', method: 'GET' as const },
                { route: 'gadgets/[id]/route.ts', method: 'PATCH' as const },
                { route: 'retired/route.ts', method: 'GET' as const },
            ];
            expect(populationGaps(routeSources(dir), rows)).toEqual({ missing: ['POST widgets/route.ts'], stale: ['GET retired/route.ts'] });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('the guest tripwire (decision 176)', () => {
    const cells = ALL_ROWS.map((r) => ({ name: `${r.method} ${r.route} | ${r.subject}`, cell: r.expect.GUEST }));

    it('a guest sees no project today, and every GUEST cell is tagged until 8.4', () => {
        const today = guestRuleToday();
        expect(today).toEqual({ guestSeesNoProject: true, guestUnassignable: true, visibilitySourceSha: PRE_8_4_VISIBILITY_SHA });
        expect(guestTripwire(today, PRE_8_4_VISIBILITY_SHA, cells)).toEqual([]);
    });

    const before: GuestRuleState = { guestSeesNoProject: true, guestUnassignable: true, visibilitySourceSha: 'pinned' };
    const tagged = [{ name: 'GET planted', cell: c('ok', 'ok', 'ok', 'ok', g('hidden'), 'ok', 'ok').GUEST }];
    const untagged = [{ name: 'GET planted', cell: 'hidden' as const }];

    it('before 8.4, an untagged GUEST cell fails', () => {
        expect(guestTripwire(before, 'pinned', tagged)).toEqual([]);
        expect(guestTripwire(before, 'pinned', untagged)).toHaveLength(1);
    });

    it.each([
        ['a guest is given projects', { ...before, guestSeesNoProject: false }],
        ['GUEST becomes assignable', { ...before, guestUnassignable: false }],
        ['the visibility functions are rewritten', { ...before, visibilitySourceSha: 'rewritten' }],
    ])('once 8.4 arrives (%s), every tagged GUEST cell fails until rewritten', (_n, after) => {
        expect(guestTripwire(after, 'pinned', tagged)).toHaveLength(1);
        expect(guestTripwire(after, 'pinned', untagged)).toEqual([]);
    });

    it('the fingerprint moves when the visibility code does, and not when a comment does', () => {
        const src = readFileSync(path.join(ROOT, VISIBILITY), 'utf8');
        const pinned = visibilityFingerprint(src);
        expect(visibilityFingerprint(src.replace("return { kind: 'GRANTED', projectIds: [] };", "return { kind: 'GRANTED', projectIds: grants };"))).not.toBe(pinned);
        expect(visibilityFingerprint(src.replace("const own = ctx.membershipRole ?? ctx.role;", "// a remark\n    const own = ctx.membershipRole ?? ctx.role;"))).toBe(pinned);
    });
});
