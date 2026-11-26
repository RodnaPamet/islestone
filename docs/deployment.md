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
| `postgres` | `islestone-postgres` | `ghcr.io/rodnapamet/islestone-postgres` (pgvector 0.8.7 on PostgreSQL 17, plus the Bulgarian dictionary; "The Postgres image" below) | 1536 MB | The database. Runs `prisma/init-roles.sh` and `deploy/postgres/init-runtime-role.sh` on a fresh volume |
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

### The Postgres image

Sub-phase 2.7f (ADR 0008 D2; owner decisions 145 to 147; `docs/search.md`).
The database runs Islestone's own image, `ghcr.io/rodnapamet/islestone-postgres`,
built from `deploy/postgres/Dockerfile`: `pgvector/pgvector:0.8.7-pg17-trixie`
by its index digest, plus the bgOffice Bulgarian dictionary
(`bulgarian.dict`, `bulgarian.affix`, MPL-2.0, ADR 0007 E10) in
`$SHAREDIR/tsearch_data`, which the `islestone_bg_en` text-search
configuration reads. Nothing else differs from the stock image: the same
PostgreSQL 17, pgvector, entrypoint, user and data directory, so moving a
database onto it is a container recreation on the same volume, with no dump
and no restore.

- **Published** by `release.yml` under the Dockerfile's version tag
  (`org.opencontainers.image.version`, today `17-0.8.7-bg4.3-r2`) when that tag
  is not yet in GHCR; a published tag is never rebuilt or moved. Change
  anything in `deploy/postgres/` and bump the tag (the Dockerfile's comment and
  label, and the compose file's line), or the release keeps the old image.
- **Pinned** in `deploy/docker-compose.prod.yml`. Until a tag's first publish
  exists its digest is unknown, so the line names the tag alone and the file
  carries the `POSTGRES-IMAGE-DIGEST-PENDING` marker; once the release has
  published it, the run's summary prints `<tag>@sha256:<digest>`, and a
  follow-up pull request puts that on the line and removes the marker
  (`tests/guards/postgres-image-pinning.test.ts` accepts exactly those two
  states). `17-0.8.7-bg4.3-r1` was pinned at
  `sha256:796db89d604fee3df2f06b041e8cc417b1597b69ceb0e7f695586df479833835`
  (release run 26, 2026-11-20); `-r2` is named with the marker until its
  publish. Watchtower never rolls the database (`enable=false`).
- **Patched beyond the base** (Hardening H1; owner decisions 247 and 248), so
  the publish's blocking Trivy scan passes. The Dockerfile upgrades the
  Debian packages that carried fixed HIGH vulnerabilities (krb5's four
  libraries, `zlib1g`, `libzstd1`, `zstd`; `apt-get install --only-upgrade`,
  no recommends, the lists removed) and refuses a build whose installed
  versions are older than the fixed ones, because `apt-get update` only warns
  when a mirror cannot be reached. It replaces the base's `gosu` (1.19, Go
  1.24.6, whose standard library carried fixed CRITICAL and HIGH
  vulnerabilities) with gosu 1.20 built in its own stage from
  `github.com/tianon/gosu` at the tag's commit, on
  `golang:1.27.4-trixie` by index digest, `CGO_ENABLED=0` and upstream's
  flags; its licence and those of what it links are in
  `/usr/share/doc/islestone-postgres/gosu/` (`NOTICE`, `PROVENANCE.md`). The
  build therefore needs the network (Debian's mirrors, GitHub and the Go
  module proxy). When Trivy reports another package or a newer Go standard
  library, add or bump it there and bump the tag; a published image is never
  patched in place.
- **Fail closed.** Migration `20261207120000_search_configuration` refuses to
  run on a server without the dictionary ("the Bulgarian dictionary could not
  be loaded … This server is not running Islestone's Postgres image"), and the
  app and the worker refuse to start in production when the configuration
  does not stem as pinned; `/api/readyz` reports it as `search`.
- **Memory.** The dictionary is loaded into each backend that uses it, about
  9.3 MB (measured); PgBouncer's pool of 20 bounds that near 190 MB of the
  1536 MB limit. No limit changed.
- **Logs.** The stored vectors and every search query are plaintext words
  (ADR 0008 D1). The application never logs them; the database keeps
  PostgreSQL's defaults, which keep bind parameters out of its own log:
  `log_statement = none` and `log_parameter_max_length_on_error = 0`. Do not
  raise either on this server.

**The one-time move (owner decision 147).** The release that carries 2.7f
publishes the image and new `:latest` app and worker images in one run, and
Watchtower would run the new `migrate` against the old database. To keep the
migration from failing, an operator does this once, around that merge:

1. Before the merge, pin the running build: set `ISLESTONE_IMAGE_TAG` in
   `.env.prod` to the `sha-<short>` tag the app runs now, and apply
   (`deploy/apply.sh`, then `CONFIRM=1`). Watchtower then has nothing to roll.
2. Merge, and wait for the release run to publish
   `ghcr.io/rodnapamet/islestone-postgres:<tag>` and the new app images.
3. Apply the repository's compose file (`CONFIRM=1 deploy/apply.sh`): it pulls
   the new database image and recreates `islestone-postgres` on the same
   `pgdata` volume (a restart of a few seconds), and the old `migrate`
   finds nothing to do.
4. Unpin: remove `ISLESTONE_IMAGE_TAG` (or set it to the new `sha-` tag) and
   apply again. The new `migrate` runs the configuration and vector
   migrations; the app and the worker start after it; the nightly
   `search-index-rebuild` (02:40) backfills every description and comment, or
   an admin starts it at once (`POST /api/t/<slug>/admin/search-index/rebuild`).
5. Check: `docker exec islestone-postgres sh -c 'ls "$(pg_config --sharedir)/tsearch_data/bulgarian.dict"'`
   and `/api/readyz` (`search: ok`).

If the new `migrate` ran before step 3 anyway, it failed closed on
`20261207120000_search_configuration` before changing anything, and Prisma
recorded the failure, so later runs stop at it. After step 3, mark it rolled
back and run it again:

```bash
cd /opt/islestone
C="docker compose -p islestone --env-file .env.prod -f docker-compose.prod.yml"
$C run --rm migrate node_modules/.bin/prisma migrate resolve --rolled-back 20261207120000_search_configuration
$C up -d migrate
```

A new cluster (a lost volume) starts on the image directly; nothing extra.

**Moving to `-r2` (owner decision 247).** The same PostgreSQL 17, pgvector,
dictionary, entrypoint, user and data directory as `-r1`, with patched
libraries and a rebuilt `gosu`, so the move is a container recreation on the
same volume, with no migration and no dump:

1. Merge; the release run publishes
   `ghcr.io/rodnapamet/islestone-postgres:17-0.8.7-bg4.3-r2` after its scan
   passes, and its summary prints the digest.
2. A follow-up pull request pins that digest on the compose line and removes
   the `POSTGRES-IMAGE-DIGEST-PENDING` marker.
3. After that merge, apply (`deploy/apply.sh`, then `CONFIRM=1`): it pulls
   the new image and recreates `islestone-postgres` (a restart of a few
   seconds; the app and the worker reconnect). Until then production keeps
   running `-r1`: a line naming an unpublished tag cannot be pulled, so do
   not apply between steps 1 and 2.
4. Check: `docker exec islestone-postgres gosu --version` (`1.20 (go1.27.4 …)`)
   and `/api/readyz` (`search: ok`).

## Health

- **`/api/livez`** — the process answers HTTP. Checks nothing, on purpose: a
  database outage must not make every replica look dead.
- **`/api/readyz`** — 200 `{"status":"ready"}` when PostgreSQL (through the
  app's own client, so through PgBouncer) and Redis both answer and the
  database's `islestone_bg_en` configuration stems its fixtures as pinned
  (`search`, sub-phase 2.7f); 503
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

Public intake forms (sub-phase 2.6b) are closed in production until an
operator sets `INTAKE_PUBLIC_FORMS=1` in `.env.prod` and applies. Open them
only once the release that added them runs on both `islestone-app` and
`islestone-worker` (the worker sends the requester's emails), and empty the
value to close them again; closed, every public form answers 404.

Inbound email (sub-phase 2.6c) is closed in production until an operator
sets `INTAKE_EMAIL=1` with the Resend values and applies; see "Email
(Resend)" below for the order.

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

## Email (Resend)

Owner decisions 120 and 121. Resend sends Islestone's mail and receives the
inbound intake email; it is a sub-processor
([`docs/sub-processors.md`](sub-processors.md)). The facts about Resend here
come from search summaries, not a live page: **re-check each against
resend.com before go-live** (marked "(re-check)").

**Domains, in eu-west-1.** In Resend, create both the sending domain and
`in.islestone.cloud` in the **eu-west-1** region; the region is fixed when a
domain is created and cannot be moved (re-check). Add the DNS records Resend
shows for the sending domain (SPF, DKIM; a DMARC record for the domain is the
operator's), and for receiving:

| Record | Name | Value |
|---|---|---|
| MX | `in.islestone.cloud` | the inbound host Resend shows for the domain, priority as Resend gives it (re-check) |

`in.islestone.cloud` is a subdomain on purpose: the apex domain's mail, if it
ever has any, is untouched.

**Outbound SMTP** (configuration only, no code). In `.env.prod`:
`SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465` (or 587), `SMTP_USER=resend`,
`SMTP_PASS=` the Resend API key, `SMTP_FROM=` an address on the verified
sending domain (re-check the host, ports and user). The mailer sends through
nodemailer whenever `SMTP_HOST` is set (`docs/notifications.md`).

**Inbound** (sub-phase 2.6c, decision 122; `docs/intake.md`, "Inbound email
(2.6c)"):

1. Create an API key for the workspace's Resend account and put it in
   `RESEND_API_KEY` (the fetch job retrieves each received email with it; the
   same key may serve `SMTP_PASS`).
2. Add a webhook in Resend for the `email.received` event to
   `https://islestone.cloud/api/intake/email/resend`, and put its signing
   secret (`whsec_…`) in `RESEND_WEBHOOK_SECRET` (re-check the event name and
   the secret's form).
3. Leave `INTAKE_EMAIL_DOMAIN` at `in.islestone.cloud` unless the MX above
   names another domain.
4. Send one test email to an address on the domain before opening intake (it
   is dropped: no project has an address yet), read the raw message Resend
   keeps, and if it carries an `Authentication-Results` header written by
   Resend's receiving server, set `INTAKE_EMAIL_AUTHSERV_ID` to that header's
   first word (its authserv-id). Unset, every email is treated as
   unauthenticated: stored, never acknowledged, never attributed to a member
   (decision 123).
5. Set `INTAKE_EMAIL=1` and apply, only once the release that added inbound
   email runs on both `islestone-app` (the webhook) and `islestone-worker`
   (the fetch job and the acknowledgements). Production refuses
   `INTAKE_EMAIL=1` without both Resend values. Empty it to close inbound
   email again: the webhook then answers 200 and reads nothing.

Caddy already accepts the path; the app trusts the first `X-Forwarded-For`
entry Caddy sets, which the webhook's per-IP bound reads.

**Data held at Resend** (decision 121). Received mail and Resend's logs are
very likely stored in the US for 30 days, and no API to delete them was found
(re-check). The owner accepted this on the Standard Contractual Clauses
(Resend's DPA, resend.com/legal/dpa) and the EU–US Data Privacy Framework.
**Operator step:** ask Resend whether received mail and logs can be deleted
on request or kept for zero days, and record the answer in
`docs/sub-processors.md`.

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

A dump restores only into Islestone's Postgres image (since 2.7f): the title
and project-name indexes and the stored vectors depend on the
`islestone_bg_en` configuration and its Bulgarian dictionary, which the stock
pgvector image lacks, so `pg_restore` fails creating them there. The drill
restores into the running `islestone-postgres`, which is that image. The
dump holds the search vectors: the stemmed words of every description and
comment, readable (ADR 0008 D1, decision 124).

### Restore drills

| Date | Dump | Result | By |
|---|---|---|---|
| — | — | None performed on the VM yet (H1 asks for one; the orchestrator runs it after the first deploy) | — |

The drill was exercised locally on 2026-11-19 against a migrated test database
(`docs/HANDOFF.md`, the 1.8 step), not against production data.

## Security scans

Hardening H1's scans ran report-only for a week (owner decision 47) and are
blocking since 2026-11-26:

- **Trivy**, CRITICAL and HIGH with a fix available (`ignore-unfixed`), on
  both images, with `exit-code: "1"`: in CI's `Image` job on every pull
  request (SARIF to the Security tab, categories `trivy-image-app` and
  `trivy-image-worker`, limited to the same severities by
  `limit-severities-for-sarif`, because trivy-action otherwise drops the
  severity filter for SARIF and the job would gate on every severity; the
  upload runs after a failed scan too) and before every push in
  `release.yml`, where a finding stops the run before anything reaches GHCR,
  so `:latest` stays on the last image that passed. The Postgres image's scan
  in `release.yml`, which runs only when its tag is bumped, blocks the same
  way; `-r2` upgrades the Debian packages and rebuilds `gosu` for it ("The
  Postgres image" above).
- **OWASP ZAP baseline**, nightly (`.github/workflows/dast.yml`, 03:17 UTC):
  the standalone server against Postgres and Redis, signed in as a workspace
  owner the run registers, with SARIF (`zap-baseline`), the HTML report as an
  artifact, and an issue for findings. `fail_action: true` fails the run on
  any alert of Low risk or above (zap-baseline skips Informational ones) that
  `.zap/rules.tsv` does not excuse, and `.zap/assert-no-high-risk.mjs` fails
  it on every High, excused or not.

ZAP signs in by injecting the session cookie (`ZAP_AUTH_HEADER*`). It adds the
header only to a request whose host *name* contains `ZAP_AUTH_HEADER_SITE`,
so the value is `localhost`, without the port: with `localhost:3106` the
header matched nothing, and every nightly until H1 scanned signed out (its
alerts name only signed-out URLs such as `/login?next=%2Ftenants`). The run
registers its owner with a random address, not a timestamp, because ZAP
reports a Unix timestamp in a signed-in page (10096) and the address is on
every one.

`tests/guards/security-scan-deferral.test.ts` keeps them blocking: a workflow
that holds a non-blocking scan (Trivy `exit-code` other than `"1"`, ZAP
`fail_action` off, or `continue-on-error` on a scan or the HIGH+ step) fails
CI unless it carries one `TRIVY-NON-BLOCKING-UNTIL: YYYY-MM-DD` or
`DAST-NON-BLOCKING-UNTIL: …` marker, at most 60 days ahead, and fails again
the day after that date; a marker beside scans that all block is refused as
stale. To defer a scan, add the marker with the reason in the pull request.
The same guard holds Trivy to CRITICAL,HIGH with fixes available and its
SARIF limited to those severities, every `.zap/rules.tsv` entry to a reason
and every `.trivyignore` entry to an expiry and a reason.

Triage: a finding is fixed in the app. Otherwise:

- **ZAP**, a false positive below High may be excused in `.zap/rules.tsv`
  with a reason naming the evidence. Prefer `OUTOFSCOPE`, which excuses one
  rule on named URLs only (a tab-separated line `<pluginId> OUTOFSCOPE
  ^http://localhost:3106/…$`, anchored, its reason in the comment block directly above it, naming the
  rule), to `IGNORE`, which silences the rule everywhere and at every risk.
  10044 (Big Redirect) is out of scope on `/` and `/tenants` only: Next.js's
  `redirect()` from a server component sends the root-layout shell with the
  307, and both bodies were checked to carry no session data.
  90004 (Site Isolation) is ignored for Cross-Origin-Embedder-Policy alone
  (owner decision 246): the app sends `Cross-Origin-Opener-Policy` and
  `Cross-Origin-Resource-Policy` `same-origin` and leaves COEP unset, because
  `require-corp` would block cross-origin avatars that send no CORP header.
  ZAP's rules file is keyed by plugin id, not by the rule's alert reference,
  so the whole rule is ignored and `tests/unit/security-headers.test.ts`
  holds COOP and CORP.
- **Trivy**, a finding with no fix available is not reported
  (`ignore-unfixed`). One that has a fix in Trivy's database but cannot be
  taken yet may go in `.trivyignore` (none yet) as
  `<id> exp:YYYY-MM-DD`, the expiry inside the 60-day window, with the reason
  and the condition that retires it in the comment directly above. Never
  lower a severity or widen an excuse to get green.

A High is fixed, never listed.
