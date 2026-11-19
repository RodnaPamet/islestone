/**
 * Guard: the DB-backed suites actually EXECUTE.
 *
 * ── The regression class ─────────────────────────────────────────────
 *
 * `tests/integration/db-helper.ts` probes for a live Postgres and exports
 * `DB_AVAILABLE`. Every integration suite consumes it as
 *
 *     const describeFn = DB_AVAILABLE ? describe : describe.skip;
 *
 * so a `false` probe converts every one of them into a skip — and a run full
 * of skips is GREEN. The suites behind that flag include the two-tenant
 * isolation test, RLS coverage and both last-owner triggers.
 *
 * ── What this guard adds over the fail-closed probe ──────────────────
 *
 * `db-helper` throws unless `ALLOW_DB_SKIP=1`, which handles the probe
 * failing. This guard covers the OTHER way the population can collapse: the
 * suites themselves being deleted, renamed out of the glob, or quietly
 * un-gated one at a time. Deleting a test never turns anything red, so a
 * count that trends to zero would otherwise be invisible.
 *
 * It runs in the DB-free `Test` job and deliberately does not import
 * `db-helper`. It can prove a suite still EXISTS and is still DB-gated. It
 * cannot prove the suite EXECUTED — that is what the fail-closed throw in
 * db-helper is for; the two are complementary. Population from git.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';
import { assertDbAvailableOrSkipAllowed, unavailableDbMessage } from '../integration/db-availability';

/** The integration suites at the time of writing; ratchet up as suites land. */
const DB_GATED_SUITE_FLOOR = 10;

/**
 * Suites whose absence would specifically mean a guarantee is unproven. The
 * floor catches a COLLAPSE; these turn the build red by name.
 */
const LOAD_BEARING = [
    'tests/integration/tenant-membership-isolation.test.ts',
    'tests/integration/rls-coverage.test.ts',
    'tests/integration/rls-middleware.test.ts',
    'tests/integration/last-owner-guard.test.ts',
    'tests/integration/tenant-owner-race.test.ts',
    'tests/integration/org-owner-race.test.ts',
    'tests/integration/org-last-owner-guard.test.ts',
] as const;

interface Population {
    suites: string[];
    gated: string[];
    ungated: string[];
}

/** The integration project's suites under `root`, and which are gated on DB_AVAILABLE. */
function population(root: string): Population {
    const suites = gitFiles(root).filter((f) => /^tests\/integration\/.+\.test\.ts$/.test(f));
    const isGated = (f: string) => /\bDB_AVAILABLE\b/.test(codeOf(fs.readFileSync(path.join(root, f), 'utf8')));
    return { suites, gated: suites.filter(isGated), ungated: suites.filter((f) => !isGated(f)) };
}

describe('DB-backed suites execute rather than skip', () => {
    const pop = population(REPO_ROOT);

    it('keeps a population of DB-gated suites (a collapse turns the build red)', () => {
        expect(pop.gated.length).toBeGreaterThanOrEqual(DB_GATED_SUITE_FLOOR);
    });

    it('every integration suite is gated on DB_AVAILABLE, so none can skip silently around the probe', () => {
        expect(pop.ungated).toEqual([]);
    });

    it.each(LOAD_BEARING)('%s still exists and is DB-gated', (rel) => {
        expect(pop.gated).toContain(rel);
    });

    /**
     * The decision itself, exercised in all three states, as a pure function
     * (`db-availability.ts`), because this job has no database.
     */
    describe('the fail-closed decision', () => {
        const URL = 'postgresql://user:hunter2@localhost:5432/db';

        it('throws when the database is unavailable and skipping was not requested', () => {
            expect(() => assertDbAvailableOrSkipAllowed(false, undefined, URL)).toThrow(
                /Integration database is unavailable/,
            );
        });

        it('allows the skip only for the explicit opt-in', () => {
            expect(() => assertDbAvailableOrSkipAllowed(false, '1', URL)).not.toThrow();
            // Anything else is not an opt-in — including the truthy-looking ones.
            for (const value of ['0', 'true', 'yes', '', undefined]) {
                expect(() => assertDbAvailableOrSkipAllowed(false, value, URL)).toThrow();
            }
        });

        it('says nothing when the database is available', () => {
            expect(() => assertDbAvailableOrSkipAllowed(true, undefined, URL)).not.toThrow();
        });

        it('never puts the database password in the message', () => {
            const message = unavailableDbMessage(URL);
            expect(message).not.toContain('hunter2');
            expect(message).toContain('//user:***@');
        });

        it('tells the reader both ways out', () => {
            const message = unavailableDbMessage(URL);
            expect(message).toContain('docker compose up -d');
            expect(message).toContain('ALLOW_DB_SKIP=1');
        });
    });

    it('never lets CI take the escape hatch', () => {
        // The flag exists for local work. If it is ever set in a workflow file,
        // the fail-closed probe is inert and every suite is free to skip again.
        const workflows = gitFiles(REPO_ROOT).filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
        expect(workflows.length).toBeGreaterThan(0);
        const withFlag = workflows.filter((f) => /ALLOW_DB_SKIP/.test(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')));
        expect(withFlag).toEqual([]);
    });
});

describe('the population, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-integration-suites-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant('tests/integration/gated.test.ts', "import { DB_AVAILABLE } from './db-helper';\nconst d = DB_AVAILABLE ? describe : describe.skip;\n");
        plant('tests/integration/ungated.test.ts', "// DB_AVAILABLE is only mentioned in a comment\ndescribe('x', () => {});\n");
        plant('tests/integration/db-helper.ts', 'export const DB_AVAILABLE = true;\n');
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('counts only suites, and sees a comment-only mention as ungated', () => {
        expect(population(root)).toEqual({
            suites: ['tests/integration/gated.test.ts', 'tests/integration/ungated.test.ts'],
            gated: ['tests/integration/gated.test.ts'],
            ungated: ['tests/integration/ungated.test.ts'],
        });
    });
});
