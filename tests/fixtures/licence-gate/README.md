# Licence gate fixtures

Inputs for `tests/unit/licence-gate.test.ts`. Several of them break the third-party intake policy on purpose: a GPL dependency, an import from an `ee` folder, an import of a deny-listed package.

- `lockfiles/*.lock.json`: npm lockfiles (lockfileVersion 3) describing made-up packages. They are not named `package-lock.json`, so GitHub's dependency graph does not read them as real dependencies.
- `installed-manifests.json`: `package.json` files keyed by lockfile location, which the tests write into a temporary `node_modules`.
- `sources/`: source files whose import specifiers the scan must, or must not, flag. Tests compute expected line numbers from the files themselves. `jsx-backtick.tsx`, `jsx-comment.tsx` and `division.js` hold text that once made the scanner lose its place and miss the imports after it; the scan must now flag those imports.
- `root/docs/adr/`: ADRs for exemptions to reference. `0099` names every package a fixture exemption covers, so those exemptions pass the rules that the ADR must exist and must name the package. `0098` names none, for the test of the second rule.

The gate scans every git-listed source file except this directory, which it leaves out by name (`EXCLUDED_SOURCE_PREFIXES`). `tsconfig.json` and `eslint.config.mjs` ignore `tests/fixtures/`, because these files import packages that do not exist.
