/**
 * scripts/wait-for-migrations.mjs against the real test database (sub-phase 1.8).
 *
 * Both images start through it, so a container Watchtower rolls before the
 * one-shot `migrate` has applied its migrations holds instead of serving the
 * old schema. Run as a process, as the images run it:
 *   - the newest migration in prisma/migrations is the one the build bakes;
 *   - it exits 0 once that migration is recorded as applied;
 *   - it keeps waiting, then exits 1, for one that is not;
 *   - it never prints the connection URL's credentials.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

import { getTestDatabaseUrl } from '../helpers/db';

import { DB_AVAILABLE } from './db-helper';

const describeFn = DB_AVAILABLE ? describe : describe.skip;
const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/wait-for-migrations.mjs');

function run(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: REPO,
        encoding: 'utf8',
        env: { NODE_ENV: 'test', PATH: process.env.PATH, DATABASE_URL: getTestDatabaseUrl(), ...env },
        timeout: 20_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describeFn('wait-for-migrations', () => {
    const head = run(['--print-head', 'prisma/migrations']).out.trim();

    it('names the newest migration directory as the head', () => {
        expect(head).toMatch(/^\d{14}_[a-z0-9_]+$/);
    });

    it('exits 0 at once when the head is applied (global setup migrated the test database)', () => {
        const r = run(['--head', head]);
        expect(r.status).toBe(0);
        expect(r.out).toContain(`${head} is applied`);
    });

    it('waits, then exits 1, for a migration that is not applied, without printing credentials', () => {
        const r = run(['--head', '29991231235959_not_yet'], { MIGRATION_WAIT_SECONDS: '1', MIGRATION_POLL_MS: '200' });
        expect(r.status).toBe(1);
        expect(r.out).toContain('waiting');
        expect(r.out).toContain('giving up');
        const password = new URL(getTestDatabaseUrl()).password;
        if (password) expect(r.out).not.toContain(password);
    });

    it('treats an unreachable database as not ready, naming only the error code', () => {
        const r = run(['--head', head], {
            DATABASE_URL: 'postgresql://nobody:secret-pw@127.0.0.1:1/none', // pragma: allowlist secret — unreachable on purpose
            MIGRATION_WAIT_SECONDS: '1',
            MIGRATION_POLL_MS: '200',
        });
        expect(r.status).toBe(1);
        expect(r.out).toContain('database unreachable (ECONNREFUSED)');
        expect(r.out).not.toContain('secret-pw');
    });
});
