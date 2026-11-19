# API rate limiting

Islestone has **three rate-limit tiers**, each scoped to a different
traffic class. They share no budget: a script that exhausts the read tier
can still sign in, and a credential spray does not spend legitimate users'
read budget.

Copied and edited from inflect-compliance's `docs/rate-limiting.md`
(`PROVENANCE.md`). The anonymous edge surfaces, API-key callers and the
MCP endpoint sections are left out: Islestone has none of those surfaces
yet (API keys arrive in 5.2, MCP in 6.2; see the note at the end).

## Tiers

| Tier | Preset | Budget | Applied at | Key shape |
|------|--------|--------|------------|-----------|
| **Auth** | tiered (10/30/60 per min) | 10/min for sign-in, callback, sign-out and SSO entry points; 30/min for session probes; 60/min for `/csrf`, `/providers` and the rest of `/api/auth/` | Edge middleware | `(IP, ua-hash)` |
| **Mutation** | `API_MUTATION_LIMIT` | 60 per minute | Node route handlers via `withApiErrorHandling` | `<scope>:ip:<ip>:<actor>`; `actor` is `anon` unless the route passes a `getUserId` resolver, which no route does yet |
| **Read** | `API_READ_LIMIT` | 120 per minute | Edge middleware | `(IP, userId, tenantSlug)` |

The numbers are sized for interactive use: a person filling in forms or
paging through lists stays well below every threshold.

Some routes take a stricter preset on the mutation tier through
`withApiErrorHandling(handler, { rateLimit: { config, scope } })`:
`LOGIN_LIMIT`, `MFA_VERIFY_LIMIT`, `MFA_ENROLL_VERIFY_LIMIT`,
`EMAIL_DISPATCH_LIMIT` and `TENANT_CREATE_LIMIT`, all in
`src/lib/security/rate-limit.ts`. A credentials sign-in also runs the
progressive lockout (`LOGIN_PROGRESSIVE_POLICY`), which is a separate
mechanism with its own tests.

## Where each tier lives

| Tier | Source of truth (preset) | Enforcement module | Storage |
|------|--------------------------|--------------------|---------|
| Auth | `src/lib/rate-limit/authRateLimit.ts` | same file, called from `src/middleware.ts` for `/api/auth/**` | Upstash, or memory |
| Mutation | `src/lib/security/rate-limit.ts` (`API_MUTATION_LIMIT`) | `src/lib/security/rate-limit-middleware.ts` (`enforceRateLimit`), called by `withApiErrorHandling` in `src/lib/errors/api.ts` | in-process Map (Node runtime) |
| Read | `src/lib/security/rate-limit.ts` (`API_READ_LIMIT`) | `src/lib/rate-limit/apiReadRateLimit.ts`, called from `src/middleware.ts` | Upstash, or memory |

The edge tiers run in the middleware, on the Edge runtime, which cannot
import the Node-only `withApiErrorHandling` wrapper; that is why they have
their own modules.

## Storage: `RATE_LIMIT_MODE`

The two edge tiers store their counters in Upstash Redis when
`RATE_LIMIT_MODE` is `upstash` (the default) and in a per-process Map when
it is `memory`. A per-process Map is per container: behind more than one
instance, each instance keeps its own count, so the effective budget is
the preset times the number of instances.

**A production start with `RATE_LIMIT_MODE=upstash` and no Upstash
credentials is refused** (issue #17). The Upstash client is built with an
empty URL rather than refused, every call to it then fails, and every
limiter fails open on an Upstash error: a production deployment that forgot
`UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_TOKEN` let every request
through the sign-in throttle and the edge tiers. Two checks now refuse it:

1. the `RATE_LIMIT_MODE` schema in `src/env.ts`, which names the missing
   variable when the env module loads (`NODE_ENV=production`, not
   `NEXT_TEST_MODE=1`);
2. `checkProductionRateLimitStore` in
   `src/lib/security/startup-rate-limit-check.ts`, run from
   `src/instrumentation-node.ts`, for a process started with
   `SKIP_ENV_VALIDATION=1`.

A deployment that means to run on memory says so with
`RATE_LIMIT_MODE=memory`. The Playwright server does, with
`NEXT_TEST_MODE=1`.

## Read-tier scope

The read tier matches **only**:

- **GET requests.** POST, PUT, PATCH and DELETE on the same paths go
  through `API_MUTATION_LIMIT` instead.
- **Paths under `/api/t/`**, the tenant-scoped API. The auth routes
  (`/api/auth/*`) have their own tier, and the organization and account
  routes are not throttled at the edge.

It runs **after** the JWT is verified and the tenant-access gate has
passed, so an unauthorised request gets the cheaper 401 or 403 first
(`tests/guards/api-read-rate-limit.test.ts` holds the order).

### Exclusions

These paths are **never** read-throttled:

| Path | Reason |
|------|--------|
| `/api/health` | Health probe: operators keep monitoring access during an attack. |
| `/api/livez` | Liveness probe. |
| `/api/readyz` | Readiness probe. |
| `/api/docs` | Not a route today; listing it means a future docs surface ships unthrottled. |

The match is prefix-with-slash (`path === excluded ||
path.startsWith(excluded + '/')`), so `/api/health` matches and
`/api/healthcheck` does not. `tests/unit/api-read-rate-limit.test.ts`
holds that case.

## Bucketing

The read tier keys on **`(IP, userId, tenantSlug)`**:

- **Per workspace:** the same person in workspaces A and B has two
  budgets, so a runaway tab in A does not starve B.
- **Per person within a workspace:** ten members each get their own
  120/min.

The auth tier keys on `(IP, ua-hash)` because it runs before
authentication, with no user to key on.

## 429 response shape

An exhausted read tier answers:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1714328400000

{
  "error": {
    "code": "RATE_LIMITED",
    "scope": "api-read",
    "message": "Too many read requests. Retry after 47 seconds.",
    "retryAfterSeconds": 47
  }
}
```

The mutation tier answers the same shape with `scope: "api-mutation"` (or
the route's own scope) and also carries `x-request-id`. The auth tier
answers `{ "error": "RATE_LIMITED", "retryAfterSeconds": n }` with
`Retry-After` and the `X-RateLimit-*` headers.

No body contains the IP, the user id or the workspace slug; they are
logged on the server only, and the log line leaves the IP and user out
too.

## Bypass gates (development and test)

| Env var | Effect |
|---------|--------|
| `RATE_LIMIT_ENABLED=0` | Disables every tier. Never set in production. |
| `AUTH_TEST_MODE=1` | Set by the Playwright server. Skips all three tiers. |
| `NEXT_TEST_MODE=1` | Skips the read and mutation tiers (not the auth tier). |

Under Jest (`NODE_ENV=test`) the mutation tier is also off unless a test
sets `RATE_LIMIT_ENABLED=1`, which the rate-limit suites do. Production
cannot disable rate limiting without an explicit `RATE_LIMIT_ENABLED=0`.

## Tuning

1. Find the preset in `src/lib/security/rate-limit.ts` (mutation and read
   tiers) or the tier table in `src/lib/rate-limit/authRateLimit.ts`.
2. Change `maxAttempts` and/or `windowMs`, with a comment justifying the
   values. Each preset carries a threat-model note; keep that pattern.
3. Re-run `tests/unit/api-read-rate-limit.test.ts`,
   `tests/guards/api-read-rate-limit.test.ts`, the `tests/unit/rate-limit-*`
   suites and `tests/unit/auth-flow/auth-ratelimit.test.ts`.

`tests/guards/api-read-rate-limit.test.ts` asserts that `API_READ_LIMIT`
has a 60-second window: a longer one silently weakens the gate.

## Operational signals

Every blocked request logs at `warn` through the edge logger:

```
{ "level": "warn", "component": "rate-limit", "scope": "api-read",
  "tenantSlug": "acme", "msg": "API read rate limit exceeded" }
```

The auth tier logs under the same `component: 'rate-limit'`. An Upstash
error fails open (the request goes through) and logs at `error`: a Redis
outage must not take the API down. The mutation tier records
`rate_limit.scope` on the request span.

## Adding a new tier

1. Add the preset to `src/lib/security/rate-limit.ts` with a threat-model
   note.
2. Re-export it from `src/lib/security/rate-limit-middleware.ts`.
3. At the edge, add a module under `src/lib/rate-limit/` mirroring
   `apiReadRateLimit.ts`; in route handlers, pass the preset to
   `withApiErrorHandling`.
4. Wire it in after the auth gates.
5. Document it here and add a structural guard beside
   `tests/guards/api-read-rate-limit.test.ts`.

## Later callers

API keys (5.2) reach the edge with no session cookie, so they cannot be
keyed on a user. inflect-compliance meters them per key digest and per IP,
on every method, because the credential is the thing an attacker varies;
`enforceApiKeyRateLimit` and `buildApiKeyRateLimitKey` are already in
`rate-limit-middleware.ts` for that. 5.2 brings the edge wiring and this
section's full text.
