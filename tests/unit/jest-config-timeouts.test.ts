/**
 * The integration project's 30 s per-test timeout is real.
 *
 * Jest reads `testTimeout` only from the top-level config; inside an entry of
 * `projects` it is silently ignored. `jest.config.mjs` once set it on the
 * integration project, so every integration suite actually ran at the 5 s
 * default, and a 20-way concurrent create that queues on one key sequence
 * timed out in CI (PR #31) while the config claimed 30 s. The timeout now
 * comes from `jest.setTimeout` in a `setupFilesAfterEnv` file, which does apply
 * per project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Jest timeouts', () => {
    const config = codeOf(read('jest.config.mjs'));

    it('no project sets testTimeout, which Jest ignores there', () => {
        expect(config).not.toMatch(/\btestTimeout\s*:/);
    });

    it('the integration project loads the timeout setup file first', () => {
        const at = config.indexOf("displayName: 'integration'");
        expect(at).toBeGreaterThan(-1);
        const project = config.slice(at, config.indexOf('}', at));
        const after = /setupFilesAfterEnv:\s*\[([^\]]*)\]/.exec(project);
        expect(after).not.toBeNull();
        const files = after![1]!.split(',').map((f) => f.trim()).filter(Boolean);
        expect(files[0]).toBe("'<rootDir>/tests/setup/integration-timeout.ts'");
    });

    it('the setup file raises the timeout to at least 30 s', () => {
        const setup = codeOf(read('tests/setup/integration-timeout.ts'));
        const m = /jest\.setTimeout\(\s*([\d_]+)\s*\)/.exec(setup);
        expect(m).not.toBeNull();
        expect(Number(m![1]!.replace(/_/g, ''))).toBeGreaterThanOrEqual(30_000);
    });
});
