/**
 * The concurrency suite runs at four times its rounds every night (Hardening
 * H2, part 2; issue #70; `tests/helpers/stress-scale.ts`).
 *
 *   1. Every suite under `tests/integration/concurrency/` reads the scale
 *      (imports `stress-scale`), so a new race joins the nightly scale.
 *   2. `.github/workflows/perf.yml` has the `concurrency-stress` job: on the
 *      schedule (never only on a push), running that directory through the
 *      integration project with `STRESS_SCALE` 4, and a red night reaches the
 *      report job (in its `needs` and its condition).
 *   3. The scale refuses a value it cannot honour rather than running at 1.
 *
 * Population from git; rule 1's detector proves itself on a planted repository.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const SUITE_DIR = 'tests/integration/concurrency/';
const IMPORT = /from\s+['"]\.\.\/\.\.\/helpers\/stress-scale['"]/;

/** The concurrency suites under `root` that do not read the scale. */
function suitesWithoutScale(root: string): string[] {
    return gitFiles(root)
        .filter((rel) => rel.startsWith(SUITE_DIR) && rel.endsWith('.test.ts'))
        .filter((rel) => !IMPORT.test(fs.readFileSync(path.join(root, rel), 'utf8')));
}

/** The text of one job of a workflow: its header line to the next job's (two-space keys under `jobs:`). */
function jobBlock(workflow: string, name: string): string | null {
    const lines = workflow.split('\n');
    const start = lines.indexOf(`  ${name}:`);
    if (start < 0) return null;
    let end = start + 1;
    while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end]!)) end += 1;
    return lines.slice(start, end).join('\n');
}

describe('the nightly concurrency stress run', () => {
    it('every concurrency suite reads STRESS_SCALE', () => {
        const suites = gitFiles(REPO_ROOT).filter((rel) => rel.startsWith(SUITE_DIR) && rel.endsWith('.test.ts'));
        expect(suites.length).toBeGreaterThanOrEqual(6);
        expect(suitesWithoutScale(REPO_ROOT)).toEqual([]);
    });

    it('perf.yml runs the suite nightly at STRESS_SCALE=4 and reports a red night', () => {
        const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/perf.yml'), 'utf8');
        expect(workflow).toMatch(/^on:\n {2}schedule:\n/m);
        const job = jobBlock(workflow, 'concurrency-stress');
        expect(job).not.toBeNull();
        // Skipped on a push only, so it runs on the schedule.
        expect(job).toMatch(/^ {4}if: github\.event_name != 'push'$/m);
        expect(job).toMatch(/^ {8}run: npm run test:integration -- --ci tests\/integration\/concurrency\n {8}env:\n {10}STRESS_SCALE: '4'$/m);
        const report = jobBlock(workflow, 'report');
        expect(report).toMatch(/^ {4}needs: \[[^\]]*\bconcurrency-stress\b[^\]]*\]$/m);
        expect(report).toMatch(/^ {4}if: .*needs\.concurrency-stress\.result == 'failure'.*github\.event_name == 'schedule'$/m);
    });

    it('the scale refuses what it cannot honour', async () => {
        const saved = process.env.STRESS_SCALE;
        try {
            for (const bad of ['0', '11', '2.5', 'four']) {
                process.env.STRESS_SCALE = bad;
                await expect(jest.isolateModulesAsync(async () => {
                    await import('../helpers/stress-scale');
                })).rejects.toThrow(/STRESS_SCALE/);
            }
            process.env.STRESS_SCALE = '4';
            await jest.isolateModulesAsync(async () => {
                const scale = await import('../helpers/stress-scale');
                expect(scale.rounds(3)).toBe(12);
                expect(scale.roundNumbers(2)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
                expect(scale.scaledTimeout()).toBe(120_000);
            });
        } finally {
            if (saved === undefined) delete process.env.STRESS_SCALE;
            else process.env.STRESS_SCALE = saved;
        }
    });

    describe('the detector, on a planted repository', () => {
        let root = '';
        beforeAll(() => {
            root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-stress-scale-'));
            execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
            fs.mkdirSync(path.join(root, SUITE_DIR), { recursive: true });
            fs.writeFileSync(path.join(root, SUITE_DIR, 'scaled.test.ts'), "import { rounds } from '../../helpers/stress-scale';\n");
            fs.writeFileSync(path.join(root, SUITE_DIR, 'unscaled.test.ts'), "const ROUNDS = 3;\n");
            fs.writeFileSync(path.join(root, SUITE_DIR, 'helper.ts'), 'export {};\n');
        });
        afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

        it('flags a suite that does not read the scale, and only that one', () => {
            expect(suitesWithoutScale(root)).toEqual([`${SUITE_DIR}unscaled.test.ts`]);
        });
    });
});
