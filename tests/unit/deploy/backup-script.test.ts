/**
 * deploy/backup.sh's off-host copy and the drill from the bucket, run for real
 * against a stand-in `docker` and a stand-in `gcloud` (owner decision 48,
 * 2026-11-19).
 *
 * The stand-in docker answers pg_dump with a few bytes and pg_restore --list
 * with a table-data line, so the script keeps the dump; the stand-in gcloud
 * logs its arguments and copies files in and out of a directory that plays
 * the bucket. The cases prove that:
 *   - with no bucket configured the upload is skipped with a warning, gcloud
 *     is never called, and the local backup still succeeds;
 *   - the bucket comes from --bucket, the environment or .env.prod, and the
 *     dump is uploaded to gs://BUCKET/db/<file> as soon as it is kept;
 *   - a failed upload fails the run and keeps the local copy;
 *   - a malformed bucket name is refused;
 *   - BACKUP_SOURCE=gcs restores the newest object in the bucket, and the
 *     downloaded file does not outlive the run.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');
const BACKUP = path.join(REPO, 'deploy/backup.sh');

const FAKE_DOCKER = `#!/usr/bin/env bash
printf 'docker %s\\n' "$*" >> "$FAKE_LOG"
case "$1" in
  version) exit 0 ;;
  exec)
    args=" $* "
    case "$args" in
      *" pg_dump "*) printf 'PGDMP-fake-dump' ;;
      *" pg_restore --list"*) cat > /dev/null; printf '3; 0 0 TABLE DATA public Tenant islestone\\n' ;;
      *" pg_restore "*) cat > "$FAKE_RESTORED" ;;
      *" psql "*) cat > /dev/null 2>&1 || true; echo 0 ;;
    esac
    exit 0 ;;
esac
exit 0
`;

/** gs://bucket/db/x is the file $FAKE_BUCKET_ROOT/bucket/db/x. */
const FAKE_GCLOUD = `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "$FAKE_LOG"
[ "\${FAKE_GCLOUD_FAIL:-0}" = 1 ] && exit 1
to_path() { printf '%s/%s' "$FAKE_BUCKET_ROOT" "\${1#gs://}"; }
case "$1 $2" in
  "storage cp")
    shift 2; [ "$1" = "--quiet" ] && shift
    src="$1"; dst="$2"
    case "$src" in gs://*) src="$(to_path "$src")" ;; esac
    case "$dst" in gs://*) dst="$(to_path "$dst")"; mkdir -p "$(dirname "$dst")" ;; esac
    cp "$src" "$dst" ;;
  "storage ls")
    dir="$(to_path "$3")"
    for f in "$dir"*; do [ -e "$f" ] && printf '%s%s\\n' "$3" "$(basename "$f")"; done ;;
esac
`;

interface Host {
    root: string;
    remote: string;
    log: string;
    bin: string;
    buckets: string;
    restored: string;
}

function makeHost(envProd?: string): Host {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'islestone-backup-'));
    const host: Host = {
        root,
        remote: path.join(root, 'opt/islestone'),
        log: path.join(root, 'calls.log'),
        bin: path.join(root, 'bin'),
        buckets: path.join(root, 'gcs'),
        restored: path.join(root, 'restored.dump'),
    };
    fs.mkdirSync(host.remote, { recursive: true });
    fs.mkdirSync(host.bin);
    fs.mkdirSync(host.buckets);
    fs.writeFileSync(path.join(host.bin, 'docker'), FAKE_DOCKER, { mode: 0o755 });
    fs.writeFileSync(path.join(host.bin, 'gcloud'), FAKE_GCLOUD, { mode: 0o755 });
    fs.writeFileSync(host.log, '');
    if (envProd !== undefined) {
        fs.writeFileSync(path.join(host.remote, '.env.prod'), envProd, { mode: 0o600 });
    }
    return host;
}

function run(host: Host, extra: Record<string, string> = {}, args: string[] = []) {
    const result = spawnSync('bash', [BACKUP, ...args], {
        encoding: 'utf8',
        env: {
            NODE_ENV: 'test',
            PATH: `${host.bin}:${process.env.PATH}`,
            HOME: host.root,
            ON_VM: '1',
            REMOTE_DIR: host.remote,
            FAKE_LOG: host.log,
            FAKE_BUCKET_ROOT: host.buckets,
            FAKE_RESTORED: host.restored,
            ...extra,
        },
    });
    const calls = fs.readFileSync(host.log, 'utf8').split('\n').filter(Boolean);
    return { status: result.status, out: `${result.stdout}${result.stderr}`, calls };
}

const dumps = (host: Host) =>
    fs.existsSync(path.join(host.remote, 'backups/db'))
        ? fs.readdirSync(path.join(host.remote, 'backups/db')).filter((f) => /^islestone-.*\.dump$/.test(f))
        : [];
const uploaded = (host: Host, bucket: string) =>
    fs.existsSync(path.join(host.buckets, bucket, 'db')) ? fs.readdirSync(path.join(host.buckets, bucket, 'db')) : [];

describe('deploy/backup.sh — the off-host copy', () => {
    it('skips the upload with a warning when no bucket is configured, and still keeps the backup', () => {
        const host = makeHost();
        const r = run(host);
        expect(r.status).toBe(0);
        expect(r.out).toContain('BACKUP_GCS_BUCKET is not configured');
        expect(r.calls.some((c) => c.startsWith('gcloud'))).toBe(false);
        expect(dumps(host)).toHaveLength(1);
    });

    it('uploads the kept dump to gs://BUCKET/db/<file>, the bucket from the environment', () => {
        const host = makeHost();
        const r = run(host, { BACKUP_GCS_BUCKET: 'gs://islestone-backups-test/' });
        expect(r.status).toBe(0);
        const [file] = dumps(host);
        expect(r.calls).toContain(`gcloud storage cp --quiet ${host.remote}/backups/db/${file} gs://islestone-backups-test/db/${file}`);
        expect(uploaded(host, 'islestone-backups-test')).toEqual([file]);
        expect(r.out).toContain(`uploaded gs://islestone-backups-test/db/${file}`);
    });

    it('takes the bucket from --bucket, and from .env.prod when neither is given', () => {
        const flag = makeHost();
        expect(run(flag, {}, ['--bucket', 'gs://from-flag-bucket']).status).toBe(0);
        expect(uploaded(flag, 'from-flag-bucket')).toHaveLength(1);

        const fromFile = makeHost('POSTGRES_PASSWORD=x\nBACKUP_GCS_BUCKET=from-env-file\n');
        const r = run(fromFile);
        expect(r.status).toBe(0);
        expect(uploaded(fromFile, 'from-env-file')).toHaveLength(1);
        // The one value it reads from .env.prod is the bucket; nothing else is printed.
        expect(r.out).not.toMatch(/POSTGRES_PASSWORD/);
    });

    it('fails when a configured upload fails, and keeps the local copy', () => {
        const host = makeHost();
        const r = run(host, { BACKUP_GCS_BUCKET: 'islestone-backups-test', FAKE_GCLOUD_FAIL: '1' });
        expect(r.status).toBe(1);
        expect(r.out).toMatch(/upload to gs:\/\/islestone-backups-test\/db\/.* failed; the local copy .* is kept/);
        expect(dumps(host)).toHaveLength(1);
    });

    it('refuses a malformed bucket name', () => {
        const host = makeHost();
        const r = run(host, { BACKUP_GCS_BUCKET: 'gs://Not A Bucket' });
        expect(r.status).toBe(1);
        expect(r.out).toContain('is not a bucket name');
        expect(r.calls.some((c) => c.startsWith('gcloud') || c.includes('pg_dump'))).toBe(false);
    });
});

describe('deploy/backup.sh — the drill from the bucket', () => {
    it('restores the newest object in the bucket and removes the download', () => {
        const host = makeHost();
        const dir = path.join(host.buckets, 'drill-bucket/db');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'islestone-20261101T020000Z.dump'), 'older');
        fs.writeFileSync(path.join(dir, 'islestone-20261118T020000Z.dump'), 'newest');
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a dump');
        const r = run(host, { RESTORE_DRILL: '1', BACKUP_SOURCE: 'gcs', BACKUP_GCS_BUCKET: 'drill-bucket' });
        expect(r.out).toContain('downloaded gs://drill-bucket/db/islestone-20261118T020000Z.dump');
        expect(r.status).toBe(0);
        expect(fs.readFileSync(host.restored, 'utf8')).toBe('newest');
        expect(r.calls).toContain('gcloud storage ls gs://drill-bucket/db/');
        expect(fs.readdirSync(path.join(host.remote, 'backups/db')).filter((f) => f.startsWith('drill-'))).toEqual([]);
    });

    it('restores a named object, and refuses BACKUP_SOURCE=gcs without a bucket', () => {
        const host = makeHost();
        const dir = path.join(host.buckets, 'b-named/db');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'islestone-20261115T020000Z.dump'), 'named');
        const named = run(host, { RESTORE_DRILL: '1', BACKUP_FILE: 'gs://b-named/db/islestone-20261115T020000Z.dump' });
        expect(named.status).toBe(0);
        expect(fs.readFileSync(host.restored, 'utf8')).toBe('named');

        const none = run(makeHost(), { RESTORE_DRILL: '1', BACKUP_SOURCE: 'gcs' });
        expect(none.status).toBe(1);
        expect(none.out).toContain('BACKUP_SOURCE=gcs needs a bucket');
    });
});

describe('deploy/gcs/backup-lifecycle.json', () => {
    it('deletes live objects after 30 days and noncurrent versions 30 days after they stop being current', () => {
        const lifecycle = JSON.parse(fs.readFileSync(path.join(REPO, 'deploy/gcs/backup-lifecycle.json'), 'utf8'));
        expect(lifecycle).toEqual({
            rule: [
                { action: { type: 'Delete' }, condition: { age: 30, isLive: true } },
                { action: { type: 'Delete' }, condition: { daysSinceNoncurrentTime: 30 } },
            ],
        });
    });
});
