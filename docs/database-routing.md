# Database routing — primary vs read replica

A deployment can run a read replica for analytical and dashboard reads, taking aggregation pressure off the primary. Routing is **opt-in per usecase** and deliberately conservative: replicas are eventually consistent, so only reads that tolerate lag go there. Production runs no replica yet (sub-phase 1.8, `docs/deployment.md`): `DATABASE_READ_URL` is unset there, so every read uses the primary.

## The two clients

Both live in `src/lib/prisma.ts` and carry the **same extension chain** (the RLS tripwire today; audit, soft delete, field encryption and PII from sub-phases 1.5 and 2.1), so encrypted columns will decrypt and `deletedAt` filtering will apply on either path:

| Client | Connection | Used by |
|--------|-----------|---------|
| `prisma` | `DATABASE_URL` (primary, via PgBouncer) | everything by default |
| `prismaRead` | `DATABASE_READ_URL` (replica, via its own PgBouncer) | replica-tolerant reads only |

When `DATABASE_READ_URL` is **unset**, `prismaRead === prisma`: single-database mode. Nothing else changes; this is the safe default and the rollback (see below).

## The routing helpers

Reads run inside an RLS transaction (`SET LOCAL ROLE app_user` and the tenant setting; see [rls-tenant-isolation.md](rls-tenant-isolation.md)). Two context helpers in `src/lib/db-context.ts`, re-exported from `@/lib/db/rls-middleware`:

- **`runInTenantContext(ctx, fn)`** opens the transaction on the **primary**. The default for all reads and every write.
- **`runInTenantReadContext(ctx, fn)`** opens the transaction on **`prismaRead`** and marks it `READ ONLY`. Use it ONLY for replica-tolerant reads. A write inside it fails fast (the replica rejects it, and `READ ONLY` rejects it on the primary too), so the "no writes on the read path" rule is enforced at runtime.

> Why not `@prisma/extension-read-replicas`? Islestone is Prisma 7 with driver adapters, and every tenant read runs inside an interactive `$transaction` (the RLS context). That extension never routes queries inside a transaction to a replica, so it would route almost nothing here. Explicit `runInTenantReadContext` is both functional and reviewable.

## Routing rules

| Read class | Route | Why |
|------------|-------|-----|
| Dashboards / aggregations / reporting | **replica** (`runInTenantReadContext`) | high-cost, lag-tolerant |
| List reads | replica-eligible; served from the primary until a measured win | lag-tolerant |
| Detail reads, **especially read-after-write** | **primary** (`runInTenantContext`) | a GET right after a POST must see the write |
| Auth / session / billing | **primary** | latency-sensitive and tightly coupled to writes |
| All writes | **primary** | replicas are read-only |

No usecase is routed to the replica yet. `ROUTED_USECASES` in `tests/guards/database-routing-coverage.test.ts` lists each one that is, and the guard checks it really calls `runInTenantReadContext`. Analytics (sub-phase 3.6) is the expected first.

## The read-after-write rule (and how it is enforced)

A read that must observe a just-committed write **must** use the primary (`runInTenantContext`). A replica lags, and a detail read after a create on the replica could 404 or show stale data.

Enforcement is three-layered:
1. **Review.** `runInTenantReadContext` is a visible, greppable marker at the usecase boundary.
2. **Guard.** `tests/guards/database-routing-coverage.test.ts` fails if any file under `src/` writes (`.create(`, `.update(`, `.delete(`, `.upsert(`, `$executeRaw`, `logEvent(` …) inside a `runInTenantReadContext` callback.
3. **Runtime.** The read context's transaction is `READ ONLY`; a stray write throws immediately.

## Replication-lag contract

- **Eventually consistent.** Soft target: under 5 s of lag; alert above 30 s (the alert itself arrives with observability, sub-phase 1.6).
- Under sustained high lag, **back off**: unset `DATABASE_READ_URL` (rollback below) so all traffic returns to the primary until the replica catches up.

## Rollback / opt-out

Set **`DATABASE_READ_URL=""`** (or unset it) and restart the app. `prismaRead` falls back to `prisma`, and `runInTenantReadContext` transparently uses the primary. No code change: the single safe lever during a replica incident.
