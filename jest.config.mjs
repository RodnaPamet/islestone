/**
 * Jest 30, three projects.
 *
 *   node         tests/unit, tests/guards    route handlers, pure logic, source guards
 *   jsdom        tests/rendered              React components through Testing Library
 *   integration  tests/integration           against a real Postgres (`npm run test:integration`)
 *   perf         tests/perf                  against the SEEDED database (`npm run test:perf`, H2a)
 *
 * `npm test` selects `node` and `jsdom` only, so it needs no database. The
 * perf project (Hardening H2a, docs/performance.md) needs a database seeded by
 * `scripts/seed-scale/` and runs only when selected. The
 * integration project applies the migrations once (globalSetup), points the
 * app's DATABASE_URL at the test database before any suite loads (setupFiles),
 * and runs in band: suites share one database and reset it.
 *
 * Transformer: @swc/jest. It compiles TypeScript and TSX with SWC (the
 * compiler Next.js itself uses), needs no tsconfig-driven type check per test
 * file (`npm run typecheck` owns type errors), works with Jest 30's transform
 * API, and handles React 19's automatic JSX runtime with one option. Chosen
 * over ts-jest (slow, type-checks per file, its own config surface) and over
 * next/jest (async config factory that is awkward with `projects`, and it
 * loads .env files into tests).
 *
 * @t3-oss/env-nextjs is ESM-only, so both env modules map to one mock in BOTH
 * projects. Specific mappings come before the general `@/` alias: Jest takes
 * the first pattern that matches.
 *
 * The jsdom project carries what the shared UI's rendered tests need
 * (sub-phase 1.2, docs/porting/maps/1.2.md section 5.1): co-located
 * `__tests__` under src/ and packages/, a transform for the ESM-only packages
 * the UI reaches at runtime, three module mocks, and `__mocks__/next-intl.js`
 * (applied automatically from the root `__mocks__`), which resolves every key
 * against messages/en.json.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {[string, Record<string, unknown>]} */
const swc = [
    '@swc/jest',
    {
        jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic' } },
            target: 'es2022',
        },
        module: { type: 'commonjs' },
        sourceMaps: 'inline',
    },
];

/**
 * Plain ESM scripts (`scripts/*.mjs`, such as the licence gate) are compiled
 * to CommonJS for Jest the same way. Without `--experimental-vm-modules`,
 * Jest 30 loads a `.mjs` file through its CommonJS path, which works once a
 * transform has converted it. SWC rewrites `import.meta.url` to the file's
 * own URL, so a script can find its location under test as it does under
 * node. The parser is ECMAScript, not TypeScript, so the script is read as
 * the JavaScript node runs.
 *
 * @type {[string, Record<string, unknown>]}
 */
const swcEsm = [
    '@swc/jest',
    {
        jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022' },
        module: { type: 'commonjs' },
        sourceMaps: 'inline',
    },
];

/**
 * Packages under node_modules that ship ESM only and that the shared UI
 * reaches at runtime in a rendered test. Jest loads node_modules through its
 * CommonJS path, so these are compiled like our own code; everything else in
 * node_modules is required as it is. TanStack Table v9 has no `require`
 * condition at all; visx re-exports d3 modules (and `internmap`, d3-array's
 * dependency); react-grid-layout v2 ships ESM at its main entry. The node
 * project shares the list, for sanitize-html's ESM-only parser.
 */
const ESM_PACKAGES = [
    '@tanstack/(?:react-table|table-core)',
    '@visx/[^/]+',
    'd3-[^/]+',
    'internmap',
    'delaunator',
    'robust-predicates',
    'react-grid-layout',
    'react-resizable',
    'react-draggable',
    // sanitize-html's parser (src/lib/security/sanitize.ts, sub-phase 1.5).
    // Node 22.12+ requires ESM natively and Jest 30 does on Node 24.9+, so
    // the app and CI's Node 24 do not need this; a contributor on Node 22
    // running Jest does.
    'htmlparser2',
    'domhandler',
    'domutils',
    'dom-serializer',
    'domelementtype',
    'entities',
    // react-email's renderer (src/app-layer/notifications/templates.ts,
    // sub-phase 1.6). Its CommonJS build loads react-dom/server with a
    // dynamic `import()`, which Jest's CommonJS runtime refuses without
    // `--experimental-vm-modules`; compiled, the import becomes a require.
    '@react-email/render',
    // The timeline widget (3.1b): SVAR React Gantt's MIT core and the
    // packages it reaches ship ESM only.
    '@svar-ui/[^/]+',
];

const moduleNameMapper = {
    '^@/env$': '<rootDir>/tests/mocks/env.ts',
    '^@/env-client$': '<rootDir>/tests/mocks/env.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    // jest-resolve does not honour an exports-array fallback, so the shared
    // package's subpath imports are mapped to its source directly.
    '^@inflect/ui/(.*)$': '<rootDir>/packages/ui/src/$1',
    '^@inflect/ui$': '<rootDir>/packages/ui/src/index.ts',
    // The package's `exports` map sends this subpath to dist/legacy.js, which
    // Jest's CommonJS resolver does not follow; Node's resolver here does.
    '^react-grid-layout/legacy$': require.resolve('react-grid-layout/legacy'),
    // vaul's drawer measures pointer gestures jsdom cannot produce; the mock
    // renders the same Radix Dialog structure without the drag maths.
    '^vaul$': '<rootDir>/tests/rendered/vaul-mock.tsx',
    // NumberFlow animates through Web Animations and a custom element jsdom
    // only partly supports; the mock renders the settled Intl.NumberFormat text.
    '^@number-flow/react$': '<rootDir>/tests/rendered/number-flow-mock.tsx',
    // SVAR's React packages declare a `require` entry (`dist/index.cjs.js`)
    // that is not in the published files; Jest's CommonJS resolver takes it,
    // so the ES build is mapped directly (and compiled, ESM_PACKAGES).
    '^@svar-ui/(react-[a-z]+)$': '<rootDir>/node_modules/@svar-ui/$1/dist/index.es.js',
    '\\.css$': '<rootDir>/tests/mocks/style.ts',
};

/** @type {import('jest').Config} */
const shared = {
    rootDir: '.',
    transform: { '^.+\\.tsx?$': swc, '^.+\\.(m|c)?jsx?$': swcEsm },
    transformIgnorePatterns: [`node_modules/(?!(?:${ESM_PACKAGES.join('|')})/)`],
    moduleNameMapper,
    setupFiles: ['<rootDir>/jest.setup.ts'],
    clearMocks: true,
    // The standalone build (`output: 'standalone'`, sub-phase 1.8) copies a
    // package.json and a traced node_modules into .next/standalone; without
    // this Jest's module map indexes them beside the real ones.
    modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/dist/'],
};

/** @type {import('jest').Config} */
const config = {
    projects: [
        {
            ...shared,
            displayName: 'node',
            testEnvironment: 'node',
            testMatch: [
                '<rootDir>/tests/unit/**/*.test.ts',
                '<rootDir>/tests/guards/**/*.test.ts',
                // RuleTester suites for the local ESLint rules (eslint-rules/).
                '<rootDir>/eslint-rules/__tests__/**/*.test.ts',
            ],
        },
        {
            ...shared,
            displayName: 'jsdom',
            testEnvironment: 'jsdom',
            // Co-located tests, in src/ and inside workspace packages, run
            // here, in jsdom. The node project's patterns are anchored at
            // tests/unit and tests/guards, so it never matches them too.
            testMatch: [
                '<rootDir>/tests/rendered/**/*.test.{ts,tsx}',
                '<rootDir>/src/**/__tests__/**/*.test.{ts,tsx}',
                '<rootDir>/packages/*/src/**/__tests__/**/*.test.{ts,tsx}',
            ],
            setupFilesAfterEnv: ['<rootDir>/tests/setup/rendered.ts'],
        },
        {
            ...shared,
            displayName: 'integration',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
            globalSetup: '<rootDir>/tests/setup/integration-global-setup.ts',
            setupFiles: ['<rootDir>/jest.setup.ts', '<rootDir>/tests/setup/integration-env.ts'],
            // `integration-timeout.ts` raises the per-test timeout to 30 s
            // (real database round trips, advisory-lock waits, a cold Prisma
            // client). Not `testTimeout`: Jest ignores it inside a project.
            setupFilesAfterEnv: ['<rootDir>/tests/setup/integration-timeout.ts', '<rootDir>/tests/setup/disconnect-after-suite.ts'],
        },
        {
            ...shared,
            displayName: 'perf',
            testEnvironment: 'node',
            testMatch: ['<rootDir>/tests/perf/**/*.test.ts'],
            setupFiles: ['<rootDir>/jest.setup.ts', '<rootDir>/tests/setup/perf-env.ts'],
            setupFilesAfterEnv: ['<rootDir>/tests/setup/perf-timeout.ts'],
        },
    ],
};

export default config;
