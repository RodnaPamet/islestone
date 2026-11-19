# Prisma multi-file schema

The schema lives in this directory, not in a single `prisma/schema.prisma`. `prisma.config.ts` names the folder (`schema: path.join('prisma', 'schema')`), and Prisma 7 reads every `.prisma` file in it and concatenates them into one model graph at generate and migrate time. `tests/guards/prisma-schema-folder-coverage.test.ts` holds that layout.

## Layout

| File | What lives here |
|---|---|
| `base.prisma` | `generator client` + `datasource db` (the only ones; Prisma rejects duplicates across the folder) |
| `enums.prisma` | Every enum |
| `tenancy.prisma` | `Organization`, `OrgMembership`, `Tenant` (a workspace), `TenantMembership`, `User` |
| `auth.prisma` | The NextAuth, session, MFA, invite, custom-role and password-reset models, and `TenantSecuritySettings` (sub-phase 1.4; 1.5 adds the audit-stream columns) |
| `audit-trail.prisma` | `AuditLog`, `OrgAuditLog`, `AuditOutbox` (sub-phase 1.5, [docs/audit-trail.md](../../docs/audit-trail.md)) |

Later sub-phases add one file per domain.

## Conventions

### One owner per declaration

A model or enum lives in exactly one file. A cross-domain relation is declared on the owning side, in the model's own domain file; the reverse-relation field on the referenced model is declared in the referenced model's home file.

### Generator and datasource

Exactly one generator and one datasource block, both in `base.prisma`. The datasource carries no `url`: Prisma 7 rejects it there. The CLI reads the URL from `prisma.config.ts` (`DIRECT_DATABASE_URL`, else `DATABASE_URL`), and the runtime client passes it to the `@prisma/adapter-pg` driver adapter (`src/lib/prisma.ts`).

### Enum policy

All enums live in `enums.prisma`, even when one domain references them today: enums gain consumers across domains, one home avoids duplicate declarations, and enum diffs stay in one file. Declaration order is physical order, and order is meaning for `Role` (seniority, ADR 0006). `tests/guards/enum-member-order-matches-migrations.test.ts` holds the schema order equal to the migrations' order, and `tests/guards/migration-enum-isolation.test.ts` refuses a bare `ALTER TYPE … ADD VALUE` mixed with other DDL.

### Vocabulary

Names follow [ADR 0006](../../docs/adr/0006-vocabulary.md). No `@map` or `@@map` renames a model, enum or column (rule 3), and no identifier uses a word the ADR bans; `tests/guards/schema-vocabulary.test.ts` holds both.

### Migration discipline

`prisma/migrations` is the only apply path. A database built from it must reproduce this folder exactly, both ways: `npm run db:check-schema-drift` (`scripts/check-fresh-db-schema-drift.mjs`) runs `prisma migrate diff` against a freshly migrated database in CI and compares the result with `prisma/fresh-db-schema-drift.expected.sql`, which holds one deliberate line (`User.emailHash`, nullable in the schema and NOT NULL in the database; see [docs/encryption.md](../../docs/encryption.md)). A migration that creates a tenant table carries its RLS policies and its `GRANT … TO app_user` (see [docs/rls-tenant-isolation.md](../../docs/rls-tenant-isolation.md)).

## Running Prisma

```
npm run db:generate          # prisma generate (also runs as postinstall)
npm run db:migrate           # prisma migrate dev, while developing
npm run migrate:deploy       # prisma migrate deploy
npm run db:check-schema-drift
npx prisma format            # format every .prisma file in the folder
```

`prisma.config.ts` loads `.env.local` and friends with `@next/env`, so the CLI sees the same local values `next dev` does.
