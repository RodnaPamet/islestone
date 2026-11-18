# Provenance fragment: shared UI (roadmap 1.2, part A)

This fragment is to be merged into `PROVENANCE.md` when sub-phase 0.3 creates that file.

- **Source:** inflect-compliance at commit `5528464fc54a8681956f3b9ce23ca9c075f0420e`.
- **Path:** every row below is under `packages/ui/` at that commit.
- **Hashes:** `packages/ui/UPSTREAM.json` records the sha256 of every file, and which
  files are executable (none).
- **Changes:** none, in every row. The copy is byte for byte.
  `node scripts/ui-drift.mjs verify` fails on any change to a file, and
  `node scripts/ui-drift.mjs audit` fails on any manifest that does not match the
  package at the commit above (see `docs/porting/shared-ui.md`, "Verify and audit").

| Component | Source path | Commit | Licence | What was taken | Changes |
|---|---|---|---|---|---|
| `@inflect/ui` package shell | `packages/ui/{README.md, package.json, tsconfig.json, tokens.contract.css, src/index.ts}` | `5528464fc54a` | BUSL-1.1, licensor Inflect Ltd. (see the open question on the BUSL grant) | 5 files: manifest, boundary tsconfig, the 47-name token contract, the empty index | None. The README, index and description are stale upstream; see `docs/porting/shared-ui.md` |
| Flat primitives | `packages/ui/src/components/ui/*.{ts,tsx}` | `5528464fc54a` | BUSL-1.1 | 10 files: button, button-variants, card, card-variants, empty-state, error-state, hit-area, skeleton, tooltip, typography | None |
| Charts | `packages/ui/src/components/ui/charts/` | `5528464fc54a` | BUSL-1.1 | 22 files: visx series, axes, legend, tooltip, gradients, 3D stub, layout utilities | None. 11 are classified `MIXED` upstream (compliance or product wording in comments and examples) |
| UI hooks | `packages/ui/src/components/ui/hooks/` | `5528464fc54a` | BUSL-1.1 | 23 files: 21 hooks, 1 co-located test, 1 README | None. The README is stale upstream |
| Utilities | `packages/ui/src/lib/{cn,format-date,number-format}.ts` | `5528464fc54a` | BUSL-1.1 | 3 files | None. `number-format.ts` says it replaced a function "pulled from the `Dub utils` shim" |
| Icons (non-Nucleo) | `packages/ui/src/components/ui/icons/` (except `nucleo/`) | `5528464fc54a` | BUSL-1.1 as inflect ships them. **Origin unverified**; see the open questions | 63 files: brand marks, continents, default-domain logos, loaders, small glyphs | None |
| **Nucleo icons** | `packages/ui/src/components/ui/icons/nucleo/` | `5528464fc54a` | **Nucleo proprietary licence, not BUSL-1.1.** The bundled README reads: "Redistribution of icons is prohibited. Icons are restricted for use only within the product they are bundled with" (nucleoapp.com/license) | 271 files: 270 icon components plus the Nucleo README | None |

## Islestone's own code (not a port)

| Component | Path | Origin |
|---|---|---|
| Drift check | `scripts/ui-drift.mjs`, `tests/unit/ui-drift.test.mjs` | Written for Islestone. It follows the hash-synced copy model that inflect describes in `docs/shared-ui-policy.md` ("For a consumer"). No code was copied: inflect has no consumer-side sync script, and playerz.bg's `scripts/ui-sync` was not read. |

## Open questions for the owner, to settle before this is committed or shipped

1. **Nucleo (blocks shipping).**
   - The notice limits the icons to "the product they are bundled with".
   - Islestone is a different product from inflect-compliance.
   - inflect-compliance records no Nucleo licence held by Inflect Ltd. Its `NOTICE`,
     `LICENSING.md` and `docs/attributions.md` do not mention Nucleo, and git history
     cannot show the files' origin because the local clone is shallow.

   The options are:
   - Confirm a Nucleo licence that covers Islestone.
   - Remove or replace the Nucleo icons **upstream** in inflect-compliance, then sync.
     A local deletion would break byte identity and fail `verify`.

   The same question applies to inflect-compliance itself if the icons arrived with
   code adapted from another product.
2. **Dub origin (unverified).** inflect's own documents record that parts of this UI
   were adapted from Dub (dub.co):
   - "Dub-originated" presets
   - the "`Dub utils` shim"
   - the "de-Dub" cleanup (#829)
   - a barrel that re-exported "the upstream pricing-plan map"

   The non-Nucleo icon names (continents, default-domain logos, `crown-small`,
   `matrix-lines`) and the Nucleo README itself match Dub's icon set. Dub's
   repository licence could not be read from this session (the repository is not
   reachable here); it is believed to be AGPL-3.0, which is **unverified**.

   Before shipping, re-read Dub's LICENSE at the relevant commit. Then establish which
   files in this package derive from Dub, and under which licence. Roadmap section 2.5
   treats AGPL code as "do not copy".
3. **BUSL-1.1 grant.** Islestone's use of every BUSL-1.1 row depends on the written
   grant from Inflect Ltd. in roadmap sub-phase 0.1. Record that grant's reference here
   when it exists.
