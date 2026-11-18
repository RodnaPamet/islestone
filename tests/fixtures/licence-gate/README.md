# Licence gate fixtures

Inputs for `tests/unit/licence-gate.test.ts`. Several of them break the third-party intake policy on purpose: a GPL dependency, an import from an `ee` folder, an import of a deny-listed package.

- `lockfiles/*.lock.json`: npm lockfiles (lockfileVersion 3) describing made-up packages. They are not named `package-lock.json`, so GitHub's dependency graph does not read them as real dependencies.
- `installed-manifests.json`: `package.json` files keyed by lockfile location, which the tests write into a temporary `node_modules`.
- `sources/`: source files whose import specifiers the scan must, or must not, flag. Tests compute expected line numbers from the files themselves.
- `root/docs/adr/`: an ADR for exemptions to reference, so a fixture exemption can pass the "the ADR exists" rule.

The gate never scans this directory. Its import scan reads only `src/`, `packages/`, `scripts/` and root-level source files, and it also excludes `tests/fixtures/licence-gate/` by name (`EXCLUDED_SOURCE_PREFIXES`). `tsconfig.json` and `eslint.config.mjs` ignore `tests/fixtures/`, because these files import packages that do not exist.
