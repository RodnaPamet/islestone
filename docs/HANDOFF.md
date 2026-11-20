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
| 23 | Search versus encryption: S1 now (titles, keys and unencrypted fields), until a search ADR, due before roadmap 2.7, chooses between S2 and S3. Decided 2026-11-19. | "S1 now, decide later" | ADR 0002 section 11 |
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
| 76 | Waiting on: a work item names who must act next, apart from its assignee, who stays the one accountable person (ADR 0003 §1); a column, filter and swimlane, a "waiting on me" section in My Work, and time waiting per party in analytics. From the Procore audit (top idea #1). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row; the word is open. | relayed | `docs/ROADMAP.md` 2.4b, 2.7, 3.6 (and section 2.6); `docs/research/procore-audit.md` |
| 77 | Field sets: per work item type, which built-in and custom fields are required, optional or hidden, enforced in the usecase, and checked when an agent proposes. From the Procore audit (top idea #2). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0002 §1 amendment ("Types carry no behaviour") and an ADR 0006 row; the word is open. | relayed | `docs/ROADMAP.md` 2.4b, 6.2 (and section 2.6); `docs/research/procore-audit.md` |
| 78 | Questions: a Question type whose one comment a person marks as the answer, and an agent that drafts answers citing item, page and file ids, as proposals. From the Procore audit (top idea #3). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row for the answer; the word is open. | relayed | `docs/ROADMAP.md` 2.4b (type and answer), 7.8 (the agent) (and section 2.6); `docs/research/procore-audit.md` |
| 79 | Distribution groups: named sets of people to notify, added to an item's watchers in one step and named as recipients by reviews, checklists, automation, reports and minutes, with preferences and visibility re-checked at send time. From the Procore audit (top idea #4). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row ("Group" is SCIM's word); the word is open. | relayed | `docs/ROADMAP.md` 2.7, 5.1 (and section 2.6); `docs/research/procore-audit.md` |
| 80 | Review steps: sequential or parallel reviewers on a work item, a returned review opening a new round that keeps the earlier one rather than rewinding it; only people review, never an agent. From the Procore audit (top idea #5). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0002 §3 amendment ("No reviewer gate") or a new ADR, and ADR 0006 rows; the words are open. | relayed | `docs/ROADMAP.md` 2.8 (new), 5.1 (and section 2.6); `docs/research/procore-audit.md` |
| 81 | Checklist runs: defined pass/fail checks run against a project or item, whose failed checks open linked work items, with optional sign-offs and a PDF record. From the Procore audit (top idea #6). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows ("Checklist item" is banned for sub-item); the words are open. | relayed | `docs/ROADMAP.md` 4.5 (new) (and section 2.6); `docs/research/procore-audit.md` |
| 82 | Periodic structured reports: sections computed by code, sections people fill, an agent's draft summary from the computed facts only, filed by a person and sent to a distribution group. From the Procore audit (top idea #7). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs an ADR 0006 row ("Report" is banned for view); the word is open. | relayed | `docs/ROADMAP.md` 7.4 (and section 2.6); `docs/research/procore-audit.md` |
| 83 | Meeting series: an agenda linked to work items, open points carried into the next meeting, minutes sent to a distribution group, and a home for 7.6's proposals. From the Procore audit (top idea #9). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows; the words are open. | relayed | `docs/ROADMAP.md` 7.6 (and section 2.6); `docs/research/procore-audit.md` |
| 84 | Project roles per area for guests, a subset project admins may grant, and a tag naming the outside firm a guest belongs to. From the Procore audit (top idea #10). Decided 2026-11-20, relayed. Adopted into the roadmap; not built. Needs ADR 0006 rows ("Company" and "Collaborator" are banned); the words are open. | relayed | `docs/ROADMAP.md` 8.4 (and section 2.6); `docs/research/procore-audit.md` |

Rows 62 to 75 are reserved for sub-phase 2.5's open questions, which another branch records. Rows 76 to 84 are the ideas the owner adopted from the Procore audit, all of its top ten but #8 (event triggers for delegate agents and a search skill), which 6.3 and a search skill already plan. None changes an ADR yet: each sub-phase lists the amendments it needs and its proposed words as open questions, decided when it starts.

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
