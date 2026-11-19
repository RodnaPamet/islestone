/**
 * Epic E.3 — explicit API contract versioning.
 *
 * `X-API-Version` is set on every response that flows through
 * `withApiErrorHandling` — i.e. every wrapped route that shares the
 * canonical ApiErrorResponse contract. Bare/exempt routes (the health
 * probes, redirect-only flows, anti-enumeration uniform-200 responses, the
 * CSP report sink, the NextAuth catch-all) intentionally don't carry this
 * header — they have their own contracts and consumers.
 *
 * Copied from inflect-compliance `src/lib/api-version.ts` at
 * 5528464fc54a8681956f3b9ce23ca9c075f0420e; the version is Islestone's own
 * first contract date (sub-phase 1.5).
 *
 * **Bumping the version.** When a future change is breaking
 * (rename a field on a hot DTO, change an HTTP status mapping,
 * tighten a Zod schema, etc.), bump `API_VERSION` in lockstep
 * with the change. The version is a date for two reasons:
 *
 *   1. Date-string sort order trivially reflects "newer wins" —
 *      consumers comparing versions can use lexical compare.
 *   2. The string itself names when the breaking change shipped,
 *      which helps when correlating with operator runbooks /
 *      changelog entries.
 *
 * **What versioning DOESN'T do today.** This is a header marker
 * for forward compatibility, not a routing decision. The server
 * does not branch behaviour on a request's `X-API-Version` (that
 * would be content-negotiation, a separate epic). Consumers can
 * read the response header to detect which contract version they
 * received, log it for telemetry, or alert when it changes
 * unexpectedly. When we DO want server-side branching, the
 * mechanism extends naturally: read a request header
 * (`Accept-Version: 2026-11-19`), match against a registry of
 * supported versions, dispatch.
 */

export const API_VERSION = '2026-11-19';
export const API_VERSION_HEADER = 'X-API-Version';
