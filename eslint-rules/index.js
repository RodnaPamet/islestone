'use strict';

/**
 * `eslint-plugin-local` — this repository's own ESLint rules, registered as
 * `local` in `eslint.config.mjs`.
 *
 * Rewritten from inflect-compliance `eslint-rules/index.js` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e: the same plugin shape, with the
 * rules sub-phase 1.4 brings. Later sub-phases append theirs (6.1's map says
 * it creates this folder "unless an earlier sub-phase did").
 *
 * CommonJS `.js`, and it is not a free choice: `.mjs` cannot be required by
 * Jest, and `.cjs` falls outside the scope `eslint-config-next` registers its
 * plugins for. See README.md.
 */

module.exports = {
    meta: { name: 'eslint-plugin-local' },
    rules: {
        'next-auth-single-seam': require('./rules/next-auth-single-seam'),
        'no-request-derived-public-url': require('./rules/no-request-derived-public-url'),
    },
};
