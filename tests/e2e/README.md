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

## Isolation (Hardening H2g)

Owner decision 180 (`docs/porting/maps/H2.md`, part 7). The suite runs
`fullyParallel`, and a pull request's run retries a failure once, so a spec
that depends on another spec, on the order or on the day would pass anyway.
Four things stop it:

  1. **No state shared through variables.** A top-level `let` or `var`
     written in one `test()` and read in another fails
     `tests/guards/e2e-isolation.test.ts` (ported from inflect-compliance; its
     `BASELINE` is empty). Create what a test needs inside it, or in a
     `beforeEach`, or make the steps one `test()` with `test.step(...)`.
  2. **Signed-in specs use the per-test workspace.** A spec that calls
     `signInAs`, `page.goto('/t/…')` or sends a request to `/api/t/…` imports
     `test` from `./fixtures` (`isolatedTenant`, `authedPage`: a fresh, empty
     workspace per `test()`). The same guard fails a spec that does not. There
     is no seeded workspace to share.
  3. **No shared rate-limit budget.** Every spec reaches the server from
     `127.0.0.1`, and the limits are keyed by IP; `AUTH_TEST_MODE=1` bypasses
     every tier, so no spec spends another's budget. The guard fails if the
     webServer loses `AUTH_TEST_MODE=1` or `NEXT_TEST_MODE=1` while the base URL
     is loopback. The server enqueues into the one Redis but no worker runs, so
     nothing a spec enqueues reaches another; a spec that one day starts the
     worker must key what it asserts by its own workspace.
  4. **One "today" for the run.** `playwright.config.ts` pins `E2E_TODAY`
     (`YYYY-MM-DD`) when the run starts, as the date in `NOTIFICATIONS_TZ`
     (`Europe/London` by default), unless the caller set one, and passes it to
     the server. The server honours it only beside `NEXT_TEST_MODE=1`, through
     the one clock seam, `todayClock` (`src/lib/clock.ts`): cycles, repeats,
     due soon, the due reminders, milestones, calendars, the timeline and the
     roadmap all read that day, however long the run takes.
     `tests/guards/today-clock-seam.test.ts` refuses a fresh clock read beside
     the date helpers. A spec builds dates from `e2eToday()`, `e2eDay(n)` or
     `plannedDay(n)` in `e2e-utils.ts`, never from its own clock. Production
     refuses `E2E_TODAY` as it refuses `AUTH_TEST_MODE`: in `src/env.ts` and at
     startup (`src/lib/security/startup-test-clock-check.ts`). Only "today"
     moves: stored times (`createdAt`, a transition's time) stay real, and the
     browser's own clock is not changed (no spec reads it). With
     `reuseExistingServer` (local runs only) a server started on another day
     keeps that day's `E2E_TODAY`: stop it first.

**The nightly isolation run** (`.github/workflows/perf.yml`, the
`e2e-isolation` job, on the schedule and on dispatch) builds the app and runs
`playwright test --repeat-each=2 --retries=0 --workers=4`, then each spec file
alone (`--retries=0`), and a red night opens or comments on one issue
("Nightly E2E isolation run is red"). Pull requests keep `retries: 1`: the
nightly run is where order dependence shows. Locally:

```bash
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 npm run build
npx playwright test --repeat-each=2 --retries=0 --workers=4
for spec in $(git ls-files 'tests/e2e/*.spec.ts'); do npx playwright test "$spec" --retries=0 || echo "FAILED ALONE: $spec"; done
```

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
