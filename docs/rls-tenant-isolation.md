# PostgreSQL Row-Level Security

Multi-tenant isolation in Islestone is enforced at **two** layers, in this order of authority:

1. **PostgreSQL RLS policies.** Every tenant-scoped table has a `tenant_isolation` policy, (for direct-scoped tables) a `tenant_isolation_insert` policy, and a `superuser_bypass` policy that explicitly re-admits non-`app_user` sessions. This is the load-bearing contract: even an app-layer bug (a missing `where: { tenantId }`) cannot leak across tenants, because the database returns zero rows.
2. **Application-layer `tenantId` filters.** Every repository query also filters by `tenantId`. This is defence in depth, and keeps error messages clear when the app code is working correctly.

The workspace is the `Tenant` model in code and the database ("Workspace" in everything a customer reads; [ADR 0006](adr/0006-vocabulary.md), option W1). This doc covers the RLS side: how to use it, when to bypass, and the rules that keep the architecture durable. The first migration, `prisma/migrations/20261119120000_tenancy_core/migration.sql`, holds the canonical shapes.

## The role model

| Postgres role | Used by | RLS behaviour |
|---|---|---|
| The login role (`islestone` locally; a superuser in development and CI) | Migrations, seeds, admin scripts, auth lookups, webhook ingest, cross-tenant sweeps, the organization paths | Admitted by the `superuser_bypass` policy (`current_setting('role') != 'app_user'`). Sees everything. |
| `app_user` (NOLOGIN, granted to the login role) | All normal request handlers and per-tenant jobs, via `runInTenantContext` | `superuser_bypass` does not match. `tenant_isolation` enforces `"tenantId" = current_setting('app.tenant_id')`. Sees only own-tenant rows. |

`FORCE ROW LEVEL SECURITY` is enabled on every tenant-scoped table, so policies apply to the table owner too, which is why `superuser_bypass` exists to re-admit trusted non-app paths.

The migration creates `app_user` if it is missing, and grants it, but never names a login role. Making the login role a member of `app_user` (without which `SET ROLE app_user` fails) is done outside migrations: by `prisma/init-roles.sh`, which `docker-compose.yml` mounts into the Postgres image, and by the CI `Integration` job, which runs the same script. Production must connect as a role that is neither a superuser nor `BYPASSRLS` and is a member of `app_user`. Since sub-phase 1.8 it does: the app, the worker and PgBouncer use `islestone_app`, created by `deploy/postgres/init-runtime-role.sh` on the production volume's first start, while migrations run as the superuser that owns the tables (`docs/deployment.md`, "Database roles"; `tests/integration/runtime-role.test.ts`). The runtime role inherits exactly `app_user`'s grants, so a table `app_user` cannot read, it cannot read either.

## The canonical API

All tenant-scoped database access imports from **`@/lib/db/rls-middleware`**.

### `runInTenantContext(ctx, callback)` — the only right answer for request code

```ts
import { runInTenantContext } from '@/lib/db/rls-middleware';
import type { RequestContext } from '@/app-layer/types';

export async function listMembers(ctx: RequestContext) {
    return runInTenantContext(ctx, async (db) => {
        return db.tenantMembership.findMany({ where: { tenantId: ctx.tenantId } }); // RLS filters too
    });
}
```

Inside the callback:
- `SET LOCAL ROLE app_user` has dropped the login role's privilege for this transaction.
- `set_config('app.tenant_id', ctx.tenantId, true)` has bound the session variable to the transaction.
- Every query hits the RLS policies and sees only `ctx.tenantId` rows.
- The transaction commits, and `LOCAL` settings reset automatically.
- It is safe under PgBouncer transaction pooling.

`runInTenantReadContext` (read replica, `READ ONLY`; see [database-routing.md](database-routing.md)) and `runInTenantJobContext` (a background job's tenant context; it refuses the KEK-bypass source labels `seed`, `job` and `system`) take the same posture. `withTenantDb(tenantId, …)` is the lower-level form; usecases use `runInTenantContext` (`tests/guards/no-direct-prisma.test.ts`).

### `runWithoutRls({ reason }, callback)` — explicit, logged bypass

```ts
import { runWithoutRls } from '@/lib/db/rls-middleware';

// Auth flow: tenant not yet known
const memberships = await runWithoutRls(
    { reason: 'auth-tenant-discovery' },
    async (db) => db.tenantMembership.findMany({ where: { userId } }),
);
```

Rules:
- `reason` must be a literal from `RlsBypassReason`. The union is the allowlist; adding a reason means editing `rls-middleware.ts` (an intentional code-review checkpoint), and the runtime rejects any other string.
- Every invocation logs at `info` level with `reason` and a caller fingerprint (`module/file.ts:line`), so bypass usage can be audited from the logs.
- The callback receives the raw `prisma` client; queries run as the login role and `superuser_bypass` admits them.

Current reasons:

| Reason | Used by |
|---|---|
| `auth-tenant-discovery` | Tenant resolution before a tenant context exists (`resolveTenantContext`, `getDefaultTenantForUser`); the NextAuth callbacks in 1.4 |
| `auth-credentials` | Password reset, invite redemption, pre-auth lookups (1.4) |
| `webhook-ingest` | Inbound webhook receipt before the tenant is resolved |
| `cross-tenant-sweep` | Scheduled jobs that iterate every tenant by design |
| `seed` | Seed scripts |
| `admin-script` | One-off maintenance and repair scripts |
| `test` | Test fixtures that need to seed across tenants |

## Adding a new tenant-scoped table

When a new Prisma model with `tenantId` lands, the SAME migration that creates it carries (roadmap section 4):

```sql
ALTER TABLE "NewModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NewModel" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "NewModel"
    USING ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY tenant_isolation_insert ON "NewModel"
    FOR INSERT WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::text);
CREATE POLICY superuser_bypass ON "NewModel"
    USING (current_setting('role') != 'app_user');
GRANT SELECT, INSERT, UPDATE, DELETE ON "NewModel" TO app_user;
```

Keep the per-table `GRANT`. `ALTER DEFAULT PRIVILEGES` covers only tables later created by the role that ran it, so if migrations ever run as a role other than the one that ran the first migration, a table created without its own grant is invisible to `app_user` (and to the production runtime role, which reads through it), and RLS on a table `app_user` cannot read is a 500, not isolation.

The model also needs a `tenantId`-leading index and a two-tenant behavioural test listed in `ISOLATION_TESTED` (`tests/guards/tenant-isolation-forward-lock.test.ts`). CI catches a forgotten piece:

- `tests/guards/rls-migration-policies.test.ts` (no database) fails when a `TENANT_SCOPED_MODELS` table lacks a policy or FORCE in the migrations.
- `tests/integration/rls-coverage.test.ts` reads `pg_policies`, FORCE and `has_table_privilege` on the migrated database.
- `tests/guards/schema-index-coverage.test.ts` fails on a missing tenant-leading index.
- `tests/guards/tenant-isolation-forward-lock.test.ts` fails until the two-tenant test exists.

`TENANT_SCOPED_MODELS` is derived from the Prisma DMMF at runtime, so every model with a `tenantId` column enters the inventory by itself.

### Special-case policies

Three shapes, picked by the column shape:

| Class | When | Policy form |
|---|---|---|
| **A — standard** | `tenantId String` (required) | Split: `tenant_isolation` USING + `tenant_isolation_insert` FOR INSERT WITH CHECK. `TenantMembership` is the first. |
| **C — nullable tenant** | `tenantId String?` | **Single** permissive policy with both `USING (tenantId IS NULL OR …)` and a strict `WITH CHECK (tenantId = …)`. Splitting leaks through permissive-OR. Add the model to `SINGLE_POLICY_EXCEPTIONS` in `tests/helpers/rls-policies.ts`. `UserSession` (1.4) is expected to be the first. |
| **E — ownership-chained** | No `tenantId` column; scoped through a parent FK | **Single** permissive policy with `USING (EXISTS parent matches)` and `WITH CHECK (EXISTS both parents match for junctions)`. Do not use a split policy: the `FOR ALL USING` doubles as WITH CHECK for INSERT and admits cross-tenant parent pairs. List the model in `OWNERSHIP_CHAINED_MODELS` in `rls-middleware.ts`, which is the denominator for the guards and the tripwire. ADR 0002 denormalises `tenantId`, so none is expected. |

## The organization axis

`Organization` and `OrgMembership` carry no `tenantId`. They sit on a second axis keyed on the session variable `app.user_id`: `org_isolation` on `Organization` (an EXISTS over the requester's own membership) and `org_membership_self_isolation` on `OrgMembership` (`"userId" = current_setting('app.user_id', true)`), each with `superuser_bypass` and FORCE. The policies are USING-only, so `app_user` can never INSERT or UPDATE them.

**Nothing sets `app.user_id` yet**, as in inflect-compliance. Under `app_user` both tables therefore return zero rows, which fails closed, and every organization path reads and writes through the login role (the global client or `runWithoutRls`), gated at the API layer by `getOrgCtx`. Setting `app.user_id` inside `runInTenantContext` is a separate decision, and must first change the org last-owner trigger (below).

## Global tables

`Tenant` and `User` have no RLS. Because of the grant above, a query on the transaction client inside `runInTenantContext` can read every `User` row in the deployment. Whether to put `User` behind RLS (by shared membership) or revoke `app_user`'s SELECT on it is an open hardening (H1) question.

## The last-owner triggers under RLS

The migration installs `tenant_membership_last_owner_guard` (`check_not_last_owner`) and `org_membership_last_owner_guard` (`check_not_last_org_owner`). Each takes a transaction-scoped advisory lock before it counts, keyed `hashtext('tenant-owner:' || tenantId)` and `hashtext('org-owner:' || organizationId)`, the keys `lockTenantOwners` and `lockOrgOwners` take in TypeScript. Keep both functions VOLATILE: their count reads a fresh snapshot only because it runs after the lock.

Neither function is `SECURITY DEFINER`, so their reads run as the writer and are RLS-filtered when the writer is `app_user`:

- **The tenant trigger is correct under `app_user`.** Inside `runInTenantContext` a writer can only touch rows of `app.tenant_id`, and the trigger counts rows of that same tenant. Its `Tenant.deletedAt` check reads a table with no RLS.
- **The org trigger is correct only on the login role.** Under `app_user` with `app.user_id` unset, the organization reads as gone, so a delete would be treated as the organization's own cascade; today that cannot happen, because the same unset variable hides every `OrgMembership` row. With `app.user_id` set, the count sees only the caller's own rows, and a legitimate demotion is refused. So every org-membership write stays on the login role. Whoever sets `app.user_id` must first make the function `SECURITY DEFINER` with `SET search_path = public`, owned by a role that bypasses RLS, or give the trigger its own policy, and add a test.

## Adding a new bypass reason

Rare. Ask first: is this really a bypass, or missing `ctx` plumbing? If it is genuinely required, extend `RlsBypassReason` and `KNOWN_REASONS` in `src/lib/db/rls-middleware.ts` and document the reason in the table above.

## Testing

| Test | What it guarantees |
|---|---|
| `tests/guards/rls-migration-policies.test.ts` | With no database: every `TENANT_SCOPED_MODELS` table has `tenant_isolation`, `tenant_isolation_insert` and `superuser_bypass` and FORCE in the migrations; every org-axis table has its named policy, `superuser_bypass` and FORCE. |
| `tests/integration/rls-coverage.test.ts` | On the migrated database: the same policies in `pg_policies`, FORCE, the canonical `superuser_bypass` shape, no `allow_all`, and `app_user` holding SELECT, INSERT, UPDATE and DELETE on every tenant- and org-scoped table. |
| `tests/integration/rls-middleware.test.ts` | `runInTenantContext` runs as `app_user` and isolates, `SET LOCAL` is transaction-scoped under concurrency, `runWithoutRls` bypasses, the org axis returns nothing under `app_user`. |
| `tests/integration/tenant-membership-isolation.test.ts` | The two-tenant test for `TenantMembership`: read, list, count, update, delete, upsert and create from tenant B never reach tenant A. |
| `tests/integration/last-owner-guard.test.ts`, `org-last-owner-guard.test.ts`, `tenant-owner-race.test.ts`, `org-owner-race.test.ts` | Both last-owner triggers, the purge exemption, and the advisory lock under concurrent cross-demotions. |
| `tests/unit/rls-middleware.test.ts` | `runWithoutRls` rejects unknown reasons, logs a caller fingerprint and never leaks query payloads; the tripwire logs writes-without-context at `warn`, reads at `debug`, and never throws. |

```bash
npx jest tests/guards/rls-migration-policies.test.ts   # no database
npm run test:integration                               # needs DATABASE_URL_TEST or DATABASE_URL
```

## Don'ts

- **Don't** import `prisma` directly in repositories or usecases. Go through `runInTenantContext` or `runWithoutRls` (`tests/guards/no-direct-prisma.test.ts`).
- **Don't** add a tenant-scoped model without its RLS, grant, index and two-tenant test in the same pull request.
- **Don't** introduce a bypass by calling `prisma` from a module that is not obviously an auth, webhook or seed path. Use `runWithoutRls({ reason })` so the log record exists.
- **Don't** remove a `superuser_bypass` policy: FORCE RLS would block the table owner, and migrations and seeds would fail.
- **Don't** rename `app.tenant_id`. Every policy reads it; a rename needs coordinated policy and `runInTenantContext` changes for no security benefit.
- **Don't** widen a Class-C (nullable-tenant) policy into the split form.
- **Don't** set `app.user_id` before fixing the org last-owner trigger (above).
