/**
 * deploy/docker-compose.prod.yml — the production stack's contract
 * (sub-phase 1.8, owner decisions 42 to 46, docs/HANDOFF.md).
 *
 * Parsed, not grepped: every assertion reads the YAML Compose executes (merge
 * keys resolved, tests/helpers/compose-file.ts). What it holds:
 *   - every required secret is a `${VAR:?…}` guard, matching src/env.ts's
 *     production refusals, and no credential is written into the file;
 *   - each service is told only the variables it needs, and every name the
 *     app's processes receive is a variable src/env.ts declares;
 *   - only `app` joins the shared network; nothing publishes a port;
 *   - every service states a memory limit and a CPU cap, the long-running
 *     ones within the 4 GB budget, with Node's heap below its limit;
 *   - the healthchecks probe what they claim (readyz, the worker heartbeat);
 *   - migrations run once, as the superuser, before app and worker, and
 *     Watchtower is scoped to this project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
    environmentOf,
    inlineSecrets,
    interpolatedVariables,
    labelsOf,
    loadCompose,
    networksOf,
    type ComposeService,
} from '../../helpers/compose-file';

const REPO = path.resolve(__dirname, '../../..');
const FILE = path.join(REPO, 'deploy/docker-compose.prod.yml');
const TEXT = fs.readFileSync(FILE, 'utf8');
const compose = loadCompose(FILE);
const svc = (name: string): ComposeService => {
    const s = compose.services[name];
    if (!s) throw new Error(`no service ${name}`);
    return s;
};
const LONG_RUNNING = ['postgres', 'pgbouncer', 'redis', 'app', 'worker', 'watchtower'];

/** Megabytes from a Compose memory string (`1536m`, `1g`). */
function megabytes(value: string | undefined): number {
    const m = /^(\d+)([mg])$/i.exec(value ?? '');
    if (!m) throw new Error(`unreadable mem_limit ${value}`);
    return Number(m[1]) * (m[2]?.toLowerCase() === 'g' ? 1024 : 1);
}

/** The server variables src/env.ts declares (its `runtimeEnv` keys). */
function declaredServerVariables(): Set<string> {
    const src = fs.readFileSync(path.join(REPO, 'src/env.ts'), 'utf8');
    const runtime = src.slice(src.indexOf('runtimeEnv: {'));
    return new Set([...runtime.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*): process\.env\./gm)].map((m) => m[1] as string));
}

describe('the stack', () => {
    it('is the `islestone` project with exactly its seven services, each named islestone-<service>', () => {
        expect(compose.name).toBe('islestone');
        expect(Object.keys(compose.services).sort()).toEqual(
            ['app', 'migrate', 'pgbouncer', 'postgres', 'redis', 'watchtower', 'worker'].sort(),
        );
        for (const [name, def] of Object.entries(compose.services)) {
            expect({ name, container: def.container_name }).toEqual({ name, container: `islestone-${name}` });
        }
    });

    it('pins every third-party image to a version, and runs its own from GHCR', () => {
        for (const name of ['postgres', 'pgbouncer', 'redis', 'watchtower']) {
            expect(svc(name).image).toMatch(/:[^:]*\d+\.\d+/);
            expect(svc(name).image).not.toMatch(/:latest$/);
        }
        expect(svc('postgres').image).toMatch(/^pgvector\/pgvector:/);
        // `:latest` unless ISLESTONE_IMAGE_TAG pins a build (the rollback lever).
        expect(svc('app').image).toBe('ghcr.io/rodnapamet/islestone:${ISLESTONE_IMAGE_TAG:-latest}');
        expect(svc('worker').image).toBe('ghcr.io/rodnapamet/islestone-worker:${ISLESTONE_IMAGE_TAG:-latest}');
        expect(svc('migrate').image).toBe(svc('worker').image);
    });
});

describe('secrets', () => {
    it('writes no credential into the file', () => {
        expect(inlineSecrets(compose)).toEqual([]);
    });

    it('guards every production secret src/env.ts refuses to start without', () => {
        const vars = interpolatedVariables(TEXT);
        for (const name of [
            'POSTGRES_PASSWORD',
            'APP_DB_PASSWORD',
            'REDIS_PASSWORD',
            'AUTH_SECRET',
            'DATA_ENCRYPTION_KEY',
            'LOOKUP_HASH_KEY',
            'DERIVED_SUBKEY_KEY',
            'RATE_LIMIT_MODE',
        ]) {
            expect({ name, required: vars.get(name)?.required }).toEqual({ name, required: true });
        }
        // Optional means an EMPTY default, which src/env.ts reads as unset.
        expect(vars.get('UPSTASH_REDIS_REST_URL')?.required).toBe(false);
        expect(vars.get('UPSTASH_REDIS_REST_TOKEN')?.required).toBe(false);
    });

    it('gives the app and the worker an authenticated REDIS_URL, the runtime role and every refused-without key', () => {
        for (const name of ['app', 'worker']) {
            const env = environmentOf(svc(name));
            expect(env.REDIS_URL).toMatch(/^redis:\/\/:\$\{REDIS_PASSWORD:\?[^}]+\}@islestone-redis:6379$/);
            expect(env.DATABASE_URL).toMatch(/^postgresql:\/\/islestone_app:\$\{APP_DB_PASSWORD:\?[^}]+\}@islestone-pgbouncer:5432\/islestone$/);
            for (const key of ['AUTH_SECRET', 'DATA_ENCRYPTION_KEY', 'RATE_LIMIT_MODE', 'LOOKUP_HASH_KEY', 'DERIVED_SUBKEY_KEY']) {
                expect(env[key]).toMatch(new RegExp(`^\\$\\{${key}:\\?`));
            }
            expect(env.NODE_ENV).toBe('production');
        }
    });

    it('never hands the superuser password to the app, the worker or PgBouncer', () => {
        for (const [name, def] of Object.entries(compose.services)) {
            const mentions = Object.values(environmentOf(def)).some((v) => v.includes('POSTGRES_PASSWORD'));
            expect({ name, mentions }).toEqual({ name, mentions: ['postgres', 'migrate'].includes(name) });
        }
        expect(environmentOf(svc('pgbouncer')).DB_USER).toBe('islestone_app');
    });

    it('never sets a test switch or turns validation or rate limits off', () => {
        const forbidden = ['AUTH_TEST_MODE', 'NEXT_TEST_MODE', 'SKIP_ENV_VALIDATION', 'RATE_LIMIT_ENABLED', 'NEXT_PUBLIC_TEST_MODE'];
        for (const [name, def] of Object.entries(compose.services)) {
            const set = Object.keys(environmentOf(def)).filter((key) => forbidden.includes(key));
            expect({ name, set }).toEqual({ name, set: [] });
        }
        const example = fs.readFileSync(path.join(REPO, 'deploy/.env.prod.example'), 'utf8');
        for (const key of forbidden) expect(example).not.toMatch(new RegExp(`^${key}=`, 'm'));
    });

    it('reads no env_file: each service names its variables', () => {
        for (const [name, def] of Object.entries(compose.services)) {
            expect({ name, env_file: def.env_file }).toEqual({ name, env_file: undefined });
        }
    });

    it('tells the app and the worker only variables src/env.ts declares', () => {
        const declared = declaredServerVariables();
        expect(declared.has('DATABASE_URL')).toBe(true);
        for (const name of ['app', 'worker']) {
            const unknown = Object.keys(environmentOf(svc(name))).filter(
                (key) => !declared.has(key) && !['NODE_OPTIONS', 'NEXT_PUBLIC_APP_URL'].includes(key),
            );
            expect({ name, unknown }).toEqual({ name, unknown: [] });
        }
    });

    it('lists exactly the interpolated names in deploy/.env.prod.example', () => {
        const example = fs.readFileSync(path.join(REPO, 'deploy/.env.prod.example'), 'utf8');
        const names = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]).sort();
        expect(names).toEqual([...interpolatedVariables(TEXT).keys()].sort());
    });
});

describe('networks', () => {
    it('puts only app on the shared Caddy network, and every service on islestone_internal', () => {
        for (const [name, def] of Object.entries(compose.services)) {
            const nets = networksOf(def).sort();
            expect({ name, nets }).toEqual({
                name,
                nets: name === 'app' ? ['agrent_internal', 'islestone_internal'] : ['islestone_internal'],
            });
        }
        expect(compose.networks?.agrent_internal).toEqual({ external: true });
        expect(compose.networks?.islestone_internal?.name).toBe('islestone_internal');
        // Not `internal: true`: the worker sends mail and Watchtower pulls images.
        expect(compose.networks?.islestone_internal?.internal).toBeUndefined();
    });

    it('publishes no port: Caddy reaches the app over the shared network', () => {
        for (const [name, def] of Object.entries(compose.services)) {
            expect({ name, ports: def.ports }).toEqual({ name, ports: undefined });
        }
    });
});

describe('resources', () => {
    it('gives every service a memory limit and a CPU cap', () => {
        for (const [name, def] of Object.entries(compose.services)) {
            expect({ name, mem: megabytes(def.mem_limit) > 0, cpus: Number(def.cpus) > 0 }).toEqual({ name, mem: true, cpus: true });
        }
    });

    it('keeps the long-running services within 4 GB of the shared VM', () => {
        const total = LONG_RUNNING.reduce((sum, name) => sum + megabytes(svc(name).mem_limit), 0);
        expect(total).toBeLessThanOrEqual(4096);
    });

    it("states Node's heap ceiling below each Node service's limit", () => {
        for (const name of ['app', 'worker']) {
            const heap = Number(/--max-old-space-size=(\d+)/.exec(environmentOf(svc(name)).NODE_OPTIONS ?? '')?.[1]);
            const limit = megabytes(svc(name).mem_limit);
            expect(heap).toBeGreaterThan(0);
            expect(limit - heap).toBeGreaterThanOrEqual(128);
        }
    });
});

describe('health', () => {
    const test = (name: string) => {
        const t = svc(name).healthcheck?.test;
        return Array.isArray(t) ? t.join(' ') : (t ?? '');
    };

    it('probes the app through /api/readyz, the worker through its heartbeat, the stores natively', () => {
        expect(test('app')).toContain('http://127.0.0.1:3000/api/readyz');
        expect(test('worker')).toBe('CMD node dist/worker-healthcheck.mjs');
        expect(test('postgres')).toContain('pg_isready');
        expect(test('pgbouncer')).toContain('pg_isready');
        expect(test('redis')).toContain('redis-cli ping');
        expect(svc('migrate').healthcheck?.disable).toBe(true);
    });

    it('runs Redis with a password and noeviction, the password kept off its command line', () => {
        const command = ([] as string[]).concat(svc('redis').command ?? []).join(' ');
        expect(command).toMatch(/--maxmemory-policy noeviction/);
        expect(command).toMatch(/requirepass %s/);
        expect(command).not.toMatch(/--requirepass/);
        expect(environmentOf(svc('redis')).REDIS_PASSWORD).toMatch(/^\$\{REDIS_PASSWORD:\?/);
    });
});

describe('migrations and rollout', () => {
    it('migrates once, as the superuser, directly, before app and worker start', () => {
        const migrate = svc('migrate');
        expect(migrate.command).toEqual(['node_modules/.bin/prisma', 'migrate', 'deploy']);
        expect(migrate.restart).toBe('no');
        expect(environmentOf(migrate).DIRECT_DATABASE_URL).toMatch(/^postgresql:\/\/islestone:\$\{POSTGRES_PASSWORD:\?[^}]+\}@islestone-postgres:5432\/islestone$/);
        for (const name of ['app', 'worker']) {
            const deps = svc(name).depends_on as Record<string, { condition?: string }>;
            expect(deps.migrate?.condition).toBe('service_completed_successfully');
            expect(deps.pgbouncer?.condition).toBe('service_healthy');
            expect(deps.redis?.condition).toBe('service_healthy');
        }
    });

    it('creates the runtime role on a fresh volume, after app_user', () => {
        const volumes = svc('postgres').volumes ?? [];
        expect(volumes).toContain('./init-roles.sh:/docker-entrypoint-initdb.d/01-init-roles.sh:ro');
        expect(volumes).toContain('./init-runtime-role.sh:/docker-entrypoint-initdb.d/02-runtime-role.sh:ro');
    });

    it('lets Watchtower roll app, worker and migrate, scoped to islestone, and nothing stateful', () => {
        for (const name of ['app', 'worker', 'migrate']) {
            expect(labelsOf(svc(name))).toMatchObject({
                'com.centurylinklabs.watchtower.enable': 'true',
                'com.centurylinklabs.watchtower.scope': 'islestone',
            });
        }
        for (const name of ['app', 'worker']) {
            expect(labelsOf(svc(name))['com.centurylinklabs.watchtower.depends-on']).toBe('islestone-migrate');
        }
        for (const name of ['postgres', 'pgbouncer', 'redis', 'watchtower']) {
            expect(labelsOf(svc(name))['com.centurylinklabs.watchtower.enable']).toBe('false');
        }
        expect(environmentOf(svc('watchtower'))).toMatchObject({
            WATCHTOWER_SCOPE: 'islestone',
            WATCHTOWER_LABEL_ENABLE: 'true',
            WATCHTOWER_INCLUDE_STOPPED: 'true',
            WATCHTOWER_REVIVE_STOPPED: 'true',
        });
    });

    it('runs the app, worker and migrate without privileges they never use', () => {
        for (const name of ['app', 'worker', 'migrate']) {
            const def = svc(name);
            expect(def.user).toBeUndefined(); // the image's non-root `node`
            expect(def.cap_drop).toEqual(['ALL']);
            expect(def.security_opt).toContain('no-new-privileges:true');
        }
    });
});
