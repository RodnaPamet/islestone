# Playwright E2E suite

End-to-end tests run against a real Next.js server, booted by
`playwright.config.ts` via `next start` on port 3100 after `npm run build`.
Specs that sign in need the local Postgres stack (`docker compose up -d`) and a
migrated database.

## Server-mode invariant: `AUTH_TEST_MODE=1`

The webServer command in `playwright.config.ts` boots the app with:

  - `AUTH_TEST_MODE=1` (with `NEXT_TEST_MODE=1`, which `src/env.ts` requires
    before it accepts `AUTH_TEST_MODE` in a production build) — the
    credentials flow's test conveniences;
  - `AUTH_PUBLIC_SIGNUP=1` — the public sign-up switch, so a spec can create
    its own workspace through `/api/auth/register`;
  - `RATE_LIMIT_MODE=memory` — no Upstash in the run.

`AUTH_TEST_MODE=1` deliberately **bypasses** two server gates the production
credentials flow enforces:

  1. **Per-email rate limit** (`checkCredentialsAttempt`) — a login spec that
     fat-fingers the password six or more times would lock itself out
     otherwise.
  2. **`AUTH_REQUIRE_EMAIL_VERIFICATION`** — Playwright fixtures create users
     that have not clicked a verification link.

Specs that exercise the UI of these gates still test the **rendering** of the
state; the **server enforcement** of the same gates is covered by tests that
run with `AUTH_TEST_MODE` unset instead.

## Why not a sibling `playwright.real-auth.config.ts`?

A second Playwright config pointed at a no-`AUTH_TEST_MODE=1` server, fed by a
SMTP catcher service (mailpit or mailhog) in the Compose stack, would let specs
exercise the gates through a browser. It has been considered and deferred. The
reasoning, in order of weight:

  - **The regression class is already covered below the browser.**
    `tests/integration/credentials-end-to-end.test.ts` and
    `tests/integration/email-verification.test.ts` hit the real usecases and
    Prisma with `AUTH_TEST_MODE` unset; `tests/unit/credential-rate-limit.test.ts`
    drives the real limiter (memory and Upstash), and
    `tests/unit/credentials-auth.test.ts` the email-verification refusal on the
    authenticate path. Removing `AUTH_TEST_MODE=1` from Playwright would add a
    browser layer on top; the marginal regression detection is real but small.
  - **Real infra cost.** A SMTP catcher needs a Compose service, a
    wait-for-ready check, a `@real-auth` Playwright tag and a second CI job.
  - **Per-spec setup cost.** A real-auth spec has to register a user, scrape
    the catcher mailbox for the verification link, click it, then proceed.

The decision is locked in by the structural guard
[`tests/guards/auth-server-gate-coverage.test.ts`](../guards/auth-server-gate-coverage.test.ts).
If a future change deletes the tests relied on above, that guard fails and
forces a reconsideration of whether a real-auth Playwright config is now
worthwhile.

## When to revisit

Add a real-auth Playwright config when a bug ships that the tests above did not
catch but a browser would have (a redirect chain, or a cookie flag that only
shows in a real navigation), and the case cannot be added to the existing suite
because `AUTH_TEST_MODE=1` short-circuits the gate it depends on.
