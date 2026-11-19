# Architecture decision records

Each ADR records one decision: the context, the options, the decision, its consequences and what would change it. An ADR is **Proposed** until the owner has made each of its decisions; it is then **Accepted**. A Proposed ADR may already record some owner decisions in place; its status line names them. A later ADR that replaces one marks the old one **Superseded by NNNN**. If a roadmap step would contradict an ADR, stop and ask (roadmap section 4).

## Index

| No. | Title | Status | Roadmap item |
|---|---|---|---|
| [0001](0001-code-provenance-and-licences.md) | Code provenance and licences | Accepted (owner decisions, 2026-11-18): copying from inflect-compliance allowed (D1), BUSL-1.1 (D2), tldraw 3.x with the watermark (D3), Dub-derived UI and Nucleo icons copied as is, risk accepted (D4) | 0.1 |
| [0002](0002-work-item-model.md) | Work item model | Accepted (owner decisions, 2026-11-19): search titles, keys and unencrypted fields until a search ADR chooses (S1), in-house fractional index (F1), 30-day soft-delete window, depth caps of 5 sub-item and 3 goal levels, a sub-item never moves to another project on its own | 0.2 (for 2.1–2.4, 2.7, 3.2) |
| [0003](0003-assignee-and-delegate.md) | Assignee and delegate | Proposed — awaiting owner sign-off. Open questions 8 (a session started by someone else runs at once), 9 (no rung cap) and 10 (such a session's writes go to the assignee as proposals at every rung), and no agent risk tier, decided 2026-11-18 | 0.2 (for 6.1–6.3) |
| [0004](0004-authentication-path.md) | Authentication path | Accepted (owner decisions, 2026-11-19): port NextAuth v4 (A1); SSO and SCIM wait for 8.3 (A2); exit thresholds as written (A4); fail-open on a database error kept (A5 item 6). Open questions 5 to 7 open, not blocking | 0.2 (for 1.4, 9.3) |
| [0005](0005-data-sync-strategy.md) | Data sync strategy | Accepted (owner decisions, 2026-11-19): no sync engine now (E0), canvas C1 and T1, TanStack Query, presence R1, encrypted Yjs state, the stated audit window and limits, the new words. Open questions 8 and 9 open, not blocking | 0.2 (for 2.3, 4.1–4.3, 9.3) |
| [0006](0006-vocabulary.md) | Vocabulary | Proposed — awaiting owner sign-off. The roles (Owner, Admin, Member, Viewer, Guest), their order, the Viewer fallback and the sign-up switch decided 2026-11-18; the sync and collaboration words from ADR 0005 decided 2026-11-19 | 0.2 (for 1.3 onward) |
| [0007](0007-third-party-licence-exceptions.md) | Third-party licence exceptions | Accepted (owner decisions, 2026-11-18) | 0.3, H0 |

Planned, not yet written: a search ADR before roadmap 2.7 (ADR 0002 section 11), and the ADRs that roadmap 5.4, 6.4 and 7.5 ask for.

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
