# Licensing

Islestone is **source-available**, licensed under the **Business Source License 1.1
(BUSL-1.1)**. The full terms are in [`LICENSE`](./LICENSE); this page is a plain-language
summary, and the `LICENSE` file always governs.

## What you can do

- **Read, fork, modify and self-host** the source.
- **Run it in production to manage your own organization's projects and work**, including
  through consultants or service providers acting solely on your behalf.

## What you can't do without a commercial licence

- Offer the Licensed Work to third parties as a **hosted, managed, embedded or SaaS**
  project-management, work-management, compliance, governance, risk or audit-management
  product or service that **competes** with an Inflect offering.

For a commercial licence, use the contact named in [`LICENSE`](./LICENSE).

## It becomes open source over time

BUSL is not an open-source licence, but it converts to one. Each released version is
relicensed to the **Apache License, Version 2.0** on its **Change Date**, four years after
that version was first made publicly available. Today's code converts by 2030-11-18, and
each later release opens on its own four-year clock.

## Code from elsewhere

Islestone reuses code from inflect-compliance, which is BUSL-1.1 from the same licensor.
Every file taken from another project is recorded in [`PROVENANCE.md`](./PROVENANCE.md),
and attributions that a source requires are in [`NOTICE`](./NOTICE).

Some of that code has third-party origins with their own terms, and those terms are not
replaced by this licence:

- Parts of the shared UI (`packages/ui` and some files under `src/components/ui`) are
  derived from **Dub** (github.com/dubinc/dub), which is licensed **AGPL-3.0**.
- `packages/ui/src/components/ui/icons/nucleo/` holds **Nucleo** icons, whose notice
  prohibits redistribution and use outside the product they are bundled with.

The owner decided on 2026-11-18 to take this code as it is and accept the open licence
risk. The decision and the measurements behind it are in
[`docs/adr/0001-code-provenance-and-licences.md`](./docs/adr/0001-code-provenance-and-licences.md).

## Third-party dependencies

A CI gate (`npm run licence:check`, `scripts/licence-gate.mjs`) fails the build when a
production dependency's licence is not on its allowlist. Exemptions are recorded in
`scripts/licence-exemptions.json`, each citing an ADR.

tldraw (the canvas, roadmap 4.2) is used at major version 3 under its own licence, which
allows commercial production use only with its watermark visible. Do not hide or alter it.
