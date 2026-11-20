# Handoff — 2026-11-18 (paused for usage quota)

State of the roadmap work when it paused, the owner decisions taken so far, and the next
steps in order. Read this first, then `CLAUDE.md`, `docs/ROADMAP.md` and `docs/adr/`.
Delete this file when everything under "Next steps" is done.

## Owner decisions, 2026-11-18 and 2026-11-19

Given in the working session by the repository owner. The ADRs, the roadmap and the
porting maps now record them (next step 2); the last column says where.

| # | Decision | Owner's words | Recorded in |
|---|---|---|---|
| 1 | Code may be copied from inflect-compliance. Record every copied file in `PROVENANCE.md`. | "inflect compliance is my software, it's in the same Organization- you can copy" | ADR 0001 D1 |
| 2 | The canvas stays on tldraw 3.x with the watermark visible, in commercial production. | "we can use the 3.x in commercial production with the watermark, it's open sourced" | ADR 0001 D3 |
| 3 | Islestone is licensed BUSL-1.1, like inflect-compliance. | "Make it BUSL as well" | ADR 0001 D2 |
| 4 | The Dub-derived UI (see below) is copied as it is, and the licence risk is accepted. | Chose "Copy as is, accept risk" when asked | ADR 0001 D4 |
| 5 | Islestone's Licensor is Inflect Ltd., as in `LICENSE`. | Chose "Inflect Ltd." | ADR 0001 D2 |
| 6 | The Additional Use Grant's competing products are project management, work management, compliance, governance, risk and audit management, as in `LICENSE`. | Chose "PM + compliance" | ADR 0001 D2 |
| 7 | Public sign-up at `/api/auth/register` sits behind a switch: off by default in production, on in development, and an operator opens it without a code change. | Chose "Behind a switch" | ADR 0006 |
| 8 | The standard role is called **Member**. Roles: Owner, Admin, Member, Viewer, Guest. | Chose "Member" | ADR 0006 |
| 9 | Roles rank Owner > Admin > Member > Viewer > Guest, by breadth of access. A user whose role cannot be resolved falls back to Viewer, never Guest. | Chose "Owner>Admin>Member>Viewer>Guest" | ADR 0006 |
| 10 | On resume, finish Phase 0 + 1.1 first, then the steps below in order. | Chose "Finish Phase 0 + 1.1" | This file |
| 11 | sharp stays in production for image optimisation; its 14 libvips/sharp packages are exempted, each pinned to the version read. The 1.8 image carries the LGPL notice and leaves the library replaceable. | "Keep, exempt them" | ADR 0007 E1a |
| 12 | The rest of ADR 0007 as recommended: 0BSD joins the allowlist and the `tslib` exemption goes (E2b); `caniuse-lite` is exempted by name, bound to CC-BY-4.0 (E3a); no other licence is added until a dependency needs one (E4). ADR 0007 is Accepted. | "ADR 0007 as proposed" | ADR 0007 |
| 13 | A session someone other than the assignee starts on an item runs at once, within the starter's permissions; every write is a proposal routed to the assignee, who is notified and can end the session. | "Run now, assignee notified" | ADR 0003, open question 8 |
| 14 | No rung cap at `PROPOSE`: from Phase 6 a workspace owner may raise an agent's autonomy rung, within that agent's grants, as roadmap principle 2 allows. This goes against the ADR's recommendation. | "Owners may raise rungs" | ADR 0003, open question 9 |
| 15 | A session started by someone other than the work item's assignee never writes directly, whatever the rung: even where a workspace owner raised a tool to `AUTOMATIC`, its writes go to the assignee as proposals. Decision 13 wins over decision 14 for such sessions; sessions the assignee started follow the rung. | "Proposals to assignee" | ADR 0003, open question 10 (sections 4 and 9) |
| 16 | Due-date reminders land in sub-phase 2.2 with the work-item engine, not in 2.7. | "In 2.2" | `docs/ROADMAP.md` 2.2; porting maps `1.6.md` and `2.1-2.2.md` |
| 17 | Islestone's agents have no risk tier: every agent is governed by its grants and its autonomy rung alone. inflect-compliance's tier and what it drives (autonomy cap, policy-card defaults, approval count, readiness checks, re-assessment) are not ported. | "Drop it" | ADR 0003 section 4; porting maps `6.1.md` (section G, which names each replacement) and `6.2.md` |
| 18 | Automation rules get an action that starts an agent run, added in Phase 6: 5.1 ships without it, and 6.3 adds it once the agent engine and its kill switch exist. | "Add it in Phase 6" | `docs/ROADMAP.md` 5.1 and 6.3; porting map `5.1.md`, open decision 7 |
| 19 | The Unlicense joins the licence allowlist (first needed by visx's `robust-predicates`, sub-phase 1.2). Decided 2026-11-19. | "Allow the Unlicense" | ADR 0007 E6; `scripts/licence-gate.mjs` |
| 20 | Authentication: port the parent's auth layer on NextAuth v4 (option A), with the ADR's scope, pin, seam, exit criteria and contract. Decided 2026-11-19. | "Port NextAuth v4" | ADR 0004 A1 |
| 21 | SSO and SCIM wait for sub-phase 8.3. Roadmap 1.4 ports credentials, Google, Microsoft, sign-in sessions, MFA and invites. Decided 2026-11-19. | "Wait for 8.3" | ADR 0004 A2, open question 3 |
| 22 | ADR 0004's exit thresholds T1 to T3 as written (open question 2), and the parent's fail-open on a database error during the session check is kept (contract item 6, open question 4). ADR 0004 is Accepted; open questions 5 (passkeys), 6 (the maintenance claim) and 7 (the `next-auth` overrides entry) stay open, not blocking. Decided 2026-11-19. | "Accept all" | ADR 0004 A4, A5 |
| 23 | Search versus encryption: S1 now (titles, keys and unencrypted fields), until a search ADR, due before roadmap 2.7, chooses between S2 and S3. Decided 2026-11-19. ADR 0008 chose S2 for descriptions and comments (decision 124). | "S1 now, decide later" | ADR 0002 section 11 |
| 24 | The rest of ADR 0002 as recommended: an in-house fractional-index module with property tests (F1); a 30-day soft-delete window; depth caps of 5 levels of sub-items and 3 of goals; moving a sub-item on its own to another project is refused. ADR 0002 is Accepted. Decided 2026-11-19. | "Accept all" | ADR 0002 sections 2, 5 and 8 |
| 25 | ADR 0005 as recommended: no sync engine now (E0) with section 7's reopen thresholds; canvas persistence C1 and transport T1; TanStack Query as the client cache; item presence R1; stored Yjs state and snapshots encrypted, page text searched under ADR 0002's S1 for now; one audit entry per person per page per 10 minutes; a 60-second token lifetime, a 60-second stream re-check and the caps as written. ADR 0005 is Accepted; open questions 8 (long-lived connections on the hosting target) and 9 (offline PWA quick capture) stay open, not blocking. Decided 2026-11-19. | "Accept all" | ADR 0005 |
| 26 | The words ADR 0005 added are confirmed: change notice, collaboration server, collaboration token, page content and projection. Decided 2026-11-19. | "Accept all" | ADR 0006 (decided rows); ADR 0005 open question 11 |
| 27 | The Prisma CLI's tree: BlueOak-1.0.0 joins the licence allowlist, and `elkjs` (EPL-2.0) and the second `@visx/vendor` are exempted, pinned. Decided 2026-11-19. | "BlueOak + 2 exemptions" | ADR 0007 E7; `scripts/licence-exemptions.json` |
| 28 | `src/instrumentation.ts` may read `process.env.NEXT_RUNTIME` and nothing else raw: the Node-only startup checks move to `src/instrumentation-node.ts`, imported behind that literal, so the Edge bundle drops them. Decided 2026-11-19. | "One named exception" | `tests/guards/no-raw-process-env.test.ts`; CLAUDE.md "Rules that apply now" |
| 29 | `RATE_LIMIT_MODE` defaults to `upstash`, and production refuses to start without both Upstash values (issue #17); per-process limits are an explicit `RATE_LIMIT_MODE=memory`. The 1.5 map's "default to memory" is not taken. Decided 2026-11-19. | "Upstash + refuse" | `src/env.ts`; `docs/rate-limiting.md` |
| 30 | The CSP violation-report sink comes back with observability in 1.6; until then the policy names no report endpoint. Decided 2026-11-19. | "With 1.6" | `docs/porting/maps/1.6.md`; `docs/security-perimeter.md` |
| 31 | MIT-0 joins the licence allowlist, so `nodemailer` (10.3.1) and the mailer's SMTP transport are ported; the `next-auth` → `nodemailer` override is kept, with a guard against next-auth's email provider (ADR 0004 open question 7). Decided 2026-11-19; the owner gave the approval to the coordinator directly. Applied. | "Allow MIT-0"; "Add the override" | ADR 0007 E8; ADR 0004 question 7; `scripts/licence-gate.mjs`; `src/lib/mailer.ts` |
| 32 | FSL-1.1-Apache-2.0 joins the licence allowlist (source-available, Apache-2.0 after two years), accepted for the Sentry SDK; `@sentry/nextjs` 11.11.0 is installed and the real `sentry.ts` ported, off unless `SENTRY_DSN` is set. Decided 2026-11-19, approved as row 31. Applied. | "Allow FSL for Sentry" | ADR 0007 E9; `scripts/licence-gate.mjs`; `src/lib/observability/sentry.ts` |
| 33 | ADR 0006 gains decided rows for `Notification.body` (a notification's text, replacing the banned "Message") and `TenantNotificationSettings.bccMailbox` (a workspace's copy-to address). Decided 2026-11-19, relayed. | relayed | ADR 0006 "Notification column names — decided" |
| 34 | The mailer's log lines never carry a recipient's address: they log `hashForLookup` of each address and the template name. Decided 2026-11-19, relayed. | relayed | `src/lib/mailer.ts` (`recipientLogFields`); `tests/unit/mailer.test.ts` |
| 35 | A key rotation (master key or workspace DEK) re-resolves the person who started it when the job runs. Still an ACTIVE member holding the route's key: it acts as them. Otherwise it still finishes, as the workspace system user, and its audit entries and result record who asked (`requestedByUserId`), `authority: 'SYSTEM'` and the refusal; a departed person is never named as the actor. The owner-decided exception to the job-identity rule. Decided 2026-11-19, relayed. | relayed | `src/app-layer/jobs/rotation-actor.ts`; CLAUDE.md ("Job identity"); `docs/encryption.md` ("Who a rotation acts as") |
| 36 | The master-key rotation is OWNER-only: its route, rule and policy use `admin.tenant_lifecycle`, as the DEK rotation does (inflect-compliance admitted ADMIN). Decided 2026-11-19, relayed. | relayed | `src/lib/security/route-permissions.ts`; `src/app-layer/policies/admin.policies.ts`; `docs/encryption.md` |
| 37 | Creating the workspace system user is audited: one `SYSTEM_USER_CREATED` entry, as the system actor, in the same transaction as the insert; a later call that finds the row writes nothing. Decided 2026-11-19, relayed. | relayed | `src/app-layer/context-system.ts` (`ensureTenantSystemUser`); `docs/audit-trail.md` |
| 38 | The theme follows the operating system's colour scheme until the person picks light or dark; the toggle stores the choice, which wins. The pre-paint script applies the effective theme before first paint; the `data-theme` contract and the token blocks are unchanged. (Rows 35 to 37 are reserved for 1.5b.) Decided 2026-11-19, relayed. Applied: the toggle offers light and dark only, as the ported one does. | relayed | `src/components/theme/ThemeProvider.tsx`; `src/lib/theme-constants.ts`; `tests/rendered/theme-storage-on-choice.test.tsx`; `docs/app-shell.md` |
| 39 | The `IS` initials stay as the brand mark for now, with a generated letter favicon (`src/app/icon.svg`) on the brand colours; both are placeholders until a logo exists. Decided 2026-11-19, relayed. Applied. | relayed | `src/app/icon.svg`; `tests/unit/app-icon.test.ts`; `docs/app-shell.md` |
| 40 | The command palette lists Settings only to a person who can open it, from `nav-config.ts`'s `mayOpenSettings`, not a restated rule. Decided 2026-11-19, relayed. Applied: the shell registers the answer for the palette. | relayed | `src/components/command-palette/workspace-access.tsx`; `tests/rendered/palette-commands.test.tsx` |
| 41 | The MFA challenge and enrolment pages stay outside the shell for everyone. Decided 2026-11-19, relayed. No change. | relayed | `src/app/t/[tenantSlug]/(mfa)/`; `docs/app-shell.md` |
| 42 | Hosting: Islestone runs on the existing GCP VM `agrent` (project `hazel-design-419410`, zone `europe-west1-b`, e2-highmem-2: 2 vCPUs, 16 GB), shared with Agrent and Playerz, each its own Docker Compose project under `/opt/<name>`. Islestone's project is `islestone`, in `/opt/islestone`. Decided 2026-11-19, relayed. Applied. | relayed | `deploy/docker-compose.prod.yml`; `deploy/lib/common.sh`; `docs/deployment.md` |
| 43 | Production only, on `islestone.cloud` (and `www.islestone.cloud`). No staging environment and no per-pull-request previews for now: the roadmap's staging and previews (1.8) are deferred. Decided 2026-11-19, relayed. Applied. | relayed | `docs/ROADMAP.md` 1.8 and H1; `docs/deployment.md`; `docs/change-management-policy.md` |
| 44 | Caddy: the shared `agrent-caddy` (ports 80/443, network `agrent_internal`, Agrent's `/opt/agrent/Caddyfile`) serves Islestone. Islestone does not edit Agrent's Caddyfile: it gains one line, `import /etc/caddy/sites/*.caddy`, and Caddy a read-only mount of `/opt/caddy-sites` at `/etc/caddy/sites`; Islestone ships `deploy/caddy/islestone.caddy` (apex, `www` redirects to it, headers, body limit, `reverse_proxy islestone-app:3000` with forwarded headers, HSTS), and its app joins `agrent_internal`. The Agrent-side change is a runbook step; the apply script refuses without it. Decided 2026-11-19, relayed. Applied. | relayed | `deploy/caddy/islestone.caddy`; `deploy/apply.sh`; `docs/deployment.md` ("The shared Caddy") |
| 45 | Delivery is GHCR plus Watchtower: CI publishes `ghcr.io/rodnapamet/islestone` (and a worker image) on each merge to `main`, tagged `:latest`, the commit and semantic-release's version; a Watchtower scoped to Islestone's containers by label pulls `:latest`, as Agrent's scoped one does; migrations run in a one-shot `migrate` service that app and worker `depends_on` with `service_completed_successfully` (forward fix, never down-migrations); semantic-release versions `main`. Decided 2026-11-19, relayed. Applied: two images (`islestone`, `islestone-worker`), reasons in the `Dockerfile`; a start gate in both images (`scripts/wait-for-migrations.mjs`), because Watchtower ignores `depends_on`. | relayed | `.github/workflows/release.yml`; `.releaserc.json`; `Dockerfile`; `deploy/docker-compose.prod.yml` |
| 46 | Islestone runs its own Postgres (pgvector, `prisma/init-roles.sh` for `app_user`), PgBouncer (transaction mode) and Redis (`noeviction`, a password), all on an internal `islestone_internal` network; only the app also joins `agrent_internal`. Every secret comes from `/opt/islestone/.env.prod` through `env_file` or `--env-file`, never inline, with `:?error` guards on the required ones (`DATA_ENCRYPTION_KEY`, `AUTH_SECRET`, `REDIS_URL`, and the Upstash pair or `RATE_LIMIT_MODE=memory`); memory limits sized to share the ~11 GB free. Decided 2026-11-19, relayed. Applied: `--env-file` only, each service naming its variables; 4 GB for the long-running services; the app connects as a non-superuser runtime role (`deploy/postgres/init-runtime-role.sh`), as `docs/rls-tenant-isolation.md` requires. | relayed | `deploy/docker-compose.prod.yml`; `deploy/.env.prod.example`; `tests/unit/deploy/compose-prod.test.ts` |
| 47 | H1's security scans start report-only: a nightly OWASP ZAP baseline against the built app in CI and a Trivy CRITICAL/HIGH container scan on the image, both publishing SARIF, neither blocking yet, both carrying a dated note that they become blocking after two clean weeks, with a guard that fails once the date has passed and a scan is still non-blocking. Decided 2026-11-19, relayed. Applied: the date is 2026-12-03. | relayed | `.github/workflows/dast.yml`; `.github/workflows/ci.yml` (`Image`); `.github/workflows/release.yml`; `tests/guards/security-scan-deferral.test.ts` |
| 48 | Off-host backups go to a private, versioned GCS bucket in project `hazel-design-419410` (e.g. `gs://islestone-backups-hazel-design-419410`), uniform access and public access prevention, with a 30-day delete rule on noncurrent and old objects. `deploy/backup.sh` uploads each dump with the VM's service account through `gcloud storage cp`, skipping with a clear warning when no bucket is configured; `BACKUP_GCS_BUCKET` comes from `.env.prod` or a flag; the restore drill can restore from the bucket. The one-time setup is documented as exact `gcloud` commands for the orchestrator to run with the owner's approval; nothing is created from this repository. Decided 2026-11-19, relayed. Applied. | relayed | `deploy/backup.sh`; `deploy/gcs/backup-lifecycle.json`; `docs/deployment.md` ("Off-host copies"); `tests/unit/deploy/backup-script.test.ts` |
| 49 | The GHCR packages (`islestone`, `islestone-worker`) are public, set so after the first publish; no registry credential goes on the VM. Decided 2026-11-19, relayed. Applied: the `docker login` step and Watchtower's `config.json` mount are removed. | relayed | `deploy/docker-compose.prod.yml`; `docs/deployment.md`; `tests/unit/deploy/compose-prod.test.ts` |
| 50 | Production uses `RATE_LIMIT_MODE=memory`: a single app container, so the limits are exact. Revisit when the app scales past one container. Decided 2026-11-19, relayed. Applied. | relayed | `deploy/.env.prod.example`; `docs/deployment.md` |
| 51 | Pull request titles follow Conventional Commits from now on, so the squash-merge subject lets semantic-release cut versions; a CI check fails a title that does not. Decided 2026-11-19, relayed. Applied. | relayed | `.github/workflows/pr-title.yml`; `scripts/check-pr-title.mjs`; `CLAUDE.md` ("Delivery"); `docs/change-management-policy.md` ("Versioning") |
| 52 | The work configuration's keys are kept as built: `admin.manage` changes teams, workflow states, work item types and labels; `projects.view` reads them; `projects.archive` covers project archive, delete and restore. Admins configure, and a custom role can grant `admin.manage`. Decided 2026-11-19, relayed. Applied. | relayed | `src/app-layer/policies/work-config.policies.ts`; `docs/work-items.md` ("Who may do what") |
| 53 | Comments: only the author edits a comment (an admin never rewrites someone else's words); the author or a workspace admin deletes one, for moderation, and an admin's delete of someone else's comment is audited as a moderation action (`COMMENT_MODERATED`). Decided 2026-11-19, relayed. Applied. | relayed | `src/app-layer/policies/comment.policies.ts`; `src/app-layer/usecases/work-item-collab.ts`; `tests/integration/work-items-api.test.ts` |
| 54 | My Work shows its full scope now, not at 2.7: the items assigned to me, the items I created, the items I watch, and my items due soon, each as a section of the shared list query. Decided 2026-11-20, relayed. Applied. | relayed | `src/app/t/[tenantSlug]/(app)/my-work/page.tsx`; `src/components/work-items/MyWorkView.tsx`; the `createdById`, `watching=me` and `due=soon` list filters (`src/lib/schemas/work-item.ts`, `WorkItemRepository._buildWhere`, `src/app-layer/domain/work-item-due.ts`); `docs/work-items.md` ("Views (2.3)", My Work); `docs/pagination.md` |
| 55 | A minimal Settings page for admins (`admin.manage`) to create and edit teams, workflow states, work item types, labels and projects is built now, as its own pull request after 2.3, so a new workspace can get its first project without the API. Decided 2026-11-20, relayed. Applied: a landing page with the first-project steps, and Teams (with each team's workflow states), Work item types, Labels and Projects, on 2.2's routes, gated by `mayOpenSettings` and offering the writes `workConfigAffordances` returns; not offered in this pull request: project delete and restore, key-prefix changes, type icons, colours and order, label colours; a Member still creates a project only through the API (open question; answered by decision 57). | relayed | `src/app/t/[tenantSlug]/(app)/settings/`; `src/components/settings/`; `src/lib/server/settings-pages.server.ts`; `src/app-layer/policies/work-config.policies.ts`; `docs/work-items.md` ("Settings"); `tests/rendered/settings-pages.test.tsx`; `tests/integration/settings-first-project.test.ts`; `tests/e2e/settings.spec.ts` |
| 56 | The mirrored filter select's no-op URL write on mount (it cancelled navigation the person had started) is fixed upstream in inflect-compliance's `filter-select.tsx` / `filter-context.tsx`; Islestone re-pins the part B mirror once that merges and then drops the work-item views' guard. Decided 2026-11-20, relayed. Applied: inflect-compliance #5778 merged, the part B mirror re-pinned to `f916dfa`, and the work-item views' local guard removed. | relayed | `ui-mirror.json`; `src/components/ui/filter/filter-select.tsx`, `filter-context.tsx`; `src/components/work-items/use-work-item-filter-context.ts`; `tests/rendered/filter-toolbar-no-noop-url-write.test.tsx` |
| 57 | Anyone who holds `projects.create` can create a project from the Projects page, outside Settings; Settings stays admin-only (`mayOpenSettings`). Decided 2026-11-20, relayed. Applied: the Projects page asks `mayCreateProject(ctx)` on the server and offers a Project button opening the create dialog shared with Settings → Projects (`ProjectCreateDialog`); with no team, the dialog links to Settings → Teams only for a viewer who may open Settings and otherwise asks them to ask an admin. | relayed | `src/app/t/[tenantSlug]/(app)/projects/page.tsx`; `src/components/work-items/ProjectsList.tsx`; `src/components/settings/ProjectCreateDialog.tsx`; `src/components/settings/ProjectsSettings.tsx`; `messages/en.json` (`settings.projects.noTeamsAskAdmin`); `docs/work-items.md` ("Views (2.3)", "Settings"); `tests/rendered/projects-page.test.tsx` |
| 58 | Custom fields are defined (create, rename, reorder, archive fields and their options) under `projects.edit`, so members can: a field belongs to its project. Kept as built (2.4 map open question 1). Decided 2026-11-20, relayed. Applied. | relayed | `src/app-layer/policies/work-config.policies.ts` (`mayManageCustomFields`); `src/app-layer/usecases/custom-field.ts`; `src/lib/security/route-permissions.ts`; `docs/porting/maps/2.4.md` ("Open questions"); `docs/work-items.md` ("Custom fields and saved views (2.4)") |
| 59 | A shared saved view is changed only by its creator; a workspace admin (`admin.manage`) may delete someone else's shared view as moderation, audited `SAVED_VIEW_MODERATED`, and never edits it. Kept as built (2.4 map open question 2). Decided 2026-11-20, relayed. Applied. | relayed | `src/app-layer/policies/saved-view.policies.ts`; `src/app-layer/usecases/saved-view.ts`; `tests/integration/custom-fields-and-views.test.ts`; `docs/porting/maps/2.4.md`; `docs/work-items.md` |
| 60 | VIEWERs may save their own personal views: VIEWER gains `views.create` and `views.edit`, not `views.share`, so a shared view stays with the roles that hold `views.share` (2.4 map open question 9). Decided 2026-11-20, relayed. Applied: `viewerPermissions()` (also the fallback for an unresolvable role, where a personal view is harmless) grants both keys; the saved-view policy, unchanged, keeps a VIEWER to personal views; a refusal past the route's key (saving or switching to a shared view, changing someone else's) is audited `AUTHZ_DENIED` in the usecase; the views menu offers a VIEWER "Save view" with no share box. | relayed | `src/lib/permissions.ts`; `src/app-layer/policies/saved-view.policies.ts`; `src/app-layer/usecases/saved-view.ts`; `tests/unit/permissions.test.ts`; `tests/unit/policies/saved-view-policies.test.ts`; `tests/integration/custom-fields-and-views.test.ts`; `tests/integration/work-items-api.test.ts`; `tests/rendered/custom-fields-and-views.test.tsx`; `CLAUDE.md`; `docs/porting/maps/2.4.md`; `docs/work-items.md` |
| 61 | A person custom field holds one person. Kept as built (ADR 0002; 2.4 map open question 5). Decided 2026-11-20, relayed. Applied. | relayed | `src/lib/work-items/custom-fields.ts` (`CUSTOM_FIELD_TYPE_SPECS`); `src/app-layer/domain/custom-field.ts`; `docs/porting/maps/2.4.md`; `docs/work-items.md` |
| 62 | A scoped group of work with a date is a **Milestone**, one model per project with a name and a due date; not "Module" (map question 1). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; ADR 0006 |
| 63 | Cycles come from a per-team **cycle schedule** (length 1 to 8 weeks, a first start date, two upcoming cycles kept ready, default two weeks); a person may also add a one-off cycle or move a future cycle's dates (question 2). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5a |
| 64 | When a cycle ends, its unfinished items (Backlog, Unstarted, Started) move automatically to the team's next cycle the night after its last day, in `NOTIFICATIONS_TZ`; a per-team switch sends them to no cycle instead; items in archived projects and deleted items stay behind; no rollover notification (question 3). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5a (`cycle-rollover`) |
| 65 | The burn-up reads `WorkItemTransition`, a change record written by a database trigger; it counts items (points wait for 3.4's estimates), cancelled items leave the scope, completed means a Done state (question 4). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5a |
| 66 | Transitions are kept until the workspace is deleted, so a closed cycle's chart never changes after its items are purged (question 5). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5a |
| 67 | A repeat is the simple built-in rule: every N days, weeks, months or years (N up to 99), weekly on chosen weekdays, monthly on the same day clamped to month end, an optional end date or count; no "second Tuesday" in 2.5 (question 6). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5d |
| 68 | Copies are made on a schedule by a nightly job, by default 3 days before they are due (0 to 30); after an outage only the latest missed copy is made (question 7). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5d |
| 69 | A copy is taken from the item where the repeat was set, as it is then: title, description, type, priority, labels, assignee (if still an active member), custom-field values, milestone (if it still exists) and sub-items; not comments, watchers, relations, links or cycle (question 8). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5d |
| 70 | A repeat runs as the person who set it, re-resolved before each copy; when they no longer resolve or lack the permission, the repeat pauses with the reason and anyone allowed may resume it, becoming its owner (question 9). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5d |
| 71 | Templates: item templates per project under `projects.edit`; project templates per workspace, managed under `admin.manage` (made with "Save as template") and used under `projects.create`, creating fields, milestones, item templates and starter items; in-browser editing of a project template's content waits (question 10). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5c |
| 72 | No new permission keys: cycles and the cycle schedule under `cycles.manage` (read `cycles.view`), milestones under `projects.edit`, templates as decision 71, a repeat under `work_items.create` plus `work_items.edit` (question 11). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5a–2.5d |
| 73 | Template descriptions and project-template content are encrypted under the workspace key; names, titles, cycle and milestone names stay plaintext (question 12). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md`; 2.5c |
| 74 | ADR 0006 gains the rows Cycle schedule, Burn-up, Repeat and Transition, and a milestone's date is "Due date" (`dueDate`) (question 13). Decided 2026-11-20, relayed. | relayed | ADR 0006 "Planning words of sub-phase 2.5 — decided" |
| 75 | 2.5 ships as four pull requests, in order: 2.5a cycles with the burn-up and rollover, 2.5b milestones, 2.5c templates, 2.5d repeats (question 14). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.5.md` |
| 76 | Waiting on: a work item names who must act next, apart from its assignee, who stays the one accountable person (ADR 0003 §1); a column, filter and swimlane, a "waiting on me" section in My Work, and time waiting per party in analytics. From the Procore audit (top idea #1). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row; the word is open. | relayed | `docs/ROADMAP.md` 2.4b, 2.7, 3.6 (and section 2.6); `docs/research/procore-audit.md` |
| 77 | Field sets: per work item type, which built-in and custom fields are required, optional or hidden, enforced in the usecase, and checked when an agent proposes. From the Procore audit (top idea #2). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0002 §1 amendment ("Types carry no behaviour") and an ADR 0006 row; the word is open. | relayed | `docs/ROADMAP.md` 2.4b, 6.2 (and section 2.6); `docs/research/procore-audit.md` |
| 78 | Questions: a Question type whose one comment a person marks as the answer, and an agent that drafts answers citing item, page and file ids, as proposals. From the Procore audit (top idea #3). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row for the answer; the word is open. | relayed | `docs/ROADMAP.md` 2.4b (type and answer), 7.8 (the agent) (and section 2.6); `docs/research/procore-audit.md` |
| 79 | Distribution groups: named sets of people to notify, added to an item's watchers in one step and named as recipients by reviews, checklists, automation, reports and minutes, with preferences and visibility re-checked at send time. From the Procore audit (top idea #4). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row ("Group" is SCIM's word); the word is open. | relayed | `docs/ROADMAP.md` 2.7, 5.1 (and section 2.6); `docs/research/procore-audit.md` |
| 80 | Review steps: sequential or parallel reviewers on a work item, a returned review opening a new round that keeps the earlier one rather than rewinding it; only people review, never an agent. From the Procore audit (top idea #5). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0002 §3 amendment ("No reviewer gate") or a new ADR, and ADR 0006 rows; the words are open. | relayed | `docs/ROADMAP.md` 2.8 (new), 5.1 (and section 2.6); `docs/research/procore-audit.md` |
| 81 | Checklist runs: defined pass/fail checks run against a project or item, whose failed checks open linked work items, with optional sign-offs and a PDF record. From the Procore audit (top idea #6). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows ("Checklist item" is banned for sub-item); the words are open. | relayed | `docs/ROADMAP.md` 4.5 (new) (and section 2.6); `docs/research/procore-audit.md` |
| 82 | Periodic structured reports: sections computed by code, sections people fill, an agent's draft summary from the computed facts only, filed by a person and sent to a distribution group. From the Procore audit (top idea #7). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row ("Report" is banned for view); the word is open. | relayed | `docs/ROADMAP.md` 7.4 (and section 2.6); `docs/research/procore-audit.md` |
| 83 | Meeting series: an agenda linked to work items, open points carried into the next meeting, minutes sent to a distribution group, and a home for 7.6's proposals. From the Procore audit (top idea #9). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows; the words are open. | relayed | `docs/ROADMAP.md` 7.6 (and section 2.6); `docs/research/procore-audit.md` |
| 84 | Project roles per area for guests, a subset project admins may grant, and a tag naming the outside firm a guest belongs to. From the Procore audit (top idea #10). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows ("Company" and "Collaborator" are banned); the words are open. | relayed | `docs/ROADMAP.md` 8.4 (and section 2.6); `docs/research/procore-audit.md` |
| 85 | An intake request is a separate record (`IntakeRequest`) until a person accepts it; accepting creates the work item in the same transaction. Spam and declined requests take no key number and appear in no work-item read (question 1). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; ADR 0002 "Consequences"; 2.6a |
| 86 | Public forms ship in 2.6b, as a shared link (never embedded), each working only after an admin publishes it, and behind a deployment switch that is off in production until the operator opens it, as public sign-up is (question 2). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6b |
| 87 | Inbound email arrives through a hosted receiving service that posts each email as a signed web request; it is a sub-processor. The provider is chosen at 2.6c once its signed webhooks and EU processing are confirmed; prefer the company that sends Islestone's mail. One random address per project at `in.islestone.cloud` (question 3). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6c |
| 88 | Bot defence on public forms is in-house only: a hidden trap field, a signed single-use form token with a minimum fill time, a small proof-of-work, per-visitor and per-form limits and a per-form daily cap; no third-party captcha (question 4). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6b |
| 89 | The requester sees an on-screen confirmation with a short reference; email updates (accepted, declined with the chosen reason and note, merged) go only to an address the requester confirmed, never echo the text they typed, and nothing is sent on a snooze; no status page (question 5). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6b, 2.6c |
| 90 | Triage: snooze until a date (back at 08:00 in `NOTIFICATIONS_TZ`, a bell to whoever snoozed it); decline with a reason (Not planned, Out of scope, Spam, Other), an optional note to the requester and an internal note, spam sending nothing; merge into a work item or another pending request; a declined, merged or snoozed request can be reopened while it is kept. Decided requests are purged 90 days after the decision, spam after 7 (question 6). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6a (`intake-snooze-wake`, `intake-purge`) |
| 91 | The triage page and its sidebar entry are called **Intake**; one entry is a Request; "triage" is only a verb; the 2.7 notification list stays Inbox (question 7). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; ADR 0006 |
| 92 | New permission domain `intake`: `intake.view` and `intake.triage` for Owners, Admins and Members; `intake.manage` (intake on or off, forms, the notify list, the email address, blocked senders) for Owners and Admins; none for Viewers and Guests. Accepting also needs `work_items.create` in the target project; anyone who can see a project may send a request through its internal forms (question 8). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; `src/lib/permissions.ts`; 2.6a |
| 93 | Forms are built in Settings → Intake, per project (question 9). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6a |
| 94 | ADR 0006 gains the rows Intake form, Form field, Requester, Intake email address, Follow-up, Decline reason, Blocked sender and Intake channel; ADR 0002 gains a note that an intake request is not a work item (question 10). Decided 2026-11-20, relayed. | relayed | ADR 0006 "Intake words of sub-phase 2.6 — decided"; ADR 0002 "Consequences" |
| 95 | A new request rings a per-project notify list set in Settings → Intake (by default whoever turned intake on); everyone who may triage sees a count beside Intake; from 2.7 the list may be a distribution group (question 11). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6a |
| 96 | Encryption: a request's body, form answers, follow-ups and both notes under the workspace key; the requester's name and email as personal data matched by a lookup hash; the title in plain text (question 12). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; `src/lib/security/encrypted-fields.ts`; `src/lib/security/pii-middleware.ts` |
| 97 | 2.6 ships as three pull requests, in order: 2.6a the model, internal forms, the builder, the Intake page with all triage actions and the two jobs; 2.6b public forms; 2.6c inbound email (question 13). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md` |
| 98 | The public perimeter of 2.6b and 2.6c is approved: a new `RlsBypassReason`, `public-intake-resolve`, and new `MACHINE_CALLER_PREFIXES` entries for the public submit, the confirmation link and the inbound-email webhook, each with its contract in `tests/guards/machine-caller-paths-self-authenticate.test.ts`. Not added in 2.6a, which needs neither. Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md` ("Tenant resolution and the public surface"); 2.6b, 2.6c |
| 99 | An inbound email whose address matches a member's `emailHash` and whose sender domain authentication passes is shown as coming from that member (question 3, "Also"). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.6.md`; 2.6c |
| 100 | The field naming who must act next is **Waiting on** (`WorkItem.waitingOnUserId`; "Waiting on me" in My Work) (question 1). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0006 |
| 101 | Per-type field rules are a **Field set**: a type's `WorkItemTypeField` rows, enum `FieldRequirement` (`REQUIRED`, `OPTIONAL`, `HIDDEN`), shown as a type's "Fields" (question 2). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0006; 2.4b-b |
| 102 | The marked comment is the **Answer** (`WorkItem.answerCommentId`; "Mark as answer") (question 3). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0006; 2.4b-c |
| 103 | Any active member may be waited on, the assignee's rule (Viewers included); guests from 8.4 when they can see the project (question 4). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §14; 2.4b-a |
| 104 | Waiting on is set under `work_items.edit`, as an item's cycle and milestone are (question 5). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-a |
| 105 | The person named gets one in-app bell when someone else names them (a new notification type with its own preference); no email and no reminders until 2.7 (question 6). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-a |
| 106 | Who or what else sets waiting on: in 2.4b people set it by hand, 2.8's review steps will set it, and a repeat copy takes its source's value; **from 6.3 it may name the delegate's agent session**, not only a member (6.3 adds a nullable session reference with a CHECK that at most one of the two is set; no session column now). It never makes anyone or anything accountable: ADR 0003 §1 is unchanged (question 7, option C). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §14; ADR 0006; 2.4b-a, 6.3 |
| 107 | `WorkItemTransition` records waiting-on changes from the day the column exists (the trigger fires on it), so 3.6 counts time waiting from recorded changes (question 8). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-a |
| 108 | A field set's built-in rules belong to the type across the workspace; a custom field's rules belong to the type within the field's project (question 9). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §1, §7; 2.4b-b |
| 109 | A new rule rewrites nothing: a create, a write that empties a required field of an open item, and a type change are checked; other writes pass and the item lists its gaps (question 10). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §1; 2.4b-b |
| 110 | Configurable built-in fields: description, assignee, waiting on, priority (required = not None), labels (at least one), start date, due date, cycle, milestone, answer (shown or hidden only); title, type, project and state are fixed (question 11). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §1; 2.4b-b |
| 111 | A hidden field is not offered and a write setting it is refused (a template's value is skipped and named); template sub-items, starter items and repeat copies are checked like any create, and a refused repeat holds with a new reason `FIELD_SET_UNMET` (question 12). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §1; 2.4b-b |
| 112 | Built-in field rules are managed under `admin.manage`, custom-field rules under `projects.edit` (question 13). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-b |
| 113 | While a comment is the marked answer, deleting and editing it are refused until the answer is cleared; an admin moderates by clearing, then deleting (question 14). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §15; 2.4b-c |
| 114 | Marking an answer moves the item to the team's first live Done state, with a chooser when there are several (question 15). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-c |
| 115 | Marking or clearing the answer of a closed item changes only the pointer; clearing never reopens (question 16). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §15; 2.4b-c |
| 116 | Question is not seeded: Settings → Work item types offers "Add the Question type" (due date and waiting on required, answer shown) and each project's templates manager offers "Add a Question template" (due in 5 days) (question 17). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0006 open question 6; 2.4b-c |
| 117 | Watchers hear that a question was answered, and the creator of an item whose type shows the answer becomes a watcher (question 18). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; 2.4b-c |
| 118 | The answer is a field-set field, hidden unless the type's field set shows it; no type flag (question 19). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md`; ADR 0002 §1, §15; 2.4b-c |
| 119 | 2.4b ships as three pull requests, in order: 2.4b-a waiting on, 2.4b-b field sets, 2.4b-c questions (question 20). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.4b.md` |
| 120 | The inbound email provider is Resend (question 3, A), for receiving and for Islestone's outbound SMTP. Outbound is configuration only: `SMTP_HOST=smtp.resend.com`, user `resend`, the API key as the password. The sending domain and `in.islestone.cloud` are both created in Resend's eu-west-1 region, which is fixed when a domain is created. Decided 2026-11-20, relayed. | relayed | `docs/deployment.md` "Email (Resend)"; `deploy/.env.prod.example`; `docs/intake.md` "Inbound email (2.6c)" |
| 121 | US storage is accepted: received mail and Resend's logs are very likely stored in the US for 30 days, with no deletion API found. The transfer basis is the Standard Contractual Clauses (Resend's DPA) and the EU–US Data Privacy Framework. Recorded in the sub-processor register; an operator asks Resend about deletion or zero retention. Decided 2026-11-20, relayed. | relayed | `docs/sub-processors.md`; `docs/intake.md`; `docs/deployment.md` |
| 122 | The webhook fetches nothing: `POST /api/intake/email/resend` (the `/api/intake/email` machine-caller entry, with its contract) verifies the Svix signature by hand (five-minute window, constant time, any one `v1` signature), caps the body before parsing, dedupes on `svix-id` and `email_id`, resolves the address token (unknown or disabled: nothing stored, 200), records a pending row and enqueues a job, answering 200 fast. The job retrieves the email with `RESEND_API_KEY`, downloads the raw message from the signed `download_url` with a capped read, parses it and makes the request or follow-up; idempotent and retried. Decided 2026-11-20, relayed. Applied: the download host is pinned (below). | relayed | `src/lib/intake/email/`; `src/app-layer/usecases/intake-email.ts`; `tests/guards/machine-caller-paths-self-authenticate.test.ts` |
| 123 | `Authentication-Results` is read if Resend's receiving server writes it; absent or not a pass is unauthenticated, and an unauthenticated sender gets no `INTAKE_RECEIVED_ACK`. Spam is a triage action plus blocked senders; no automatic scoring. Decided 2026-11-20, relayed. Applied: only a header from the configured server (`INTAKE_EMAIL_AUTHSERV_ID`) is believed. | relayed | `src/lib/intake/email/auth-results.ts`; `docs/intake.md` |
| 124 | Encrypted descriptions and comments are searched through a **plaintext `tsvector` full-text index** (ADR 0008 D1, option C, S2), not the recommended keyed word tokens. The owner confirmed it knowing that the searchable words of descriptions and comments will be readable in Postgres, in its dumps and in the off-host backups. Indexed: titles, keys and project names (expression indexes), descriptions and live comments (`SearchVector`, written by the usecase in the text's own transaction, removed with its comment, item or workspace, rebuilt by `search-index-rebuild`). Never indexed: intake request bodies, answers and notes, encrypted template text, project-template content, and every `PII_FIELD_MAP` field. The encryption-manifest guard classifies the column as a deliberate plaintext derivative citing ADR 0008 (question 1). Decided 2026-11-20, relayed. | relayed | ADR 0008 D1; ADR 0002 §11; `docs/porting/maps/2.7.md`; 2.7b, 2.7f |
| 125 | The search token key is **moot**: with decision 124 no keyed tokens are stored, so there is no key to derive (question 2). Decided 2026-11-20, relayed. | relayed | ADR 0008 D3; `docs/porting/maps/2.7.md` |
| 126 | **Bulgarian and English stemming** (revised by the owner after first choosing English stemming): one custom text-search configuration, `islestone_bg_en`, for titles, stored vectors and queries alike. Latin words use Postgres's built-in `english_stem`; Cyrillic (non-ASCII) words use the open-source Bulgarian Hunspell dictionary (`bg_BG`), then `simple`. Postgres has no Bulgarian stemmer, so the dictionary is installed in Islestone's own Postgres image. 2.7f work: verify and pin the dictionary's licence, with rows in `PROVENANCE.md` and `NOTICE` (stop and ask if ADR 0007 does not admit it); the custom image for production, CI's services, the local `docker-compose.yml` and the deploy files; the configuration in a migration; fail closed: migrations, the app and the worker refuse to run without the dictionary, and nothing degrades silently to `simple` or `english` (question 3). Decided 2026-11-20, relayed. | relayed | ADR 0008 D2; `docs/porting/maps/2.7.md`; 2.7f |
| 127 | Mentions stay in plain text: a `<@userId>` token chosen from a picker (`@` in the textarea), rendered as a chip showing the person's current name; rich text waits for 4.1 (question 4). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7d |
| 128 | A mention notifies the person and adds them as a watcher (question 5). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7d |
| 129 | Machine-made text never mentions: intake accept, templates and repeat copies record no `Mention` rows; only a person's own write does (question 6). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7d |
| 130 | A mention notification says who mentioned you on which item, with a link, and never carries the comment or description text (question 7). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7d |
| 131 | A work-item key in text (`ISL-123`) renders as a link at display time; nothing is stored (question 8). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7d |
| 132 | Preferences are per notification type: in-app on or off, and email off, immediate or daily, with immediate offered only for assigned, mentioned and waiting on; the workspace's settings stay the ceiling (question 9). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7c |
| 133 | One daily digest email at 08:10 in `NOTIFICATIONS_TZ` with the day's DAILY notifications and due items, replacing 1.6's separate `DUE_DIGEST` (question 10). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7c |
| 134 | Inbox actions are read, unread and **Done** (archive), shown as the tabs Unread, All and Done (question 11). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; ADR 0006; 2.7c |
| 135 | Retention: Done notifications are purged after 90 days, read ones after 180; unread ones are kept (question 12). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7c |
| 136 | Settings → Notifications ships in 2.7c over the existing notification-settings API (email on or off, sender, BCC, muted types), so admins see and set the ceiling members' preferences show (question 13). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7c |
| 137 | Due-date reminders also go to the person an item waits on: the same windows and notification type as the assignee's, worded "waiting on you", unassigned items included, and one reminder, not two, when the assignee is the person waited on (question 14; decision 76's open point). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7a |
| 138 | The roadmap's "distribution group" is a **Recipient list** (`RecipientList`, members `RecipientListMember`) (question 15). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; ADR 0006; 2.7e |
| 139 | Adding a recipient list to an item's watchers copies its members at that moment as ordinary watchers, each free to stop watching; later features resolve a list at send time (question 16). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7e |
| 140 | Workspace recipient lists are managed under `admin.manage`, project lists under `projects.edit`; any member reads them (`projects.view`) (question 17). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7e |
| 141 | Recipient lists are archived and restored, never deleted (question 18). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7e |
| 142 | A project's intake may name one recipient list in addition to its notify-list member rows, resolved at send time for `intake.view` holders (question 19; decision 95's "may"). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md`; 2.7e |
| 143 | ADR 0006 gains the rows Notification preference, Digest, Mention, Recipient list and Search vector, and the Inbox's archive verb is Done. The drafted "Search token" row becomes **Search vector** (`SearchVector`) to fit decision 124's plaintext index; "Document" stays a page's word (question 20). Decided 2026-11-20, relayed. | relayed | ADR 0006 "Search, inbox and mention words of sub-phase 2.7"; `docs/porting/maps/2.7.md` |
| 144 | 2.7 ships as six pull requests, in order: 2.7a My Work's "waiting on me" and the waiting-on reminder; 2.7b search over titles and keys; 2.7c the Inbox, preferences and digests; 2.7d mentions; 2.7e recipient lists; 2.7f search over descriptions and comments with the Bulgarian dictionary and its Postgres image (question 21). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.7.md` |
| 145 | **Bulgarian dictionary licence: option A.** The bgOffice Bulgarian spelling dictionary, OOo-spell-bg 4.3 (`OOo-full-pack-bg-4.3.zip`, SHA512 `1c4acf0c…bd66341d7`, as Gentoo's `app-dicts/myspell-bg/Manifest` at `1d677101c0776fa2bf680550e2864f4f0a2e6ccd` records), is offered under "GPL-2.0-or-later OR LGPL-2.1-or-later OR MPL-1.1" (`Copyright_spell`); Islestone takes it under MPL-1.1 and uses it under MPL-2.0 through MPL-1.1 §6.2 ("any subsequent version"). ADR 0007 gains E10, admitting this one file set, modified only by re-encoding to UTF-8; the converted files are MPL-2.0, published with their source and a statement of the change in the repository and the image. `ALLOWED_LICENCES` is not widened: the licence gate scans npm packages, so a guard (`tests/guards/postgres-dictionary-pinned.test.ts`) and the image build hold the files to the pinned hashes and E10. Decided 2026-11-20, relayed. | relayed | ADR 0007 E10; `deploy/postgres/dictionary.json`; `deploy/postgres/tsearch_data/`; `PROVENANCE.md`; `NOTICE`; 2.7f |
| 146 | **Islestone's Postgres image is a new public GHCR package,** `ghcr.io/rodnapamet/islestone-postgres`, built from `deploy/postgres/Dockerfile` (`FROM` pgvector by digest) and published by the release workflow (actions pinned by SHA) under an immutable version tag. Production's compose file pins it; the local `docker-compose.yml` builds it; CI's Integration, E2E and DAST jobs build and run it as steps, so every pull request tests the Dockerfile. Decided 2026-11-20, relayed. Applied: the compose file names the version tag until the first publish exists, then the tag and its digest (`tests/guards/postgres-image-pinning.test.ts`). | relayed | `deploy/postgres/Dockerfile`; `.github/workflows/release.yml`, `ci.yml`, `dast.yml`; `deploy/docker-compose.prod.yml`; `docker-compose.yml`; 2.7f |
| 147 | **Rollout: a one-time operator step.** Before the dictionary migration (`20261207120000_search_configuration`) reaches production, an operator recreates the `postgres` container on the same volume onto the new image with `deploy/apply.sh`; the data directory is unchanged. If the migration runs first it fails closed and both images wait at `wait-for-migrations` until the move. Recorded in `docs/deployment.md`, "The Postgres image". Decided 2026-11-20, relayed. | relayed | `docs/deployment.md`; 2.7f |
| 148 | Review words: **Review step**, **Round**, **Reviewer**; outcomes **Signed off** and **Returned** (verbs Sign off, Return); My Work's section **To review** (question 1). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; ADR 0006; 2.8a |
| 149 | Review is an indicator by default; a work item type may require its review to finish before Done (`REVIEW_INCOMPLETE`); cancelling is never held; closing an item withdraws an open round (question 2). The Done check ships in 2.8c. Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a, 2.8c |
| 150 | Anyone with `work_items.edit` may edit steps not yet opened. Skipping a step, or closing one whose reviewers left, takes the item's assignee, whoever sent the round, or an admin (`admin.manage`), and is audited (question 3). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 151 | Working days are Monday to Friday, no holidays, computed in `NOTIFICATIONS_TZ` when a step opens and stored date-only (question 4). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 152 | Waiting on stays one person (`waitingOnUserId`). While a round is open the item waits on the open step's pending reviewers, read from their rows; the column is cleared when a round opens and names the assignee when the round ends. My Work gains "To review" and a `reviewerId` filter (the filter in 2.8a, the section in 2.8b). 2.4b and decision 106 are untouched (question 5). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a, 2.8b |
| 153 | Setting waiting on by hand while a round is open is refused, 409 `REVIEW_ROUND_OPEN`; 6.3's agent-session reference follows the same rule (question 6). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 154 | A recipient list is resolved to people when its step opens, through `resolveListRecipients` (question 7). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 155 | A round starts only on an explicit "Send for review"; after a Return the new round waits to be sent again (question 8). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 156 | In a step where every reviewer must sign off, one Return returns the step at once and withdraws the others (question 9). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 157 | The response text is its own encrypted text, required to Return; it is not searched, carries no mentions, and an admin cannot remove it; its mutability follows decision 162 (question 10). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 158 | **Departure from the map's recommendation (the owner chose B over A).** Any active member who can see the project may be a reviewer, Viewers included, **but the item's assignee may not respond to a step on their own item** (separation of duties; a one-person team cannot review its own work). Applied: refused at both points, naming the assignee when steps are edited (400 `REVIEWER_IS_ASSIGNEE`) and responding (403, audited `AUTHZ_DENIED`); a list resolved at open drops the assignee; an assignee change that makes a pending reviewer the assignee withdraws their reviewer row (`BECAME_ASSIGNEE`), audited, and re-evaluates the step. The usecase is the authority (question 11). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 159 | Default steps per type are workspace-wide under `admin.manage`, naming members and workspace lists; every create path copies them, templates, intake and repeats included, and none opens them (question 12). Built in 2.8c. Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8c |
| 160 | No new permission domain: steps and sending under `work_items.edit`, responding under `work_items.view` plus being the named reviewer, defaults under `admin.manage` (question 13). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 161 | Four notification types: review requested, review due, returned, completed. Immediate email is offered for requested and returned, which widens decision 132's IMMEDIATE list (and the `NotificationPreference` CHECK) by two. Due reminders come from the 08:00 due job (question 14). Applied defaults: requested and returned bell and immediate email, due bell and daily digest, completed bell only. Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 162 | **Departure from the map's recommendation (the owner chose B over A).** A reviewer may change their response until the step completes (by every required sign-off, by a Return under 156, by a skip, or by withdrawal). Once the step completes, its responses and the step are frozen, and an ended round is never rewritten. In place of the map's "a response can never be changed once recorded" trigger, a trigger refuses any change to a response row of a completed step or an ended round (the key-rotation re-wrap of the encrypted text and the purge excepted). A change while the step is open is audited with ids, never text, and decided under a lock on the round so it cannot race the step's completion; changing to Returned completes the step at once, and changing a sign-off may complete it (question 15). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a |
| 163 | The item stays editable during a round; each response records the item's `version`, and the review section shows "changed since signed off" (question 16). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a, 2.8b |
| 164 | A new ADR 0009, which ADR 0002 points to, plus the ADR 0003 §4 line "an agent never reviews" and the ADR 0006 rows (question 17). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; ADR 0002, 0003, 0006 |
| 165 | Three pull requests: 2.8a rounds, steps and responses; 2.8b the item detail and My Work; 2.8c defaults per type and the Done check (question 18). Decided 2026-11-20, relayed. | relayed | `docs/porting/maps/2.8.md`; ADR 0009; 2.8a to 2.8c |

Rows 62 to 75 are sub-phase 2.5's decisions. Rows 85 to 99 are sub-phase 2.6's (`docs/porting/maps/2.6.md`, questions 1 to 13, then the public perimeter and the member-email rule). Rows 100 to 119 are sub-phase 2.4b's (`docs/porting/maps/2.4b.md`, questions 1 to 20 in order): every recommendation accepted except question 7, where the owner chose option C. Rows 124 to 144 are sub-phase 2.7's (`docs/porting/maps/2.7.md`, questions 1 to 21 in order): every recommendation accepted except question 1, where the owner chose the plaintext full-text index (option C, ADR 0008), question 2, moot as a result, question 3, where the owner chose Bulgarian and English stemming through a custom configuration, and question 20, whose "Search token" row became "Search vector". Rows 148 to 165 are sub-phase 2.8's (`docs/porting/maps/2.8.md`, questions 1 to 18 in order): every recommendation accepted except question 11 (decision 158) and question 15 (decision 162), where the owner chose option B. Rows 120 to 123 are sub-phase 2.6c's: the provider for the 2.6 map's question 3. Rows 76 to 84 are the ideas the owner adopted from the Procore audit, all of its top ten but #8 (event triggers for delegate agents and a search skill), which 6.3 and a search skill already plan. Those of 76 to 78 changed ADRs 0002 and 0006 with 2.4b's decisions (rows 100 to 119); the others change none yet: each sub-phase lists the amendments it needs and its proposed words as open questions, decided when it starts.

Sub-phase 2.6b (public intake forms) applies decisions 86, 88, 89 and 98 as follows. The deployment switch of decision 86 is `INTAKE_PUBLIC_FORMS` (`1` open, `0` closed, unset closed in production), set in `.env.prod` by the operator once the release runs on both images. Decision 98's bypass reason `public-intake-resolve` and two of its three machine-caller entries (`/api/intake/forms`, `/api/intake/confirm`) are live with their contracts; the third, `/api/intake/email`, arrives with 2.6c. The outsider email types (`INTAKE_CONFIRM_ADDRESS`, `INTAKE_ACCEPTED`, `INTAKE_DECLINED`, `INTAKE_MERGED`) are added in a migration of their own; their writers ship in the same release but cannot run until the switch is opened. Blocked senders move to 2.6c. As built: `docs/intake.md`, "Public forms (2.6b)".

Sub-phase 2.6c (inbound email) applies decisions 87, 98, 99 and 120 to 123 as follows. Rows 120 to 123 are the owner's answers to the 2.6 map's open question 3 (the provider and its data handling). The deployment switch is `INTAKE_EMAIL` (`1` open, `0` closed, unset closed in production); production refuses `INTAKE_EMAIL=1` without `RESEND_API_KEY` and a `whsec_` `RESEND_WEBHOOK_SECRET`, in `src/env.ts` and again at startup. Decision 98's third machine-caller entry, `/api/intake/email`, is live with its contract. While building, three choices were made that no decision names, each recorded in `docs/intake.md`: the raw message's download host is pinned to Resend's domains and AWS storage and then fetched through `safeFetch` (the URL comes from an authenticated call to a fixed host, but a pin keeps a tampered answer from steering the worker; re-check the hosts against a real delivery before go-live); only an `Authentication-Results` header carrying the configured `INTAKE_EMAIL_AUTHSERV_ID` is believed, since a sender can write the header too, and with it unset every email is unauthenticated; and a blocked sender is kept only as the address's lookup hash, per ADR 0006's definition, for one project or the whole workspace, managed under `intake.manage` (also when a spam decline blocks it). A reply to a decided request is dropped without an answer; the map allowed one "this request is closed" answer, which is not built. As built: `docs/intake.md`, "Inbound email (2.6c)".

`LICENSE`'s Change Date, 2030-11-18, follows the BUSL four-year rule from today; it was
not asked separately.

Decisions 7 to 9 are in ADR 0006 (vocabulary), and reach `src/lib/permissions.ts` and
the register route when 1.4 is ported. The 1.3 and 1.4 maps (`docs/porting/maps/`) now
say `MEMBER`, the decided role order, the Viewer fallback and the sign-up switch.

Decisions 13 and 14 left one question between them, recorded as ADR 0003 open question
10: when a tool has been raised to `AUTOMATIC`, does a session a non-assignee started
still send that tool's writes to the assignee as proposals? Decision 15 answers it: yes,
such a session's writes go to the assignee as proposals at any rung.

Map housekeeping: `1.5.md` has a "Handoff to 1.6" section, listing what 1.5 already
places in `metrics.ts`, `tracing.ts`, `edge-logger.ts` and `instrumentation.ts`. Copy it
into `1.6.md` before porting 1.6.

## Finding: Dub (AGPL-3.0) and Nucleo in inflect's UI

`docs/porting/licence/dub-nucleo-finding.md` has the measurement (script:
`docs/porting/licence/dub-overlap.py`). In short, 368 of inflect's 597 UI files share at
least half their text with Dub's `packages/ui`/`packages/utils`, which are AGPL-3.0. That
count includes 270 Nucleo icons whose notice forbids use outside the product they shipped
with. The engines (tasks, automation, agentic, MCP, canvas) show no overlap. The owner
accepted the risk (decision 4), and ADR 0001 D4 records it. `NOTICE` names Dub and Nucleo
in the change that lands `packages/ui` (next step 3); it says so already.

## Branches

- `main` was created at `449fb38` (the roadmap only), on the owner's go-ahead, and exists on the remote.
- Draft PR #1 (https://github.com/RodnaPamet/islestone/pull/1) merges
  `claude/great-planck-57ljb4` into `main`, so CI runs. `ci.yml` runs only on pull
  requests and on pushes to `main`. PR #1's first completed CI run was green, on
  `3ffb78a` (an earlier run, on `6f57a59`, was cancelled by the next push).
- The owner sets `main` as the default branch and protects it, requiring a pull request
  and the CI checks.
- Merge PR #1 only when its CI is green.

## What is on the branch

`claude/great-planck-57ljb4`:

- `449fb38` — the roadmap.
- `0bf9582` — Phase 0 + 1.1 skeleton, checkpointed during its review loop: app skeleton,
  env modules, licence gate, CI, ADRs 0001–0006 as drafts.
- `c7d1123` adds:
  - `LICENSE` and `LICENSING.md` (BUSL-1.1);
  - the shared-UI drift tooling (`scripts/ui-drift.mjs` with `verify`, `audit`, `compare`
    and `pin`, plus `tests/unit/ui-drift.test.mjs`, run with `npm run test:scripts`)
    and `docs/porting/shared-ui.md`;
  - the porting maps (`docs/porting/maps/`), the open-source studies (`docs/porting/oss/`)
    and the Dub finding (`docs/porting/licence/`).
- Later commits carry the rest of the Phase 0 + 1.1 work (`3ffb78a` had the first
  completed CI run, green), refresh the porting maps, and record the owner decisions
  (next step 2).

## What is not on the branch

- **`packages/ui` (the 397-file `@inflect/ui` copy).** Recreate it exactly with:

      node scripts/ui-drift.mjs pin /path/to/inflect-compliance --ref 5528464fc54a8681956f3b9ce23ca9c075f0420e

  This was checked: it reproduces the held copy, `UPSTREAM.json` included. Until then the
  last test in `ui-drift.test.mjs`, which checks the real `packages/ui`, is skipped; the
  skip asserts that nothing in the repository expects the package yet (no git-listed file
  under `packages/ui`, no lockfile entry for it).
- **Porting-map verification still in progress at pause time.** The maps on the branch are
  the latest saved versions, and some were still being re-verified.

## Rules learned from the licence re-reads (H0)

Full evidence is in `docs/porting/oss/<project>.md`, section "Licence check". `PROVENANCE.md` carries each commit and licence-boundary rule in its port-candidates table, and its wording governs; the rules below are short forms. Every candidate is still UNPINNED for use: the commit is the one its licence was read at.

| Project | Licence read at | Licence | Rule |
|---|---|---|---|
| Kaneo | `fb890b4` | MIT | None on licence grounds. `packages/importers/src/plane/*` is for structure only until audited; no use of the Kaneo name or marks |
| Paperclip | `8285a81` | MIT | Take nothing from a revision that lacks `63afce369` (the LICENSE merge) as an ancestor. |
| Teable | `bd8cfc0` | `packages/` MIT since `9c77957af`; apps and plugins AGPL-3.0 | `packages/` only |
| Cal.diy | `ae027bb7` | MIT since `ab21c7f805` (AGPL before) | Only the 63 paths the study names, none of them formerly `ee/` |
| Paca | `5913718` | Apache-2.0 | Not `apps/web/public/provider-logos/`, the bundled skills content or `apps/web/src/components/ui/`; ship the Apache-2.0 text, mark modified files, re-check for a `NOTICE` at every re-pin |
| circle | `b0ba7dd` | MIT | None on licence grounds. Vendored code under other holders needs its own notice; not `components/common/settings/integration-logos.tsx` or the paid BaseUI variant |
| SVAR Gantt | `24f381a` / `ba70128` (v2.8.3) | MIT from v2.4.3; GPL-3.0 before | Pin 2.4.3 or later; never copy from earlier commits |
| jira-auto-scheduler | `39323ed` | MIT | None on licence grounds. Not the vendored `public/can.js`, `public/json-logic/` or `public/dist/` files, nor Bitovi's name and images; the study recommends pattern only |

## Next steps, in order

1. **Finish Phase 0 + 1.1.** Done on the branch: the skeleton is there, and PR #1's first
   completed CI run, on `3ffb78a`, was green. Roadmap 0.2's "Done when: five ADRs merged"
   PR #1 merged on 2026-11-19. Roadmap 0.2's five ADRs: 0001, 0002, 0004, 0005 and 0007
   are Accepted; 0003 and 0006 record the owner's decisions in place and stay Proposed for
   their remaining open questions.
2. **Record the owner decisions.** Done. What landed:
   - ADR 0001 is Accepted. It records D1 (copying allowed), D2 (BUSL-1.1, licensor
     Inflect Ltd.), D3 (tldraw 3.x with the watermark) and a new D4 (Dub/Nucleo taken as
     is, risk accepted, with the finding's numbers). Its interim "pattern only" rule is
     replaced by the copy rule: copy, record each file in `PROVENANCE.md`, keep the BUSL
     and other licence notices.
   - ADR 0007 is Accepted (decisions 11 and 12). ADR 0003 records decisions 13 and 14 in
     place; ADR 0006 records decisions 7 to 9. Both stay Proposed, because their other
     open questions are unanswered. ADRs 0002, 0004 and 0005 were
     Accepted on 2026-11-19 (decisions 20 to 26).
   - `package.json` says `"license": "BUSL-1.1"`.
   - The licence gate allows 0BSD, the `tslib` exemption is gone, an exemption must cite
     an Accepted ADR that names the package, and a workspace holding `UPSTREAM.json` is
     checked like any dependency.
   - `CLAUDE.md`, `PROVENANCE.md` (the copy rule; the port candidates with the commit each
     licence was read at and its licence-boundary rule; rows for the patterns the ADRs
     adopt), `NOTICE`, `LICENSING.md`, `README.md`, and `docs/ROADMAP.md` 0.1 and section 7.
   - Since then: the porting maps and OSS studies no longer call copying forbidden or
     ADR 0001 unsigned (1.3, 1.4, 1.5, 1.6, 1.7, 2.1–2.2, 2.3, 5.1, and the Cal.diy, Paca
     and SVAR studies; 6.1 and 6.2 arrived already corrected), and the 1.3 and 1.4 maps
     carry the ADR 0006 role decisions.
   - Decisions 15 to 18: ADR 0003 records 15 (open question 10) and 17 (no agent risk
     tier) in place and stays Proposed; `docs/ROADMAP.md` records 16 (under 2.2) and 18
     (5.1's prompt drops the agent-run action, 6.3's prompt and a bullet under it add it); the
     1.4, 1.6, 2.1–2.2, 5.1, 6.1 and 6.2 maps follow them; `README.md` and `CLAUDE.md`
     qualify the rung summary for decision 15, and `CLAUDE.md` says where decisions are recorded.
3. **Land the shared UI (1.2 part A).** Done, in PR #2. `packages/ui` is pinned and verified;
   `.gitattributes`, the root dependencies, `typecheck:ui`, the Jest mapper and jsdom
   `testMatch`, the env guard's workspace resolution and CI's `Shared UI` job are in;
   `NOTICE` carries the Dub and Nucleo notices; `PROVENANCE.md` lists all 397 files and
   marks the 74 Dub-derived and 270 Nucleo ones; `@inflect/ui` and `@visx/vendor` are
   exempted. Two consequences: the root `tsconfig.json` no longer sets
   `noUncheckedIndexedAccess` (the package fails it, and inflect does not use it), so the
   maps' "noUncheckedIndexedAccess fix" edits are no longer needed; and the owner added the
   Unlicense to the allowlist (ADR 0007 E6, 2026-11-19) for visx's `robust-predicates`.
   Add the new `Shared UI` check to the `main` ruleset.
4. **1.2 part B (the GENERIC `src/components/ui` files).** Done, on branch `wt/partb`
   (not pushed). Following `docs/porting/maps/1.2.md` B0 to B12:
   - 130 code files copied to inflect's paths under `src/`: 127 byte-identical
     mirrors (the 106 GENERIC files the map copies, the 14 required MIXED files,
     `radio-group.tsx`, `format-bytes.ts`, `text-utils.ts`, `filters/filter-presets.ts`,
     the two MIXED `hooks/__tests__` tests, and `src/types/tanstack-table.d.ts`, which
     the map missed) and 3 forks (the `charts/index.ts` and `icons/index.tsx` stubs,
     and `ui-storage.ts` with `UI_STORAGE_PREFIX = 'islestone'`). The map's optional
     MIXED files, `dashboard-widgets/{index,types,TargetLine}` and everything SKIP or
     COUPLED are not taken.
   - The second manifest is `ui-mirror.json`, checked by `scripts/ui-mirror.mjs`
     (`verify`, `audit`, `compare`, `pin`) in CI's `Shared UI` job
     (`docs/porting/shared-ui.md`, "Part B").
   - `src/styles/tokens.css` (the 47 contract tokens and the section 6.1 extras, light
     and dark), the Tailwind theme keys as `@theme` in `src/app/globals.css` with the
     section 6.4 recipes, next-intl with the section 6.6 keys in `messages/en.json`,
     the jsdom Jest settings of section 5.1, the two Radix overrides, and the section 4
     dependencies at the map's versions (all on the licence allowlist).
   - 111 tests copied under `tests/`: 102 from section 5.2 (one, `modal-fly-in`,
     repointed from `tailwind.config.js` to `globals.css`) and 9 from 5.3 with their edits.
   - `/gallery` renders the main primitives in both themes, with a rendered test and a
     Playwright smoke test.
   - `PROVENANCE.md` ("Copied: generic UI") lists every copied file and names the Dub
     origin of the 14 the measurement links to Dub (13 primitives and `icons/icon-type.ts`;
     the other files step 4 named, `charts/funnel-chart.tsx`, `form.tsx`,
     `number-stepper.tsx`, `slider.tsx` and the `dub-*` and `plan-feature-icons` icons,
     are not copied). `NOTICE`'s Dub entry now covers `src/components/ui`.
   Open for the owner: Islestone's brand palette (the tokens are an unbranded
   placeholder), and whether the theme should follow the OS colour scheme before the
   1.7 theme provider. Add the `Shared UI` check to the `main` ruleset if not yet done.
5. **Ports 1.3–1.7, then 2.1–2.3, 5.1, 6.1 and 6.2.** Follow their maps in
   `docs/porting/maps/`. Each map gives the files, what to cut, the npm packages and the
   tests that come along, and the copy order. Every copied file gets a `PROVENANCE.md` row
   pinned to `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
   **1.3 (tenancy and data core) has landed**: the Prisma 7 schema and the tenancy
   migration with RLS and both last-owner triggers, `runInTenantContext`,
   `RequestContext`, `getTenantCtx`, the stubs for 1.4, the `integration` Jest project and
   the CI `Integration` job (`PROVENANCE.md`, "Copied: tenancy and data core"). Two owner
   items came out of it: ADR 0006 W1 (`Tenant`/`tenantId` in code) is applied but not
   signed, and the `prisma` CLI's dependency tree fails `npm run licence:check`
   (`elkjs` EPL-2.0 and `@visx/vendor` 4.0.0-alpha.0 through Prisma Studio, `graceful-fs`
   4.2.12 BlueOak-1.0.0), which needs an ADR 0007 decision; no exemption was added (decision 27 since
   settled it).
   **1.4 (auth, members, invites, permission set) has landed** on branch `wt/p14` (not
   pushed), by `docs/porting/maps/1.4.md` (`PROVENANCE.md`, "Copied: auth, members and
   permissions"):
   - NextAuth v4.24.15 behind one seam (ADR 0004 A3): only the files in
     `NEXT_AUTH_SEAM` (`eslint.config.mjs`) load `next-auth`, enforced by
     `local/next-auth-single-seam` and held equal to the real importers by
     `tests/guards/auth-stack-pinning.test.ts`. Credentials, Google and Microsoft (each
     OAuth provider only when configured), `UserSession` rows with revocation, the
     fail-open session check (contract item 6), per-workspace MFA, the password policy
     and breach check, invites (tenant and organization), custom roles, and the edge
     tenant-access gate. SSO, "Enforce SSO", SCIM and the Entra rules wait for 8.3.
   - The new `PermissionSet` (twelve PM domains) and the five roles; GUEST is not
     assignable yet. `TenantCustomRole` stores `grantsJson` (ADR 0006 bans
     "Permissions" in identifiers).
   - `requirePermission` with audited denials; `getTenantCtx` and
     `getTenantServerContext` restore the MFA gate through one module. The audit log,
     observability and mailer are stubs at their final paths until 1.5 and 1.6 (an
     audit entry is a log line).
   - Public sign-up behind `AUTH_PUBLIC_SIGNUP` (ADR 0006): closed in production by
     default, open in development; the invite path of the register route stays open.
   - The auth migration adds six tenant tables with RLS, tenant-leading indexes and
     two-tenant tests; the login, invite, password, MFA, account and picker pages, and a
     placeholder workspace page at `/t/<slug>` that 1.7 replaces.
   Open for the owner: whether `/` and `/gallery` stay public (they are, as before 1.4);
   a seed tenant for E2E (roadmap 1.8 or H1); ADR 0004 open question 7 (the `next-auth`
   overrides entry for nodemailer) is still open, and no override was added.
   **1.5a (the security perimeter) has landed** on branch `wt/p15` (PR #16, not pushed
   from this session), by `docs/porting/maps/1.5.md` (`PROVENANCE.md`, "Copied: security
   perimeter"):
   - Field encryption with per-workspace DEKs (`Tenant.encryptedDek`, wrapped in the
     register transaction), fail-closed decryption, and a one-entry manifest
     (`TenantSecuritySettings.auditStreamSecretEncrypted`). Production refuses to start
     without a real `DATA_ENCRYPTION_KEY` (schema and startup check).
   - The PII extension: `User.email` and `name` hold ciphertext under their own names
     (ADR 0006 forbids `@map`), every lookup is by `emailHash`, nullable in the schema and
     NOT NULL in the database (one residue line); `Account` tokens dual-written. The
     migration refuses a database with existing `User` rows.
   - The hash-chained `AuditLog` and `OrgAuditLog` (`subjectUserId`, ADR 0006 bans
     "Target") with immutability triggers and SELECT/INSERT-only grants, `AuditOutbox`,
     the erasure record, `logEvent` writing real rows from every 1.4 mutation, the audit
     stream through `safeFetch`, and `scripts/verify-audit-chain.ts`.
   - The edge read and auth rate-limit tiers, and issue #17: production refuses
     `RATE_LIMIT_MODE=upstash` (the default) without both Upstash values.
   - A per-request nonce CSP (request-header and `__webpack_nonce__` bridges), CORS,
     sanitisation profiles, the egress allowlist, and secret detection (Husky hook plus
     `tests/guards/no-secrets.test.ts`).
   - Docs: `docs/encryption.md`, `docs/audit-trail.md`, `docs/rate-limiting.md`,
     `docs/security-perimeter.md`.
   Left for **1.5b**, after 1.6 brings the job queue: the master-key and per-tenant DEK
   rotation jobs and routes, `scripts/rotate-global-pii.ts` and the audit-outbox drain.
   Decided on review (rows 28 to 30): the startup checks are in
   `src/instrumentation-node.ts`, behind a literal `process.env.NEXT_RUNTIME` branch, so
   `next build` no longer warns; `upstash` stays the default with the production refusal;
   the CSP violation-report sink is ported in 1.6. The 1.4 integration suites now read
   real audit rows and the recorder is gone (issue #18). 1.5b is issue #19. 1.6 is next.
   **1.6 (jobs, notifications and observability) has landed** on branch `wt/p16`, by
   `docs/porting/maps/1.6.md` (`PROVENANCE.md`, "Copied: jobs, notifications and
   observability"):
   - The BullMQ queue (`islestone-jobs`), the executor registry with two jobs
     (`health-check` every 2 minutes, `notification-outbox-flush` every 10), the worker,
     scheduler and healthcheck scripts and their esbuild bundle (`npm run build:worker`),
     `NonRetryableJobError`, the heartbeat, and the per-workspace system user
     (`sys_<tenantId>`, refused by CHECKs as a sign-in, membership or session). Production
     refuses to start without an authenticated `REDIS_URL`; Redis runs `noeviction`.
     `docs/jobs.md`.
   - Notifications: `Notification`, `NotificationOutbox` and `TenantNotificationSettings`
     (RLS, two-workspace test; no DELETE for `app_user` on the last two), the outbox with
     its claim-before-send lease, the due-digest dispatcher, the two bell writers with
     in-app mutes, the bell routes and SSE stream, the settings routes and a workspace
     drain. Mail goes through SMTP when `SMTP_HOST` is set, else to the console sink.
     `docs/notifications.md`.
   - Observability: the OpenTelemetry SDK (off unless `OTEL_ENABLED=true`), the metrics
     and fifteen business KPIs, job trace propagation, web vitals, shutdown handlers with
     the audit-stream flush, the `observable-gauge-rebinds` lint rule, and Sentry
     (server-side, off unless `SENTRY_DSN` is set). `docs/observability.md`.
   - The CSP violation sink (`/api/security/csp-report`, the legacy `/api/csp-report`
     delegating in-process), `report-uri` and `report-to` in the policy, and the three
     beacons as `MACHINE_CALLER_PREFIXES` (row 30).
   - CI: a Redis service in Integration and E2E, and the worker bundle in Build.
   Owner decisions 31 to 34 (2026-11-19) are applied: MIT-0 and FSL-1.1-Apache-2.0 on the
   licence allowlist (ADR 0007 E8, E9), the SMTP transport and the Sentry SDK, the
   `next-auth` override (ADR 0004 question 7), the column names in ADR 0006, and a
   mailer that logs only address hashes. Open: whether to initialise Sentry in the
   browser (the source never did; it would be a new data flow for the sub-processor
   register). 1.5b (issue #19) can now use the queue; 1.7 is next.
   **1.5b (key rotation and the audit-outbox drain) has landed** on branch `wt/p15b`
   (issue #19, not pushed from this session), by `docs/porting/maps/1.5.md`
   (`PROVENANCE.md`, "Copied: rotation and outbox drain"):
   - `rotateTenantDek` restored in `tenant-key-manager.ts` (byte-identical to the source
     again), and three jobs: `key-rotation` (master key: re-wrap the workspace DEK,
     re-encrypt its `v1:` values and the outbox recipient), `tenant-dek-rotation` (the
     per-workspace DEK sweep, with progress) and `audit-outbox-flush` (every five minutes,
     oldest event first). The two rotations are on-demand jobs; `scripts/rotate-global-pii.ts`
     sweeps `User` and `Account`.
   - `POST`/`GET /api/t/<slug>/admin/key-rotation` and `/admin/tenant-dek-rotation`,
     both `admin.tenant_lifecycle` (OWNER-only, row 36), with their
     route-permission rules; the logic is in `usecases/key-rotation.ts`. A second DEK
     rotation while a sweep is in flight is a 409. No admin page yet (1.7).
   - The raw-SQL audit guard now reads whole statements and refuses an interpolated table
     outside a named exception. It found `ensureTenantSystemUser`'s raw `INSERT INTO
     "User"` (1.6), now listed with its reason and audited (row 37).
   - Docs: `docs/encryption.md` (both runbooks), `docs/audit-trail.md` ("The drain"),
     `docs/jobs.md`.
   The three questions this left open were decided on 2026-11-19 (rows 35 to 37) and
   are applied: a rotation re-resolves its initiator and, if they no longer resolve,
   finishes as the workspace system user with who asked recorded; the master-key
   rotation is OWNER-only; creating the system user writes `SYSTEM_USER_CREATED` in the
   same transaction. The API-key liveness check in `key-rotation` returns with 5.2.

   **1.7 (application shell) has landed** on branch `wt/p17`, by
   `docs/porting/maps/1.7.md` (`PROVENANCE.md`, "Copied: application shell"):
   - The shell: `AppShell` on `AppShellFrame` with the sidebar (`SidebarNav`, navigation
     from the fresh `nav-config.ts`: My Work, Inbox, Projects, Views, with Settings as the
     footer gear behind `mayOpenSettings`), the top chrome (brand `IS`, environment badge,
     breadcrumbs, workspace switcher, the bell on the workspace routes, the account menu
     with the theme toggle) and the mobile drawer. The page shells `EntityListPage`,
     `EntityDetailLayout` and `DashboardLayout`, with `ListPageShell`, `PageHeader` and
     `FilterToolbar`.
   - The command palette (`mod+k`, navigation and actions; entity search off until 2.7
     ships `/api/t/:slug/search`), the shortcut help (`mod+/`), the theme provider and
     pre-paint script, the back-affordance libraries, root providers, layout, error and
     not-found pages. `docs/app-shell.md`.
   - The real `TenantProvider` at `@/lib/tenant-context-provider` (its URL builders fall
     back to the route's slug outside it), and `OrgProvider`.
   - Routes: `src/app/t/[tenantSlug]/(app)/layout.tsx` merges the source's two tenant
     layouts (session, `getTenantServerContext` with its MFA gate and 404, provider,
     shell). The MFA challenge and enrolment pages moved to `(mfa)`, outside it, because a
     session owing a code must reach them. Placeholder pages for every nav target; the
     workspace root and `tenantLandingPath` go to My Work; `/` goes to `/tenants` or
     `/login`.
   - `swr` 2.5.1 (MIT) for the session seam's `SWRConfig`. The nav tokens, keyframes,
     `.icon-btn` and a reduced-motion rule joined `tokens.css` / `globals.css`.
   The owner decided the four points 1.7 left open on 2026-11-19 (rows 38 to 41): the
   theme follows the OS until a choice; the `IS` initials and a generated letter favicon
   stay as placeholders until a logo; the palette's Settings row follows `mayOpenSettings`;
   the MFA pages stay outside the shell. All four are applied.
   Not ported now: `back-affordance-no-cycles` (no subpages yet, so it would check
   nothing; 2.3 brings it with the first detail page), `docs/keyboard-shortcuts.md`,
   `docs/i18n.md` and `docs/epic-52-list-page-shell.md` (distilled into
   `docs/app-shell.md`), `@axe-core/playwright` (the a11y checks are jest-axe).

   **1.8 (environments and delivery) has landed** on branch `wt/p18` (not pushed),
   by the owner decisions of 2026-11-19 (rows 42 to 47) and `PROVENANCE.md`
   ("Copied: environments and delivery"). The repository side only; nothing on
   the VM, in GitHub's settings or in DNS has been changed.
   - **Images.** One `Dockerfile`, two targets from one builder:
     `ghcr.io/rodnapamet/islestone` (the Next.js standalone server;
     `output: 'standalone'` is now on, and `npm run start` and the Playwright
     suite serve it through `scripts/start-standalone.mjs`) and
     `ghcr.io/rodnapamet/islestone-worker` (the worker, scheduler and probe
     bundles, the pruned production tree and the Prisma CLI). Node 24.22.3 on
     Alpine 3.23, non-root `node`, npm removed, `LICENSE` and `NOTICE` inside,
     `BUILD_SHA` baked in. `NOTICE` names libvips (LGPL) and elkjs (EPL), as
     ADR 0007 asked of this sub-phase.
   - **Health.** `/api/readyz` now checks PostgreSQL and Redis (503 naming the
     failure, two-second timeouts, a closed set of error strings, `version`
     from `BUILD_SHA`; `src/lib/health/readiness.ts`). The app container's
     healthcheck uses it; the worker's reads the heartbeat.
   - **The stack.** `deploy/docker-compose.prod.yml`: Postgres (pgvector),
     PgBouncer, Redis, the one-shot `migrate`, `app`, `worker` and a Watchtower
     scoped to `islestone`. `--env-file /opt/islestone/.env.prod` only, every
     secret a `:?` or empty-default reference, each service naming its
     variables. Only `app` joins `agrent_internal`. 4 GB for the long-running
     services. `ISLESTONE_IMAGE_TAG` pins a build (the rollback lever).
   - **The runtime role.** The app, the worker and PgBouncer connect as
     `islestone_app` (`deploy/postgres/init-runtime-role.sh`): not a
     superuser, not BYPASSRLS, a member of `app_user`, as
     `docs/rls-tenant-isolation.md` has required of production since 1.3.
     Checked before building on it: the whole integration suite (383 tests)
     passed with the app's `DATABASE_URL` pointed at such a role and the test
     client still the superuser, and failed (12 of 13 in one file) with a wrong
     password for it, so the run did use the role.
     `tests/integration/runtime-role.test.ts` keeps its properties.
   - **Migrations under Watchtower.** `depends_on` holds only for
     `docker compose up`; Watchtower ignores it. So `migrate` is labelled and
     revived by Watchtower, and both images start through
     `scripts/wait-for-migrations.mjs`, which waits for the newest migration
     each was built with (`.migration-head`) before the server or the worker
     starts.
   - **Deploy scripts.** `deploy/apply.sh` (preflight by default, `CONFIRM=1`
     applies; refuses without the Agrent Caddyfile import line, the read-only
     sites mount, a private complete `.env.prod`, or while another Watchtower
     is unscoped; validates the Caddy site inside `agrent-caddy`, brings the
     stack up, then validates the whole Caddy configuration and reloads it
     gracefully, rolling the site back on failure), `deploy/check-drift.sh`,
     `deploy/backup.sh` (pg_dump, and `RESTORE_DRILL=1`). They run on the VM,
     shipped over IAP when started from a workstation.
     `tests/unit/deploy/apply-script.test.ts` runs `apply.sh` against a
     stand-in `docker`. `backup.sh` and its drill were run locally against a
     migrated test database through a stand-in `docker` that ran the commands
     here (dump kept and listed, restored, structure equal, chain links
     intact); not on the VM.
   - **Delivery.** `.github/workflows/release.yml`: semantic-release
     (25.0.9, through `npx`, Conventional Commits, tags and GitHub Releases
     only, no commit back to `main`), then build, Trivy and push of both
     images (`:sha-<short>`, the version, `:latest` last) with `GITHUB_TOKEN`
     and `packages: write`. CI's new `Image` job builds both images on every
     pull request without pushing, reads them (user, files, `BUILD_SHA`, no
     npm) and uploads Trivy SARIF. Dependabot watches the base image and the
     compose images.
   - **Scans (H1).** Trivy (CI and publish) and a nightly ZAP baseline
     (`.github/workflows/dast.yml`, signed in as a registered owner) are
     report-only until 2026-12-03; `tests/guards/security-scan-deferral.test.ts`
     fails CI after that date while either is still non-blocking.
   - **Docs.** `docs/deployment.md` (the runbook: the shared Caddy steps for
     Agrent's repository, Watchtower, first deploy, operating, rollback,
     backups and the restore drill, security scans) and
     `docs/change-management-policy.md`.
   - **Guards and tests.** `tests/guards/deploy-compose-files.test.ts` (every
     git-listed production compose file: no inline secret, no `env_file`,
     limits, no published port, `noeviction`; planted repository),
     `tests/unit/deploy/{compose-prod,dockerfile,caddy-snippet,apply-script}.test.ts`,
     `tests/integration/{runtime-role,wait-for-migrations}.test.ts`, readyz unit
     and E2E tests, and the 1.8 halves of the Redis and worker-heartbeat
     guards.
   Checked locally (no Docker in this session, so no image was built here):
   the standalone server answered `/api/livez`, `/api/readyz` and `/login`,
   and the whole Playwright suite (34 specs) passed against it; `next build`
   prints only the warning it printed before (`middleware` → `proxy`); the
   compose file, the Dockerfile and the Caddy site are parsed by the tests
   above; `caddy validate` and `docker compose config` run only on the VM,
   in `apply.sh`'s preflight.
   Manual steps, in order, for the owner and the orchestrator: `docs/deployment.md`,
   "First deploy" (DNS; merge and the first publish; both GHCR packages set
   public; the `Image` and `PR title` checks in the `main` ruleset and squash
   merges titled by the pull request; Agrent's Caddyfile import line and
   read-only mount, in Agrent's repository; Agrent's and Playerz's Watchtowers
   scoped; `/opt/islestone/.env.prod`; preflight; apply; checks; the first
   workspace; the backup bucket's one-time `gcloud` setup, a backup and the H1
   restore drill from the bucket).
   Decided on review, 2026-11-19 (rows 48 to 51), and applied:
   - Off-host backups go to a private, versioned GCS bucket in the project
     (`gs://islestone-backups-hazel-design-419410`), with a 30-day delete rule
     for old and noncurrent objects (`deploy/gcs/backup-lifecycle.json`).
     `deploy/backup.sh` uploads each kept dump with `gcloud storage cp` as the
     VM's service account (bucket from `--bucket`, `BACKUP_GCS_BUCKET` or
     `.env.prod`; a warning and no upload when none is set, exit 1 when a
     configured upload fails); `RESTORE_DRILL=1 BACKUP_SOURCE=gcs` restores
     the newest object. The one-time setup is exact `gcloud` commands in
     `docs/deployment.md`, "Off-host copies" (create, versioning, lifecycle,
     `roles/storage.objectCreator` and `roles/storage.objectViewer` for the
     VM's account on the bucket); nothing was created.
     `tests/unit/deploy/backup-script.test.ts` runs the upload, skip, failure
     and bucket-drill paths against stand-in `docker` and `gcloud`; the first
     run found a real defect (the drill's early database drop also removed
     the downloaded dump), now fixed. One point the setup must check before
     granting: the VM's access scopes. The Compute Engine default is
     `devstorage.read_only`, which blocks uploads whatever IAM grants, and
     changing scopes needs the VM stopped (it also runs Agrent and Playerz);
     the runbook says to stop and ask if the scopes are narrow.
   - The GHCR packages are public: no registry credential on the VM; the
     Watchtower `config.json` mount and the `docker login` step are gone.
   - Production uses `RATE_LIMIT_MODE=memory` (one app container, so the
     limits are exact; revisit when the app scales past one container).
   - Pull request titles are Conventional Commits; the `PR title` workflow
     (`scripts/check-pr-title.mjs`, tested in `tests/unit/pr-title.test.mjs`)
     fails any other title.
   The `effect` override (CI review of PR #26, 2026-11-19): advisory
   GHSA-7589-6fvf-x4pw (high, ReDoS) covers `effect` ≤3.22.0, and `prisma`
   7.10.1 → `@prisma/config` 7.10.1 pins `effect` 3.20.0, so CI's `Audit` job
   failed on `main` and on the pull request alike. `package.json` overrides
   `@prisma/config`'s `effect` to 3.22.4 (published 2026-10-22; 3.22.5 was a
   day old and not taken). Its dependencies are unchanged from 3.20.0. Checked:
   `npm audit --omit=dev --audit-level=moderate` finds 0 vulnerabilities;
   `prisma generate`, `migrate deploy` on a fresh database and
   `db:check-schema-drift` pass; `build:worker` passes; the pruned production
   tree (what the worker image and its `migrate` service carry) holds the
   overridden version. Remove the override once Prisma ships an
   `@prisma/config` that depends on `effect` ≥3.22.1 (CLAUDE.md, "package.json
   overrides").
   CodeQL's unpinned-action alerts (same review): every third-party action
   (anything outside `actions/*`) in every workflow is pinned to the full
   commit SHA of its tag, the tag in a trailing comment;
   `tests/guards/workflow-action-pinning.test.ts` fails on one that is not.
   `actions/*` stay on their major tags, as the existing workflows had them.
   Still open for the owner: whether the H1 "dependency audit blocking" item
   needs more than CI's existing `Audit` job (it already fails on a moderate
   advisory).

   **2.1–2.2 (the work-item model; usecases, API and activity) have landed** on branch
   `wt/p21` (not pushed), by `docs/porting/maps/2.1-2.2.md` (`PROVENANCE.md`, "Copied:
   work-item model and API"; `docs/work-items.md`):
   - The model in `prisma/schema/work.prisma` and migration `20261119160100_work_core`:
     teams, workflow states by category (the category immutable by trigger), projects
     with key prefixes (never reused) and per-project key sequences, types (Feature, Bug
     and Chore seeded), work items with sub-items (five levels), relations (BLOCKS cycles
     refused under the graph lock; a property test and a concurrent pair), labels,
     comments, watchers and links. Fourteen tenant tables with RLS, grants, composite
     keys and a two-tenant test. `COLLATE "C"` sort keys from an in-house fractional
     index with property tests (ADR 0002 F1). `WORK_ITEM_DUE` in its own migration.
   - Usecases, repositories and 37 routes: cursor lists, get, key lookup (aliases and
     retired prefixes), create, update with `version`/`If-Match` (409, 428), state with
     the effects, assign, the bulk verbs, subtree soft delete by `deletionId` and
     restore, moves (reorder, re-parent, change project and team), comments (encrypted,
     sanitised, edit and soft delete), watchers (audited, split self/other), links,
     labels, metrics and the Activity feed; project visibility at every read and write,
     GUEST failing closed until 8.4.
   - Due-date reminders (owner decision row 16): the shared helper and the daily job in
     `NOTIFICATIONS_TZ`, date-only; the `work-item-purge` (30 days, row 24) and
     `work-item-sortkey-rebalance` jobs. `removeTenantMember` now unassigns the member's
     items first (ADR 0003 §1).
   - A defect fixed in 1.5's encryption extension: it fanned out by field name at the top
     level of a non-manifest model's write, so `Comment.body` in the manifest would have
     sealed `Notification.body` and `TenantCustomRole.description` outside the rotation
     sweeps.
   - `fast-check` 4.10.2 (MIT, dev). Kaneo moved to Adopted in `PROVENANCE.md` (pattern
     only).
   The owner decided the two permission questions on 2026-11-19 (rows 52 and 53): the
   configuration keys are kept as built, and a comment is edited by its author only and
   deleted by its author or a workspace admin (moderation, audited). Both are applied.
   The branch was rebased onto `origin/main` (3050d5b).
   Open for the owner (none blocks 2.3):
   - **GUEST project grants** stay with 8.4 (the map's choice); until then a guest sees no
     project and no item.
   - **Retention classification** (`retention-policy-coverage`) waits for 8.3, which
     brings the data-lifecycle job; `docs/work-items.md` records the purge window and the
     never-pruned key tables.
   - ADR 0002's sketch is refined in three places, named in `docs/work-items.md`: the
     relation index order, `WorkItemLink.type`/`location` (the schema guard refuses
     `kind` and `target`), and `createdByUserId` kept (the map said `creatorId`).

   **2.3 (the work-item list, board and detail views) has landed** on branch `wt/p23`
   (not pushed), by `docs/porting/maps/2.3.md` (`PROVENANCE.md`, "Copied: work-item
   views"; `docs/work-items.md`, "Views (2.3)"):
   - Pages: Work items (`/work-items`), a project (`/projects/<prefix>`), Projects (a
     list of projects) and My Work (the items assigned to you) replace 1.7's
     placeholders; an item's page is `/work-items/<key>` (an old key or an id
     redirects). The routes are in `NAV_PATHS` (a "Work items" row in the sidebar and
     the palette), `MAIN_PAGES`, `SUBPAGES` and the canonical parents; the stepper
     names work items.
   - The list on `EntityListPage` with the filter system (options from the server's
     configuration and the roster), cursor pages, bulk state, assign and delete with
     rollback, and the Deleted view with restore. The board on
     `@atlaskit/pragmatic-drag-and-drop` 4.0.0 (with its hitbox 3.0.0 and auto-scroll
     3.2.1, Apache-2.0, pinned): columns by state grouped by category for a project, by
     category across teams; swimlanes by assignee, priority, type, label or project;
     virtualised columns; keyboard moves announced through a live region and a
     per-card "Move to…" menu. The detail as a full page and as a sheet over the same
     reads: state, assignee, priority, type, labels, due date, watchers, relations,
     URL links, comments (decision 53, asked through `comment.policies.ts`), Activity
     and sub-items; delete with undo; prev/next. A create dialog.
   - One list query and one cache for all three; every write optimistic, versioned
     (`If-Match`), retried once on a 409 whose fields did not move, rolled back with
     the server's reason otherwise; every removal through the undo toast.
   - Server additions: the move route takes a board drop (`stateId` with a
     `position`, one transaction, `moveWorkItemOnBoard`); `GET /users/assignable`
     (`listAssignableUsers`, re-added without the reviewer audience);
     `getWorkItemViewConfig`.
   - Tests: rendered (rollback, the 409 paths, undo, board keyboard moves and
     refusals, detail and list, jest-axe on list, board and detail), unit (board-model
     properties, cache placement, Activity phrases, the work-item path), integration
     (the board drop, the view configuration, the roster, the API matrix), two guards
     (`undo-toast-coverage`, `work-item-views-shared-query`) and e2e (create → list →
     board by pointer and keyboard → sheet → page → comment → delete and undo; a
     keyboard-only board).
   Cut or deferred from the map, each named in the report: the KPI strip (its
   sparklines are 3.6's), list sorts beyond manual order (2.4, with their indexes), the
   `AsidePanel` quick view (the `Sheet` primitive serves), the column gear, the
   copied `use-tenant-mutation`, `use-entity-list-ids`, `use-guarded-push`,
   `url-sync`, `swr-keys`, `bulk-action-bar`, `kpi-filter-card`, `user-combobox` and
   their tests, and the `no-router-push-in-row-click` lint rule. ln-dev7/circle was
   not read; its row stays UNPINNED.
   Decided by the owner after it landed (decisions 54 to 56): My Work shows its full
   scope now (assigned, created, watching, due soon; applied, `docs/work-items.md`, "Views (2.3)"); a minimal Settings page for
   creating teams, states, types, labels and projects follows as its own pull request;
   the mirrored filter select's no-op URL write is fixed upstream in inflect-compliance
   and re-pinned here.

   **2.4 (saved views and custom fields) has landed** on branch `wt/p24` (not pushed), by
   `docs/porting/maps/2.4.md` (`PROVENANCE.md`, "Custom fields and saved views";
   `docs/work-items.md`, "Custom fields and saved views (2.4)"):
   - Schema: `CustomField`, `CustomFieldOption`, `CustomFieldValue` (one typed column per
     type, CHECKed; TEXT and URL plaintext by ADR 0002 §7; `projectId` under both composite
     FKs so a move must drop values), `SavedView`, enums `CustomFieldType`, `ViewLayout`,
     `SavedViewVisibility`; `WorkItem.priorityRank` (trigger-written) and three sort indexes.
     Migration `20261120120000_saved_views_and_custom_fields`, RLS and grants on all four
     tables, two-tenant tests in `work-tables-isolation.test.ts`.
   - API: field definitions under `/projects/:id/custom-fields` (`projects.edit`), a value at
     `PUT /work-items/:id/custom-fields/:fieldId` (`work_items.edit`, the version increases,
     `If-Match` optional), `customFields` on create and on every row, `cf.<fieldId>` list
     filters, the sorts `created|due|priority|key|cf:<id>` with `dir` (multi-column cursor,
     nulls last), saved views at `/views` (`views.*`).
   - UI: the field manager (project page, Settings → Projects), field editors on the detail,
     field columns in the column gear, field filters, field swimlanes, the Sort picker, the
     views menu (apply, save, share, update, rename, delete with undo) and the Views page
     (`?view=<id>` links), which replaced 1.7's placeholder.
   - Teable `packages/` moved to Adopted (pattern only, pinned at `bd8cfc0`, licence re-read);
     Kaneo got a 2.4 row. Nothing was copied.
   Decided by the owner on 2026-11-20 (decisions 58 to 61): fields are defined under
   `projects.edit`; only a shared view's creator changes it, an admin deletes one for
   moderation; a VIEWER saves its own personal views (`views.create` and `views.edit`, not
   `views.share`); a person field holds one person. Still open (the map's "Open questions",
   each with the default applied): checkbox stores only `true`; field types never change;
   relative date filters (need a workspace time zone and week start); hard delete of a
   field; workspace-wide fields.
6. **Ideas from the Procore audit (2026-11-20).** Done as docs only, on branch `wt/procore`:
   `docs/research/procore-audit.md` (with `docs/research/README.md`) audits Procore, a
   construction-management product, for ideas. Procore's hosts did not resolve from the
   session, so its facts come from search summaries and press releases; nothing was
   copied, and Procore's names are not used (`PROVENANCE.md`, "Product ideas adopted into
   the roadmap"). The owner adopted nine of its top ten ideas (decisions 76 to 84) and
   `docs/ROADMAP.md` places them: a new 2.4b (waiting on, field sets, questions), 2.8
   (reviews), 4.5 (checklists) and 7.8 (drafted answers), and owner-decision bullets in
   2.7, 3.6, 5.1, 6.2, 7.4, 7.6 and 8.4; section 2.6 lists them and section 6 gives the
   order (2.4b after 2.5 and before 2.7; 2.8 after both and not blocking Phases 3, 5 and 6).
   Nothing is built and no ADR is amended. When each sub-phase starts, settle its open
   questions first, its words above all, then amend ADR 0006 (and ADR 0002 §1 for field
   sets, §3 for reviews) before the first model or label.
7. **2.5 (cycles, milestones, templates and repeats) is decided** (decisions 62 to 75: every
   recommendation of `docs/porting/maps/2.5.md` accepted) and ships as four pull requests.
   **2.5a has landed** (its own pull request), per
   `docs/work-items.md`, "Cycles (2.5a)" and `PROVENANCE.md`, "Cycles, cycle schedules and the
   burn-up":
   - Schema: `CycleSchedule`, `Cycle` (no overlap: btree_gist exclusion constraint),
     `WorkItemTransition` (written only by a SECURITY DEFINER trigger; `app_user` SELECT
     only), `WorkItem.cycleId`, enum `CycleRollover`. Migration
     `20261121120000_cycles_and_transitions`; ADR 0006 gained the planning words.
   - API: `/cycles` (`cycles.view`/`cycles.manage`), `/cycles/:id/burn-up`,
     `/teams/:id/cycle-schedule` (`cycles.manage` saves), `PUT /work-items/:id/cycle`
     (`work_items.edit`, versioned), `cycleId` on create and as a list filter (ids, `none`,
     `current`).
   - Job: `cycle-rollover` at 00:10 in `NOTIFICATIONS_TZ`, as the system user.
   - UI: the Cycles page (`/cycles`, in the sidebar and the palette), a cycle's page (stats,
     the burn-up chart with its table, the cycle's list and board), the detail's Cycle
     picker, the create dialog's cycle, the Cycle column, filter and lanes.
   **2.5b has landed** (its own pull request), per `docs/work-items.md`, "Milestones (2.5b)"
   and `PROVENANCE.md`, "Milestones":
   - Schema: `Milestone` (per project: name unique in it, optional `dueDate`, `sortKey`),
     `WorkItem.milestoneId` (composite NO ACTION FK to the item's own project's milestone),
     `WorkItemTransition.milestoneId` (the trigger records a milestone change). Migration
     `20261122120000_milestones`.
   - API: `/projects/:id/milestones` (`projects.view` reads with progress, `projects.edit`
     writes: create, rename, re-date, reorder by neighbour, delete clearing its items),
     `PUT /work-items/:id/milestone` (`work_items.edit`, versioned), `milestoneId` on create
     and as a list filter (ids, `none`). A move to another project clears it; the rollover
     leaves it alone.
   - UI: a project's milestones page (linked from the project's header) and a milestone's
     page (progress, its list and board), the detail's and the create dialog's Milestone
     picker, the Milestone column, filter and lanes (drops on a one-project board only).
   - Also fixed: the saved-view schema refused the cycle filter and lanes (2.5a), so a view
     saved with either was a 400; it now takes both, and the milestone ones.
   **2.5c has landed** (its own pull request), per `docs/work-items.md`, "Templates (2.5c)"
   and `PROVENANCE.md`, "Templates":
   - Schema: `WorkItemTemplate` (per project; `description` encrypted), `WorkItemTemplateLabel`,
     `ProjectTemplate` (per workspace; the whole content encrypted as one versioned document).
     Migration `20261123120000_templates`.
   - API: `/projects/:id/work-item-templates` (`projects.view` / `projects.edit`),
     `/project-templates` (`projects.create` lists; `admin.manage` saves from a project,
     renames, archives, deletes), `templateId` on `POST /work-items` (through the one
     projection, `templateToCreateInput`; sub-items made in the transaction; the template
     recorded) and on `POST /projects` (applied in the create's transaction: fields,
     milestones dated from today, item templates, starter items; types and labels by name,
     misses reported). Member removal clears template assignees.
   - UI: the create dialog's Template picker, the project page's item-templates manager, the
     project create dialog's Template picker, "Save as template" in Settings → Projects,
     Settings → Project templates.
   - Not built: editing a project template's content in the browser (decision 71);
     custom-field values in the manager (API-only); a route that returns a project template's
     content.
   **2.5d has landed** (its own pull request), per `docs/work-items.md`, "Repeats (2.5d)" and
   `PROVENANCE.md`, "Repeats"; with it 2.5 is complete:
   - Schema: `WorkItemRecurrence` (one per item; CHECKs; the hold enum is `RecurrenceHold`
     because ADR 0006 bans "Pause" in the schema), `WorkItem.recurrenceId` / `occurrenceOn`
     with the partial occurrence unique and `ON DELETE SET NULL ("recurrenceId")`. Migration
     `20261126120000_repeats`.
   - Domain: `src/app-layer/domain/recurrence.ts`, the one home of the date stepping
     (property-tested).
   - API: `GET`/`PUT`/`DELETE /work-items/:id/recurrence` (`work_items.view` /
     `work_items.create` plus `work_items.edit` / `work_items.edit`).
   - Job: `work-item-recurrence` at 00:30 in `NOTIFICATIONS_TZ`, as the re-resolved owner,
     through `createWorkItemInTx` (the create core 2.6a extracted, with the repeat options) and `templateToCreateInput`;
     holds written as the system user.
   - UI: the detail's Repeat control, the list's series mark.
8. **2.4b (waiting on, field sets, questions) is decided** (decisions 100 to 119: every
   recommendation of `docs/porting/maps/2.4b.md` accepted except question 7, where the owner
   chose C: from 6.3, waiting on may name the delegate's agent session). ADR 0002 §1, §7, §9,
   §10, §13, §14 and §15 and ADR 0006's Waiting on, Field set and Answer rows are amended.
   It ships as three pull requests. **2.4b-a (waiting on) is built** on branch `wt/p24b`,
   per `docs/work-items.md`, "Waiting on (2.4b-a)" and `PROVENANCE.md`, "Waiting on":
   - Schema: `WorkItem.waitingOnUserId` (member FK, RESTRICT; the closed-item CHECK),
     `WorkItemTransition.waitingOnUserId` (the trigger fires on it),
     `NotificationType.WORK_ITEM_WAITING_ON`. Migrations
     `20261128120000_notification_type_waiting_on` and `20261128120100_waiting_on`.
   - Domain: `stateTransitionEffects` clears it on every move into a closed category.
   - API: `PUT /work-items/:id/waiting-on` (`work_items.edit`, versioned), `waitingOnUserId`
     on create, the `waitingOnId` list filter (ids, `none`). Member removal clears it; a
     repeat copy takes its source's.
   - UI: the detail's and the create dialog's Waiting on picker, the column, the filter, the
     board's lanes; the in-app bell to the person named.
   2.4b-a merged as #51. **2.4b-b (field sets) is built** on branch `wt/p24b`, per
   `docs/work-items.md`, "Field sets (2.4b-b)" and `PROVENANCE.md`, "Field sets":
   - Schema: `WorkItemTypeField` (built-in rules per type, custom-field rules per type and
     project; CHECKs, partial uniques, cascades), `FieldRequirement`,
     `CustomField @@unique([id, projectId, tenantId])`, `RecurrenceHold.FIELD_SET_UNMET`.
     Migrations `20261130120000_recurrence_hold_field_set` and `20261130120100_field_sets`.
   - Domain: `src/lib/work-items/field-sets.ts`, the one evaluation (client-safe).
   - API: `GET/PUT /work-item-types/:typeId/fields` (`admin.manage`),
     `GET/PUT /projects/:projectId/type-fields` (`projects.edit`); every create and field
     write checked (400 `FIELD_SET_UNMET` / `FIELD_HIDDEN`); intake accept takes due date,
     start date, milestone and waiting on; a refused repeat copy holds; project templates
     carry custom-field rules.
   - UI: Settings → a type's fields, the field manager's "Per type", the create dialog,
     detail, accept dialog and item-templates manager reading the rules from the server.
   2.4b-b merged as #52. **2.4b-c (questions) is built** on branch `wt/p24b`, per
   `docs/work-items.md`, "Questions (2.4b-c)" and `PROVENANCE.md`, "Questions"; with it 2.4b is
   complete:
   - Schema: `WorkItem.answerCommentId` (composite FK to `Comment(id, workItemId, tenantId)`,
     `Comment @@unique([id, workItemId, tenantId])`, `NO ACTION`), the trigger
     `comment_answer_not_deleted` refusing a soft delete of the marked comment. Migration
     `20261202120000_answers`.
   - Domain: `planAnswerMark` (`src/app-layer/domain/work-item-answer.ts`): an open item to the
     chosen or first live Done state, a closed one keeps its state.
   - API: `PUT`/`DELETE /work-items/:id/answer` (`work_items.edit`, a person only, the field set
     must show the answer), `POST /work-item-types/question-preset` (`admin.manage`); editing or
     deleting the marked comment is 409 `ANSWER_LOCKED`; the creator of an item whose type shows
     the answer watches it; watchers are told when it is answered.
   - UI: "Mark as answer" on comments (asked of `commentAffordances`), the Done-state dialog, the
     pinned answer with "Clear answer" (undo toast), "Add the Question type" in Settings → Work
     item types, "Add a Question template" in a project's item-templates manager.
   2.4b-c merged as #54. **2.7a (My Work's "Waiting on me" and the waiting-on due reminder, decision
   137) is built** as PR #55, no migration. **2.7b (search over titles and keys) is built** on
   branch `wt/p27b`, on top of 2.7a, per `docs/search.md` and `PROVENANCE.md`, "Search over
   titles and keys":
   - Schema: no model; migration `20261203120000_search_titles` creates `pg_trgm` and
     `btree_gin` (trusted contrib extensions in the pgvector image, created by the migrating
     superuser) and four tenant-leading, live-only GIN indexes: trigram and `simple` full text
     over `WorkItem.title` and `Project.name`. The drift check passes, residue unchanged.
   - API: `GET /api/t/:slug/search?q=&limit=` (`projects.view`, a route rule; work items
     skipped without `work_items.view`; `limit` at most 25, more is a 400); usecase, ranking and
     route copied from inflect-compliance and cut to work items and projects; a typed key
     (current or retired prefix, or a move's alias) ranks first; visibility and `deletedAt` in
     the raw reads' own `WHERE`. The map named `work_items.view` for the route; it was built on
     `projects.view` as instructed, with the per-domain skip keeping work items behind their key.
   - The list's `q` filter is served by the trigram index, and `%` and `_` now match themselves
     (Prisma's `contains` passed them through as wildcards).
   - UI: the command palette's entity search is on; its placeholder names work items and
     projects.
   2.7b merged as #57; 2.7f replaces the two `simple` indexes. **2.7c (the Inbox, preferences and
   the digest, decisions 132 to 136) is built** on branch `wt/p27c`, on top of 2.7b, per
   `docs/notifications.md` ("The Inbox", "Preferences", "The daily digest", "Retention") and
   `PROVENANCE.md`, "Inbox, preferences and the digest":
   - Schema: `Notification.readAt`, `archivedAt` (Done), `workItemId` (`ON DELETE SET NULL
     ("workItemId")`); `NotificationPreference` (per member and type, `inApp`, `emailDelivery`
     `OFF`/`IMMEDIATE`/`DAILY`, a CHECK keeping IMMEDIATE to assigned and waiting on, cascading with
     the membership; RLS, grants, two-tenant test); `EmailNotificationType` gains
     `WORK_ITEM_WAITING_ON` and `NOTIFICATION_DIGEST`, each in a migration of its own. Migrations
     `20261204120000_email_type_waiting_on`, `20261204120100_email_type_notification_digest`,
     `20261204120200_inbox_and_preferences`. The drift check passes, residue unchanged.
   - Rules: one pure resolution (`src/lib/notifications/preferences.ts`): the member's choice or
     the type's default, under the workspace's settings, which only narrow. Every bell writer asks
     `isInAppTypeEnabled`, now per recipient in one batch; the immediate emails (assigned, and the
     new waiting-on email) ask `emailDeliveryFor`. DAILY needs the bell on, except for due dates.
   - API: `GET /notifications?view=unread|all|done` (cursor pages, `unreadCount`; the bell's call
     without `view` unchanged but leaving Done out), `PATCH /notifications/:id { read?, done? }`,
     `POST /notifications/bulk`, `GET`/`PUT /notification-preferences` (audited). No permission key:
     each member's own rows.
   - Jobs: `notification-digest` (08:10 in `NOTIFICATIONS_TZ`; re-checks liveness, visibility and
     `intake.view`; never a description or comment; deduplicated per address and day) and
     `notification-purge` (03:10 UTC; Done after 90 days, read after 180, unread kept). 1.6's due
     digest had no caller and no schedule: `digest-dispatcher.ts`, its template and tests are
     removed, `DUE_DIGEST` stays in the enum with a `never` payload, nothing to retire from the
     scheduler.
   - UI: the Inbox page (Unread, All, Done tabs, a kind filter, read/unread, Done through the undo
     toast, "Mark all read", J/K/E/U within the list), Inbox → Notification preferences (the grid,
     caps shown with their reason), Settings → Notifications over 1.6's API (admins only, asked on
     the server).
   - Not built, as the map planned but the brief did not ask: `Notification.actorUserId` and an
     actor avatar per row, opening a row in the detail sheet (a row follows its link).
   The brief cited decisions 135 (Inbox), 136 (retention) and 139 (Settings → Notifications); in
   this file they are 134, 135 and 136 (139 is the recipient-list copy rule). The build follows the
   decisions' text.
   2.7c merged as #58. **2.7d (mentions, decisions 127 to 131) is built** on branch `wt/p27d`, on
   top of 2.7c, per `docs/work-items.md` ("Mentions (2.7d)") and `docs/notifications.md`
   ("Mentions"); written fresh, no `PROVENANCE.md` row:
   - Schema: `Mention` (one row per source and person, `commentId` NULL for the description; two
     partial uniques; cascading with the item, the comment and the membership; RLS, grants,
     two-tenant test); `NotificationType.WORK_ITEM_MENTIONED` and
     `EmailNotificationType.WORK_ITEM_MENTIONED`, each in a migration of its own; the preference
     CHECK widened to allow IMMEDIATE for mentions. Migrations
     `20261205120000_notification_type_mentioned`, `20261205120100_email_type_mentioned`,
     `20261205120200_mentions`. The drift check passes, residue unchanged.
   - Rules: the pure grammar `src/app-layer/domain/mention.ts`; `recordMentionsInTx` in a person's
     own comment add or edit, description edit, or create naming a description (never intake
     accept, templates or repeat copies; never an API key, an agent or the system user); only
     ACTIVE members with `work_items.view` who see the project, dropped silently otherwise; an edit
     notifies only the people it adds; the newly mentioned become watchers (`reason: 'mentioned'`);
     audited `WORK_ITEM_MENTIONED` / `WORK_ITEM_MENTIONS_REMOVED`, ids only. The rows, not the
     text, decide which tokens render as chips.
   - Notifications: the `WORK_ITEM_MENTIONED` bell and IMMEDIATE email (the default; offered and
     CHECKed), after the commit, who and which item with a link, never the text; the comment's
     watcher fan-out skips the people it mentioned; DAILY lists the bell row in the digest.
   - UI: the `@` picker (`MentionTextarea`) on the comment box and editor, the description editor
     and the create dialog's description; chips and key links (`MentionText`) on comments, the
     description and the pinned answer; the description is shown rendered and edited on request
     ("Edit description"). No new route or key.
   2.7d merged as #59. **2.7e (recipient lists, decisions 79 and 138 to 142) is built** on branch
   `wt/p27e`, on top of 2.7d, per `docs/work-items.md` ("Recipient lists (2.7e)"),
   `docs/notifications.md` ("Recipient lists (2.7e)") and `docs/intake.md`; written fresh, no
   `PROVENANCE.md` row (inflect-compliance has no distribution lists):
   - Schema: `RecipientList` (a workspace list, `projectId` NULL, or one project's; the name
     unique in its scope by two partial uniques, archived lists included; length CHECKs; no
     DELETE for `app_user`, decision 141) and `RecipientListMember` (the membership FK cascades,
     so a removed member leaves every list); `ProjectIntake.recipientListId` (`ON DELETE SET
     NULL ("recipientListId")`). RLS, grants, a two-tenant test for both tables. Migration
     `20261206120000_recipient_lists`. The drift check passes, residue unchanged.
   - Rules: one send-time resolver, `resolveListRecipients`
     (`src/app-layer/notifications/recipient-list.ts`): a live workspace (it joins the liveness
     census), a live list of the workspace or the named project, an ACTIVE member whose
     permissions hold what the caller asks and whose role sees the project, each person once.
     Adding a list to an item's watchers copies the people it resolves to (decision 139);
     a project's intake bell rings the union of its member rows and its list, `intake.view`
     holders only, never the sender (decision 142). The intake's member rows are now held to
     the project's visibility too; no built-in role that holds `intake.view` is affected.
   - API: workspace lists under `/recipient-lists/…` (`admin.manage`), a project's under
     `/projects/:id/recipient-lists/…` (`projects.edit`), both read under `projects.view`
     (decision 140): list, create, read, rename, set (`PUT`) or change (`PATCH { add, remove }`)
     the people, archive, restore; `POST /work-items/:id/watchers/recipient-list`
     (`work_items.edit`); `PUT /projects/:id/intake` takes `recipientListId`. Every write
     audited (`RECIPIENT_LIST_*`, `WORK_ITEM_WATCHERS_ADDED_FROM_LIST`).
   - UI: Settings → Recipient lists; a project's lists, linked from the project page and from
     Settings → Projects; removing a person goes through the undo toast; archiving is sent at
     once (not a delete); the watchers panel's "Add recipient list"; Settings → Intake's list
     picker.
   - Deviations from the map, none of them a new decision: the routes are split by scope
     (the map had one set whose usecase asserted the scope's key), the intake column is
     `recipientListId` (the map's `notifyListId`), and archiving is not behind a typed
     confirmation (the brief: archiving is not a delete).
   2.7e merged as #61. **2.7f (search over descriptions and comments, decisions 124, 126 and 145
   to 147) is built** on branch `wt/p27f`, on top of 2.7e, per `docs/search.md`, ADR 0008 and
   ADR 0007 E10; written fresh, with the dictionary recorded in `PROVENANCE.md` and `NOTICE`:
   - Licence (stopped for the owner, decided as 145): the LibreOffice `bg_BG` ships only the
     GPL-2.0 text, so the source is bgOffice's OOo-spell-bg 4.3 (`Copyright_spell`: GPL-2.0+ or
     LGPL-2.1+ or MPL-1.1), taken under MPL-1.1, used under MPL-2.0 by §6.2, re-encoded to UTF-8
     only (`deploy/postgres/convert-bgoffice.sh` reproduces it). ADR 0007 E10 admits that file set;
     `deploy/postgres/dictionary.json` and `tests/guards/postgres-dictionary-pinned.test.ts` hold it.
   - Image (146): `deploy/postgres/Dockerfile` (pgvector by digest + the two files, hash-checked);
     `release.yml` publishes `ghcr.io/rodnapamet/islestone-postgres:17-0.8.7-bg4.3-r1` once;
     production names that tag with the `POSTGRES-IMAGE-DIGEST-PENDING` marker until the first
     publish, then the tag and its digest (a follow-up PR; `postgres-image-pinning.test.ts`);
     `docker-compose.yml` builds it; CI's Integration, E2E and DAST run it through
     `scripts/ci-postgres.sh` (no `services:` Postgres any more).
   - Schema: migration `20261207120000_search_configuration` (the dictionary and `islestone_bg_en`,
     failing closed with a named error on the stock image, 17 fixtures asserted; 2.7b's two
     `simple` full-text indexes rebuilt on it) and `20261207120100_search_vectors` (`SearchVector`:
     one row per description or comment by two partial uniques, a tenant-leading GIN partial on
     the configuration, a CHECK on `configName` and `revision`, cascades from the workspace, the
     item and the comment; RLS, grants, a two-tenant test). The drift check passes, residue
     unchanged (the GIN index is partial so Prisma ignores it; Prisma cannot declare a GIN that
     leads with a text column).
   - Write path: `SearchVectorRepository.replaceForSource` in `createWorkItemInTx`,
     `insertTemplateItemInTx`, `updateWorkItem`, `addComment`, `editComment`; `removeForSource`
     in `deleteComment`; mention tokens stripped; `tests/guards/search-vector-write-seam.test.ts`
     finds every writer by AST.
   - Reads: `/api/t/:slug/search` adds description and comment hits (`matchedIn`, a snippet for
     the best five, below title hits); the list's `q` also matches stemmed titles and the vectors.
   - Jobs and checks: `search-index-rebuild` (02:40 nightly; on demand through
     `POST /api/t/:slug/admin/search-index/rebuild`, `admin.manage`); the startup checks in the app
     and the worker and `/api/readyz`'s `search` check.
   - Measured: about 9.3 MB per backend that loads the dictionary, ~100 ms first use; no memory
     limit changed.
   - Not built: the palette's "still being indexed" notice from the map (the backfill is the nightly
     job or an admin's request).
   - **Before merging, the operator step of decision 147** (`docs/deployment.md`, "The Postgres
     image"): pin the running build, merge, wait for the publish, apply, unpin. After the first
     publish, pin the digest in `deploy/docker-compose.prod.yml` and remove the marker.
   **2.8a (review rounds, steps and responses; decisions 148 to 165) is built** on branch `wt/p28`, per ADR 0009, `docs/porting/maps/2.8.md` and `docs/work-items.md`, "Reviews (2.8a)"; written fresh, four inflect-compliance patterns recorded as pattern only in `PROVENANCE.md`:
   - Schema: `prisma/schema/reviews.prisma` (`WorkItemReviewRound`, `WorkItemReviewStep`, `WorkItemReviewStepList`, `WorkItemReviewer`), migrations `20261208120000` to `20261208120500` (the four `NotificationType` and two `EmailNotificationType` values, each alone) and `20261208120600_reviews` (the tables, one live round per item and one open step per round, the CHECKs, the triggers that keep an ended round and a completed step's responses from being rewritten, the re-wrap admitted, RLS and grants with no DELETE on rounds or reviewer rows, the preference CHECK widened). The drift check passes, residue unchanged.
   - Choices no decision names, each recorded in ADR 0009 or `docs/work-items.md`: decision 158 is held at both points the map suggested (the edit and the response) and on an assignee change; in an "any" step the first response decides it either way; a step that opens later with nobody to ask opens flagged and tells the assignee and the sender with the review-requested type ("no reviewers left") rather than failing the response that opened it; removing a pending reviewer from an open step takes the skip's standing (it can complete the step); a person may add a reviewer to an open step (`POST …/reviewers`), and one withdrawn from a step is not added back to it; a withdrawn round, by a person or by a close, sets no waiting on; returned emails default to immediate as requested ones do; the `reviewerId` list filter ships in 2.8a.
   - Not built here, by decision 165: the detail's review section, the list column and card mark and My Work's "To review" (2.8b; the preferences page already lists the four review types, from `PREFERENCE_TYPES`); defaults per type and the Done check (2.8c).
   **2.8b (the review UI; decisions 148 to 165) is built** on branch `wt/p28b`, per `docs/porting/maps/2.8.md` (its 2.8b part) and `docs/work-items.md`, "Reviews (2.8b)"; written fresh:
   - The detail's "Review steps" section (`detail/ReviewSteps.tsx`, page and sheet, on the Overview) and its data hook (`data/use-review.ts`): the live round's steps with reviewers, statuses, due days and responses; the step editor (one step at a time: members and recipient lists, all or any, working days; reorder and remove); Send for review; Sign off and Return (text required to Return), and a response changed while its step is open; skip and close; withdraw; add a reviewer, and remove a pending one through the undo toast (`SITE_CONTRACTS`); "changed since signed off"; the earlier rounds folded and read-only; while a round is open the detail's waiting on names its reviewers, read-only. Every button follows the GET's `viewer`; every write that names the round sends `If-Match` (the shared-query guard extended to hold it).
   - The list and the board: `toWorkItemDto` carries `review` (`reviewSummaryOf` over the two newest rounds, added to `workItemListSelect`), shown by the list's `review` column (gear, hidden by default), My Work's sections and the board card's mark (`ReviewBadge`); the `reviewerId` filter ("Reviewer") is in `WORK_ITEM_FILTER_KEYS`, the saved-view `FilterKey` and `LIST_FILTER_KEYS`.
   - My Work's "To review" (`reviewerId=me`), first of six sections, with its count, empty state and "Load more".
   - Server changes, each with its tests: the row's `review` summary; `reviewAffordances().editSteps` offered whenever the caller edits work items (it was only with a live round, so a completed round, or one withdrawn when the item closed, could not be followed by a new one from the UI); the client shapes of the review response in `src/lib/work-items/types.ts`, which `WorkItemReviewDto` now extends so `tsc` holds the two equal.
   - Choices no decision names: "changed since signed off" marks a sign-off only while its round is open (an ended round's own end writes waiting on, so the version cannot say whether the work changed); "To review" is first and in manual order (the list has no sort by a step's due day; the row shows it); the review column is hidden by default in the list and shown in My Work; the board has a mark and no lane; the step editor edits one step and removing a step is its own action through the undo toast; adding a reviewer to an open step offers the roster without filtering the assignee (the server refuses, `REVIEWER_IS_ASSIGNEE`); no keyboard shortcut was added, so the shortcut help is unchanged; the Inbox and preferences already listed the four review types.
   - Not built here, by decision 165: defaults per type and the Done check (2.8c).
   - Verified on the branch: `npm run verify` (lint, typecheck, 565 Jest suites with 7,494 tests, 35 script tests, the licence gate); the integration suite in band on a fresh database (89 suites, 1,170 tests); the built app's E2E specs `reviews`, `work-items`, `work-items-api`, `questions`, `repeats`, `inbox`, `recipient-lists` and `app-shell` (20 tests).
   **2.8c (default review steps per type and the Done check; decisions 149, 158, 159, 160) is built** on branch `wt/p28c`, per `docs/porting/maps/2.8.md` (its 2.8c part) and `docs/work-items.md`, "Reviews (2.8c)"; written fresh:
   - Schema: migration `20261209120000_type_review_steps`: `WorkItemType.reviewRequiredForDone`, `WorkItemTypeReviewStep` and `WorkItemTypeReviewStepReviewer` (a member by the cascading membership FK, or a workspace list; exactly one by CHECK), the CHECKs on name, days and position, RLS and grants (DELETE held: the set is replaced whole). No enum value was added. The drift check passes, residue unchanged.
   - API: `GET`/`PUT /work-item-types/:typeId/review-steps` (`projects.view` / `admin.manage`), `review-defaults.ts`; audited `WORK_ITEM_TYPE_REVIEW_STEPS_SET`.
   - Copying: `copyTypeReviewDefaultsInTx` in `createWorkItemInTx` and `insertTemplateItemInTx`, so every create path (dialog and API, template sub-items, project-template starter items, intake accept, repeat copies) makes round 1 `PLANNED`; `tests/guards/review-defaults-copy-paths.test.ts`.
   - The Done check: `assertReviewAllowsDone` in `setWorkItemState`, `bulkSetWorkItemState`, `moveWorkItemOnBoard` and `markWorkItemAnswer`, `assertReviewAllowsDoneInState` in a state's delete, and the copy refusing a create into Done; 409 `REVIEW_INCOMPLETE` from the pure `reviewHoldsDone`; `tests/guards/review-done-paths.test.ts`.
   - UI: Settings → a type → Review steps (`settings/work-item-types/[typeId]/review-steps`, `WorkItemTypeReviewStepsSettings`; 2.8b's step editor reused with the workspace's lists only; removal through the undo toast, `SITE_CONTRACTS`), a Review column on the types list and a link on a type's fields page. The board, the detail and bulk already rolled a non-version 409 back with the server's sentence; tests now hold it for this refusal.
   - Choices no decision names, each recorded in `docs/work-items.md`, "Reviews (2.8c)": the refusal's code is `REVIEW_INCOMPLETE`, decision 149's name; a default naming the item's assignee drops them on the copy (as a list's resolution and an assignee change do; a template, intake or repeat copy cannot be refused for it), and so are members who may not review the item and archived lists, all named in `WORK_ITEM_CREATED`; a step left naming nobody is kept; the review that must finish is the newest round with at least one step, so an item with none, or a planned round emptied of its steps, is not held, while returned and withdrawn rounds hold; a move between two Done states is not held; a create into a Done state is refused when its copied steps would hold it; a state's delete into Done is refused while any item in it (deleted ones included) is held; the check binds everyone, admins and jobs included (no job moves an item into Done; a repeat copy made into a Done default state counts as a failed run, not a hold, since no `RecurrenceHold` value names it); project templates carry no review steps (the map's choice).
   - Verified on the branch: `npm run verify` (lint, typecheck, 568 Jest suites with 7,520 tests, 35 script tests, the licence gate); the integration suite in band on a fresh database (90 suites, 1,202 tests); `npm run db:check-schema-drift`; the built app's E2E specs `type-review-steps`, `reviews`, `work-items`, `settings`, `questions`, `repeats`, `templates`, `intake` and `work-items-api` (16 tests).
