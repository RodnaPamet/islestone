# Architecture decision records

Each ADR records one decision: the context, the options, the decision, its consequences and what would change it. An ADR is **Proposed** until the owner signs each of its decisions; it is then **Accepted**. A later ADR that replaces one marks the old one **Superseded by NNNN**. If a roadmap step would contradict an ADR, stop and ask (roadmap section 4).

## Index

| No. | Title | Status | Roadmap item |
|---|---|---|---|
| [0001](0001-code-provenance-and-licences.md) | Code provenance and licences | Proposed — awaiting owner sign-off. The owner decided D1 (copying allowed), D2 (BUSL-1.1) and D3 (tldraw 3.x with the watermark) on 2026-11-18; [`docs/HANDOFF.md`](../HANDOFF.md) records them until this ADR does. | 0.1 |
| [0002](0002-work-item-model.md) | Work item model | Proposed — awaiting owner sign-off | 0.2 (for 2.1–2.4, 2.7, 3.2) |
| [0003](0003-assignee-and-delegate.md) | Assignee and delegate | Proposed — awaiting owner sign-off | 0.2 (for 6.1–6.3) |
| [0004](0004-authentication-path.md) | Authentication path | Proposed — awaiting owner sign-off | 0.2 (for 1.4, 9.3) |
| [0005](0005-data-sync-strategy.md) | Data sync strategy | Proposed — awaiting owner sign-off | 0.2 (for 2.3, 4.1–4.3, 9.3) |
| [0006](0006-vocabulary.md) | Vocabulary | Proposed — awaiting owner sign-off | 0.2 (for 1.3 onward) |
| [0007](0007-third-party-licence-exceptions.md) | Third-party licence exceptions | Proposed — awaiting owner sign-off | 0.3, H0 |

Planned, not yet written: a search ADR before roadmap 2.7 (ADR 0002 section 11), and the ADRs that roadmap 5.4, 6.4 and 7.5 ask for.

## Adding an ADR

- Take the next free number. Never reuse or renumber one.
- File name: `NNNN-short-title.md`, lower case, words joined by hyphens.
- Add its row to the index above in the same pull request.
- The licence gate accepts an exemption only if the ADR it cites exists and names the package (`scripts/licence-gate.mjs`).

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
