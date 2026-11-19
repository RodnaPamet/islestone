# syntax=docker/dockerfile:1
#
# Islestone's container images (sub-phase 1.8). One Dockerfile, one build,
# two runnable targets, both published for every commit on `main` under the
# same tags (.github/workflows/release.yml):
#
#   app     ghcr.io/rodnapamet/islestone          `next build`'s standalone
#                                                 server and nothing else.
#   worker  ghcr.io/rodnapamet/islestone-worker   the BullMQ worker, the
#                                                 scheduler, the worker health
#                                                 probe and the Prisma CLI that
#                                                 the one-shot `migrate` service
#                                                 runs.
#
# WHY TWO IMAGES AND NOT ONE WITH TWO COMMANDS. The worker bundles
# (scripts/build-worker.mjs) keep every package external, so they need the
# whole production dependency tree, and `prisma migrate deploy` needs the
# Prisma CLI and its tree (Prisma Studio and elkjs included). `output:
# 'standalone'` traces the server down to the ~50 packages it loads. One image
# would put the full tree into the only container the internet reaches; two
# keep the app small and leave the CLI where only an operator-run, one-shot
# container can use it. Both come from one builder stage, so a tag names the
# same commit in both, and the migrations the worker image applies are the
# ones the app image expects (`.migration-head`, below).
#
# Build locally:
#   docker build --target app -t islestone:dev .
#   docker build --target worker -t islestone-worker:dev .
#
# Layout and hardening adapted from inflect-compliance's Dockerfile
# (PROVENANCE.md, "Copied: environments and delivery"): npm ci from the
# lockfile, the workspace manifest copied before the install, dev
# dependencies pruned before the runtime stage copies node_modules, the npm
# CLI removed from the runtime images, a non-root user and BUILD_SHA baked in
# last. `tests/unit/deploy/dockerfile.test.ts` holds the shape.

ARG NODE_IMAGE=node:24.22.3-alpine3.23

# ─── deps: the full dependency tree, from the lockfile ─────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# openssl: Prisma's postinstall detects the platform's libssl to fetch the
# schema engine the `migrate` service runs (linux-musl-openssl-3.0.x).
RUN apk add --no-cache openssl
# Husky's `prepare` hook installs git hooks; there is no .git here.
ENV HUSKY=0
# The workspace manifest must be present before `npm ci`, or npm silently
# omits the `@inflect/ui` link and the build cannot resolve the package
# (inflect-compliance measured it: exit 0, one package fewer).
COPY package.json package-lock.json .npmrc ./
COPY packages/ui/package.json ./packages/ui/
# `postinstall` is `prisma generate`, which reads the schema and the config.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund

# ─── builder: the Next.js build, the worker bundles, then the prune ────────
FROM deps AS builder
COPY . .
# Inlined into the client bundle at build time, so the image is built for one
# origin. Production only (owner decision, 2026-11-19).
ARG NEXT_PUBLIC_APP_URL=https://islestone.cloud
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    SKIP_ENV_VALIDATION=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build && npm run build:worker \
    && rm -rf .next/cache .next/trace \
    && mkdir -p public
# The newest migration this build carries. Both images wait for it to be
# applied before they start (scripts/wait-for-migrations.mjs).
RUN node scripts/wait-for-migrations.mjs --print-head prisma/migrations > .migration-head
# The worker image copies node_modules; drop the dev tree first. The Prisma
# CLI stays: it is an optional peer of @prisma/client, so npm marks it
# devOptional and `--omit=dev` keeps it (ADR 0007 E7).
RUN npm prune --omit=dev --no-audit --no-fund \
    && rm -f node_modules/@inflect/ui && (rmdir node_modules/@inflect 2>/dev/null || true)

# ─── runtime base: no npm, a non-root user ─────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
# Nothing at run time calls npm, npx or corepack: the server is
# `node server.js`, the worker `node dist/*.mjs`, migrations
# `node_modules/.bin/prisma`. Removing them removes their vendored trees from
# every vulnerability scan of the image.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /root/.npm \
    && ! command -v npm && ! command -v npx
# The licence and the third-party notices travel with the binaries
# (ADR 0007: libvips is LGPL-3.0-or-later and loaded as a separate, replaceable
# shared library; elkjs is EPL-2.0).
COPY --from=builder /app/LICENSE /app/NOTICE ./
COPY --from=builder /app/.migration-head ./.migration-head
COPY --from=builder /app/scripts/wait-for-migrations.mjs ./scripts/wait-for-migrations.mjs

# ─── app: the standalone Next.js server ────────────────────────────────────
FROM runtime AS app
# The standalone server binds HOSTNAME; Docker would otherwise set it to the
# container id, and the server would listen on one network's address only.
ENV PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# The `node` user (uid 1000) ships with the official image. Nothing under
# /app is writable by it except `.next/cache`, where the server keeps its
# image-optimiser and fetch caches.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
# Liveness only: a dependency outage must not mark every replica unhealthy at
# once. The production Compose file overrides this with /api/readyz, whose
# state is what an operator wants to see in `docker ps`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/livez').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA}
CMD ["/bin/sh", "-c", "node scripts/wait-for-migrations.mjs && exec node server.js"]

# ─── worker: the BullMQ worker, the scheduler and the migrate CLI ──────────
FROM runtime AS worker
# libssl for Prisma's schema engine (`migrate` runs this image).
RUN apk add --no-cache openssl
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
USER node
# Reads the heartbeat the worker refreshes after each completed job
# (scripts/worker-healthcheck.ts). Nothing beats until the scheduler has
# registered the two-minute `health-check` job and it has run once.
HEALTHCHECK --interval=60s --timeout=10s --start-period=300s --retries=3 \
    CMD ["node", "dist/worker-healthcheck.mjs"]
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA}
# Wait for this image's migrations, register the repeatable jobs (idempotent),
# then replace the shell with the worker, so it receives SIGTERM itself.
CMD ["/bin/sh", "-c", "node scripts/wait-for-migrations.mjs && node dist/scheduler.mjs && exec node dist/worker.mjs"]
