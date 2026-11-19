/**
 * Guardrail: TenantMembership is created ONLY through the curated,
 * explicit paths below. A seventh site is a privilege-escalation
 * risk (Epic 1 GAP-01 — auto-ADMIN on OAuth sign-in — was exactly
 * this class of bug) and must pass review before being allowlisted.
 *
 * This test is structural: it greps for `tenantMembership.create`,
 * `tenantMembership.upsert`, and `tenantMembership.createMany`
 * call sites in src/ and fails if any match outside the allowlist.
 *
 * When adding a new legitimate creation path:
 *   1. Add the file to `ALLOWLISTED_MEMBERSHIP_SITES` below with a
 *      one-line `reason` describing why this path is safe (gated
 *      by what? audit-logged how? email-bound?).
 *   2. Confirm the path carries a meaningful audit entry.
 *   3. Make the review visible in the PR diff.
 *
 * Also asserts:
 *   - `ensureDefaultTenantMembership` (the Epic 1 vulnerability
 *     function name) does not reappear anywhere in src/.
 */

import * as fs from 'fs';
import * as path from 'path';

import { gitFiles } from '../helpers/git-files';
import { codeOf } from '../helpers/source-blocks';

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'src');

/**
 * The git-listed `.ts` files under `src/`, relative to `src/` — the population
 * comes from git, never a directory walk (Islestone's guard convention).
 */
function srcFiles(opts: { skipTests: boolean }): string[] {
    return gitFiles(ROOT)
        .filter((f) => f.startsWith('src/') && f.endsWith('.ts') && !f.endsWith('.d.ts'))
        .filter((f) => !opts.skipTests || !/\.(test|spec)\.ts$/.test(f))
        .map((f) => f.slice('src/'.length));
}

/**
 * Every source read in this file goes through here so COMMENTS ARE MASKED
 * (#2246). Both directions matter for an allowlist ratchet: a commented-out
 * `tenantMembership.create(` would otherwise put a file on the violation
 * list, and — the direction that bites — a file kept on the allowlist by a
 * commented-out call would pass the "allowlisted file still contains the
 * pattern" check while holding no such call at all.
 */
const readSrc = (abs: string): string => codeOf(fs.readFileSync(abs, 'utf8'));

interface AllowlistedSite {
    /** Path relative to repo root. */
    file: string;
    /** Why this file is a legitimate membership-creation site. */
    reason: string;
}

const ALLOWLISTED_MEMBERSHIP_SITES: ReadonlyArray<AllowlistedSite> = [
    {
        file: 'src/app-layer/usecases/tenant-invites.ts',
        reason:
            'Epic 1 canonical path. Both entry points consume an ' +
            'admin-created TenantInvite atomically (updateMany with ' +
            'expiresAt + acceptedAt + revokedAt predicates) before ' +
            'creating the membership: redeemInvite email-binds a token ' +
            'from the /invite/:token URL; redeemPendingInvitesByEmail ' +
            'matches the invite email to the OAuth-verified sign-in email ' +
            '(caller rejects email_verified=false; never called for the ' +
            'credentials provider). No invite ⇒ no membership — not ' +
            'auto-join. Both audited through appendAuditEntry as ' +
            'MEMBER_INVITE_ACCEPTED.',
    },
    {
        file: 'src/app/api/auth/register/route.ts',
        reason:
            'Credentials self-service signup, behind the AUTH_PUBLIC_SIGNUP ' +
            'switch (off by default in production). The signing-up user ' +
            'creates their own workspace and becomes its sole OWNER — the ' +
            '"I am my own tenant" path. The invite path on the same route ' +
            'creates the account only; the membership comes from ' +
            'redeemInvite in tenant-invites.ts.',
    },
    {
        file: 'src/app-layer/usecases/org-provisioning.ts',
        reason:
            'Epic O-2 hub-and-spoke ORG_ADMIN auto-provisioning. ' +
            'Fan-out creates ADMIN memberships in every tenant under ' +
            'the org, tagged with provisionedByOrgId so ' +
            'deprovisionOrgAdmin can distinguish auto-created from ' +
            'manually-granted rows. Safety comes from the precondition, ' +
            'not the role ceiling: rows are created ONLY for a user who ' +
            'already holds OrgMembership(role=ORG_ADMIN) — an org ' +
            'administrator legitimately operates their tenants. The role ' +
            'is hard-coded to ADMIN (never OWNER, so tenant lifecycle / ' +
            'owner management stays out of reach). createMany with ' +
            'skipDuplicates preserves any pre-existing manual membership. ' +
            'Audit emission happens at the calling org-level API route, ' +
            'where the OrgContext is in scope.',
    },
];

const MEMBERSHIP_CREATION_PATTERN = /\btenantMembership\.(create|upsert|createMany)\b/;
const ORG_MEMBERSHIP_CREATION_PATTERN = /\borgMembership\.(create|upsert|createMany)\b/;

/**
 * Epic D — explicit allowlist for OrgMembership creation sites.
 * Same shape as TenantMembership: a new entry is a privilege-
 * escalation risk and must pass review.
 */
interface OrgAllowlistedSite {
    file: string;
    reason: string;
}

const ALLOWLISTED_ORG_MEMBERSHIP_SITES: ReadonlyArray<OrgAllowlistedSite> = [
    {
        file: 'src/app-layer/usecases/org-invites.ts',
        reason:
            'Epic D canonical path. redeemOrgInvite consumes an OrgInvite ' +
            'token atomically (updateMany predicate) and email-binds to ' +
            'the signed-in user. Audit-chained as ORG_INVITE_REDEEMED + ' +
            'ORG_MEMBER_ADDED.',
    },
];

describe('Guardrail: TenantMembership creation sites are allowlisted', () => {
    it('every call site is one of the ALLOWLISTED_MEMBERSHIP_SITES entries', async () => {
        const files = srcFiles({ skipTests: true });

        const allowlistedRelPaths = new Set(
            ALLOWLISTED_MEMBERSHIP_SITES.map((s) => s.file),
        );
        const violations: string[] = [];

        for (const rel of files) {
            const full = path.join(SRC, rel);
            const content = readSrc(full);
            if (!MEMBERSHIP_CREATION_PATTERN.test(content)) continue;

            const srcRelPath = `src/${rel}`;
            if (!allowlistedRelPaths.has(srcRelPath)) {
                violations.push(srcRelPath);
            }
        }

        if (violations.length > 0) {
            const msg = [
                'Unallowlisted TenantMembership creation site(s):',
                ...violations.map((v) => `  - ${v}`),
                '',
                'If this is a legitimate new creation path, add the file to',
                'ALLOWLISTED_MEMBERSHIP_SITES in tests/guards/no-auto-join.test.ts',
                'with a one-line reason describing why it is safe.',
            ].join('\n');
            throw new Error(msg);
        }

        expect(violations).toEqual([]);
    });

    it('every allowlisted file actually exists on disk + contains the pattern', () => {
        for (const site of ALLOWLISTED_MEMBERSHIP_SITES) {
            const full = path.join(ROOT, site.file);
            expect(fs.existsSync(full)).toBe(true);
            const content = readSrc(full);
            expect(MEMBERSHIP_CREATION_PATTERN.test(content)).toBe(true);
        }
    });

    it('ensureDefaultTenantMembership function name is gone from src/', async () => {
        // Epic 1 GAP-01: this was the auto-ADMIN vulnerability.
        // Removed in PR 4. This assertion prevents reintroduction.
        const files = srcFiles({ skipTests: false });

        const matches: string[] = [];
        for (const rel of files) {
            const content = readSrc(path.join(SRC, rel));
            if (/ensureDefaultTenantMembership/.test(content)) {
                matches.push(`src/${rel}`);
            }
        }

        expect(matches).toEqual([]);
    });
});

// ─── Epic D — OrgMembership creation sites ───────────────────────

describe('Guardrail: OrgMembership creation sites are allowlisted', () => {
    it('every call site is one of the ALLOWLISTED_ORG_MEMBERSHIP_SITES entries', async () => {
        const files = srcFiles({ skipTests: true });

        const allowlistedRelPaths = new Set(
            ALLOWLISTED_ORG_MEMBERSHIP_SITES.map((s) => s.file),
        );
        const violations: string[] = [];

        for (const rel of files) {
            const full = path.join(SRC, rel);
            const content = readSrc(full);
            if (!ORG_MEMBERSHIP_CREATION_PATTERN.test(content)) continue;

            const srcRelPath = `src/${rel}`;
            if (!allowlistedRelPaths.has(srcRelPath)) {
                violations.push(srcRelPath);
            }
        }

        if (violations.length > 0) {
            const msg = [
                'Unallowlisted OrgMembership creation site(s):',
                ...violations.map((v) => `  - ${v}`),
                '',
                'If this is a legitimate new creation path, add the file to',
                'ALLOWLISTED_ORG_MEMBERSHIP_SITES in tests/guards/no-auto-join.test.ts',
                'with a one-line reason describing why it is safe (gated by what?',
                'audit-logged how? email-bound?).',
            ].join('\n');
            throw new Error(msg);
        }

        expect(violations).toEqual([]);
    });

    it('every allowlisted org-membership file actually exists + contains the pattern', () => {
        for (const site of ALLOWLISTED_ORG_MEMBERSHIP_SITES) {
            const full = path.join(ROOT, site.file);
            expect(fs.existsSync(full)).toBe(true);
            const content = readSrc(full);
            expect(ORG_MEMBERSHIP_CREATION_PATTERN.test(content)).toBe(true);
        }
    });

    it('ensureDefaultOrgMembership function name is gone from src/', async () => {
        // Epic D explicit hardening — there is no auto-bootstrap of
        // org membership today, and this sentinel prevents one from
        // being introduced silently. If any future feature needs a
        // dev-time bootstrap, it must be gated behind an env flag
        // (default false in production) and named explicitly so
        // operators can audit + disable.
        const files = srcFiles({ skipTests: false });

        const matches: string[] = [];
        for (const rel of files) {
            const content = readSrc(path.join(SRC, rel));
            if (/ensureDefaultOrgMembership/.test(content)) {
                matches.push(`src/${rel}`);
            }
        }

        expect(matches).toEqual([]);
    });
});
