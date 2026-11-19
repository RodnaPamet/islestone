/**
 * deploy/apply.sh, run for real against a stand-in `docker` (sub-phase 1.8).
 *
 * The script does its work on the VM (ON_VM=1); here it runs in a temporary
 * host layout — /opt/islestone, /opt/caddy-sites and Agrent's Caddyfile are
 * temp directories — and `docker` is a small shell script that answers the
 * calls apply.sh makes and logs every one. So these cases prove the order and
 * the refusals of the script that ships, not of a description of it:
 *
 *   - it refuses, changing nothing, when Agrent's Caddyfile lacks the import
 *     line, when agrent-caddy does not mount the sites directory read-only,
 *     when .env.prod is missing a value or is readable by others, and when
 *     another Watchtower is unscoped;
 *   - without CONFIRM it changes nothing;
 *   - with CONFIRM it installs the files, brings the stack up, and only then
 *     validates and reloads Caddy;
 *   - a site the shared configuration refuses is rolled back and Caddy is
 *     never reloaded;
 *   - no value from .env.prod ever reaches its output.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');
const APPLY = path.join(REPO, 'deploy/apply.sh');
const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'; // pragma: allowlist secret — test fixture

const FAKE_DOCKER = `#!/usr/bin/env bash
# Stand-in for docker: logs each call, answers from the FAKE_* environment.
printf '%s\\n' "$*" >> "$FAKE_LOG"
args=" $* "
case "$1" in
  version) exit 0 ;;
  network) [ "\${FAKE_NO_NETWORK:-0}" = 1 ] && exit 1; exit 0 ;;
  ps) printf '%b' "\${FAKE_PS:-agrent-caddy|caddy:2}"; exit 0 ;;
  inspect)
    case "$args" in
      *State.Running*) echo true ;;
      *Mounts*) echo "\${FAKE_MOUNTS}" ;;
      *Config.Env*) echo "\${FAKE_WT_CONFIG:-[]}" ;;
      *Health*) echo healthy ;;
    esac
    exit 0 ;;
  exec)
    case "$args" in
      *" sh -c "*) cat > /dev/null; exit 0 ;;
      *"caddy validate --config /tmp/"*) exit "\${FAKE_PREFLIGHT_VALIDATE:-0}" ;;
      *"caddy validate --config /etc/caddy/Caddyfile"*) exit "\${FAKE_LIVE_VALIDATE:-0}" ;;
      *"caddy reload"*) exit 0 ;;
    esac
    exit 0 ;;
  compose)
    case "$args" in
      *" version "*) exit 0 ;;
      *" config --quiet "*) exit "\${FAKE_COMPOSE_CONFIG:-0}" ;;
      *) exit 0 ;;
    esac ;;
esac
exit 0
`;

interface Host {
    root: string;
    remote: string;
    sites: string;
    caddyfile: string;
    log: string;
    bin: string;
}

function makeHost(opts: { importLine?: boolean; envMode?: number; env?: string } = {}): Host {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-apply-'));
    const host: Host = {
        root,
        remote: path.join(root, 'opt/islestone'),
        sites: path.join(root, 'opt/caddy-sites'),
        caddyfile: path.join(root, 'opt/agrent/Caddyfile'),
        log: path.join(root, 'docker.log'),
        bin: path.join(root, 'bin'),
    };
    fs.mkdirSync(host.remote, { recursive: true });
    fs.mkdirSync(host.sites, { recursive: true });
    fs.mkdirSync(path.dirname(host.caddyfile), { recursive: true });
    fs.mkdirSync(host.bin);
    fs.writeFileSync(path.join(host.bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
    fs.writeFileSync(host.log, '');
    fs.writeFileSync(
        host.caddyfile,
        ['agrent.example {', '\treverse_proxy agrent-app:3000', '}', opts.importLine === false ? '' : 'import /etc/caddy/sites/*.caddy', ''].join('\n'),
    );
    const env =
        opts.env ??
        [
            `POSTGRES_PASSWORD=${SECRET}`,
            `APP_DB_PASSWORD=${SECRET}`,
            `REDIS_PASSWORD=${SECRET}`,
            `AUTH_SECRET=${SECRET}`,
            `DATA_ENCRYPTION_KEY=${SECRET}`,
            `LOOKUP_HASH_KEY=${SECRET}`,
            `DERIVED_SUBKEY_KEY=${SECRET}`,
            'RATE_LIMIT_MODE=memory',
            '',
        ].join('\n');
    fs.writeFileSync(path.join(host.remote, '.env.prod'), env);
    fs.chmodSync(path.join(host.remote, '.env.prod'), opts.envMode ?? 0o600);
    return host;
}

function runApply(host: Host, extra: Record<string, string> = {}) {
    const result = spawnSync('bash', [APPLY], {
        encoding: 'utf8',
        env: {
            NODE_ENV: 'test',
            PATH: `${host.bin}:${process.env.PATH}`,
            HOME: host.root,
            ON_VM: '1',
            REMOTE_DIR: host.remote,
            CADDY_SITES_DIR: host.sites,
            AGRENT_CADDYFILE: host.caddyfile,
            HEALTH_TIMEOUT_SECONDS: '5',
            FAKE_LOG: host.log,
            FAKE_MOUNTS: `/var/lib/caddy:/data:true ${host.sites}:/etc/caddy/sites:false`,
            ...extra,
        },
    });
    const calls = fs.readFileSync(host.log, 'utf8').split('\n').filter(Boolean);
    return { status: result.status, out: `${result.stdout}${result.stderr}`, calls };
}

const installed = (host: Host) => fs.existsSync(path.join(host.remote, 'docker-compose.prod.yml'));
const siteInstalled = (host: Host) => fs.existsSync(path.join(host.sites, 'islestone.caddy'));
const changedAnything = (calls: string[]) =>
    calls.some((c) => / (pull|up) /.test(` ${c} `) || c.includes('caddy reload'));

describe('deploy/apply.sh refusals (exit 2, nothing changed)', () => {
    it("refuses when Agrent's Caddyfile lacks the import line, and says where the step is", () => {
        const host = makeHost({ importLine: false });
        const r = runApply(host, { CONFIRM: '1' });
        expect(r.status).toBe(2);
        expect(r.out).toContain('import /etc/caddy/sites/*.caddy');
        expect(r.out).toContain('docs/deployment.md');
        expect(installed(host) || siteInstalled(host) || changedAnything(r.calls)).toBe(false);
    });

    it('refuses when agrent-caddy does not mount the sites directory', () => {
        const host = makeHost();
        const r = runApply(host, { CONFIRM: '1', FAKE_MOUNTS: '/var/lib/caddy:/data:true' });
        expect(r.status).toBe(2);
        expect(r.out).toMatch(/does not mount .*caddy-sites/);
        expect(changedAnything(r.calls)).toBe(false);
    });

    it('refuses a read-write mount of the sites directory', () => {
        const host = makeHost();
        const r = runApply(host, { CONFIRM: '1', FAKE_MOUNTS: `${host.sites}:/etc/caddy/sites:true` });
        expect(r.status).toBe(2);
        expect(r.out).toContain('read-write');
    });

    it('refuses an incomplete .env.prod, naming the variable and no value', () => {
        const host = makeHost({ env: `POSTGRES_PASSWORD=${SECRET}\nRATE_LIMIT_MODE=memory\n` });
        const r = runApply(host, { CONFIRM: '1' });
        expect(r.status).toBe(2);
        expect(r.out).toContain('APP_DB_PASSWORD');
        expect(r.out).not.toContain(SECRET);
        expect(changedAnything(r.calls)).toBe(false);
    });

    it('refuses an .env.prod others can read', () => {
        const host = makeHost({ envMode: 0o644 });
        const r = runApply(host, { CONFIRM: '1' });
        expect(r.status).toBe(2);
        expect(r.out).toContain('must be 600');
    });

    it('refuses upstash without both Upstash values', () => {
        const env = fs
            .readFileSync(path.join(makeHost().remote, '.env.prod'), 'utf8')
            .replace('RATE_LIMIT_MODE=memory', 'RATE_LIMIT_MODE=upstash\nUPSTASH_REDIS_REST_URL=https://x.upstash.io');
        const host = makeHost({ env });
        const r = runApply(host, { CONFIRM: '1' });
        expect(r.status).toBe(2);
        expect(r.out).toContain('UPSTASH_REDIS_REST_TOKEN');
    });

    it('refuses while another Watchtower runs unscoped, and admits a scoped one', () => {
        const host = makeHost();
        const ps = 'agrent-caddy|caddy:2\\nagrent-watchtower|containrrr/watchtower:1.7.1\\n';
        const unscoped = runApply(host, { CONFIRM: '1', FAKE_PS: ps, FAKE_WT_CONFIG: '["WATCHTOWER_LABEL_ENABLE=true"] []' });
        expect(unscoped.status).toBe(2);
        expect(unscoped.out).toContain('agrent-watchtower');
        const scoped = runApply(host, { FAKE_PS: ps, FAKE_WT_CONFIG: '["WATCHTOWER_SCOPE=agrent"] []' });
        expect(scoped.status).toBe(0);
    });

    it('refuses a site that does not validate on its own', () => {
        const host = makeHost();
        const r = runApply(host, { CONFIRM: '1', FAKE_PREFLIGHT_VALIDATE: '1' });
        expect(r.status).toBe(2);
        expect(changedAnything(r.calls)).toBe(false);
    });
});

describe('deploy/apply.sh preflight and apply', () => {
    it('without CONFIRM, passes preflight and changes nothing', () => {
        const host = makeHost();
        const r = runApply(host);
        expect(r.status).toBe(0);
        expect(r.out).toContain('CONFIRM=1');
        expect(installed(host)).toBe(false);
        expect(siteInstalled(host)).toBe(false);
        expect(changedAnything(r.calls)).toBe(false);
        // Compose parsed the staged file against the real env file.
        expect(r.calls.some((c) => c.includes('config --quiet') && c.includes('--env-file'))).toBe(true);
    });

    it('with CONFIRM, installs, brings the stack up, then validates and reloads Caddy', () => {
        const host = makeHost();
        const r = runApply(host, { CONFIRM: '1' });
        expect(r.status).toBe(0);
        expect(fs.readFileSync(path.join(host.remote, 'docker-compose.prod.yml'), 'utf8')).toBe(
            fs.readFileSync(path.join(REPO, 'deploy/docker-compose.prod.yml'), 'utf8'),
        );
        expect(fs.readFileSync(path.join(host.remote, 'init-runtime-role.sh'), 'utf8')).toBe(
            fs.readFileSync(path.join(REPO, 'deploy/postgres/init-runtime-role.sh'), 'utf8'),
        );
        expect(fs.readFileSync(path.join(host.sites, 'islestone.caddy'), 'utf8')).toBe(
            fs.readFileSync(path.join(REPO, 'deploy/caddy/islestone.caddy'), 'utf8'),
        );
        const index = (needle: string) => r.calls.findIndex((c) => c.includes(needle));
        const up = index(' up -d');
        const validate = index('caddy validate --config /etc/caddy/Caddyfile');
        const reload = index('caddy reload');
        expect(up).toBeGreaterThan(-1);
        expect(index(' pull ')).toBeLessThan(up);
        expect(validate).toBeGreaterThan(up);
        expect(reload).toBeGreaterThan(validate);
        // Every compose call is this project, the installed file, .env.prod.
        const upCall = r.calls[up] ?? '';
        expect(upCall).toContain('-p islestone');
        expect(upCall).toContain(`--env-file ${host.remote}/.env.prod`);
        expect(r.out).not.toContain(SECRET);
    });

    it('rolls a refused site back and never reloads Caddy', () => {
        const host = makeHost();
        fs.writeFileSync(path.join(host.sites, 'islestone.caddy'), '# the previous site\n');
        const r = runApply(host, { CONFIRM: '1', FAKE_LIVE_VALIDATE: '1' });
        expect(r.status).toBe(1);
        expect(fs.readFileSync(path.join(host.sites, 'islestone.caddy'), 'utf8')).toBe('# the previous site\n');
        expect(r.calls.some((c) => c.includes('caddy reload'))).toBe(false);
    });

    it('removes a first site the shared configuration refuses', () => {
        const host = makeHost();
        const r = runApply(host, { CONFIRM: '1', CADDY_ONLY: '1', FAKE_LIVE_VALIDATE: '1' });
        expect(r.status).toBe(1);
        expect(siteInstalled(host)).toBe(false);
        // CADDY_ONLY touches no container of the stack.
        expect(r.calls.some((c) => / up -d/.test(c))).toBe(false);
    });
});
