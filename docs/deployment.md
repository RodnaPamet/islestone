# Deployment

How Islestone reaches production and how an operator runs it (sub-phase 1.8).
The decisions behind it are the owner's of 2026-11-19, rows 42 to 47 of
`docs/HANDOFF.md`; the rules for what may change, and how, are in
[`docs/change-management-policy.md`](change-management-policy.md).

## Where it runs

| | |
|---|---|
| Host | The GCP VM `agrent` (project `hazel-design-419410`, zone `europe-west1-b`, e2-highmem-2: 2 vCPUs, 16 GB), shared with Agrent and Playerz |
| Project | Docker Compose project `islestone`, in `/opt/islestone` |
| Hostnames | `islestone.cloud` (canonical) and `www.islestone.cloud` (redirects to it) |
| Environments | Production only. No staging and no per-pull-request previews (owner decision 43) |
| Edge | The shared Caddy, `agrent-caddy`, on ports 80 and 443 |

The stack (`deploy/docker-compose.prod.yml`, the canonical file):

| Service | Container | Image | Memory | Role |
|---|---|---|---|---|
| `postgres` | `islestone-postgres` | `pgvector/pgvector:0.8.7-pg17-trixie` | 1536 MB | The database. Runs `prisma/init-roles.sh` and `deploy/postgres/init-runtime-role.sh` on a fresh volume |
| `pgbouncer` | `islestone-pgbouncer` | `edoburu/pgbouncer:v1.26.1-p0` | 128 MB | Transaction pooling; knows only the runtime role |
| `redis` | `islestone-redis` | `redis:7.4.12-alpine3.22` | 512 MB | BullMQ and the worker heartbeat; password, `noeviction` |
| `migrate` | `islestone-migrate` | `ghcr.io/rodnapamet/islestone-worker` | 512 MB | One-shot `prisma migrate deploy`, as the superuser, direct |
| `app` | `islestone-app` | `ghcr.io/rodnapamet/islestone` | 1024 MB | The Next.js standalone server, port 3000 |
| `worker` | `islestone-worker` | `ghcr.io/rodnapamet/islestone-worker` | 768 MB | The BullMQ worker and the scheduler |
| `watchtower` | `islestone-watchtower` | `containrrr/watchtower:1.7.1` | 128 MB | Rolls `app`, `worker` and `migrate` onto new images |

The long-running services sum to 4 GB of the roughly 11 GB the VM has free;
`tests/unit/deploy/compose-prod.test.ts` holds that ceiling, every limit, and
Node's heap ceiling below each Node container's limit.

**Networks.** Every service is on `islestone_internal`, a plain bridge that
publishes no port. Only `app` also joins `agrent_internal`, the external
network the shared Caddy proxies over. Every container is addressed by its
`islestone-` name, never by a bare service name: on `agrent_internal` a bare
`redis` or `postgres` could resolve to another product's container.

**Database roles.** Migrations run as the superuser `islestone`, which owns the
tables. The app, the worker and PgBouncer use `islestone_app`, created by
`deploy/postgres/init-runtime-role.sh`: it logs in, is not a superuser, cannot
bypass row-level security, and is a member of `app_user`
([`docs/rls-tenant-isolation.md`](rls-tenant-isolation.md), "The role model").
The whole integration suite was run with the app connected as such a role
(`docs/HANDOFF.md`, the 1.8 step), and `tests/integration/runtime-role.test.ts`
keeps the role's properties.

**Secrets.** Every secret is in `/opt/islestone/.env.prod` (mode 600, owned by
root, never copied off the host), which `deploy/apply.sh` passes to Compose
with `--env-file`. The compose file references each one as `${VAR:?…}`
(required) or `${VAR:-}` (optional) and gives each service only the variables
it names, so the app never sees the superuser's password. The names are in
`deploy/.env.prod.example`.

## How an image reaches production

1. A pull request merges into `main` once its required checks pass. CI's
   `Image` job has built both images on the pull request already, without
   pushing them.
2. `.github/workflows/release.yml` runs on the push. Its `version` job runs
   semantic-release, which tags the commit `vX.Y.Z` and writes a GitHub
   Release when the Conventional Commit subjects since the last tag call for
   one (`feat:` minor, `fix:` patch). It commits nothing back to `main`.
3. Its `publish` job builds the app and worker images (`Dockerfile` targets
   `app` and `worker`), scans them with Trivy, and pushes each to GHCR as
   `:sha-<short>`, `:<version>` when step 2 made one, and `:latest`, the
   moving tag last. The token is `GITHUB_TOKEN` with `packages: write`.
4. Watchtower on the VM (scoped to the `islestone` project) sees the new
   `:latest` within two minutes. It stops `app` and `worker`, updates
   `migrate` and starts it again (it is labelled, included while stopped and
   revived), then starts `app` and `worker` on the new images.
5. Watchtower does not honour `depends_on`, so both images start through
   `scripts/wait-for-migrations.mjs`: each waits until the newest migration
   it was built with (`.migration-head`, baked at build time) is recorded as
   applied in `_prisma_migrations`, then starts. If `migrate` fails, they keep
   waiting for five minutes, exit, and the restart policy tries again; the
   site answers 502 until the migration is fixed forward.

A change to the stack's structure (a service, a limit, a variable, the Caddy
site) does not travel this way. It lands in the repository and an operator
runs `deploy/apply.sh`.

## The images

One `Dockerfile`, one builder stage, two targets (sub-phase 1.8):

- **`app`** (`ghcr.io/rodnapamet/islestone`): `next build`'s standalone server
  (`output: 'standalone'`) with the ~50 packages it traces, the static assets,
  and nothing else. Runs as `node` (uid 1000). `HEALTHCHECK` on `/api/livez`;
  the compose file overrides it with `/api/readyz`.
- **`worker`** (`ghcr.io/rodnapamet/islestone-worker`): the worker, scheduler
  and health-probe bundles (`npm run build:worker`), the production
  dependency tree, Prisma's schema and config, and the Prisma CLI the
  `migrate` service runs. Runs as `node`. `HEALTHCHECK` reads the worker
  heartbeat.

Why two: the worker bundles keep every package external and need the whole
production tree, and the Prisma CLI drags in Prisma Studio; the standalone
server needs neither. One image would put all of it into the only container
the internet reaches. Both are built from the same commit and carry the same
tags.

Both images carry `LICENSE` and `NOTICE` at `/app` (the libvips and elkjs
notices, ADR 0007), have npm removed, and report their commit as `BUILD_SHA`,
which `/api/readyz` returns as `version`. Build locally with
`docker build --target app .` or `--target worker`.

`npm run start` serves the standalone build the way the image does
(`scripts/start-standalone.mjs`), and the Playwright suite runs against it.

## Health

- **`/api/livez`** — the process answers HTTP. Checks nothing, on purpose: a
  database outage must not make every replica look dead.
- **`/api/readyz`** — 200 `{"status":"ready"}` when PostgreSQL (through the
  app's own client, so through PgBouncer) and Redis both answer; 503
  `{"status":"not_ready","failed":[…]}` otherwise. Each check times out after
  two seconds; error strings come from a closed set and never carry a
  driver's message (`src/lib/health/readiness.ts`). In production an unset
  `REDIS_URL` is an error, never a skipped check.
- **Containers.** `app` is healthy when `/api/readyz` answers 200; `worker`
  when its heartbeat key exists (`scripts/worker-healthcheck.ts`); the stores
  by their own probes.

## The shared Caddy

One Caddy container, `agrent-caddy`, owns ports 80 and 443 and reads Agrent's
Caddyfile (`/opt/agrent/Caddyfile`, mounted at `/etc/caddy/Caddyfile`).
Islestone never edits that file (owner decision 44). Two changes to Agrent's
deployment make room for other products' sites; they are made once, **in
Agrent's repository** (this session cannot reach it), and deployed by Agrent's
own process:

1. **The import line.** Agrent's Caddyfile gains, at the top level (outside
   every site block), the line:

   ```caddyfile
   import /etc/caddy/sites/*.caddy
   ```

   Caddy accepts a glob that matches no file, so the line is safe before any
   product installs a site.
2. **The read-only mount.** Agrent's `agrent-caddy` service gains a volume,
   and the host directory is created:

   ```yaml
   services:
     caddy:   # the service whose container is agrent-caddy
       volumes:
         - /opt/caddy-sites:/etc/caddy/sites:ro
   ```

   ```bash
   sudo install -d -m 0755 /opt/caddy-sites
   ```

   Recreate `agrent-caddy` (a reload does not add a mount), then check that it
   still serves Agrent.

`deploy/apply.sh` checks both and refuses, changing nothing, until they are in
place: the import line must be in `/opt/agrent/Caddyfile`, and `agrent-caddy`
must mount `/opt/caddy-sites` at `/etc/caddy/sites` read-only.

Islestone's site is `deploy/caddy/islestone.caddy`: two site blocks and
nothing global, installed as `/opt/caddy-sites/islestone.caddy`. It redirects
`www` to the apex, sets HSTS (the app's own two-year value), the content-type,
frame and referrer headers, a 10 MB body limit, an immutable cache header on
`/_next/static/*`, and proxies to `islestone-app:3000`, setting
`X-Forwarded-For` and `X-Real-IP` from the connection, because the app reads
the client's address from the first `X-Forwarded-For` entry (rate limits,
session records). `apply.sh` validates the site on its own inside
`agrent-caddy`, then, once installed, the whole configuration, and only then
runs `caddy reload` (graceful: no dropped connection, no certificate
re-issued). A site that does not validate is removed or put back as it was.

## Watchtower

Each product on the VM runs its own Watchtower, scoped. Islestone's runs with
`WATCHTOWER_SCOPE=islestone` and `WATCHTOWER_LABEL_ENABLE=true`, and touches a
container only when it carries both `com.centurylinklabs.watchtower.scope=islestone`
and `com.centurylinklabs.watchtower.enable=true`: `app`, `worker` and
`migrate`. Postgres, PgBouncer, Redis and Watchtower itself carry
`enable=false`, which every Watchtower honours.

A Watchtower that runs without a scope considers every container on the host,
Islestone's included. `deploy/apply.sh` refuses while one runs; Agrent's and
Playerz's must be scoped (as Agrent's is) before the first deploy.

Watchtower and Compose pull from GHCR anonymously: both packages,
`islestone` and `islestone-worker`, are public (owner decision 49), so no
registry credential is kept on the VM and nothing is mounted for one. A pull
before the packages are made public fails with `denied` or `unauthorized`
(see "First deploy", step 2).

## Operating

All three scripts run from a workstation signed in to `gcloud` (as the owner):
they ship the `deploy/` bundle to the VM over IAP and run themselves there as
root. On the VM itself, set `ON_VM=1`. None prints a value from `.env.prod`.

```bash
deploy/apply.sh                      # preflight on the VM, print the plan, change nothing
CONFIRM=1 deploy/apply.sh            # preflight, then apply
CADDY_ONLY=1 CONFIRM=1 deploy/apply.sh   # install and reload only the Caddy site
deploy/check-drift.sh                # does the VM run what the repository says? (exit 1 on drift)
deploy/backup.sh                     # a pg_dump into /opt/islestone/backups/db, copied to the bucket
RESTORE_DRILL=1 deploy/backup.sh     # restore the newest local dump into a scratch database and compare
RESTORE_DRILL=1 BACKUP_SOURCE=gcs deploy/backup.sh   # the same, from the newest copy in the bucket
```

`apply.sh` exits 0 when it applied (or the preflight passed), 1 when a step
failed, 2 when it refused (nothing changed). Its preflight checks Docker and
Compose, the shared network, the shared Caddy (import line, read-only mount,
running), every other Watchtower's scope, `.env.prod` (present, mode 600,
every required value, URL-safe passwords, `RATE_LIMIT_MODE` with its Upstash
pair), that Compose interpolates and parses the new file against it, and that
the site validates. With `CONFIRM=1` it backs up the live files to
`/opt/islestone/backups/config-<timestamp>/`, installs the new ones, pulls,
runs `docker compose up -d --remove-orphans`, waits for `islestone-app` to be
healthy, then installs and reloads the Caddy site.

Useful on the VM (`sudo`):

```bash
cd /opt/islestone
docker compose -p islestone --env-file .env.prod -f docker-compose.prod.yml ps
docker logs --tail 200 islestone-app      # likewise islestone-worker, islestone-migrate
docker inspect -f '{{.State.Health.Status}}' islestone-app
```

Never `cat` or copy `.env.prod`; to see which names it holds:
`sudo grep -oE '^[A-Z_]+=' /opt/islestone/.env.prod`.

### Rollback

- **The application.** Set `ISLESTONE_IMAGE_TAG` in `.env.prod` to an earlier
  published tag (`sha-<short>` or a version; every publish keeps its
  immutable tags) and run `CONFIRM=1 deploy/apply.sh`. App, worker and
  migrate run that build, and Watchtower leaves them there. Empty the variable
  and apply again to follow `:latest`.
- **Migrations never go backwards.** An earlier image whose migrations are
  behind the database's still starts (its gate asks only for its own newest
  migration). If the earlier code cannot work with the newer schema, fix
  forward with a new migration
  ([`docs/change-management-policy.md`](change-management-policy.md), "Rollback").
- **The stack's structure.** Every apply leaves the previous files in
  `/opt/islestone/backups/config-<timestamp>/`. Revert the change in the
  repository and apply again; the backup is for reading.

## First deploy

In order. Steps 1 to 4 are the owner's or the orchestrator's on the VM, in
GitHub and at the DNS provider; this repository cannot do them.

1. **DNS.** Point `islestone.cloud` and `www.islestone.cloud` (A, and AAAA if
   the VM has IPv6) at the VM's external address. Caddy issues the
   certificates on the first request, so the records must resolve first.
2. **GitHub.**
   - Merge the 1.8 pull request; `release.yml` publishes the first images.
   - Set both packages public after that first publish (owner decision 49):
     the organization's Packages → `islestone` and then `islestone-worker` →
     Package settings → Change visibility → Public. A package does not exist
     until its first push, so this cannot be done earlier. No registry
     credential goes on the VM.
   - Add the new `Image` and `PR title` checks to the `main` ruleset's
     required checks.
   - Make squash the merge method, with the pull request's title as the
     default commit message (Settings → General → Pull Requests: allow squash
     merging, "Default commit message: Pull request title"), so the
     Conventional Commit title the `PR title` check holds is the subject
     semantic-release reads (owner decision 51).
   - Enable code scanning results for the SARIF the `Image` and `DAST` jobs
     upload, if the Security tab is not on.
3. **Agrent's Caddy.** Make the two changes in "The shared Caddy" in Agrent's
   repository, create `/opt/caddy-sites`, deploy Agrent, and confirm Agrent
   still serves. Confirm Agrent's and Playerz's Watchtowers are scoped.
4. **Secrets.** On the VM:

   ```bash
   sudo install -d -m 0755 /opt/islestone
   sudo install -m 0600 /dev/null /opt/islestone/.env.prod
   sudoedit /opt/islestone/.env.prod     # fill it from deploy/.env.prod.example
   ```

   Generate each value on the VM (`openssl rand -hex 32` for the three
   passwords, `openssl rand -base64 32` for `AUTH_SECRET`,
   `openssl rand -base64 48` for the three keys). Keep a copy of
   `DATA_ENCRYPTION_KEY`, `LOOKUP_HASH_KEY` and `DERIVED_SUBKEY_KEY` in the
   owner's password manager: without them no encrypted field and no email
   sign-in can be read again. Set `RATE_LIMIT_MODE=memory` (owner decision
   50: production runs a single app container, so the per-process limits are
   exact; revisit with Upstash when the app runs in more than one container).
   Set `BACKUP_GCS_BUCKET` once the bucket exists (step 9). Leave
   `AUTH_PUBLIC_SIGNUP` empty.
5. **Preflight**, from a workstation: `deploy/apply.sh`. Fix whatever it
   refuses.
6. **Apply**: `CONFIRM=1 deploy/apply.sh`. The first run initialises the
   database volume (the two init scripts), runs every migration, starts the
   app and the worker, and installs the Caddy site.
7. **Check**: `https://islestone.cloud/api/readyz` answers `ready` with the
   commit as `version`; `deploy/check-drift.sh` reports no drift; `docker ps`
   shows `islestone-app` and, after about five minutes, `islestone-worker`
   healthy.
8. **The first workspace.** Public sign-up is closed in production. Set
   `AUTH_PUBLIC_SIGNUP=1` in `.env.prod`, apply, register the owner's
   workspace on the sign-in page (`https://islestone.cloud/login`, in its
   register mode), then empty it and apply again.
9. **Backups.** Create the bucket and grant the VM's service account access
   ("Off-host copies", below), set `BACKUP_GCS_BUCKET` in `.env.prod`, take a
   backup (`deploy/backup.sh`; it reports the upload), run the restore drill
   from the bucket (`RESTORE_DRILL=1 BACKUP_SOURCE=gcs deploy/backup.sh`), and
   record it below. Schedule the backup (below).

## Backups and the restore drill

`deploy/backup.sh` runs `pg_dump --format=custom` inside `islestone-postgres`
as the superuser, through the container's socket (no password on a command
line), keeps the file only if `pg_restore --list` reads it, stores it mode 600
in `/opt/islestone/backups/db/` (mode 700), and keeps the newest
`BACKUP_KEEP` (14). Redis holds only queue state and is not backed up: queued
jobs are re-created by the schedules, and the outbox is in Postgres.

Schedule it on the VM, as root, for example daily at 02:23 UTC:

```cron
23 2 * * * ON_VM=1 bash /opt/islestone/deploy-tools/deploy/backup.sh >> /var/log/islestone-backup.log 2>&1
```

(`/opt/islestone/deploy-tools` is a checkout or copy of this repository's
`deploy/` and `prisma/init-roles.sh`; the scripts run from anywhere.)

### Off-host copies

A backup on the VM's disk does not survive the loss of the VM, so every kept
dump is also uploaded to a private Cloud Storage bucket in the same project
(owner decision 48): `gs://islestone-backups-hazel-design-419410/db/<file>`.
`deploy/backup.sh` uploads with `gcloud storage cp`, as the VM's own service
account (the metadata server's credentials; no key file exists). The bucket
comes from `--bucket gs://NAME`, else `BACKUP_GCS_BUCKET` in the environment,
else `BACKUP_GCS_BUCKET` in `.env.prod`. With none, the script warns and keeps
the local copy only (`deploy/check-drift.sh` reports that as drift); with one,
a failed upload fails the run (exit 1) and the local copy is kept.

The bucket is versioned and has one lifecycle policy,
`deploy/gcs/backup-lifecycle.json`: a live object is deleted 30 days after it
was written, and a noncurrent version 30 days after it stopped being current.
With versioning on, the first rule turns a dump noncurrent rather than
erasing it, so a dump stays recoverable for about 60 days in all. The VM's
account may create objects and read them (the drill), never delete or
overwrite one: a compromised VM cannot destroy the off-host history.

**One-time setup**, run by the orchestrator from a workstation signed in to
`gcloud`, with the owner's approval. Nothing in this repository creates these.

```bash
PROJECT=hazel-design-419410
BUCKET=gs://islestone-backups-hazel-design-419410

# 1. The VM's service account, and the access scopes it runs with. A scope
#    narrower than storage read-write (the GCE default is devstorage.read_only)
#    blocks uploads whatever IAM grants; if the output lists neither
#    .../auth/devstorage.read_write nor .../auth/cloud-platform, stop and ask
#    the owner: changing scopes needs the VM stopped, and the VM also runs
#    Agrent and Playerz.
gcloud compute instances describe agrent --project "$PROJECT" --zone europe-west1-b \
  --format='value(serviceAccounts[0].email)'
gcloud compute instances describe agrent --project "$PROJECT" --zone europe-west1-b \
  --format='value(serviceAccounts[0].scopes)'
VM_SA=<the email printed above>

# 2. The bucket: in the VM's region, uniform bucket-level access, public
#    access prevented.
gcloud storage buckets create "$BUCKET" --project "$PROJECT" --location europe-west1 \
  --default-storage-class STANDARD --uniform-bucket-level-access --public-access-prevention

# 3. Versioning and the 30-day lifecycle (the file is in this repository).
gcloud storage buckets update "$BUCKET" --versioning
gcloud storage buckets update "$BUCKET" --lifecycle-file deploy/gcs/backup-lifecycle.json

# 4. The VM's account: create objects (the upload) and read them (the drill
#    lists the bucket and downloads a dump). On this bucket only; no delete.
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member "serviceAccount:${VM_SA}" --role roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding "$BUCKET" \
  --member "serviceAccount:${VM_SA}" --role roles/storage.objectViewer

# 5. Check.
gcloud storage buckets describe "$BUCKET" \
  --format='yaml(versioning,lifecycle_config,iam_configuration,public_access_prevention)'
```

Then, on the VM: `command -v gcloud` (the Google Cloud CLI is on Google's
standard images; install it if not), set `BACKUP_GCS_BUCKET` in `.env.prod`,
and run `deploy/backup.sh` once: it ends with `uploaded gs://…`.

### The restore drill

The drill (Hardening H1: "a restore performed once and documented"):
`RESTORE_DRILL=1 deploy/backup.sh` restores the newest local dump (or
`BACKUP_FILE=<path>`); with `BACKUP_SOURCE=gcs` it downloads the newest
object under `gs://BUCKET/db/` instead (or `BACKUP_FILE=gs://…` names one),
to a private temporary file removed when it ends. It creates the scratch database `islestone_restore_drill` in the same Postgres,
restores the dump into it with `--exit-on-error`, prints the restored and live
migration head, table, forced-RLS, policy and trigger counts and every table's
row count side by side, checks that every audit entry's previous hash is in
the restored copy, and drops the scratch database. It never touches the live
database.

To restore for real (a lost or corrupted database), in a service window:

```bash
cd /opt/islestone
C="docker compose -p islestone --env-file .env.prod -f docker-compose.prod.yml"
$C stop app worker watchtower
docker exec -i islestone-postgres psql -U islestone -d postgres -c 'DROP DATABASE islestone WITH (FORCE)'
docker exec -i islestone-postgres psql -U islestone -d postgres -c 'CREATE DATABASE islestone OWNER islestone'
docker exec -i islestone-postgres pg_restore -U islestone -d islestone --exit-on-error < backups/db/<file>.dump
# (from the bucket: gcloud storage cp gs://islestone-backups-hazel-design-419410/db/<file>.dump backups/db/ first)
$C up -d
```

The roles (`app_user`, `islestone_app`) live in the cluster, not in the
database, so they survive the drop; a new cluster (a lost volume) gets them
from the init scripts on its first start, before the restore.

### Restore drills

| Date | Dump | Result | By |
|---|---|---|---|
| — | — | None performed on the VM yet (H1 asks for one; the orchestrator runs it after the first deploy) | — |

The drill was exercised locally on 2026-11-19 against a migrated test database
(`docs/HANDOFF.md`, the 1.8 step), not against production data.

## Security scans

Hardening H1's scans run report-only first (owner decision 47):

- **Trivy**, CRITICAL and HIGH, fixed vulnerabilities only, on both images:
  in CI's `Image` job (SARIF to the Security tab, categories
  `trivy-image-app` and `trivy-image-worker`) and before every push in
  `release.yml`.
- **OWASP ZAP baseline**, nightly (`.github/workflows/dast.yml`, 03:17 UTC):
  the standalone server against Postgres and Redis, signed in as a workspace
  owner the run registers, with SARIF (`zap-baseline`), the HTML report as an
  artifact, and an issue for findings. `.zap/rules.tsv` lists the false
  positives, each with its reason; `.zap/assert-no-high-risk.mjs` names every
  High, allowlisted or not.

Both carry a dated marker, `TRIVY-NON-BLOCKING-UNTIL: 2026-12-03` and
`DAST-NON-BLOCKING-UNTIL: 2026-12-03`: two weeks from the decision.
`tests/guards/security-scan-deferral.test.ts` fails CI the day after that date
while a scan is still non-blocking. To make them blocking: in `ci.yml` and
`release.yml` set the Trivy steps' `exit-code` to `"1"`; in `dast.yml` set
`fail_action: true` and remove `continue-on-error` from the scan and the
HIGH+ step; delete the markers. To defer instead, move the date (at most 60
days ahead) with the reason in the pull request.

Triage: a finding is fixed in the app, or, for a false positive below High,
listed in `.zap/rules.tsv` (ZAP) or `.trivyignore` (Trivy; none yet) with the
reason and the condition that retires it. A High is fixed, never listed.
