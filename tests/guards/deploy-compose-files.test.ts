/**
 * Every production compose file under deploy/ (sub-phase 1.8).
 *
 * The population is every git-listed `deploy/**` file whose name says it is a
 * compose file, not a list: a second production file (an overlay, a one-off
 * service) is held to the same rules the day it is added. The rules are the
 * ones a shared VM makes non-negotiable:
 *
 *   1. no credential is written into the file (tests/helpers/compose-file.ts,
 *      `inlineSecrets`): a required value is `${VAR:?…}`, an optional one
 *      `${VAR:-}`, and a URL's password part is one of the two;
 *   2. no service reads an `env_file:` (each names the variables it gets);
 *   3. every service states `mem_limit` and `cpus`, because three products
 *      share the host's memory;
 *   4. no service publishes a port: the shared Caddy owns 80 and 443;
 *   5. a `redis` service runs `noeviction`.
 *
 * `docker-compose.yml` at the root is the development stack (throwaway
 * defaults, ports on 127.0.0.1) and is outside the population by its path.
 * The detector proves itself against a planted repository below.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { environmentOf, inlineSecrets, loadCompose } from '../helpers/compose-file';
import { gitEnvFor, gitFiles, REPO_ROOT } from '../helpers/git-files';

const COMPOSE_FILE = /^deploy\/(?:.+\/)?[^/]*compose[^/]*\.ya?ml$/;

interface Finding {
    readonly file: string;
    readonly rule: string;
    readonly where: string;
}

function check(root: string): { files: string[]; findings: Finding[] } {
    const files = gitFiles(root).filter((f) => COMPOSE_FILE.test(f));
    const findings: Finding[] = [];
    for (const file of files) {
        const compose = loadCompose(path.join(root, file));
        for (const s of inlineSecrets(compose)) findings.push({ file, rule: 'inline-secret', where: `${s.service}.${s.name}` });
        for (const [service, def] of Object.entries(compose.services ?? {})) {
            if (def.env_file !== undefined) findings.push({ file, rule: 'env-file', where: service });
            if (!def.mem_limit || def.cpus === undefined) findings.push({ file, rule: 'resources', where: service });
            if (def.ports !== undefined && def.ports.length > 0) findings.push({ file, rule: 'published-port', where: service });
            const command = ([] as string[]).concat(def.command ?? []).join(' ');
            if (service === 'redis' && !/--maxmemory-policy\s+noeviction/.test(command)) {
                findings.push({ file, rule: 'redis-eviction', where: service });
            }
            // Touch the environment so a malformed list form fails here, loudly.
            environmentOf(def);
        }
    }
    return { files, findings };
}

describe('production compose files', () => {
    const report = check(REPO_ROOT);

    it('takes its population from git, and the canonical file is in it', () => {
        expect(report.files).toContain('deploy/docker-compose.prod.yml');
        expect(report.files).not.toContain('docker-compose.yml');
    });

    it('break none of the five rules', () => {
        expect(report.findings).toEqual([]);
    });
});

describe('the detector, against a planted repository', () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-deploy-compose-'));
        execFileSync('git', ['init', '-q'], { cwd: root, env: gitEnvFor() });
        const plant = (rel: string, content: string) => {
            fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
            fs.writeFileSync(path.join(root, rel), content);
        };
        plant('.gitignore', 'deploy/ignored/\n');
        plant(
            'deploy/overlays/docker-compose.extra.yml',
            [
                'services:',
                '  db:',
                '    image: postgres:17.6',
                '    mem_limit: 256m',
                '    cpus: 0.5',
                '    environment:',
                '      POSTGRES_PASSWORD: hunter2-literal', // pragma: allowlist secret — planted
                '      API_TOKEN: "${API_TOKEN:-a-default-token}"', // pragma: allowlist secret — planted
                '      DATABASE_URL: "postgresql://u:plain@db:5432/x"', // pragma: allowlist secret — planted
                '      SAFE_URL: "postgresql://u:${DB_PASSWORD:?required}@db:5432/x"',
                '  redis:',
                '    image: redis:7.4',
                '    command: redis-server --requirepass literalpw --maxmemory-policy allkeys-lru', // pragma: allowlist secret — planted
                '    env_file: ./.env.prod',
                '    ports: ["6379:6379"]',
                '',
            ].join('\n'),
        );
        plant('deploy/clean-compose.yaml', 'services:\n  app:\n    image: x:1.0\n    mem_limit: 64m\n    cpus: 0.1\n    environment:\n      AUTH_SECRET: "${AUTH_SECRET:?required}"\n'); // pragma: allowlist secret — a reference, planted
        plant('deploy/ignored/docker-compose.yml', 'services:\n  x:\n    environment:\n      PASSWORD: leak\n'); // pragma: allowlist secret — planted
        plant('deploy/notes.yml', 'services:\n  x:\n    environment:\n      PASSWORD: not-a-compose-file\n'); // pragma: allowlist secret — planted
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('lists git-visible compose files only', () => {
        expect(check(root).files).toEqual(['deploy/clean-compose.yaml', 'deploy/overlays/docker-compose.extra.yml']);
    });

    it('reports every planted violation, and nothing in the clean file', () => {
        const file = 'deploy/overlays/docker-compose.extra.yml';
        expect(check(root).findings).toEqual([
            { file, rule: 'inline-secret', where: 'db.POSTGRES_PASSWORD' },
            { file, rule: 'inline-secret', where: 'db.API_TOKEN' },
            { file, rule: 'inline-secret', where: 'db.DATABASE_URL' },
            { file, rule: 'inline-secret', where: 'redis.--requirepass' },
            { file, rule: 'env-file', where: 'redis' },
            { file, rule: 'resources', where: 'redis' },
            { file, rule: 'published-port', where: 'redis' },
            { file, rule: 'redis-eviction', where: 'redis' },
        ]);
    });
});
