# Architecture decision records

Each ADR records one decision: the context, the options, the decision, its consequences and what would change it. An ADR is **Proposed** until the owner has made each of its decisions; it is then **Accepted**. A Proposed ADR may already record some owner decisions in place; its status line names them. A later ADR that replaces one marks the old one **Superseded by NNNN**. If a roadmap step would contradict an ADR, stop and ask (roadmap section 4).

## Index

| No. | Title | Status | Roadmap item |
|---|---|---|---|
| [0001](0001-code-provenance-and-licences.md) | Code provenance and licences | Accepted (owner decisions, 2026-11-18): copying from inflect-compliance allowed (D1), BUSL-1.1 (D2), tldraw 3.x with the watermark (D3), Dub-derived UI and Nucleo icons copied as is, risk accepted (D4); D3's note for 4.1's Tiptap 3 (ADR 0015, 2026-11-27) | 0.1 |
| [0002](0002-work-item-model.md) | Work item model | Accepted (owner decisions, 2026-11-19): search titles, keys and unencrypted fields until a search ADR chooses (S1), in-house fractional index (F1), 30-day soft-delete window, depth caps of 5 sub-item and 3 goal levels, a sub-item never moves to another project on its own; amended for review steps (§1, §3, §14) by decisions 148 to 165, 2026-11-20, and for scheduling (§6 blocks as finish-to-start, §16 the project's due date) by decisions 183, 188 and 200, 2026-11-20, and for goals (§2 an item's direct goal, health and the lifecycle; §17 goals, initiatives and progress, soft delete and the purge) by decisions 205 to 224, 2026-11-21, and for analytics (§14, the record's `fromStateCategory`) by decision 310, 2026-11-27, and for documents (§11 and §12: `Comment` and `Mention` with a page parent, `WorkItemLink` type `PAGE`, descriptions and comments as rich text, ADR 0015) by decisions 340, 353 to 356, 2026-11-27 | 0.2 (for 2.1–2.4, 2.7, 2.8, 3.1, 3.2, 4.1) |
| [0003](0003-assignee-and-delegate.md) | Assignee and delegate | Proposed — awaiting owner sign-off. Open questions 8 (a session started by someone else runs at once), 9 (no rung cap) and 10 (such a session's writes go to the assignee as proposals at every rung), and no agent risk tier, decided 2026-11-18; "an agent never reviews" (§4) decided 2026-11-20 (decision 164); pages read through read tools and changed by proposal (§4) by ADR 0015, 2026-11-27 | 0.2 (for 6.1–6.3) |
| [0004](0004-authentication-path.md) | Authentication path | Accepted (owner decisions, 2026-11-19): port NextAuth v4 (A1); SSO and SCIM wait for 8.3 (A2); exit thresholds as written (A4); fail-open on a database error kept (A5 item 6). Open questions 5 to 7 open, not blocking | 0.2 (for 1.4, 9.3) |
| [0005](0005-data-sync-strategy.md) | Data sync strategy | Accepted (owner decisions, 2026-11-19): no sync engine now (E0), canvas C1 and T1, TanStack Query, presence R1, encrypted Yjs state, the stated audit window and limits, the new words. Open questions 8 and 9 open, not blocking; amended for 4.1 by decisions 345, 348, 359 and 360, 2026-11-27 (HTML rendered at use, versions as content JSON, one instance, the notices published from 4.1; ADR 0015) | 0.2 (for 2.3, 4.1–4.3, 9.3) |
| [0006](0006-vocabulary.md) | Vocabulary | Proposed — awaiting owner sign-off. The roles (Owner, Admin, Member, Viewer, Guest), their order, the Viewer fallback and the sign-up switch decided 2026-11-18; the sync and collaboration words from ADR 0005 decided 2026-11-19; the planning words of 2.5, the intake words of 2.6 the search, inbox and mention words of 2.7 and the review words of 2.8 and the scheduling words of 3.1 decided 2026-11-20; the goal and roadmap words of 3.2 and the calendar sync words of 3.3 decided 2026-11-21; the time, workload and analytics words of 3.4 to 3.6 decided 2026-11-26 and 2026-11-27; the page words of 4.1 decided 2026-11-27 (decision 338) | 0.2 (for 1.3 onward) |
| [0007](0007-third-party-licence-exceptions.md) | Third-party licence exceptions | Accepted (owner decisions, 2026-11-18 and 2026-11-19; E10, the Bulgarian dictionary under MPL-2.0, decision 145, 2026-11-20) | 0.3, H0, 2.7f |
| [0008](0008-search-over-encrypted-fields.md) | Search over encrypted fields | Accepted (owner decisions 124 to 126 and 145 to 147, 2026-11-20): a plaintext full-text index over work-item descriptions and comments (S2), Bulgarian and English stemming in one custom configuration (fail closed without the dictionary), the token key moot; intake, template, project-template and personal fields excluded; the bgOffice dictionary, Islestone's Postgres image and its rollout; amended for 4.1 by decisions 340 and 347, 2026-11-27 (pages searched through `PageSearchVector`; descriptions and comments vectorised from their rich text's projection) | 2.7, 4.1 (and 6.5 by amendment) |
| [0009](0009-review-steps.md) | Review steps | Accepted (owner decisions 148 to 165, 2026-11-20): rounds, ordered steps and reviewers on a work item; Signed off and Returned; an indicator with a per-type Done check; lists resolved when a step opens; never the assignee as a reviewer (158); a response changeable until its step completes (162); only people review; §13 amended for working calendars by decisions 191 and 192 (ADR 0010) | 2.8 |
| [0010](0010-scheduling-and-working-calendars.md) | Scheduling and working calendars | Accepted (owner decisions 182 to 203, 2026-11-20): one pure engine over date-only days; blocks as finish-to-start, no lag; conflicts reported, no stored date moved; milestone and project due dates as deadlines (188, a departure: each project gains a due date); workspace and team working calendars under `admin.manage`; a person's confirmed date change, optionally moving the items it pushes later (194, a departure); SVAR React Gantt 2.8.3, MIT core only, its notice left in its installed licence files (199, a departure) | 3.1 |
| [0011](0011-external-calendar-sync.md) | External calendar sync | Accepted (owner decisions 225 to 244, 2026-11-21): Islestone the source of truth; items' due dates pushed and only a moved day read back, as the member's own edit while unchanged since the last push; milestones pushed read-only (227, a departure); title and a link back (229, a departure) in a calendar of Islestone's own; personal connections an admin enables, through the sign-in apps outside the auth library's seam (236, a departure); tokens under the workspace's key; events deleted before the token | 3.3 |
| [0012](0012-time-tracking.md) | Time tracking, timesheets and billable rates | Accepted (owner decisions 255 to 279, 2026-11-26): estimates per team in points or hours, the other unit kept and uncounted; a time entry a person's own statement on one work item, by hand or one server-side timer, to the minute; weekly timesheets off by default, approved by a holder of `time.approve` other than the person, frozen by the database once submitted; a project, member, workspace rate cascade with effective dates, one currency, per-entry rounding and rates frozen at approval; money only for rate holders; an export in CSV and Excel (275, a departure); never written by an agent, API key or job | 3.4 |
| [0013](0013-workload-and-capacity.md) | Workload and capacity | Accepted (owner decisions 282 to 302, 2026-11-27): a member's capacity in hours a week from a Monday, the workspace's default otherwise, over the working weekdays of their working calendar; time off as hours on each date (286, a departure) with a type, Vacation, Sick or Other (decision 303), encrypted and seen only by the person and workload managers (287, a departure), kept for the workspace's life (289, a departure), never approved and never shaping a schedule; allocation computed on read from remaining hours estimates, points never converted; over capacity reported, never enforced; ways to rebalance opened by a person, never proposals; a `workload` domain; never written by an agent, API key or job | 3.5 |
| [0014](0014-analytics-and-forecasting.md) | Analytics and forecasting | Accepted (owner decisions 309 to 334, 2026-11-27): every measure read from the transition record (which gains `fromStateCategory`), nothing computed stored; completion once, at the last move into Done; cycle time from the first start, lead time from creation, as elapsed working time; time waiting from waiting on and review steps; a pure, seeded Monte Carlo over the daily completions of working days, items only, 50/85/95 percent dates, refusing thin history; calibration published and shown per scope; personal and shared dashboards; an `analytics` domain with per-person time waiting behind `analytics.people`; agents read-only | 3.6 |
| [0015](0015-documents-and-collaboration.md) | Documents and collaboration | Accepted (owner decisions 338 to 373, 2026-11-27): pages in a tree per project and per workspace, ten levels, moved across trees, soft-deleted and purged, never narrower than their tree; the Yjs state the source of truth with encrypted projections and HTML rendered at use, versions as content JSON (departures from ADR 0005 §6.4 and §6.9); pages searched through `PageSearchVector`; toggles, callouts and a table of contents (351, a departure); page comments on `Comment`, anchored, in rich text (356); **work-item descriptions and comments in rich text, converted from plain text and tokens** (340, a departure, replacing decision 127's plain text); one collaboration server with the `access` and `page` notices now (departures from ADR 0005 §6.1 and §4); a `pages` domain; inflect's editor copied, no deny-list entry for `@tiptap-pro/*` (366, a departure); seven pull requests; the six choices under 340 (368 to 373), plain strings accepted for good (372, a departure) | 4.1 |

Planned, not yet written: the ADRs that roadmap 5.4, 6.4 and 7.5 ask for.

## Adding an ADR

- Take the next free number. Never reuse or renumber one.
- File name: `NNNN-short-title.md`, lower case, words joined by hyphens.
- Add its row to the index above in the same pull request.
- The licence gate accepts an exemption only if the ADR it cites exists, names the package and has an Accepted status line (`scripts/licence-gate.mjs`). The status line is the first non-blank line after the `# ` title, as in the template, and nowhere else. It reads `Status: Accepted` once every decision in the ADR is made, optionally followed by ` (…)`, ` — …` or `.`. A status that qualifies the acceptance ("superseded", "in part", "partly", "pending", "awaiting") does not count as Accepted: an ADR accepted only in part stays Proposed and names its decided parts, and a replaced one reads `Status: Superseded by NNNN`.

## Template

```markdown
# NNNN — Title

Status: Proposed — awaiting owner sign-off (YYYY-MM-DD drafted)

## Context

Why a decision is needed now, and the facts it rests on. Mark each fact read in a
named file or registry as **Verified**, with the file and lines (or the version
read), and the date. Anything else is labelled as an inference, a recommendation or
an open question.

## Decision

One section per decision (D1, D2, …). For each:

- the options, each with its consequences;
- **Recommendation:** the option proposed, and why;
- Owner sign-off: ____  Date: ____

Once the owner decides, replace the sign-off line with **Decision:** the option chosen, "Owner decision, YYYY-MM-DD", and the owner's words where given. Say so when the choice differs from the recommendation.

### Open questions for the owner

1. Questions the files could not answer.

## Consequences

What follows once the decisions are taken, good and bad.

## What would change this decision

Events that would reopen it.

## References

- Roadmap sections (`docs/ROADMAP.md`).
- Other ADRs.
- External sources, each with its commit or version.
```
