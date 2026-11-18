// ESLint 9 flat config.
//
// eslint-config-next supplies the Next.js, React, hooks, import and jsx-a11y
// rules; its `typescript` entry is typescript-eslint's `recommended` set.
// typescript-eslint is also a direct devDependency, pinned, so its version is
// ours (npm dedupes it with the copy eslint-config-next asks for). The blocks
// after the presets are Islestone's own rules.
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
    ...nextVitals,
    ...nextTs,

    globalIgnores([
        '.next/**',
        'out/**',
        'build/**',
        'coverage/**',
        'test-results/**',
        'playwright-report/**',
        'blob-report/**',
        'next-env.d.ts',
        // Test inputs, some deliberately broken (they import packages that
        // do not exist). Tests read them as data.
        'tests/fixtures/**',
    ]),

    // Everything TypeScript, application and tests alike.
    {
        files: ['**/*.{ts,tsx,mts}'],
        rules: {
            // `--max-warnings=0` already fails on these; say it plainly.
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // A type-only import is erased at compile time; marking it keeps
            // the bundle (and the client env guard's import graph) honest.
            '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'separate-type-imports' }],
        },
    },

    // Application code.
    {
        files: ['src/**/*.{ts,tsx}'],
        rules: {
            // Server logging goes through the observability layer (sub-phase
            // 1.6). Any exception is granted per file, in this config, with a
            // reason.
            'no-console': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
            // One spelling for the env modules, so Jest's module mapping and
            // a reader's grep both find every import of them.
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            regex: '^\\.{1,2}/(?:.*/)?env(?:-client)?(?:\\.ts)?$',
                            message: 'Import the env modules as @/env (server) or @/env-client (client).',
                        },
                    ],
                },
            ],
        },
    },
]);
