/**
 * Guardrail: Connection Pooling Configuration
 *
 * Structural tests verifying PgBouncer/pooling is wired correctly in the dev
 * docker-compose.yml, the Prisma schema and config, the server env module and
 * .env.example. Each check is a pure function over the parsed file, and each
 * is shown to fail on a planted bad input at the bottom.
 *
 * Its live twin is tests/integration/connection-pooling.test.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import { readPrismaSchema } from '../helpers/prisma-schema';
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
// codeOf() masks comments at the READ SEAM, so a COMMENT naming a thing
// cannot satisfy an assertion meant to be about CODE. `readRaw` is for files
// where `//` is content (URLs in YAML and env files).
const readRaw = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const read = (rel: string) => codeOf(readRaw(rel));

interface ComposeService {
    image?: string;
    ports?: string[];
    environment?: Record<string, string | number>;
    healthcheck?: { test?: string[] | string };
    depends_on?: Record<string, { condition?: string }> | string[];
}
type Compose = { services: Record<string, ComposeService> };

/**
 * Expand `${VAR:-default}` to its default, so a published port such as
 * `'127.0.0.1:${PGBOUNCER_PORT:-6432}:5432'` reads as `127.0.0.1:6432:5432`.
 * Splitting on `:` first would read `-6432}` as the host port.
 */
function expandDefaults(value: string): string {
    return value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}/g, '$1');
}

/** Every host port a compose document's services publish, as service → ports. */
function hostPorts(doc: Compose): Map<string, number[]> {
    return new Map(
        Object.entries(doc.services).map(([name, svc]) => [
            name,
            // `[ip:]host:container`: the host port is the second-to-last field.
            (svc.ports ?? []).map((p) => Number(expandDefaults(String(p)).split(':').slice(-2)[0])),
        ]),
    );
}

/** The port in an env file's `KEY=postgresql://…:<port>/…` line, or null. */
function urlPort(src: string, key: string): number | null {
    const line = src.split(/\r?\n/).find((l) => l.startsWith(`${key}=`)) ?? '';
    const m = /@[^:/]+:(\d+)\//.exec(line);
    return m ? Number(m[1]) : null;
}

/** What is wrong with a compose document's pooling setup; empty is good. */
function composeProblems(doc: Compose): string[] {
    const problems: string[] = [];
    const bouncer = doc.services.pgbouncer;
    const postgres = doc.services.postgres;
    if (!bouncer) return ['no pgbouncer service'];
    if (!postgres) return ['no postgres service'];
    const env = bouncer.environment ?? {};
    if (env.POOL_MODE !== 'transaction') problems.push(`pgbouncer POOL_MODE is ${String(env.POOL_MODE)}, not transaction`);
    if (!(Number(env.MAX_CLIENT_CONN) >= 200)) problems.push('pgbouncer MAX_CLIENT_CONN < 200');
    const healthy = (s: ComposeService) => String(s.healthcheck?.test ?? '').includes('pg_isready');
    if (!healthy(bouncer)) problems.push('pgbouncer has no pg_isready health check');
    if (!healthy(postgres)) problems.push('postgres has no pg_isready health check');
    const deps = bouncer.depends_on;
    const onPostgres = Array.isArray(deps)
        ? deps.includes('postgres')
        : deps?.postgres?.condition === 'service_healthy';
    if (!onPostgres) problems.push('pgbouncer does not wait for a healthy postgres');
    return problems;
}

/** The `DATABASE_URL:` property of src/env.ts's server block, or null. */
function databaseUrlSchema(envTs: string): string | null {
    const m = /^\s*DATABASE_URL:\s*(.+)$/m.exec(envTs);
    return m ? m[1]!.trim() : null;
}

describe('Connection Pooling Configuration', () => {
    describe('Prisma schema + config', () => {
        // Prisma 7 — `url` / `directUrl` moved out of `datasource db` and
        // into `prisma.config.ts` (`datasource.url`).
        const schema = readPrismaSchema();
        const config = read('prisma.config.ts');

        test('datasource block declares postgresql provider', () => {
            expect(schema).toMatch(/datasource\s+db\s*\{[^}]*provider\s*=\s*"postgresql"/);
        });

        test('prisma.config.ts reads DIRECT_DATABASE_URL first, then DATABASE_URL, into datasource.url', () => {
            expect(config).toMatch(/url:\s*process\.env\.DIRECT_DATABASE_URL\s*\?\?\s*process\.env\.DATABASE_URL/);
        });
    });

    describe('env.ts validation', () => {
        const envTs = read('src/env.ts');

        test('DATABASE_URL is required (a postgres URL, not optional)', () => {
            const schema = databaseUrlSchema(envTs);
            expect(schema).toMatch(/^z\.url\(/);
            expect(schema).not.toContain('.optional()');
        });

        test('DIRECT_DATABASE_URL and DATABASE_READ_URL are declared (optional)', () => {
            expect(envTs).toMatch(/^\s*DIRECT_DATABASE_URL:\s*z\.url\(.*\)\.optional\(\),$/m);
            expect(envTs).toMatch(/^\s*DATABASE_READ_URL:\s*z\.url\(.*\)\.optional\(\),$/m);
        });
    });

    describe('docker-compose.yml (dev)', () => {
        test('pgbouncer pools in transaction mode in front of a healthy postgres', () => {
            expect(composeProblems(yaml.load(readRaw('docker-compose.yml')) as Compose)).toEqual([]);
        });
    });

    describe('.env.example', () => {
        const envExample = readRaw('.env.example');
        const ports = hostPorts(yaml.load(readRaw('docker-compose.yml')) as Compose);

        test('DATABASE_URL points at the port the dev stack publishes for PgBouncer', () => {
            expect(ports.get('pgbouncer')).toHaveLength(1);
            expect(urlPort(envExample, 'DATABASE_URL')).toBe(ports.get('pgbouncer')![0]);
        });

        test('DIRECT_DATABASE_URL points at the port the dev stack publishes for Postgres', () => {
            // Derived from docker-compose.yml rather than a literal, so moving
            // the port in one file and not the other fails here.
            expect(ports.get('postgres')).toHaveLength(1);
            expect(urlPort(envExample, 'DIRECT_DATABASE_URL')).toBe(ports.get('postgres')![0]);
        });
    });
});

describe('the checks, against planted bad input', () => {
    const goodCompose = (): Compose => ({
        services: {
            postgres: { healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1'] } },
            pgbouncer: {
                environment: { POOL_MODE: 'transaction', MAX_CLIENT_CONN: 200 },
                healthcheck: { test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -p 5432'] },
                depends_on: { postgres: { condition: 'service_healthy' } },
                ports: ['127.0.0.1:${PGBOUNCER_PORT:-6432}:5432'],
            },
        },
    });

    it('a good document passes, and its port reads through the ${VAR:-default}', () => {
        expect(composeProblems(goodCompose())).toEqual([]);
        expect(hostPorts(goodCompose()).get('pgbouncer')).toEqual([6432]);
    });

    it('POOL_MODE: session, a small MAX_CLIENT_CONN and no health wait are each reported', () => {
        const bad = goodCompose();
        bad.services.pgbouncer!.environment = { POOL_MODE: 'session', MAX_CLIENT_CONN: 50 };
        bad.services.pgbouncer!.depends_on = { postgres: { condition: 'service_started' } };
        expect(composeProblems(bad)).toEqual([
            'pgbouncer POOL_MODE is session, not transaction',
            'pgbouncer MAX_CLIENT_CONN < 200',
            'pgbouncer does not wait for a healthy postgres',
        ]);
    });

    it('an optional DATABASE_URL is seen as optional', () => {
        expect(databaseUrlSchema("        DATABASE_URL: z.url({ protocol: /^postgres$/ }).optional(),")).toContain(
            '.optional()',
        );
    });

    it('urlPort reads the port, and reports a missing key as null', () => {
        expect(urlPort('DATABASE_URL=postgresql://u:p@127.0.0.1:6432/db', 'DATABASE_URL')).toBe(6432);
        expect(urlPort('OTHER=1', 'DATABASE_URL')).toBeNull();
    });
});
