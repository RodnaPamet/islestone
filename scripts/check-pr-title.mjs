#!/usr/bin/env node
/**
 * A pull request's title must be a Conventional Commit subject (owner
 * decision 51, 2026-11-19).
 *
 * Pull requests are squash-merged, and the squash commit's subject is the
 * title, so the title is what semantic-release reads on `main`
 * (.github/workflows/release.yml): `feat` makes a minor release, `fix` and
 * `perf` a patch, a `!` before the colon a major; the other types make none.
 * `.github/workflows/pr-title.yml` runs this with the title in PR_TITLE (an
 * environment variable, never interpolated into a shell command).
 *
 *   type(scope)!: subject
 *
 * The type is one of TYPES; the scope is optional, lower case, and may hold
 * digits, dots, slashes and hyphens (`feat(1.8): …`, `fix(deploy): …`); the
 * subject is not empty and does not start or end with a space. At most 100
 * characters in all.
 *
 * Usage: PR_TITLE='feat(deploy): …' node scripts/check-pr-title.mjs
 * Exit:  0 valid, 1 not. Written fresh for Islestone.
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The allowed types, as docs/change-management-policy.md lists them. */
export const TYPES = ['feat', 'fix', 'perf', 'refactor', 'revert', 'docs', 'test', 'build', 'ci', 'chore', 'style'];

export const MAX_LENGTH = 100;

export const PR_TITLE_PATTERN = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9./-]*\\))?(!)?: (\\S(?:.*\\S)?)$`);

/** `{ ok: true, type, breaking }`, or `{ ok: false, reason }`. */
export function checkPrTitle(title) {
    if (typeof title !== 'string' || title.length === 0) return { ok: false, reason: 'the title is empty' };
    if (title.length > MAX_LENGTH) return { ok: false, reason: `the title is ${title.length} characters; at most ${MAX_LENGTH}` };
    const match = PR_TITLE_PATTERN.exec(title);
    if (!match) {
        return {
            ok: false,
            reason: `the title is not "type(scope): subject" with a type among ${TYPES.join(', ')}`,
        };
    }
    return { ok: true, type: match[1], breaking: match[3] === '!' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const title = process.env.PR_TITLE ?? '';
    const result = checkPrTitle(title);
    if (result.ok) {
        process.stdout.write(`PR title OK: ${result.type}${result.breaking ? ' (breaking)' : ''}\n`);
        process.exit(0);
    }
    process.stdout.write(
        `::error title=PR title is not a Conventional Commit::${result.reason}. ` +
            'Squash merges use the title as the commit subject, which semantic-release reads. ' +
            `Examples: "feat(1.8): …", "fix(deploy): …", "docs: …". See docs/change-management-policy.md, "Versioning".\n`,
    );
    process.exit(1);
}
