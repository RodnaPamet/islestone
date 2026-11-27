-- Sub-phase 4.1a: the `docs` permission domain becomes `pages` (owner
-- decision 339; ADR 0015 §10; docs/porting/maps/4.1.md, "Keys and who sees
-- what"). "Doc" is a banned word for a page (ADR 0006), and a permission key
-- is customer-facing, so the unused `docs` domain (`view`, `create`, `edit`)
-- is renamed and gains `comment` and `delete`.
--
-- Stored custom roles keep what they granted: a role's `docs` object is
-- rewritten to a `pages` object, `view` to `view`, `create` to `create`,
-- `edit` to `edit`, and `comment` and `delete` taken from `edit`; a value
-- that is not a boolean is dropped, so the reader falls back to the role's
-- base, as it does for any unreadable value (`parsePermissionsJson`). A role
-- with no `docs` object is left alone. Idempotent: a role that already holds
-- `pages` keeps it.
--
-- Audited by count (decision 339): one entry per workspace that had roles
-- rewritten, written to the audit outbox here and appended to the hash
-- chain by the `audit-outbox-flush` drain within five minutes (the chain's
-- hash is computed by the application, which a migration cannot run). The
-- entry names the count, never a role's grants.
--
-- The previous image reads `docs` and finds it gone: its parser falls back
-- to the base role's defaults for that domain, and no route asks a `docs`
-- key, so nothing it serves changes.

WITH rewritten AS (
    UPDATE "TenantCustomRole" r
       SET "grantsJson" = (r."grantsJson" - 'docs') || jsonb_build_object('pages', jsonb_strip_nulls(jsonb_build_object(
               'view',    CASE WHEN jsonb_typeof(r."grantsJson"->'docs'->'view')   = 'boolean' THEN r."grantsJson"->'docs'->'view' END,
               'create',  CASE WHEN jsonb_typeof(r."grantsJson"->'docs'->'create') = 'boolean' THEN r."grantsJson"->'docs'->'create' END,
               'edit',    CASE WHEN jsonb_typeof(r."grantsJson"->'docs'->'edit')   = 'boolean' THEN r."grantsJson"->'docs'->'edit' END,
               'comment', CASE WHEN jsonb_typeof(r."grantsJson"->'docs'->'edit')   = 'boolean' THEN r."grantsJson"->'docs'->'edit' END,
               'delete',  CASE WHEN jsonb_typeof(r."grantsJson"->'docs'->'edit')   = 'boolean' THEN r."grantsJson"->'docs'->'edit' END
           ))),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE jsonb_typeof(r."grantsJson"->'docs') = 'object'
       AND NOT (r."grantsJson" ? 'pages')
    RETURNING r."tenantId"
),
per_workspace AS (
    SELECT "tenantId", count(*)::integer AS "roles" FROM rewritten GROUP BY "tenantId"
)
INSERT INTO "AuditOutbox" ("id", "tenantId", "payloadJson", "occurredAt", "action", "status", "attempts", "nextAttemptAt", "createdAt")
SELECT gen_random_uuid()::text,
       w."tenantId",
       jsonb_build_object(
           'tenantId', w."tenantId",
           'userId', NULL,
           'actorType', 'SYSTEM',
           'entity', 'TenantCustomRole',
           'entityId', w."tenantId",
           'action', 'CUSTOM_ROLES_DOMAIN_RENAMED',
           'details', format('Rewrote the docs grants of %s custom role(s) to pages (decision 339)', w."roles"),
           'detailsJson', jsonb_build_object(
               'category', 'custom',
               'operation', 'permission_domain_renamed',
               'fromDomain', 'docs',
               'toDomain', 'pages',
               'rolesRewritten', w."roles",
               'decision', 339
           )
       ),
       CURRENT_TIMESTAMP,
       'CUSTOM_ROLES_DOMAIN_RENAMED',
       'PENDING',
       0,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
  FROM per_workspace w;

-- A `docs` key that is not an object grants nothing readable; drop it too.
UPDATE "TenantCustomRole" SET "grantsJson" = "grantsJson" - 'docs', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "grantsJson" ? 'docs';
