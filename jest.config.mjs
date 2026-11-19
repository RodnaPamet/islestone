/**
 * Jest 30, three projects.
 *
 *   node         tests/unit, tests/guards    route handlers, pure logic, source guards
 *   jsdom        tests/rendered              React components through Testing Library
 *   integration  tests/integration           against a real Postgres (`npm run test:integration`)
 *
 * `npm test` selects `node` and `jsdom` only, so it needs no database. The
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
 * dependency); react-grid-layout v2 ships ESM at its main entry.
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
            setupFilesAfterEnv: ['<rootDir>/tests/setup/disconnect-after-suite.ts'],
            // Real database round trips, advisory-lock waits and a cold
            // Prisma client: the 5 s default is too tight.
            testTimeout: 30_000,
        },
    ],
};

export default config;
