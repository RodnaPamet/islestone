/**
 * `local/next-auth-single-seam` — RuleTester.
 *
 * Adapted from inflect-compliance
 * `eslint-rules/__tests__/anthropic-client-single-seam.test.ts`. The valid
 * cases are the load-bearing half: every narrowing the rule makes (`import
 * type`, `export type`, a package that only shares the prefix's letters, a
 * computed dynamic import) has a case that goes red if it breaks. The invalid
 * cases are every way a module can load the library.
 */
import { RuleTester } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';

// CommonJS on purpose — see eslint-rules/index.js.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require('../rules/next-auth-single-seam');

const ruleTester = new RuleTester({
    languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

describe('local/next-auth-single-seam', () => {
    ruleTester.run('next-auth-single-seam', rule, {
        valid: [
            { name: 'a type-only import', code: "import type { Session } from 'next-auth';" },
            { name: 'a type-only subpath import', code: "import type { JWT } from 'next-auth/jwt';" },
            { name: 'a type-only re-export', code: "export type { Session } from 'next-auth';" },
            { name: 'a package that only shares the letters', code: "import x from 'next-authorize';" },
            { name: 'the seam module itself', code: "import { auth } from '@/auth';" },
            { name: 'the session helper', code: "import { getSession } from '@/lib/auth/session';" },
            { name: 'a computed dynamic import cannot be judged', code: 'const m = await import(name);' },
        ],
        invalid: [
            {
                name: 'a named import',
                code: "import { getServerSession } from 'next-auth';",
                errors: [{ messageId: 'valueImport' }],
            },
            {
                name: 'a subpath import',
                code: "import { signIn } from 'next-auth/react';",
                errors: [{ messageId: 'valueImport' }],
            },
            {
                name: 'the adapter scope',
                code: "import { PrismaAdapter } from '@next-auth/prisma-adapter';",
                errors: [{ messageId: 'valueImport' }],
            },
            {
                name: 'inline type specifiers only',
                code: "import { type Session } from 'next-auth';",
                errors: [{ messageId: 'inlineTypeOnly' }],
            },
            { name: 'a side-effect import', code: "import 'next-auth';", errors: [{ messageId: 'valueImport' }] },
            {
                name: 'a re-export',
                code: "export { getServerSession } from 'next-auth';",
                errors: [{ messageId: 'reExport' }],
            },
            { name: 'export *', code: "export * from 'next-auth/jwt';", errors: [{ messageId: 'reExport' }] },
            {
                name: 'a dynamic import',
                code: "const m = await import('next-auth/jwt');",
                errors: [{ messageId: 'dynamicLoad' }],
            },
            { name: 'require', code: "const m = require('next-auth');", errors: [{ messageId: 'dynamicLoad' }] },
            {
                name: 'import = require',
                code: "import NextAuth = require('next-auth');",
                errors: [{ messageId: 'valueImport' }],
            },
        ],
    });
    // The wiring in eslint.config.mjs (on for src/, off for exactly the
    // seam's files) is checked by tests/guards/auth-stack-pinning.test.ts,
    // which runs the real ESLint CLI: Jest cannot load the ESM config.
});
