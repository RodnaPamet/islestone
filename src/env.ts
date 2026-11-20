import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { DEV_FALLBACK_DATA_ENCRYPTION_KEY } from './lib/security/encryption-constants';
import { parseCidr } from './lib/security/cidr';

import { skipEnvValidation } from './env-skip';

/**
 * SERVER environment. Only server code may import this module.
 *
 * Why two modules: a server variable's VALUE never reaches a browser, but this
 * file's SCHEMA is ordinary module code. If a `'use client'` file can reach it
 * through any chain of imports, `next build` bundles every key name and every
 * validator below into that route's client JavaScript. So browser-reachable
 * code reads `@/env-client` (NEXT_PUBLIC_ variables only), and
 * `tests/guards/client-env-boundary.test.ts` fails, naming the import chain,
 * when a client file can reach this one.
 *
 * Add a variable here, never as a raw `process.env` read elsewhere in `src/`,
 * and add it to `.env.example` in the same change.
 */
export const env = createEnv({
    server: {
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

        /**
         * PostgreSQL, through PgBouncer in transaction mode (see
         * docker-compose.yml). The runtime Prisma client (src/lib/prisma.ts)
         * connects here.
         */
        DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),

        /**
         * Direct connection to Postgres, bypassing PgBouncer. Used by the
         * Prisma CLI for migrations (prisma.config.ts), which need DDL and
         * lock semantics PgBouncer does not provide. Falls back to
         * DATABASE_URL when unset (a non-pooled environment).
         */
        DIRECT_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

        /**
         * Read-replica connection string. When set, reads explicitly marked
         * replica-tolerant route to it through `prismaRead` and
         * `runInTenantReadContext`; writes and read-after-write stay on
         * DATABASE_URL. Unset means single-database mode. See
         * docs/database-routing.md.
         */
        DATABASE_READ_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),

        /** Minimum log level (src/lib/observability/logger.ts). Defaults by NODE_ENV. */
        LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),

        /**
         * Redis: the BullMQ job queue and the worker heartbeat (sub-phase
         * 1.6). REQUIRED in production, and the URL must carry a password in
         * its userinfo (`redis://:PASSWORD@HOST:6379`, or `rediss://` for TLS):
         * an unauthenticated Redis that is network-reachable lets anyone who
         * can reach the port read and enqueue jobs. `src/instrumentation-node.ts`
         * refuses a production boot without it again, for the case where
         * SKIP_ENV_VALIDATION=1 leaks into the runtime container. The rule
         * reads `process.env.NODE_ENV` itself, as DATA_ENCRYPTION_KEY's does.
         */
        REDIS_URL: z
            .url({ protocol: /^rediss?$/ })
            .optional()
            .superRefine((val, ctx) => {
                if (process.env.NODE_ENV !== 'production') return;
                if (!val) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'REDIS_URL is REQUIRED in production. The job queue and ' +
                            'the worker heartbeat depend on it. Set REDIS_URL ' +
                            '(e.g. redis://:PASSWORD@HOST:6379) before deploying.',
                    });
                    return;
                }
                if (!new URL(val).password) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'REDIS_URL must be AUTHENTICATED in production. A bare ' +
                            'redis://HOST:6379 leaves Redis open to anyone who can ' +
                            'reach the port. Set a password: redis://:PASSWORD@HOST:6379 ' +
                            '(or rediss:// for TLS).',
                    });
                }
            }),

        // ─── Authentication (sub-phase 1.4, ADR 0004) ────────────────
        /** NextAuth's signing and encryption secret. At least 16 characters. */
        AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters long'),
        /** NextAuth's canonical URL (v4 reads it itself as well). */
        NEXTAUTH_URL: z.url().optional(),
        /** The deployment's public origin, for links in email and redirects. */
        APP_URL: z.url().optional(),
        /** Google sign-in. The provider is offered only when both are set. */
        GOOGLE_CLIENT_ID: z.string().min(1).optional(),
        GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
        /** Microsoft sign-in. The provider is offered only when both are set. */
        MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
        MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
        MICROSOFT_TENANT_ID: z.string().default('common'),
        /**
         * "1" disables the credential throttle and both rate-limit tiers, for
         * tests and the E2E server. Refused in production unless
         * NEXT_TEST_MODE is "1" (set only by the Playwright webServer).
         */
        AUTH_TEST_MODE: z
            .enum(['0', '1'])
            .optional()
            .superRefine((val, ctx) => {
                if (process.env.NODE_ENV !== 'production') return;
                // `next start` forces NODE_ENV=production even under test,
                // so the E2E server would otherwise trip this.
                if (process.env.NEXT_TEST_MODE === '1') return;
                if (val === '1') {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'AUTH_TEST_MODE must not be "1" in production. It disables the ' +
                            'login brute-force throttle and both rate-limit tiers. Remove it ' +
                            'from the production environment.',
                    });
                }
            }),
        /** Set by the Playwright webServer only; see AUTH_TEST_MODE. */
        NEXT_TEST_MODE: z.enum(['0', '1']).optional(),
        /** "1": a password sign-in needs a verified email address. */
        AUTH_REQUIRE_EMAIL_VERIFICATION: z.enum(['0', '1']).optional(),
        /** "1": the sign-in page hides the email and password form. */
        AUTH_CREDENTIALS_UI_HIDDEN: z.enum(['0', '1']).optional(),
        /**
         * Public self-sign-up at `/api/auth/register` (ADR 0006, owner
         * decision 2026-11-18): "1" opens it, "0" closes it. Unset, it is
         * closed in production and open otherwise. Read through
         * `isPublicSignupOpen` (src/lib/auth/public-signup.ts).
         */
        AUTH_PUBLIC_SIGNUP: z.enum(['0', '1']).optional(),
        /**
         * Public intake forms (sub-phase 2.6b, owner decision 86): "1" opens
         * them, "0" closes them. Unset, they are closed in production and
         * open otherwise. Closed, every public form, its submit and its
         * confirmation link answer one 404. Read through `isPublicIntakeOpen`
         * (src/lib/intake/public-switch.ts).
         */
        INTAKE_PUBLIC_FORMS: z.enum(['0', '1']).optional(),
        /** Platform-operator key (and its predecessor during a rotation). */
        PLATFORM_ADMIN_API_KEY: z.string().min(32).optional(),
        PLATFORM_ADMIN_API_KEY_PREVIOUS: z.string().min(32).optional(),
        /**
         * Rate-limit store for the credential throttle and the edge read and
         * auth tiers: Upstash (shared across processes and edge isolates), or
         * process memory (one process). The default stays `upstash`.
         *
         * Issue #17: with `upstash` and no Upstash URL or token, the
         * limiters cannot reach a store, and the credential throttle used to
         * let every request through without a word. Production now REFUSES to
         * start in that state. A production deployment either configures
         * both `UPSTASH_REDIS_REST_*` values or chooses `memory` explicitly
         * (per process, so the limit multiplies by the instance count). The
         * hosting decision (Upstash, a self-hosted REST proxy over the
         * stack's Redis, or memory) is the owner's (docs/porting/maps/1.5.md,
         * Traps). NEXT_TEST_MODE=1 (the Playwright server) is exempt, like
         * AUTH_TEST_MODE below.
         */
        RATE_LIMIT_MODE: z
            .enum(['upstash', 'memory'])
            .default('upstash')
            .superRefine((val, ctx) => {
                // NODE_ENV and the Upstash values are read from process.env:
                // zod parses each field on its own, so the parsed siblings
                // are not available here (the same reason DATA_ENCRYPTION_KEY
                // reads it). An empty string counts as unset, as
                // `emptyStringAsUndefined` treats it.
                if (process.env.NODE_ENV !== 'production') return;
                if (process.env.NEXT_TEST_MODE === '1') return;
                if (val !== 'upstash') return;
                const missing = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'].filter(
                    (key) => !process.env[key],
                );
                if (missing.length === 0) return;
                ctx.addIssue({
                    code: 'custom',
                    message:
                        `RATE_LIMIT_MODE is "upstash" (the default) but ${missing.join(' and ')} ` +
                        `${missing.length === 1 ? 'is' : 'are'} not set. In production that would leave ` +
                        'the sign-in throttle and the rate-limit tiers without a store. Set both ' +
                        'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or set ' +
                        'RATE_LIMIT_MODE=memory to limit per process.',
                });
            }),
        /** "0" turns every rate limit off. */
        RATE_LIMIT_ENABLED: z.enum(['0', '1']).optional(),
        UPSTASH_REDIS_REST_URL: z.url().optional(),
        UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
        /** Test-only: "1" lets the edge logger write under NODE_ENV=test. */
        EDGE_LOGGER_IN_TEST: z.enum(['0', '1']).optional(),

        // ─── Security perimeter (sub-phase 1.5) ──────────────────────
        /**
         * The master key-encryption key (KEK) for field encryption
         * (src/lib/security/encryption.ts, docs/encryption.md). At least 32
         * characters. REQUIRED in production, where the documented dev
         * fallback is refused too; development and test use the fallback.
         * Generate one with `openssl rand -base64 48`.
         *
         * The production rule is a field-level superRefine that reads
         * `process.env.NODE_ENV` itself, because zod parses each field on its
         * own and the parsed NODE_ENV is not available here.
         */
        DATA_ENCRYPTION_KEY: z
            .string()
            .min(32, 'DATA_ENCRYPTION_KEY must be at least 32 characters')
            .optional()
            .superRefine((val, ctx) => {
                if (process.env.NODE_ENV !== 'production') return;
                if (!val) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'DATA_ENCRYPTION_KEY is REQUIRED in production. ' +
                            'Generate with: openssl rand -base64 48',
                    });
                    return;
                }
                if (val === DEV_FALLBACK_DATA_ENCRYPTION_KEY) {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'DATA_ENCRYPTION_KEY equals the documented dev ' +
                            'fallback. Refusing to boot — generate a real ' +
                            'key with: openssl rand -base64 48',
                    });
                }
            }),
        /**
         * The outgoing KEK during a master-key rotation: a decrypt fallback
         * for ciphertext the new primary cannot read. Remove it once the
         * rotation sweep reports no rows left under the old key.
         */
        DATA_ENCRYPTION_KEY_PREVIOUS: z.string().min(32).optional(),
        /**
         * The key the deterministic lookup hashes (`User.emailHash`) derive
         * from. Unset, it falls back to DATA_ENCRYPTION_KEY's material. Set
         * it at first deploy (to its own value or to the KEK's), so a later
         * KEK rotation does not move every hash: a hash is an index, and a
         * moved index makes every email sign-in miss.
         */
        LOOKUP_HASH_KEY: z.string().min(32).optional(),
        /**
         * The key every HKDF subkey (`deriveSubkey`) derives from. Unset, it
         * falls back to DATA_ENCRYPTION_KEY's material. A sibling of
         * LOOKUP_HASH_KEY, not the same variable: a signing key should be
         * rotatable, an index never.
         */
        DERIVED_SUBKEY_KEY: z.string().min(32).optional(),
        /**
         * "0" makes a genuine decrypt failure (a key resolved, AES-GCM still
         * refused) pass the ciphertext through instead of failing the read.
         * The incident lever for a page that 500s on one corrupt row; leave
         * it unset in normal operation.
         */
        ENCRYPTION_DECRYPT_FAIL_CLOSED: z.string().optional(),
        /** "0" sends each audit-stream batch once, without retries. */
        AUDIT_STREAM_RETRY_ENABLED: z.string().optional(),
        /**
         * Self-hosted only: comma-separated private CIDRs `safeFetch` may
         * reach (an internal SIEM, say). Inert on a hosted deployment, and
         * loopback and cloud metadata stay refused inside it. Validated for
         * shape here so a typo fails at startup; the runtime parser drops
         * anything unparseable, which fails closed.
         */
        EGRESS_PRIVATE_CIDR_ALLOWLIST: z
            .string()
            .optional()
            .refine(
                (v) =>
                    v === undefined ||
                    v
                        .split(',')
                        .map((e) => e.trim())
                        .filter(Boolean)
                        .every((e) => parseCidr(e) !== null),
                {
                    message:
                        'EGRESS_PRIVATE_CIDR_ALLOWLIST must be a comma-separated list of CIDRs, ' +
                        "e.g. '10.0.0.0/8,192.168.0.0/16' or 'fd00::/8'",
                },
            ),
        /**
         * Billing (sub-phase 8.1 consumes it). Its presence is what makes a
         * deployment hosted rather than self-hosted
         * (src/lib/billing/billing-mode.ts).
         */
        STRIPE_SECRET_KEY: z.string().optional(),
        /**
         * "1" (or "true"/"yes") sends the Content-Security-Policy as
         * Content-Security-Policy-Report-Only: violations are reported in the
         * browser and not blocked. Unset, the policy is enforced.
         */
        CSP_REPORT_ONLY: z.string().optional(),
        /**
         * Comma-separated origins allowed to call `/api/**` cross-origin
         * (src/lib/security/cors.ts). Unset in production means none:
         * fail-closed. Development and test also admit http://localhost.
         */
        CORS_ALLOWED_ORIGINS: z.string().optional(),
        /** Set by Next.js itself: `nodejs` or `edge` (src/instrumentation.ts). */
        NEXT_RUNTIME: z.string().optional(),

        // ─── Jobs, notifications and observability (sub-phase 1.6) ───
        /** "true" starts the OpenTelemetry SDK (src/lib/observability/instrumentation.ts). */
        OTEL_ENABLED: z.enum(['true', 'false']).optional(),
        /** "true" logs the OpenTelemetry SDK's own diagnostics. */
        OTEL_DEBUG: z.enum(['true', 'false']).optional(),
        /** The `service.name` resource attribute. Defaults to `islestone`. */
        OTEL_SERVICE_NAME: z.string().min(1).optional(),
        /** OTLP/HTTP collector base URL. Defaults to http://localhost:4318. */
        OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
        /**
         * Set by npm when a process starts through `npm run`/`npm start`: the
         * `service.version` resource attribute. Not set by the deployer.
         */
        npm_package_version: z.string().optional(),
        /**
         * SMTP relay host. Set, the mailer sends through nodemailer
         * (src/lib/mailer.ts, `initMailerFromEnv`); unset, mail goes to the
         * console sink, and production says so at WARN.
         */
        SMTP_HOST: z.string().min(1).optional(),
        /** SMTP port. Defaults to 587; 465 means implicit TLS. */
        SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
        /**
         * The IANA zone the due-date reminder counts calendar days in and the
         * daily `work-item-due-notification` cron runs in (sub-phase 2.2).
         */
        NOTIFICATIONS_TZ: z
            .string()
            .default('Europe/London')
            .refine((tz) => {
                try {
                    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
                    return true;
                } catch {
                    return false;
                }
            }, 'NOTIFICATIONS_TZ must be an IANA time zone, such as Europe/London'),
        /**
         * Days a soft-deleted work item or project stays restorable before
         * `work-item-purge` hard-deletes it (ADR 0002 §8: 30, owner decision
         * 2026-11-19).
         */
        WORK_ITEM_PURGE_DAYS: z.coerce.number().int().min(1).default(30),
        /** SMTP user; with SMTP_PASS, the relay's credentials. Both or neither. */
        SMTP_USER: z.string().min(1).optional(),
        /** SMTP password. A secret: never logged. */
        SMTP_PASS: z.string().min(1).optional(),
        /**
         * Sentry project DSN. Unset, the Sentry SDK is never initialised and
         * every capture is a no-op (src/lib/observability/sentry.ts).
         */
        SENTRY_DSN: z.url().optional(),
        /** The Sentry environment tag. Defaults to NODE_ENV. */
        SENTRY_ENVIRONMENT: z.string().min(1).optional(),
        /** Sentry performance sample rate, 0 to 1. Defaults to 0 (tracing is OpenTelemetry's). */
        SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
        /**
         * The deployment's sender address: the fallback `From` for every
         * outbound email (src/lib/email/sender-identity.ts). Unset, the
         * placeholder `noreply@islestone.invalid` is used, which no relay
         * will accept.
         */
        SMTP_FROM: z.string().min(1).optional(),

        // ─── Environments and delivery (sub-phase 1.8) ───────────────
        /**
         * The commit the running image was built from. The Dockerfile bakes
         * it in from the `BUILD_SHA` build argument the publish workflow
         * passes; `/api/readyz` reports it as `version`, so a deploy can be
         * confirmed from outside the VM. Unset (a local or CI build) reads as
         * `dev`.
         */
        BUILD_SHA: z.string().min(1).optional(),
    },

    // Listed key by key so a variable cannot be declared without being wired.
    runtimeEnv: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_URL: process.env.DATABASE_URL,
        DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
        DATABASE_READ_URL: process.env.DATABASE_READ_URL,
        LOG_LEVEL: process.env.LOG_LEVEL,
        REDIS_URL: process.env.REDIS_URL,
        AUTH_SECRET: process.env.AUTH_SECRET,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        APP_URL: process.env.APP_URL,
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
        MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
        MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
        MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
        AUTH_TEST_MODE: process.env.AUTH_TEST_MODE,
        NEXT_TEST_MODE: process.env.NEXT_TEST_MODE,
        AUTH_REQUIRE_EMAIL_VERIFICATION: process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
        AUTH_CREDENTIALS_UI_HIDDEN: process.env.AUTH_CREDENTIALS_UI_HIDDEN,
        AUTH_PUBLIC_SIGNUP: process.env.AUTH_PUBLIC_SIGNUP,
        INTAKE_PUBLIC_FORMS: process.env.INTAKE_PUBLIC_FORMS,
        PLATFORM_ADMIN_API_KEY: process.env.PLATFORM_ADMIN_API_KEY,
        PLATFORM_ADMIN_API_KEY_PREVIOUS: process.env.PLATFORM_ADMIN_API_KEY_PREVIOUS,
        RATE_LIMIT_MODE: process.env.RATE_LIMIT_MODE,
        RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
        UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
        EDGE_LOGGER_IN_TEST: process.env.EDGE_LOGGER_IN_TEST,
        DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
        DATA_ENCRYPTION_KEY_PREVIOUS: process.env.DATA_ENCRYPTION_KEY_PREVIOUS,
        LOOKUP_HASH_KEY: process.env.LOOKUP_HASH_KEY,
        DERIVED_SUBKEY_KEY: process.env.DERIVED_SUBKEY_KEY,
        ENCRYPTION_DECRYPT_FAIL_CLOSED: process.env.ENCRYPTION_DECRYPT_FAIL_CLOSED,
        AUDIT_STREAM_RETRY_ENABLED: process.env.AUDIT_STREAM_RETRY_ENABLED,
        EGRESS_PRIVATE_CIDR_ALLOWLIST: process.env.EGRESS_PRIVATE_CIDR_ALLOWLIST,
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        CSP_REPORT_ONLY: process.env.CSP_REPORT_ONLY,
        CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
        NEXT_RUNTIME: process.env.NEXT_RUNTIME,
        OTEL_ENABLED: process.env.OTEL_ENABLED,
        OTEL_DEBUG: process.env.OTEL_DEBUG,
        OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
        OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
        npm_package_version: process.env.npm_package_version,
        SMTP_HOST: process.env.SMTP_HOST,
        SMTP_PORT: process.env.SMTP_PORT,
        NOTIFICATIONS_TZ: process.env.NOTIFICATIONS_TZ,
        WORK_ITEM_PURGE_DAYS: process.env.WORK_ITEM_PURGE_DAYS,
        SMTP_USER: process.env.SMTP_USER,
        SMTP_PASS: process.env.SMTP_PASS,
        SMTP_FROM: process.env.SMTP_FROM,
        SENTRY_DSN: process.env.SENTRY_DSN,
        SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT,
        SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
        BUILD_SHA: process.env.BUILD_SHA,
    },

    skipValidation: skipEnvValidation(),

    // Compose and shell defaults produce empty strings ("${VAR:-}"); treat
    // an empty value as unset rather than as an invalid URL.
    emptyStringAsUndefined: true,
});
