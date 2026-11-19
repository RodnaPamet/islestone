# `eslint-rules/` — this repo's own ESLint rules

Copied from inflect-compliance `eslint-rules/README.md` at
`5528464fc54a8681956f3b9ce23ca9c075f0420e` (sections up to "Adding a rule";
the parent's per-rule catalogue covers rules Islestone does not have). Sub-phase
1.4 created this directory for `next-auth-single-seam` (ADR 0004 A3) and the
copied `no-request-derived-public-url`.

A structural rule — a banned import, a required prop, a forbidden identifier, a
naming convention — is better as an **ESLint rule** than as a `readFileSync` +
regex guard under `tests/guards/`: an AST rule survives reformatting and
renaming; a regex over source text does not.

## Layout

```
eslint-rules/
  index.js                          the plugin object, registered as `local`
  rules/<rule-name>.js              one rule per file
  __tests__/<rule-name>.test.ts     RuleTester, run by Jest's `node` project
```

A scope that a rule and a guard both need is spelled once. The next-auth seam's
allowlist is `NEXT_AUTH_SEAM`, exported from `eslint.config.mjs`;
`tests/guards/auth-stack-pinning.test.ts` holds it equal to the files that load
the library and reads the rule's wiring through the ESLint CLI (Jest cannot
load the ESM config).

`eslint.config.mjs` imports `index.js`, registers it as the `local` plugin, and
turns each rule on by its `local/<rule-name>` id.

## Module format: CommonJS `.js`, and it is not a free choice

`package.json` declares no `"type"`, so a `.js` file here is CommonJS. All
three consumers can load it: `eslint.config.mjs` (ESM) imports it through
Node's CJS/ESM interop, Jest's CommonJS `node` project requires it, and
`eslint .` loads it the same way as the config.

Both alternatives were tried and both fail:

| Format | What happens |
| --- | --- |
| `.mjs` | TypeScript treats a `.mjs` file as ES-module format unconditionally and will not downlevel it to CommonJS, so the rule tests could not `require` it — the rules become untestable, which defeats the point. |
| `.cjs` | `eslint.config.mjs` applies the `react-hooks/*` rules to all files, but `eslint-config-next` only registers the `react-hooks` plugin for its own scope, which excludes `.cjs`. The Lint job fails with "could not find plugin react-hooks". Same reason every build script under `scripts/` is `.js` or `.mjs`. |

## When a rule belongs here rather than in `tests/guards/`

Write an ESLint rule when the thing you are policing is **syntax**: a banned
call, a required prop, a forbidden identifier, a shape of expression. The AST
survives renaming, reformatting, comment edits and helper extraction; a regex
over source text survives none of those, and the failure mode is silent: a
doc-block mentioning the banned thing is a match unless the guard strips
comments first.

Keep it in `tests/guards/` when the assertion is about something ESLint cannot
see from inside one file: a registry that must stay in sync with a directory
listing, a count or budget across the tree, a Prisma schema invariant, a
cross-file coverage claim.

**Prefer a `no-restricted-syntax` selector in `eslint.config.mjs` over a rule
file** when one esquery selector says the whole thing (Islestone's env-module
import rule is a `no-restricted-imports` pattern, with no rule file). Reach for `rules/` when the check needs more than a selector: scope
resolution, cross-node reasoning inside the file, a computed message, options.

## Adding a rule

1. Write `rules/<name>.js`, exporting an ESLint `RuleModule`
   (`meta.type`, `meta.docs`, `meta.schema`, `meta.messages`, `create`).
2. Register it in `index.js`.
3. Add `__tests__/<name>.test.ts` using ESLint's `RuleTester`, with **both**
   `valid` and `invalid` arrays. An invalid-only suite passes against a rule
   that flags everything — every narrowing the rule performs needs a `valid`
   case that would go red if the narrowing broke.
   Call `ruleTester.run(...)` directly in the `describe` body, never inside an
   `it(...)`: ESLint 9's RuleTester emits its own `describe`/`it` per case and
   nesting it fails with "Tests cannot be nested".
4. Turn it on in `eslint.config.mjs`.
5. Run `npm run lint` over the whole repo before choosing a severity. If the
   rule flags existing code, that is a calibration signal — decide whether the
   flags are true positives (fix them, or land at `warn` with a plan) before
   landing at `error`.
