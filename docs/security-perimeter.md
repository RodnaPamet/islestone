# The security perimeter

Sub-phase 1.5. What stands between a request, or a value, and the data:
response headers and the Content-Security-Policy, CORS, server-side
sanitisation, outbound-request safety, and secret detection in the
repository. Field encryption, the audit trail and rate limiting have their
own documents: [encryption.md](encryption.md), [audit-trail.md](audit-trail.md)
and [rate-limiting.md](rate-limiting.md).

Written for Islestone, with §C.2 and §C.5 of inflect-compliance's
`docs/epic-c-security.md` and §D.2 of `docs/epic-d-completeness.md` mined
into it (`PROVENANCE.md`).

## Response headers

Every response carries the baseline set from `src/lib/security-headers.ts`:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
`Permissions-Policy` and, in production, `Strict-Transport-Security` (two
years, `includeSubDomains`). `next.config.ts` sets them on every route; the
middleware sets them again on a response it answers itself (a 401, a 403, a
redirect, a 429, a preflight), which `next.config.ts`'s `headers()` does not
reach.

## Content-Security-Policy, with a nonce per request

The policy is built per request in `src/middleware.ts` by
`buildCspHeader` (`src/lib/security/csp.ts`), because its `script-src` carries
a fresh nonce:

```
default-src 'self';
script-src 'self' 'nonce-<16 random bytes>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self' data:;
connect-src 'self' blob: https:; object-src 'none'; base-uri 'self';
frame-ancestors 'none'; form-action 'self';
worker-src 'self' blob:; manifest-src 'self';
upgrade-insecure-requests
```

(`csp.ts` is the source.) The nonce reaches the render two ways,
and both are needed:

- the **whole policy on the request's `Content-Security-Policy` header**,
  which is what Next.js reads to stamp its own chunk-preload and loader
  scripts with the nonce. Without it, `'strict-dynamic'` blocks every chunk;
- the nonce alone in the **`x-csp-nonce` request header**, which the root
  layout (`src/app/layout.tsx`) reads to set `__webpack_nonce__` for chunks
  loaded later. Reading `headers()` there makes every page dynamic, which a
  per-request nonce requires anyway.

`tests/guards/csp-request-header-bridge.test.ts`,
`csp-webpack-nonce-bridge.test.ts` and
`tests/unit/auth-flow/middleware-csp.test.ts` hold both bridges.

Decisions in the policy:

- **No `'unsafe-inline'` or `'unsafe-eval'` in production `script-src`.**
  Development adds `'unsafe-eval'` and `ws://localhost:*` for hot reload and
  drops `upgrade-insecure-requests`.
- **`style-src 'unsafe-inline'`, without a nonce.** A `style=""` attribute
  cannot be nonced, and the shared UI sets dynamic widths and colours that
  way; a nonce in `style-src` would disable `'unsafe-inline'` and break every
  one of them.
- **No third-party host.** Islestone serves its own fonts, so the source's
  Google Fonts entries are gone.
- **Violations are reported** (sub-phase 1.6) to `/api/security/csp-report`:
  the policy names it in `report-uri` (older browsers) and `report-to
  csp-endpoint`, and every response carries the matching `Report-To` and
  `Reporting-Endpoints` headers. See "CSP violation reports" below.
- **`CSP_REPORT_ONLY=1`** sends the same policy as
  `Content-Security-Policy-Report-Only`, for trying a tighter policy on a
  live deployment.

## CSP violation reports

Sub-phase 1.6. Copied from inflect-compliance's sink (`PROVENANCE.md`).

- **`POST /api/security/csp-report`** takes a browser's report in either
  format (`application/csp-report`, `application/reports+json`), keeps it in
  an in-process ring buffer of the last 500 (`src/lib/security/csp-violations.ts`)
  and answers 204 whatever it receives, so a malformed report teaches the
  sender nothing. The body is capped at 16 KB (413 above it) and each client
  IP at 30 reports a minute (429), inside the handler: the beacon carries no
  credential, and a limiter shared with an attacker would drop real reports.
  Each stored report is also logged once at WARN (document and blocked URI,
  directive, source file and line; not the client IP or user agent), for the
  log pipeline; the buffer itself is memory only and never written to the
  database. A document URI is a path in the app, so it can carry an id.
- **`GET /api/security/csp-report`** returns the summary (counts by
  directive and blocked URI, the recent entries) to the platform operator
  only: it requires `PLATFORM_ADMIN_API_KEY` (`verifyPlatformApiKey`,
  compared in constant time). The edge rate-limits GET and HEAD on both
  report paths at the read tier, keyed by IP, before the handler checks the
  key, so the key cannot be guessed at speed (`tests/unit/security/csp-report-get-rate-limit.test.ts`).
- **`/api/csp-report`** is the legacy path some browsers and older policies
  use. It hands the request to the same handler in the same process; it does
  not forward it over the network (inflect-compliance re-fetched its own
  origin, which made the route a request to a URL built from the request's
  host header).
- Both paths are machine callers (`MACHINE_CALLER_PREFIXES` in
  `src/lib/auth/guard.ts`): the edge lets them through without a session,
  and `tests/guards/machine-caller-paths-self-authenticate.test.ts` holds
  each method to its own check (the POST's limits, the GET's key).

## Public intake forms (2.6b)

The first anonymous write. A form published for "anyone with the link"
(`/f/<publicId>`) takes requests from people with no session, only while an
operator opens public forms (`INTAKE_PUBLIC_FORMS`, closed in production by
default; owner decision 86). The layers, each with its own test
(`docs/intake.md`, "Public forms (2.6b)"):

- **One pre-tenant read.** `resolvePublicIntakeForm` resolves the form's
  random public id under `runWithoutRls({ reason: 'public-intake-resolve' })`
  (decision 98; used in that one file) and answers one identical 404 for every
  form that is not open to the public; everything after runs in the
  workspace's context as its system user. The page shows only the form's own
  published text, and no public module reads a session
  (`tests/guards/public-intake-boundary.test.ts`).
- **Two machine-caller routes**, POST only, each gated in its handler
  (`acceptPublicIntakeRequest`, `confirmRequesterAddress`; contracts in
  `tests/guards/machine-caller-paths-self-authenticate.test.ts`): per-IP and
  per-form limits, `Sec-Fetch-Site: cross-site` refused, `application/json`
  only (a cross-origin `fetch` with it needs a preflight, which CORS refuses
  for an unlisted origin), a capped body read through the stream.
- **In-house bot defence** (decision 88): a signed form token (age, form,
  version, a nonce that makes one request), a proof-of-work solved by the
  page with WebCrypto (no script from another host, so the policy above is
  unchanged), a trap field, and daily caps counted in the database.
- **Content.** Every text sanitised before it is stored, the title stripped
  of control and bidirectional-override characters, rendered as text; the
  requester's name and address encrypted in place as personal data; no
  requester email repeats what they typed.
- **Not an embed.** `frame-ancestors 'none'` stays: a public form is a link.

## CORS

`src/lib/security/cors.ts`, applied in the middleware only. An origin is
allowed when it is listed in `CORS_ALLOWED_ORIGINS` (comma-separated, exact
match) or, in development and test only, is a localhost origin. Production
with the variable unset allows no cross-origin caller: the app's own pages
are same-origin and need none. An API preflight (`OPTIONS /api/**`) is
answered at the edge with a 204, the allow headers only for an allowed
origin, and the security headers.

## Sanitisation before storage

Free text a person types is sanitised **on the server, in the usecase or
route that stores it**, with `@/lib/security/sanitize`:

| Function | For |
|---|---|
| `sanitizePlainText` | Names, titles, descriptions: decodes entities first and strips every tag until the value is stable, so a pre-encoded `&lt;script&gt;` is removed like a raw one |
| `sanitizeRichTextHtml` | Rich text: a conservative allowlist of tags, attributes and link schemes |
| `sanitizeUrlText` | A stored URL: encodes the characters that could end an attribute or open a tag; it does not judge the scheme |

Sanitising at render time alone is not enough: the stored row reaches places
that never render it through React (an audit stream, an export, an email, a
future API consumer reading it verbatim). **Encryption is not safety to
render**: an encrypted field decrypts to whatever was written, so a field in
the encryption manifest is sanitised like any other.
`tests/guards/sanitize-rich-text-coverage.test.ts` derives the population
from `ENCRYPTED_FIELDS` and fails until every encrypted free-text model is
classified as sanitised, not free text, or knowingly uncovered. The 1.4
writers that store free text (`register`'s name and workspace name, custom
roles' name and description) sanitise it.

Each function returns `''` for `null`, `undefined` or a non-string, and never
throws, so a loosely typed caller cannot skip it by accident. Do not widen the
rich-text allowlist (`style`, `class`, `id`, `<svg>`, `<iframe>`, `<object>`,
`<embed>`) without a security review, and add positive and negative cases to
`tests/unit/security/sanitize.test.ts` when you change it.

`src/lib/security/safe-url.ts` (`isSafeHref`, `normaliseHref`,
`EXTERNAL_LINK_ATTRS`) is the render-side twin for links: a `javascript:`,
`data:`, `vbscript:` or `file:` URL (read as the browser reads it, control
characters dropped) never becomes an `href`, and a new-tab link carries
`rel="noopener noreferrer"`.

## Outbound requests

Every request Islestone makes to a URL a person configured goes through
`safeFetch` (`src/app-layer/automation/webhook-safety.ts`):

- https only; the host is resolved at request time and **every** resolved
  address is checked; a private, loopback, link-local or metadata address is
  refused (`SsrfBlockedError`); the connection is pinned to the address that
  was checked (undici's own `fetch` with a pinned `Agent`), which closes DNS
  rebinding; redirects are refused (`RedirectNotAllowedError`);
- `checkWebhookUrl` is the same check without the request, for a form that
  saves a URL.

A **self-hosted** deployment (no `STRIPE_SECRET_KEY`,
`src/lib/billing/billing-mode.ts`) may let it reach private ranges through
`EGRESS_PRIVATE_CIDR_ALLOWLIST` (`src/lib/security/egress-allowlist.ts`): a
deployment-level CIDR list, never tenant-configurable, inert on a hosted
deployment, and unable to admit loopback, `0.0.0.0/8`, link-local or the
metadata range whatever it says. `tests/guards/ssrf-egress-coverage.test.ts`
fails on an outbound `fetch` sink that does not go through `safeFetch`, and
`tests/guards/egress-allowlist.test.ts` holds the three properties.

Outbound webhooks sign their body with `computeHmacSha256`
(`src/app-layer/integrations/webhook-crypto.ts`) and build their headers
with `buildOutboundHeaders` (`src/app-layer/events/webhook-headers.ts`).

## Secret detection

One pattern list, `.secret-patterns`, two scanners:

- **Locally**, the Husky pre-commit hook (`.husky/pre-commit` →
  `scripts/detect-secrets.sh`) scans the staged files, including renamed
  ones (`git diff --cached --name-only --diff-filter=ACMR`). `npm install`
  installs the hook (`"prepare": "husky"`). `npm run secret-scan` scans the
  whole tree.
- **In CI**, `tests/guards/no-secrets.test.ts` scans every git-listed file.

A false positive is marked on its line with `// pragma: allowlist secret`
(or `# pragma: allowlist secret`), or moved under `tests/fixtures/secrets/`,
which both scanners skip. A known placeholder that cannot carry a comment
goes in the guard's `REPO_BASELINE`, with a written `reason`.

To prove the hook works:

```bash
echo 'const k = "AKIAIOSFODNN7EXAMPLE";' > leak.ts  # pragma: allowlist secret (AWS's documented fake key)
git add leak.ts && git commit -m 'leak'
# ✖ Possible secrets detected in staged changes
#   AWS Access Key ID
git restore --staged leak.ts && rm leak.ts
```

`git commit --no-verify` skips the hook for one commit, deliberately: the CI
guard is the gate that cannot be skipped. A real secret that reached a commit
is rotated, not just removed: it is in the history.

## Failure modes, by design

| Layer | Degradation | Why |
|---|---|---|
| Edge rate limits | An Upstash error lets the request through and logs at `error`. | A Redis outage must not take the API down. |
| Audit stream | A failed delivery is retried, then dropped with a warning. | The audit row is already committed; the stream is a copy. |
| `AUTHZ_DENIED` audit | The chain, else the outbox, else the request fails. | A denial with no record is worse than a failed request (`docs/audit-trail.md`). |
| Field decryption | Fails closed on a real decrypt failure (`docs/encryption.md`). | A ciphertext blob read as a string contaminates every export. |
| Sanitisers | Never throw; non-strings become `''`. | A sanitiser must not become an outage. |
