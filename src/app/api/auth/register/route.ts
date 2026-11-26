/**
 * POST /api/auth/register  body: { action: 'register', email, password, name, orgName? }
 *
 * With `orgName`: a new workspace, and the account as its Owner. Without it:
 * an account only, for the pending invitation in the request's
 * `islestone_invite_token` cookie, which must have been sent to the same
 * email; the sign-in that follows redeems the invitation as usual.
 *
 * PUBLIC SIGN-UP SITS BEHIND A SWITCH (ADR 0006, owner decision 2026-11-18):
 * the workspace-creating path is refused with `PUBLIC_SIGNUP_CLOSED` unless
 * `isPublicSignupOpen()` — off by default in production, on in development,
 * opened by an operator with `AUTH_PUBLIC_SIGNUP=1`. The invitation path is
 * not public sign-up and stays open.
 *
 * Every refusal carries a code from `REGISTER_REFUSALS` beside its English
 * sentence, so the sign-in page can say it in the user's language.
 *
 * Copied from inflect-compliance `src/app/api/auth/register/route.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e. The per-tenant data key
 * (`generateAndWrapDek`) arrives with field encryption in sub-phase 1.5.
 *
 * Register is the ONLY credentials flow still served by this route.
 * Login was served here historically via `action: 'login'` before the
 * NextAuth Credentials provider became production-grade; that path was
 * removed on 2026-04-22 to avoid having two concurrent login surfaces
 * with subtly different rate-limit / audit / email-verification
 * semantics. All production login now flows through NextAuth
 * `/api/auth/callback/credentials`.
 */
import { cookies } from 'next/headers';
import { Prisma, type Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { previewInviteByToken } from '@/app-layer/usecases/tenant-invites';
import type { RegisterRefusal } from '@/lib/auth/register-refusals';
import { issueEmailVerification } from '@/lib/auth/email-verification';
import { hashPassword, validatePasswordPolicy } from '@/lib/auth/passwords';
import { checkPasswordAgainstHIBP } from '@/lib/security/password-check';
import { lookupEmail } from '@/lib/auth/email-lookup';
import { hasAsciiLookalike, LOOKALIKE_EMAIL_MESSAGE } from '@/lib/email-lookalike';
import { hashForLookup } from '@/lib/security/encryption';
import { sanitizePlainText } from '@/lib/security/sanitize';
import { generateAndWrapDek } from '@/lib/security/tenant-keys';
import { isPublicSignupOpen } from '@/lib/auth/public-signup';
import { withValidatedBody } from '@/lib/validation/route';
import { AuthActionSchema } from '@/lib/schemas/auth';
import { env } from '@/env';
import { withApiErrorHandling } from '@/lib/errors/api';
import { TENANT_CREATE_LIMIT } from '@/lib/security/rate-limit';
import { jsonResponse } from '@/lib/api-response';
import { recordTenantCreated, recordUserSignup } from '@/lib/observability/business-metrics';

// The parent's open signup-policy question is settled here by the switch
// above (ADR 0006).
//
// The local try/catch that used to wrap this is gone. It caught every
// failure and returned `error.message` verbatim with status 500, which
// DEFEATED withApiErrorHandling's toApiErrorResponse shaping — so raw
// Prisma text, constraint and column names, the invocation site and an
// absolute server path went to an unauthenticated caller. Its comment
// justified it as "a final safety net so a DB error returns JSON instead
// of an HTML 500 page", which is exactly what the wrapper already does,
// minus the disclosure.
//
// TENANT_CREATE_LIMIT (5/hour) is the preset the repo already wrote for
// this threat. Each accepted request permanently creates a Tenant + User +
// TenantMembership, runs bcrypt cost 12, makes an outbound HIBP call,
// and sends mail to an attacker-chosen recipient from our sending
// domain. 3,600/hour from one IP was the ceiling.
export const POST = withApiErrorHandling(
    withValidatedBody(AuthActionSchema, async (_req, _ctx, body) => {
        // Zod's discriminated union already rejects anything but
        // `register`, so there are no else branches to guard.
        return await handleRegister(body);
    }),
    { rateLimit: { config: TENANT_CREATE_LIMIT, scope: 'self-service-register' } },
);

const POLICY_REFUSAL = {
    empty: 'PASSWORD_EMPTY',
    too_short: 'PASSWORD_TOO_SHORT',
    too_long: 'PASSWORD_TOO_LONG',
} as const satisfies Record<string, RegisterRefusal>;

/**
 * The unique violation a racing duplicate registration loses on: the
 * user's `emailHash`, the column the `existing` check reads.
 */
function isEmailHashUniqueViolation(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
    // The pg driver adapter names the index and its fields; the classic
    // engine names the columns in `target`. Anything else is not recognised
    // and stays a 500, rather than being reported as a clash it may not be.
    const meta = err.meta as
        | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } } }
        | undefined;
    const constraint = meta?.driverAdapterError?.cause?.constraint;
    const names: unknown[] = [
        constraint?.index,
        ...(Array.isArray(constraint?.fields) ? constraint.fields : []),
        ...(Array.isArray(meta?.target) ? meta.target : [meta?.target]),
    ];
    return names.some((n) => typeof n === 'string' && (n.includes('email') || n === 'User_emailHash_key'));
}

/** Every refusal carries its code beside the English sentence. */
function refuse(code: RegisterRefusal, error: string, status = 400) {
    return jsonResponse({ error, code }, { status });
}

async function handleRegister(body: { email: string; password: string; name: string; orgName?: string }) {
    const { email: rawEmail, password } = body;
    // Free text is sanitised on the server before it is stored (sub-phase
    // 1.5): the display name and the workspace name are rendered everywhere.
    const name = sanitizePlainText(body.name ?? '').trim();
    const orgName = sanitizePlainText(body.orgName ?? '').trim() || null;
    if (!rawEmail || !password || !name) {
        return refuse('REGISTER_FIELDS_MISSING', 'Missing required fields');
    }
    // An address with a character that folds into ASCII would hash as the
    // address it imitates (decision 252, `@/lib/email-lookalike`).
    if (hasAsciiLookalike(rawEmail)) {
        return refuse('EMAIL_LOOKALIKE', LOOKALIKE_EMAIL_MESSAGE);
    }

    // Enforce password policy at the set-password boundary. Login
    // does NOT re-validate (see src/lib/auth/passwords.ts) so pre-policy
    // users aren't locked out by a later rule bump.
    const policy = validatePasswordPolicy(password);
    if (!policy.ok) {
        return refuse(
            POLICY_REFUSAL[policy.reason],
            policy.reason === 'too_short'
                ? 'Password must be at least 8 characters'
                : policy.reason === 'too_long'
                  ? 'Password is too long'
                  : 'Password is required',
        );
    }

    // Breached-password screening (Epic A.3). Fails open on network
    // errors — a HIBP outage must not brick signup. The function never
    // logs the password or its hash.
    const hibp = await checkPasswordAgainstHIBP(password);
    if (hibp.breached) {
        return refuse(
            'PASSWORD_BREACHED',
            'This password appears in known data breaches. Please choose a different password.',
        );
    }

    const email = String(rawEmail).trim().toLowerCase();

    // Identity is anchored on the hash of the normalised email (`emailHash`),
    // which is what the unique constraint enforces, so a duplicate signup races
    // through the same gate as the DB.
    const existing = await prisma.user.findUnique({
        where: { emailHash: hashForLookup(email) },
    });
    if (existing) {
        return refuse('EMAIL_ALREADY_REGISTERED', 'Email already registered', 409);
    }

    // No workspace name: an account only, and only for a live invitation
    // sent to this email. Without that, an unnamed registration
    // would make an account that belongs nowhere, so it is refused. The
    // email check runs here rather than at redemption, which burns the
    // invitation on a mismatch.
    if (!orgName) {
        const token = (await cookies()).get('islestone_invite_token')?.value;
        if (!token) {
            return refuse('WORKSPACE_NAME_REQUIRED', 'A workspace name is required.');
        }
        const invite = await previewInviteByToken(token, email);
        if (!invite) {
            return refuse('INVITE_UNAVAILABLE', 'The invitation for this account is no longer available.');
        }
        if (!invite.matchesSession) {
            return refuse('INVITE_EMAIL_MISMATCH', 'Register with the email address the invitation was sent to.');
        }
        const invitedPasswordHash = await hashPassword(password);
        let user: { id: string; email: string; name: string | null };
        try {
            user = await prisma.user.create({
                data: { email: lookupEmail(email), passwordHash: invitedPasswordHash, name },
            });
        } catch (err) {
            // A racing duplicate passed the `existing` check above.
            if (isEmailHashUniqueViolation(err)) {
                return refuse('EMAIL_ALREADY_REGISTERED', 'Email already registered', 409);
            }
            throw err;
        }
        recordUserSignup({ signupSource: 'credentials' });
        await issueEmailVerification(email, { userId: user.id }).catch(() => undefined);
        return jsonResponse({
            user: { id: user.id, email: user.email, name: user.name, role: null },
            // The sign-in that follows redeems the invitation; no workspace
            // is created here.
            tenant: null,
            emailVerificationRequired: env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1',
        });
    }

    // A new workspace is public sign-up, which the switch governs.
    if (!isPublicSignupOpen()) {
        return refuse(
            'PUBLIC_SIGNUP_CLOSED',
            'Sign-up is closed on this deployment. Ask a workspace administrator for an invitation.',
            403,
        );
    }

    // Tenant, user and OWNER membership are ONE transaction: a racing
    // duplicate registration (a double-submitted form) passes the `existing`
    // check above and loses on the user's unique email, and the loser rolls
    // back whole and is told the email is registered, rather than leaving a
    // tenant with no member behind. The per-tenant data key is wrapped as
    // `createTenantWithDek` wraps it, inside the transaction, so a rolled-back
    // registration leaves no key behind either; its first use unwraps it.
    const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
    // Hashed before the transaction opens: a slow hash must not hold it.
    const passwordHash = await hashPassword(password);
    let created: {
        tenant: { id: string; name: string; slug: string };
        user: { id: string; email: string; name: string | null };
        membership: { role: Role };
    };
    try {
        created = await prisma.$transaction(async (tx) => {
            const { wrapped } = generateAndWrapDek();
            const tenant = await tx.tenant.create({
                data: { name: orgName, slug, encryptedDek: wrapped },
                select: { id: true, name: true, slug: true },
            });

            // Create user (no role/tenantId — membership is sole authority)
            const user = await tx.user.create({
                data: {
                    email: lookupEmail(email),
                    passwordHash,
                    name,
                },
            });

            // Create TenantMembership (sole source of role + tenant binding)
            const membership = await tx.tenantMembership.create({
                data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    // OWNER, not ADMIN. OWNER is strictly superior: it alone carries
                    // admin.tenant_lifecycle (delete tenant, rotate keys, transfer
                    // ownership) and admin.owner_management (invite/remove OWNERs).
                    // A first member created as ADMIN would leave the workspace
                    // with ZERO owners and those two capability sets unreachable.
                    role: 'OWNER',
                },
            });
            return { tenant, user, membership };
        });
    } catch (err) {
        if (isEmailHashUniqueViolation(err)) {
            return refuse('EMAIL_ALREADY_REGISTERED', 'Email already registered', 409);
        }
        throw err;
    }
    const { tenant, user, membership } = created;

    // Business KPIs — credentials self-service signup creates BOTH a
    // tenant (always FREE on this path) and its first user.
    recordTenantCreated({ plan: 'FREE', signupSource: 'credentials' });
    recordUserSignup({ signupSource: 'credentials' });

    // Fire the verification email. Non-blocking in intent — the issue
    // path writes the token row in a transaction and then attempts to
    // send the email; mailer failures are swallowed inside
    // issueEmailVerification so the register response is not held up
    // by SMTP latency or outages.
    await issueEmailVerification(email, { userId: user.id }).catch(() => undefined);

    // No session cookie is minted here: the client calls
    // signIn('credentials', …) immediately after this response
    // (src/app/login/page.tsx), so NextAuth issues the only session.
    const response = jsonResponse({
        user: { id: user.id, email: user.email, name: user.name, role: membership.role },
        // GAP-23: slug exposed alongside id/name so callers (notably
        // E2E test fixtures via `createIsolatedTenant`) can navigate
        // to `/t/<slug>/...` without having to look the slug up
        // post-registration. Slug is a public routing identifier,
        // not sensitive — it appears in every authenticated URL.
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        emailVerificationRequired: env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1',
    });

    return response;
}
