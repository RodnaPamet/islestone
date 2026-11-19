// ESLint 9 flat config.
//
// eslint-config-next supplies the Next.js, React, hooks, import and jsx-a11y
// rules; its `typescript` entry is typescript-eslint's `recommended` set.
// typescript-eslint is also a direct devDependency, pinned, so its version is
// ours (npm dedupes it with the copy eslint-config-next asks for). The blocks
// after the presets are Islestone's own rules.
import { readFileSync } from 'node:fs';

import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

import localPlugin from './eslint-rules/index.js';

// The generic UI files copied byte for byte from inflect-compliance into src/
// (sub-phase 1.2, part B). ui-mirror.json lists them under "files"; they are
// linted upstream under upstream's rules and may not be edited here, so this
// config skips exactly those paths. Islestone's own files beside them (the
// manifest's "owned" entries, the gallery) are linted as usual.
const mirroredUiFiles = Object.keys(JSON.parse(readFileSync(new URL('./ui-mirror.json', import.meta.url), 'utf8')).files);

// The auth seam (ADR 0004 A3): the ONLY files under src/ that may load
// `next-auth` or `@next-auth/*` (`local/next-auth-single-seam`). Everything
// else reads the session through `src/lib/auth/session.ts`. Exported so
// `tests/guards/auth-stack-pinning.test.ts` can hold this list equal to the
// files that really import the library, so a stale entry fails as well as a
// missing one. Sub-phases that port another importer (1.7's shell and
// command palette, Phase 6's agent pages) add it here, or their lint fails.
export const NEXT_AUTH_SEAM = [
    'src/auth.ts',
    'src/app/api/auth/[...nextauth]/route.ts',
    'src/middleware.ts',
    'src/lib/security/session-tracker.ts',
    'src/lib/auth/refresh-session-claims.ts',
    'src/app/login/page.tsx',
    'src/app/invite/_components/InviteSwitchAccountButton.tsx',
    'src/app/t/[tenantSlug]/(app)/auth/mfa/page.tsx',
];

// ESLint's `files` are globs, where `[` and `]` open a character class; the
// paths above are literal, so each bracket is matched by a class of itself.
const asLiteralGlob = (path) => path.replace(/[[\]]/g, '[$&]');

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
        // The byte-for-byte mirror of @inflect/ui (UPSTREAM.json). It is
        // linted upstream and may not be edited here; `npm run typecheck:ui`
        // and `node scripts/ui-drift.mjs verify` check it instead.
        'packages/ui/**',
        ...mirroredUiFiles,
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

    // Islestone's own rules (./eslint-rules, see its README).
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: { local: localPlugin },
        rules: {
            'local/next-auth-single-seam': 'error',
        },
    },
    {
        // The seam itself.
        files: NEXT_AUTH_SEAM.map(asLiteralGlob),
        rules: { 'local/next-auth-single-seam': 'off' },
    },
    {
        // Externally published URLs in route handlers come from
        // `publicBaseUrl`, never the request's host (SCIM `location`, the
        // invite link; inflect-compliance wires it the same way).
        files: ['src/app/api/**/*.ts'],
        rules: { 'local/no-request-derived-public-url': 'error' },
    },

    // ./eslint-rules is CommonJS by necessity (see its README), so its
    // modules load one another with `require`.
    {
        files: ['eslint-rules/**/*.js'],
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },

    // The edge logger writes structured JSON to `console.*`, the only I/O
    // channel the Edge runtime has (pino needs Node). This one file holds the
    // exception the application-code block above refuses.
    {
        files: ['src/lib/observability/edge-logger.ts'],
        rules: {
            'no-console': 'off',
        },
    },
]);
