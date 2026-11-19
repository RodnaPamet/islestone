'use strict';

/**
 * `local/next-auth-single-seam`
 *
 * ADR 0004 A3 (owner decision, 2026-11-19): "Only the modules under one
 * folder import `next-auth` or `better-auth`. Everything else, the edge gate
 * included, calls Islestone's own functions. Enforce it with a lint rule. …
 * The seam is what makes a later move a bounded change." The parent let about
 * fifteen server components import its `auth()` shim directly.
 *
 * Outside the files `eslint.config.mjs` exempts (the seam's allowlist), no
 * module under `src/` LOADS `next-auth`, a `next-auth/…` subpath or an
 * `@next-auth/…` package:
 *
 *   • `import X from 'next-auth…'`, a named, namespace or side-effect import;
 *   • `import X = require('next-auth…')`;
 *   • `export … from 'next-auth…'` and `export * from …`;
 *   • `import('next-auth…')` and `require('next-auth…')`.
 *
 * `import type` and `export type` are allowed: they are erased and load
 * nothing. An import whose specifiers are all inline `type` is NOT accepted:
 * under `isolatedModules` TypeScript may keep it as `import {} from '…'`.
 *
 * The allowlist is spelled once, in `eslint.config.mjs` (`NEXT_AUTH_SEAM`),
 * and `tests/guards/auth-stack-pinning.test.ts` holds it equal to the files
 * that really import the library, so a stale entry fails as well as a missing
 * one. Sub-phase 1.4 starts from inflect-compliance's importers; moving them
 * under `src/lib/auth/provider/` tightens the seam later.
 *
 * A dynamic `import()` or `require()` whose argument is not a string literal
 * cannot be judged statically and is not reported.
 *
 * Adapted from inflect-compliance `eslint-rules/rules/anthropic-client-single-seam.js`
 * at 5528464fc54a8681956f3b9ce23ca9c075f0420e: the same load-policing shape,
 * pointed at the auth library.
 */

/** `next-auth` and its subpaths, and the `@next-auth/` adapter scope. */
const PACKAGES = ['next-auth'];
const SCOPES = ['next-auth/', '@next-auth/'];

/** The literal module name a node names, or null when it is computed. */
function literalSource(node) {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis.map((q) => q.value.cooked).join('');
    }
    return null;
}

function isAuthPackage(source) {
    return typeof source === 'string' && (PACKAGES.includes(source) || SCOPES.some((s) => source.startsWith(s)));
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                "Only the auth seam's files (eslint.config.mjs) may load next-auth or @next-auth/*; elsewhere, read the session through src/lib/auth/session.ts.",
        },
        schema: [],
        messages: {
            valueImport:
                "Only the auth seam loads '{{source}}' (ADR 0004 A3). Read the session through getSession() in src/lib/auth/session.ts; for the library's types, write `import type`.",
            inlineTypeOnly:
                "An import of '{{source}}' whose specifiers are all inline `type` may still load the package under isolatedModules. Write `import type { … } from '{{source}}'`.",
            reExport:
                "Do not re-export from '{{source}}': only the auth seam may hand on NextAuth. `export type` is allowed.",
            dynamicLoad:
                "Only the auth seam loads '{{source}}' (ADR 0004 A3), at run time included.",
        },
    },

    create(context) {
        function report(node, messageId, source) {
            context.report({ node, messageId, data: { source } });
        }

        return {
            ImportDeclaration(node) {
                const source = literalSource(node.source);
                if (!isAuthPackage(source)) return;
                if (node.importKind === 'type') return;
                const specifiers = node.specifiers || [];
                if (
                    specifiers.length > 0 &&
                    specifiers.every((s) => s.type === 'ImportSpecifier' && s.importKind === 'type')
                ) {
                    report(node, 'inlineTypeOnly', source);
                    return;
                }
                report(node, 'valueImport', source);
            },

            TSImportEqualsDeclaration(node) {
                if (node.importKind === 'type') return;
                const ref = node.moduleReference;
                if (!ref || ref.type !== 'TSExternalModuleReference') return;
                const source = literalSource(ref.expression);
                if (isAuthPackage(source)) report(node, 'valueImport', source);
            },

            ExportNamedDeclaration(node) {
                const source = literalSource(node.source);
                if (!isAuthPackage(source)) return;
                if (node.exportKind === 'type') return;
                const specifiers = node.specifiers || [];
                if (specifiers.length > 0 && specifiers.every((s) => s.exportKind === 'type')) return;
                report(node, 'reExport', source);
            },

            ExportAllDeclaration(node) {
                const source = literalSource(node.source);
                if (!isAuthPackage(source)) return;
                if (node.exportKind === 'type') return;
                report(node, 'reExport', source);
            },

            ImportExpression(node) {
                const source = literalSource(node.source);
                if (isAuthPackage(source)) report(node, 'dynamicLoad', source);
            },

            CallExpression(node) {
                if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
                const source = literalSource(node.arguments[0]);
                if (isAuthPackage(source)) report(node, 'dynamicLoad', source);
            },
        };
    },
};
