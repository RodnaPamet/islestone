/**
 * The Dockerfile's contract (sub-phase 1.8). Docker is not available where
 * the unit tests run, and CI's `Image` job builds both targets on every pull
 * request; this file holds the parts a build would accept but production
 * must not lose. It parses the Dockerfile into stages and instructions, so a
 * comment that names an instruction satisfies nothing.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');

interface Instruction {
    readonly op: string;
    readonly args: string;
}
interface Stage {
    readonly name: string;
    readonly from: string;
    readonly body: Instruction[];
}

/** Instructions (continuations joined, comments dropped) grouped by stage. */
function parseDockerfile(text: string): { args: Instruction[]; stages: Stage[] } {
    const logical: string[] = [];
    let current = '';
    for (const raw of text.split('\n')) {
        if (/^\s*#/.test(raw) && current === '') continue;
        if (/^\s*#/.test(raw)) continue;
        const line = raw.replace(/\s+$/, '');
        if (line.endsWith('\\')) {
            current += `${line.slice(0, -1)} `;
            continue;
        }
        current += line;
        if (current.trim()) logical.push(current.trim());
        current = '';
    }
    const args: Instruction[] = [];
    const stages: Stage[] = [];
    for (const l of logical) {
        const at = l.indexOf(' ');
        const ins = { op: l.slice(0, at).toUpperCase(), args: l.slice(at + 1).replace(/\s+/g, ' ').trim() };
        if (ins.op === 'FROM') {
            const m = /^(\S+)(?: AS (\S+))?$/i.exec(ins.args);
            stages.push({ from: m?.[1] ?? '', name: m?.[2] ?? '', body: [] });
        } else if (stages.length === 0) {
            args.push(ins);
        } else {
            stages[stages.length - 1]?.body.push(ins);
        }
    }
    return { args, stages };
}

const { args, stages } = parseDockerfile(fs.readFileSync(path.join(REPO, 'Dockerfile'), 'utf8'));
const stage = (name: string): Stage => {
    const s = stages.find((x) => x.name === name);
    if (!s) throw new Error(`no stage ${name}`);
    return s;
};
const ops = (s: Stage, op: string) => s.body.filter((i) => i.op === op).map((i) => i.args);
/** A stage's instructions including those it inherits from its FROM chain. */
const chain = (name: string): Instruction[] => {
    const s = stage(name);
    const parent = stages.find((x) => x.name === s.from);
    return [...(parent ? chain(parent.name) : []), ...s.body];
};

describe('the parser', () => {
    it('reads stages and joins continuation lines (the check is not vacuous)', () => {
        const parsed = parseDockerfile('ARG X=1\nFROM a AS one\n# RUN commented\nRUN echo \\\n  two\nFROM one AS two\nUSER node\n');
        expect(parsed.args).toEqual([{ op: 'ARG', args: 'X=1' }]);
        expect(parsed.stages.map((s) => [s.name, s.from, s.body.length])).toEqual([
            ['one', 'a', 1],
            ['two', 'one', 1],
        ]);
        expect(parsed.stages[0]?.body[0]?.args).toBe('echo two');
    });
});

describe('Dockerfile', () => {
    it('builds on one pinned Node image, the major .nvmrc names', () => {
        const base = args.find((a) => a.op === 'ARG' && a.args.startsWith('NODE_IMAGE='))?.args.split('=')[1] ?? '';
        const major = fs.readFileSync(path.join(REPO, '.nvmrc'), 'utf8').trim();
        expect(base).toMatch(new RegExp(`^node:${major}\\.\\d+\\.\\d+-alpine\\d+\\.\\d+$`));
        for (const s of stages.filter((x) => !stages.some((y) => y.name === x.from))) {
            expect(s.from).toBe('${NODE_IMAGE}');
        }
    });

    it('installs from the lockfile, with the workspace manifest present first', () => {
        const deps = stage('deps').body;
        const ci = deps.findIndex((i) => i.op === 'RUN' && /\bnpm ci\b/.test(i.args));
        const ui = deps.findIndex((i) => i.op === 'COPY' && i.args.includes('packages/ui/package.json'));
        expect(ci).toBeGreaterThan(-1);
        expect(ui).toBeGreaterThan(-1);
        expect(ui).toBeLessThan(ci);
        expect(chain('builder').some((i) => i.op === 'RUN' && /\bnpm install\b/.test(i.args))).toBe(false);
    });

    it('builds the app, the worker bundles and the migration head, then prunes dev dependencies', () => {
        const runs = ops(stage('builder'), 'RUN').join(' && ');
        expect(runs).toMatch(/npm run build && npm run build:worker/);
        expect(runs).toMatch(/wait-for-migrations\.mjs --print-head prisma\/migrations > \.migration-head/);
        expect(runs).toMatch(/npm prune --omit=dev/);
    });

    it('ships the standalone server in the app image and the worker tree in the worker image', () => {
        const app = ops(stage('app'), 'COPY').join('\n');
        expect(app).toContain('/app/.next/standalone ./');
        expect(app).toContain('/app/.next/static ./.next/static');
        expect(app).not.toMatch(/node_modules/);
        const worker = ops(stage('worker'), 'COPY').join('\n');
        for (const part of ['/app/node_modules', '/app/dist', '/app/prisma ', '/app/prisma.config.ts']) {
            expect(worker).toContain(part);
        }
    });

    it.each(['app', 'worker'])('%s runs as the non-root `node` user', (name) => {
        const body = stage(name).body;
        const user = body.findIndex((i) => i.op === 'USER');
        const cmd = body.findIndex((i) => i.op === 'CMD');
        expect(body[user]?.args).toBe('node');
        expect(user).toBeLessThan(cmd);
        expect(body.filter((i) => i.op === 'USER')).toHaveLength(1);
    });

    it('checks the app at /api/livez and the worker through its heartbeat', () => {
        expect(ops(stage('app'), 'HEALTHCHECK').join(' ')).toContain("http://127.0.0.1:3000/api/livez");
        expect(ops(stage('worker'), 'HEALTHCHECK').join(' ')).toContain('dist/worker-healthcheck.mjs');
    });

    it('waits for the image\'s migrations before starting either process', () => {
        expect(ops(stage('app'), 'CMD').join('')).toMatch(/node scripts\/wait-for-migrations\.mjs && exec node server\.js/);
        expect(ops(stage('worker'), 'CMD').join('')).toMatch(
            /node scripts\/wait-for-migrations\.mjs && node dist\/scheduler\.mjs && exec node dist\/worker\.mjs/,
        );
        const runtime = ops(stage('runtime'), 'COPY').join('\n');
        expect(runtime).toContain('/app/.migration-head');
        expect(runtime).toContain('/app/scripts/wait-for-migrations.mjs');
    });

    it('removes npm from the runtime images and carries LICENSE and NOTICE', () => {
        expect(ops(stage('runtime'), 'RUN').join(' ')).toMatch(/rm -rf \/usr\/local\/lib\/node_modules\/npm/);
        expect(ops(stage('runtime'), 'COPY').join(' ')).toMatch(/\/app\/LICENSE \/app\/NOTICE/);
        expect(stage('app').from).toBe('runtime');
        expect(stage('worker').from).toBe('runtime');
    });

    it('bakes BUILD_SHA in last, so a new commit invalidates no earlier layer', () => {
        for (const name of ['app', 'worker']) {
            const body = stage(name).body;
            const arg = body.findIndex((i) => i.op === 'ARG' && i.args === 'BUILD_SHA');
            expect(arg).toBeGreaterThan(-1);
            expect(body[arg + 1]).toEqual({ op: 'ENV', args: 'BUILD_SHA=${BUILD_SHA}' });
            expect(body.slice(arg).filter((i) => !['ARG', 'ENV', 'CMD'].includes(i.op))).toEqual([]);
        }
    });

    it('binds the standalone server to every interface', () => {
        expect(ops(stage('app'), 'ENV').join(' ')).toMatch(/HOSTNAME=0\.0\.0\.0/);
    });
});

describe('what the Dockerfile relies on elsewhere', () => {
    it('next.config.ts builds the standalone output', () => {
        expect(fs.readFileSync(path.join(REPO, 'next.config.ts'), 'utf8')).toMatch(/^\s+output: 'standalone',$/m);
    });

    it('the worker bundles the healthcheck and the CMD name', () => {
        const build = fs.readFileSync(path.join(REPO, 'scripts/build-worker.mjs'), 'utf8');
        for (const out of ['dist/worker.mjs', 'dist/scheduler.mjs', 'dist/worker-healthcheck.mjs']) {
            expect(build).toContain(`outfile: '${out}'`);
        }
    });

    it('.dockerignore keeps secrets, dependencies and build output out of the context', () => {
        const lines = fs.readFileSync(path.join(REPO, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
        for (const entry of ['.env*', 'node_modules', '.next', '.git', 'tests/', 'deploy/']) {
            expect(lines).toContain(entry);
        }
        expect(lines.some((l) => l.startsWith('!.env'))).toBe(false);
    });
});
