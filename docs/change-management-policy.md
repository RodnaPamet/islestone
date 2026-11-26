# Change management policy

How a change reaches Islestone's production service, and what each kind of
change must carry on its way (sub-phase 1.8). The operational side, the VM,
the scripts and the runbooks, is [`docs/deployment.md`](deployment.md).

Adapted from inflect-compliance's `docs/change-management-policy.md` at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` (PROVENANCE.md): the same three
classes, rollback rule and audit trail, fitted to Islestone's pipeline and to
a repository with one owner.

## How a change reaches production

1. **Pull request.** Every change to `main` is a pull request. `main` is
   protected: a pull request and the CI checks (`Lint`, `Typecheck`, `Test`,
   `Integration`, `Build`, `E2E`, `Licence`, `Shared UI`, `Audit`, `Image`)
   are required, as is `PR title` (the title is a Conventional Commit
   subject; "Versioning" below). This is the last point at which a person or
   a check can stop a change.
2. **Release and publish.** `.github/workflows/release.yml` runs on the merge:
   semantic-release tags a version when the commit subjects call for one, and
   both images are built, scanned and pushed to GHCR (`:sha-<short>`,
   `:<version>`, `:latest`). The Trivy scan blocks (Hardening H1): a
   CRITICAL or HIGH vulnerability with a fix available stops the run before
   any push, so `:latest` stays on the last image that passed. The `Image`
   check on the pull request runs the same scan first, and the nightly ZAP
   baseline fails on any unexcused alert (`docs/deployment.md`, "Security
   scans").
3. **Roll-out.** Watchtower on the VM follows `:latest` and rolls `app`,
   `worker` and `migrate` within minutes; the migrations run before the new
   code serves (`docs/deployment.md`, "How an image reaches production").
4. **Structure.** A change to the stack itself (`deploy/`, the compose file,
   the Caddy site) is merged the same way, then applied by an operator with
   `deploy/apply.sh`, which preflights by default and applies with
   `CONFIRM=1`.

There is **no staging environment and no preview deployment** (owner
decision 43, 2026-11-19), and no approval between merge and production: a
merge is a release within the time it takes to publish the images and for
Watchtower to notice them. The pull request's review and checks are the gate.

## Scope

A change under this policy is anything that can affect the production
service: application code, database migrations, the deploy files and
workflows, dependency upgrades, and secret or key rotations. Documentation-only
and test-only changes go through the same pull-request review but are never
SIGNIFICANT.

## Change classes

| Class | What it is | What it carries |
|---|---|---|
| **STANDARD** | Routine, covered by the automated checks. Most changes. | A reviewed pull request with every required check green. |
| **SIGNIFICANT** | A schema migration (anything under `prisma/migrations/`); a change to security middleware or the security perimeter (`src/middleware.ts`, `src/lib/security/`, `src/lib/auth/`, the CSP, rate limits, encryption); a change to the deploy files, the Dockerfile or the release workflow; a dependency major bump; a data backfill that crosses workspaces. | STANDARD, plus a **rollback plan** and a **risk assessment** in the pull request description, and the owner's review (below). |
| **EMERGENCY** | An active production incident where the standard path would extend the harm. | Declared by the owner. The fix still goes through a pull request and the required checks; it may be merged before a full review, and a retrospective pull request follows within 5 working days. |

A pull request that mixes classes is classified by its most significant part.

## Approval

Islestone has one owner, who reviews and merges. Assistant-driven pull
requests (Claude Code sessions) are reviewed by the owner or by the
orchestrating session the owner runs; neither approves its own change.

| Change | Approver |
|---|---|
| STANDARD | The pull request's reviewer |
| SIGNIFICANT | The owner, after reading the rollback plan and the risk assessment |
| A VM change outside the repository (DNS, GHCR credentials, `.env.prod`, Agrent's Caddy, a restore) | The owner, who runs it or approves the orchestrator running it |
| A secret or key rotation | The owner; the runbook is `docs/encryption.md` for the encryption keys |
| An owner decision (anything `docs/HANDOFF.md` lists as open) | The owner, recorded in `docs/HANDOFF.md` and, where one exists, the ADR |

## Emergency procedure

1. The owner declares the emergency and names what is broken.
2. The fix is cut on a branch named `emergency/<short-description>` with the
   smallest change that stops the harm. A rollback by image tag
   (`ISLESTONE_IMAGE_TAG`, `docs/deployment.md`, "Rollback") is often that
   change, and needs no code.
3. The pull request runs the required checks like any other. No check is
   skipped and no merge bypasses branch protection.
4. Within 5 working days a retrospective pull request
   (`chore(retro): <emergency PR>`) records what happened, what the standard
   path would have cost, and the test or guard that keeps it from recurring.

## Rollback

- **Application: roll back by image.** Every publish keeps its immutable
  `:sha-<short>` and version tags. Set `ISLESTONE_IMAGE_TAG` to an earlier one
  and run `deploy/apply.sh`; app, worker and migrate run that build until it
  is emptied. A revert merged as a pull request also works, but builds a new
  image.
- **Migrations go forward only.** A migration that breaks production is fixed
  by a new migration. A down-migration against live data is the larger risk,
  and none is ever written. Write migrations so the previous image keeps
  working against the new schema (add before you remove; remove in a later
  release), so that rolling the image back stays possible.
- **The decision**: if the previous image works against the current schema,
  roll the image back; otherwise fix forward.
- **Structure**: revert the change in the repository and apply again;
  `deploy/apply.sh` keeps the previous files in
  `/opt/islestone/backups/config-<timestamp>/`.

## Audit trail

- **Every change** is a pull request with its review and its CI run, kept by
  GitHub.
- **What reached production** is the `release.yml` run for the merge commit:
  the images are tagged with the commit (`sha-<short>`) and report it as
  `version` from `/api/readyz`; the release, when there is one, is a GitHub
  Release with notes generated from the commit subjects.
- **SIGNIFICANT** changes carry their rollback plan and risk assessment in the
  pull request description.
- **VM operations** are run through `deploy/apply.sh`, `deploy/check-drift.sh`
  and `deploy/backup.sh`, whose output is the record; restore drills are
  logged in `docs/deployment.md`.

## Versioning

**Pull request titles follow Conventional Commits** (owner decision 51,
2026-11-19). Pull requests are squash-merged with the title as the commit
subject, and semantic-release reads those subjects on `main`:

```
type(scope)!: subject
```

| Type | Use | Release |
|---|---|---|
| `feat` | A capability users or operators can see | minor |
| `fix` | A defect fixed | patch |
| `perf` | Faster, same behaviour | patch |
| `refactor` | Restructured, same behaviour | none |
| `revert` | A previous change undone | none |
| `docs` | Documentation only | none |
| `test` | Tests only | none |
| `build` | The build, the images, dependencies | none |
| `ci` | Workflows | none |
| `chore` | Anything else that ships no behaviour | none |
| `style` | Formatting only | none |

The scope is optional, lower case, and may name a sub-phase or an area
(`feat(1.8): …`, `fix(deploy): …`). A `!` before the colon marks a breaking
change and makes a major release. The whole title is at most 100 characters.
The `PR title` check (`.github/workflows/pr-title.yml`, runs when a pull
request is opened, edited or pushed to) fails a title that does not match
`scripts/check-pr-title.mjs`. Titles before the rule (`1.7: …`) made no
release; every merge still publishes `:sha-<short>` and `:latest`.

## Open questions

- Customer notice for SIGNIFICANT changes that alter behaviour customers see:
  none is promised beyond the GitHub Releases.
- A second reviewer for SIGNIFICANT changes once Islestone has more than one
  engineer.
