/**
 * Jest 30, two projects.
 *
 *   node   tests/unit, tests/guards    route handlers, pure logic, source guards
 *   jsdom  tests/rendered              React components through Testing Library
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
 */

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
        jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
        module: { type: 'commonjs' },
        sourceMaps: 'inline',
    },
];

const moduleNameMapper = {
    '^@/env$': '<rootDir>/tests/mocks/env.ts',
    '^@/env-client$': '<rootDir>/tests/mocks/env.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    // jest-resolve does not honour an exports-array fallback, so the shared
    // package's subpath imports are mapped to its source directly.
    '^@inflect/ui/(.*)$': '<rootDir>/packages/ui/src/$1',
    '^@inflect/ui$': '<rootDir>/packages/ui/src/index.ts',
    '\\.css$': '<rootDir>/tests/mocks/style.ts',
};

/** @type {import('jest').Config} */
const shared = {
    rootDir: '.',
    transform: { '^.+\\.(t|j)sx?$': swc, '^.+\\.mjs$': swcEsm },
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
            testMatch: ['<rootDir>/tests/unit/**/*.test.ts', '<rootDir>/tests/guards/**/*.test.ts'],
        },
        {
            ...shared,
            displayName: 'jsdom',
            testEnvironment: 'jsdom',
            // Co-located tests inside workspace packages run here, in jsdom.
            testMatch: ['<rootDir>/tests/rendered/**/*.test.tsx', '<rootDir>/packages/*/src/**/__tests__/**/*.test.{ts,tsx}'],
            setupFilesAfterEnv: ['<rootDir>/tests/setup/rendered.ts'],
        },
    ],
};

export default config;
